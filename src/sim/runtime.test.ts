import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createSnapshotStorage, snapshotTransferList } from '../shared/simulation';
import type { SimulationCommand, SimulationEvent, SimulationSnapshot } from '../shared/simulation';
import { ovalFixture } from './fixtures/oval';
import { MAX_BATCH_STEPS, WorkerRuntime } from './runtime';
import type { WorkerHost } from './runtime';

/** Real engine + real structured-clone transfers, with only the wall clock/queue controlled. */
class Host implements WorkerHost {
  time = 0;
  events: SimulationEvent[] = [];
  tasks = new Map<number, () => void>();
  next = 0;
  runtime = new WorkerRuntime(this);
  now(): number { return this.time; }
  schedule(callback: () => void): number { this.tasks.set(++this.next, callback); return this.next; }
  cancel(handle: unknown): void { this.tasks.delete(handle as number); }
  send(event: SimulationEvent, transfer: ArrayBuffer[] = []): void { this.events.push(structuredClone(event, { transfer })); }
  command(command: SimulationCommand): void { this.runtime.receive(command); }
  reset(runId = 1, changes = {}): void {
    this.command({ type: 'reset', runId, track: ovalFixture(), settings: { ...DEFAULT_SETTINGS, population: 16, eliteCount: 2, ...changes } });
  }
  pump(elapsed = 0): void {
    this.time += elapsed;
    const first = this.tasks.entries().next().value;
    if (first) { this.tasks.delete(first[0]); first[1](); }
  }
  snapshots(): SimulationSnapshot[] { return this.events.flatMap((e) => e.type === 'snapshot' ? [e.snapshot] : []); }
  recycle(snapshot: SimulationSnapshot): void {
    this.runtime.receive(structuredClone({ type: 'recycle', runId: snapshot.runId, storage: snapshot.storage }, { transfer: snapshotTransferList(snapshot.storage) }));
  }
}

describe('worker acceptance, scheduling and lifecycle', () => {
  it('starts paused with generation one, initial snapshot and no queued work', () => {
    const h = new Host(); h.reset();
    expect(h.events.map((e) => e.type)).toEqual(['ready', 'snapshot']);
    expect(h.snapshots()[0]).toMatchObject({ generation: 1, tick: 0, generationTick: 0, rate: 1, running: false, selected: null, steps: 0 });
    h.pump(10000); expect(h.runtime.engine!.tick).toBe(0); expect(h.tasks.size).toBe(0);
  });
  it('validates reset transactionally, continues accepted old run, and consumes failed request ids', () => {
    const h = new Host(); h.reset(); h.command({ type: 'set-running', runId: 1, running: true }); h.pump(100);
    const old = h.runtime.engine, tick = old!.tick;
    h.reset(3, { population: 1001 });
    expect(h.runtime.engine).toBe(old); expect(h.runtime.running).toBe(true);
    expect(h.events.at(-1)).toMatchObject({ type: 'error', runId: 3 });
    h.pump(100); expect(old!.tick).toBeGreaterThan(tick);
    h.reset(2); expect(h.runtime.engine).toBe(old);
    h.reset(4); expect(h.runtime.engine!.runId).toBe(4); expect(h.runtime.engine!.tick).toBe(0); expect(h.runtime.running).toBe(false);
  });
  it('pauses without advancing, cancels queued work and discards elapsed time on resume', () => {
    const h = new Host(); h.reset(); h.command({ type: 'set-running', runId: 1, running: true }); h.pump(100);
    const tick = h.runtime.engine!.tick;
    h.command({ type: 'set-running', runId: 1, running: false }); h.pump(100000);
    expect(h.runtime.engine!.tick).toBe(tick); expect(h.tasks.size).toBe(0);
    h.command({ type: 'set-running', runId: 1, running: true }); h.pump(); expect(h.runtime.engine!.tick).toBe(tick);
    h.pump(1000 / 60); expect(h.runtime.engine!.tick).toBe(tick + 1);
  });
  it('steps at 1x/4x wall rates and bounds a long stall to 250ms of simulated accumulation', () => {
    const h = new Host(); h.reset(); h.command({ type: 'set-running', runId: 1, running: true }); h.pump(100);
    expect(h.runtime.engine!.tick).toBe(6);
    h.command({ type: 'set-rate', runId: 1, rate: 4 }); h.pump(50); expect(h.runtime.engine!.tick).toBe(18);
    h.pump(100000); expect(h.runtime.engine!.tick).toBe(33);
  });
  it('bounds fast batches and remains command responsive even when nobody recycles snapshots', () => {
    const h = new Host(); h.reset(); h.command({ type: 'set-rate', runId: 1, rate: 'fast' }); h.command({ type: 'set-running', runId: 1, running: true });
    for (let i = 0; i < 50; i++) h.pump(100);
    expect(h.runtime.engine!.tick).toBe(MAX_BATCH_STEPS * 50);
    expect(h.snapshots()).toHaveLength(3); // pool exhaustion never allocates or blocks evolution
    h.command({ type: 'set-running', runId: 1, running: false }); h.pump(1000);
    expect(h.runtime.engine!.tick).toBe(MAX_BATCH_STEPS * 50);
    h.recycle(h.snapshots()[0]!);
    expect(h.snapshots()).toHaveLength(4);
    expect(h.snapshots().at(-1)).toMatchObject({ tick: MAX_BATCH_STEPS * 50, running: false, steps: MAX_BATCH_STEPS * 50 });
  });
  it('ignores obsolete commands and recycled slots after reset', () => {
    const h = new Host(); h.reset(); const old = h.snapshots()[0]!; h.reset(2);
    h.command({ type: 'set-running', runId: 1, running: true }); h.command({ type: 'set-rate', runId: 1, rate: 'fast' }); h.recycle(old);
    expect(h.runtime.running).toBe(false); expect(h.runtime.rate).toBe(1); expect(h.snapshots()).toHaveLength(2);
  });
  it('emits every generation exactly once before a snapshot of a later generation, clearing selection', () => {
    const h = new Host(); h.reset(1, { generationSeconds: 1 / 60 }); h.command({ type: 'select', runId: 1, car: { runId: 1, generation: 1, index: 0 } });
    h.command({ type: 'set-running', runId: 1, running: true }); h.pump(100);
    h.recycle(h.snapshots()[0]!); h.command({ type: 'set-running', runId: 1, running: false });
    const generations = h.events.filter((e) => e.type === 'generation');
    expect(generations.map((e) => e.statistics.generation)).toEqual([1, 2, 3, 4, 5, 6]);
    const latest = h.snapshots().at(-1)!;
    expect(latest.generation).toBe(7); expect(latest.selected).toBeNull();
    const generationIndex = h.events.findIndex((e) => e.type === 'generation' && e.statistics.generation === 6);
    const snapshotIndex = h.events.findIndex((e) => e.type === 'snapshot' && e.snapshot.generation === 7);
    expect(generationIndex).toBeLessThan(snapshotIndex);
  });
  it('rejects malformed recycled sizes without poisoning future delivery and bounds errors', () => {
    const h = new Host(); h.reset();
    for (let i = 0; i < 100; i++) h.command({ type: 'recycle', runId: 1, storage: createSnapshotStorage(17) });
    expect(h.events.filter((e) => e.type === 'error')).toHaveLength(1);
    h.recycle(h.snapshots()[0]!);
    h.command({ type: 'select', runId: 1, car: { runId: 1, generation: 1, index: 4 } });
    expect(h.snapshots().at(-1)!.selected?.index).toBe(4);
    for (let i = 2; i < 30; i++) h.reset(i, { seed: -1 });
    expect(h.events.filter((e) => e.type === 'error')).toHaveLength(29);
    expect(h.runtime.engine!.runId).toBe(1);
  });
  it('restarts the exact seeded state and clears rate, selection and history records', () => {
    const h = new Host(); h.reset(); const initial = h.snapshots()[0]!.storage.cars.slice();
    h.command({ type: 'set-rate', runId: 1, rate: 'fast' }); h.command({ type: 'set-running', runId: 1, running: true }); h.pump(100);
    h.reset(2);
    const next = h.snapshots().at(-1)!; expect(next.storage.cars).toEqual(initial);
    expect(next).toMatchObject({ rate: 1, selected: null, tick: 0, running: false }); expect(h.runtime.engine!.bestLap).toBeNull();
  });
});


