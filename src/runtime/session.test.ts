import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createSnapshotStorage } from '../shared/simulation';
import type { SimulationCommand, SimulationSnapshot } from '../shared/simulation';
import { ovalFixture } from '../sim/fixtures/oval';
import { Session } from './session';

function setup() {
  const commands: SimulationCommand[] = [];
  const session = new Session((command, transfer = []) => commands.push(structuredClone(command, { transfer })), () => {});
  const track = ovalFixture(); session.reset(track); session.receive({ type: 'ready', runId: 1 });
  return { session, commands, track };
}
function snapshot(runId = 1, tick = 0): SimulationSnapshot {
  return { runId, tick, generation: 1, generationTick: tick, population: 512, alive: 512, running: true, rate: 1, selected: null, storage: createSnapshotStorage(512), computeMs: 1, steps: 1 };
}
describe('main-thread run and buffer ownership', () => {
  it('keeps accepted geometry and intentions through failed reset, then uses a new id', () => {
    const { session, commands, track } = setup(); const accepted = session.accepted;
    session.rate(4); session.running(false); session.reset(track, { ...DEFAULT_SETTINGS, population: 5000 });
    expect(session.accepted).toBe(accepted);
    session.receive({ type: 'error', runId: 2, message: 'Population must be 2–1000.' });
    expect(session.pending).toBeNull(); expect(session.accepted).toBe(accepted);
    session.reset(track); session.receive({ type: 'ready', runId: 3 });
    expect(session.accepted?.id).toBe(3);
    expect(commands.at(-2)).toMatchObject({ type: 'set-rate', runId: 3, rate: 4 });
    expect(commands.at(-1)).toMatchObject({ type: 'set-running', runId: 3, running: false });
  });
  it('coalesces rapid resets without treating an unaccepted run as current', () => {
    const { session, commands, track } = setup();
    session.reset({ ...track, id: 'first' }); session.reset({ ...track, id: 'skipped' }); session.reset({ ...track, id: 'last' });
    expect(commands.filter((c) => c.type === 'reset').map((c) => c.runId)).toEqual([1, 2]);
    expect(session.accepted?.track.id).toBe(track.id);
    session.receive({ type: 'ready', runId: 2 });
    expect(session.accepted?.track.id).toBe('first'); expect(session.pending?.id).toBe(4);
    session.receive({ type: 'ready', runId: 4 }); expect(session.accepted?.track.id).toBe('last');
    session.receive({ type: 'ready', runId: 2 }); expect(session.accepted?.id).toBe(4);
  });
  it('recycles superseded and stale slots immediately, but retains the display until replaced', () => {
    const { session } = setup();
    const a = snapshot(1, 1), b = snapshot(1, 2), c = snapshot(1, 3), stale = snapshot(99);
    session.receive({ type: 'snapshot', snapshot: a }); session.takeSnapshot();
    session.receive({ type: 'snapshot', snapshot: b }); session.receive({ type: 'snapshot', snapshot: c });
    expect(a.storage.cars.byteLength).toBeGreaterThan(0); expect(b.storage.cars.byteLength).toBe(0);
    session.receive({ type: 'snapshot', snapshot: stale }); expect(stale.storage.cars.byteLength).toBe(0);
    session.takeSnapshot(); expect(a.storage.cars.byteLength).toBe(0); expect(session.snapshot?.tick).toBe(3);
    session.dispose(); expect(c.storage.cars.byteLength).toBe(0);
  });
  it('bounds history and rejects stale, duplicate generation and best records', () => {
    const { session, track } = setup();
    for (let generation = 1; generation <= 300; generation++) session.receive({ type: 'generation', statistics: { runId: 1, generation, ticks: 60, bestFitness: 0.1, meanFitness: 0.05, completedLaps: 0, bestLapSeconds: null } });
    expect(session.history.entries).toHaveLength(256); expect(session.history.entries[0]?.generation).toBe(45);
    const record = session.history.entries[0]!; session.receive({ type: 'generation', statistics: record }); expect(session.history.entries).toHaveLength(256);
    session.reset(track); session.receive({ type: 'ready', runId: 2 });
    session.receive({ type: 'generation', statistics: record });
    session.receive({ type: 'best', trajectory: { car: { runId: 1, generation: 300, index: 0 }, fitness: 0.2, lapSeconds: null, samples: new Float32Array([1, 1, 1, 0]) } });
    expect(session.history.entries).toHaveLength(0); expect(session.best).toBeNull();
  });
  it('hidden and drawing suspension never change the visitor running preference', () => {
    const { session, commands } = setup();
    session.hidden = true; session.syncRunning(); expect(commands.at(-1)).toMatchObject({ running: false }); expect(session.desiredRunning).toBe(true);
    session.hidden = false; session.syncRunning(); expect(commands.at(-1)).toMatchObject({ running: true });
    session.drawing = true; session.syncRunning(); expect(commands.at(-1)).toMatchObject({ running: false });
    session.running(false); session.drawing = false; session.syncRunning(); expect(commands.at(-1)).toMatchObject({ running: false });
  });
});

describe('selection acknowledgements', () => {
  it('never revives a cleared or previous-generation selection from an in-flight snapshot', () => {
    const { session } = setup(); const car = { runId: 1, generation: 1, index: 0 };
    session.select(car); session.receive({ type: 'snapshot', snapshot: { ...snapshot(), selected: car } }); session.takeSnapshot();
    expect(session.snapshot?.selected).toEqual(car);
    session.select(null); expect(session.snapshot?.selected).toBeNull();
    session.receive({ type: 'snapshot', snapshot: { ...snapshot(), selected: car } }); session.takeSnapshot();
    expect(session.snapshot?.selected).toBeNull();
    session.select(car); session.receive({ type: 'snapshot', snapshot: { ...snapshot(), selected: car } }); session.takeSnapshot();
    session.receive({ type: 'generation', statistics: { runId: 1, generation: 1, ticks: 60, bestFitness: 0.1, meanFitness: 0.05, completedLaps: 0, bestLapSeconds: null } });
    expect(session.snapshot?.selected).toBeNull();
  });
});
