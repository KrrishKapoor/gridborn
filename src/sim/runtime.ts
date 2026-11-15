import { FIXED_DT, createSnapshotStorage, snapshotTransferList } from '../shared/simulation';
import type { SimulationCommand, SimulationEvent, SimulationRate, SnapshotStorage } from '../shared/simulation';
import { Engine } from './engine';
import { validStorage, validateSettings, validateTrack } from './validation';

export interface WorkerHost {
  now(): number;
  schedule(callback: () => void, delay: number): unknown;
  cancel(handle: unknown): void;
  send(event: SimulationEvent, transfer?: ArrayBuffer[]): void;
}
export const BATCH_MS = 8;
export const MAX_BATCH_STEPS = 32;
export const MAX_ACCUMULATOR_SECONDS = 0.25;

/** Scheduling and transferable ownership are separate from deterministic engine steps. */
export class WorkerRuntime {
  engine: Engine | null = null;
  running = false;
  rate: SimulationRate = 1;
  private pool: SnapshotStorage[] = [];
  private outstanding = 0;
  private lastRequested = 0;
  private timer: unknown = null;
  private lastTime = 0;
  private accumulator = 0;
  private lastDelivery = -Infinity;
  private lastDeliveryTick = 0;
  private computeMs = 0;
  private steps = 0;
  private dirty = false;
  private errors = 0;
  private lastError = '';
  constructor(private readonly host: WorkerHost) {}

  receive(raw: unknown): void {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) { this.error(this.engine?.runId ?? 0, 'Malformed command.'); return; }
    const command = raw as SimulationCommand;
    if (command.type === 'reset') { this.reset(command); return; }
    const engine = this.engine;
    if (!engine || command.runId !== engine.runId) return;
    switch (command.type) {
      case 'set-running':
        if (typeof command.running !== 'boolean') { this.error(engine.runId, 'Running must be boolean.'); return; }
        this.running = command.running;
        this.clearSchedule(); this.accumulator = 0; this.lastTime = this.host.now();
        this.deliver(true);
        if (this.running) this.schedule(0);
        break;
      case 'set-rate':
        if (command.rate !== 1 && command.rate !== 4 && command.rate !== 'fast') { this.error(engine.runId, 'Rate must be 1, 4, or fast.'); return; }
        this.rate = command.rate;
        this.clearSchedule(); this.accumulator = 0; this.lastTime = this.host.now();
        this.deliver(true);
        if (this.running) this.schedule(0);
        break;
      case 'select': engine.select(command.car); this.deliver(true); break;
      case 'recycle':
        if (!validStorage(command.storage, engine.settings.population)) { this.error(engine.runId, 'Recycled storage has invalid sizes or ownership.'); return; }
        // Structured clone changes buffer identities. Outstanding credit bounds the pool even
        // for unsolicited/duplicate returns; full buffers and distinct backing stores are required.
        if (this.outstanding === 0 || this.pool.length >= 3) return;
        this.outstanding--; this.pool.push(command.storage);
        if (this.dirty) this.deliver(true);
        break;
      default: this.error(engine.runId, 'Unknown command.');
    }
  }

  private reset(command: Extract<SimulationCommand, { type: 'reset' }>): void {
    if (!Number.isSafeInteger(command.runId) || command.runId <= 0) { this.error(this.engine?.runId ?? 0, 'Run id must be a positive safe integer.', true); return; }
    if (command.runId <= this.lastRequested) return;
    this.lastRequested = command.runId;
    try {
      validateSettings(command.settings); validateTrack(command.track);
      // All potentially failing validation/allocation happens before replacing the accepted run.
      const candidate = new Engine(command.runId, command.track, { ...command.settings }, {
        generation: (statistics) => this.host.send({ type: 'generation', statistics }),
        best: (trajectory) => this.host.send({ type: 'best', trajectory }, [trajectory.samples.buffer]),
      });
      const pool = [createSnapshotStorage(command.settings.population), createSnapshotStorage(command.settings.population), createSnapshotStorage(command.settings.population)];
      this.clearSchedule(); this.engine = candidate; this.pool = pool; this.outstanding = 0;
      this.running = false; this.rate = 1; this.accumulator = 0; this.steps = 0; this.computeMs = 0;
      this.lastTime = this.host.now(); this.lastDelivery = -Infinity; this.lastDeliveryTick = 0; this.dirty = false; this.errors = 0; this.lastError = '';
      this.host.send({ type: 'ready', runId: command.runId });
      this.deliver(true);
    } catch (error) { this.error(command.runId, error instanceof Error ? error.message : 'Reset failed.', true); }
  }

  private error(runId: number, message: string, acknowledgement = false): void {
    const key = `${runId}:${message}`;
    if (!acknowledgement) {
      if (this.errors >= 8 || this.lastError === key) return;
      this.errors++; this.lastError = key;
    }
    this.host.send({ type: 'error', runId, message: message.slice(0, 240) });
  }
  private clearSchedule(): void {
    if (this.timer !== null) this.host.cancel(this.timer);
    this.timer = null;
  }
  private schedule(delay: number): void { this.timer = this.host.schedule(this.pump, delay); }
  private readonly pump = (): void => {
    this.timer = null;
    if (!this.running || !this.engine) return;
    const start = this.host.now();
    if (this.rate !== 'fast') this.accumulator = Math.min(MAX_ACCUMULATOR_SECONDS, this.accumulator + Math.max(0, start - this.lastTime) / 1000 * this.rate);
    this.lastTime = start;
    let count = 0;
    try {
      while (count < MAX_BATCH_STEPS && (this.rate === 'fast' || this.accumulator + 1e-12 >= FIXED_DT)) {
        this.engine.step(); count++;
        if (this.rate !== 'fast') this.accumulator = Math.max(0, this.accumulator - FIXED_DT);
        if (this.host.now() - start >= BATCH_MS) break;
      }
    } catch (error) {
      this.running = false; this.error(this.engine.runId, error instanceof Error ? error.message : 'Simulation failed.');
    }
    const end = this.host.now();
    this.computeMs += Math.max(0, end - start); this.steps += count;
    // Gate normal delivery by simulated steps, not a second wall clock. Timer
    // rounding must not discard alternating 1x frames. 4x groups four steps.
    if (!this.running || (count > 0 && (this.rate === 'fast' ? end - this.lastDelivery >= 100 : Math.floor(this.engine.tick / this.rate) > Math.floor(this.lastDeliveryTick / this.rate)))) this.deliver(false);
    if (this.running) this.schedule(this.rate === 'fast' ? 0 : Math.max(0, (FIXED_DT - this.accumulator) * 1000 / this.rate));
  };

  private deliver(force: boolean): void {
    const engine = this.engine;
    if (!engine) return;
    const storage = this.pool.pop();
    if (!storage) { this.dirty ||= force; return; }
    engine.copyInto(storage);
    this.outstanding++; this.dirty = false;
    this.host.send({ type: 'snapshot', snapshot: { runId: engine.runId, generation: engine.generation, tick: engine.tick,
      generationTick: engine.generationTick, population: engine.settings.population, alive: engine.alive,
      running: this.running, rate: this.rate, selected: engine.selected, storage, computeMs: this.computeMs, steps: this.steps } }, snapshotTransferList(storage));
    this.computeMs = 0; this.steps = 0; this.lastDelivery = this.host.now(); this.lastDeliveryTick = engine.tick;
  }
}