describe('production cadence and reset acknowledgements', () => {
  it.each([1, 4] as const)('delivers fresh normal state at 60 Hz at %ix without a wall-clock gate', (rate) => {
    const h = new Host(); h.reset(); h.command({ type: 'set-rate', runId: 1, rate });
    h.command({ type: 'set-running', runId: 1, running: true });
    for (const snapshot of h.snapshots()) h.recycle(snapshot);
    h.events = [];
    // Exact host timing reproduces the old alternating-delivery defect.
    for (let i = 0; i < 600 * rate; i++) {
      h.pump(1000 / 60 / rate);
      for (const snapshot of h.snapshots()) if (snapshot.storage.cars.byteLength) h.recycle(snapshot);
    }
    const snapshots = h.snapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(599);
    expect(snapshots.length).toBeLessThanOrEqual(601);
    expect(snapshots.every((s) => s.steps === rate)).toBe(true);
  });
  it('acknowledges an invalid reset after all eight malformed-command errors', () => {
    const h = new Host(); h.reset(10); h.command({ type: 'set-running', runId: 10, running: true });
    for (let i = 0; i < 8; i++) h.runtime.receive(i % 2 ? { type: 'set-running', runId: 10, running: 1 } : { type: 'set-rate', runId: 10, rate: 3 });
    expect(h.events.filter((e) => e.type === 'error')).toHaveLength(8);
    const accepted = h.runtime.engine;
    h.reset(11, { population: 5000 });
    expect(h.events.at(-1)).toMatchObject({ type: 'error', runId: 11 });
    expect(h.runtime.engine).toBe(accepted); expect(h.runtime.running).toBe(true);
    h.pump(100); expect(accepted!.tick).toBe(6);
    h.reset(12); expect(h.runtime.engine!.runId).toBe(12);
  });
});

describe('normal delivery phase', () => {
  it('keeps 4x delivery at 60 Hz when pumps cross a four-step boundary by one step', () => {
    const h = new Host(); h.reset(); h.command({ type: 'set-rate', runId: 1, rate: 4 }); h.command({ type: 'set-running', runId: 1, running: true });
    for (const s of h.snapshots()) h.recycle(s); h.events = [];
    let deliveries = 0;
    for (let i = 0; i < 2000; i++) {
      h.pump(5);
      for (const s of h.snapshots()) { deliveries++; h.recycle(s); }
      h.events = [];
    }
    expect(h.runtime.engine!.tick).toBe(2400); expect(deliveries).toBe(600);
  });
});
