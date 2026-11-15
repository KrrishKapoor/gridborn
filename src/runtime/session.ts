import type { TrackGeometry } from '../shared/geometry';
import { DEFAULT_SETTINGS, HISTORY_LIMIT, snapshotTransferList } from '../shared/simulation';
import type { BestTrajectory, CarId, GenerationHistory, GenerationStatistics, SimulationCommand, SimulationEvent, SimulationRate, SimulationSettings, SimulationSnapshot } from '../shared/simulation';

export interface Run { readonly id: number; readonly track: TrackGeometry; readonly settings: SimulationSettings }
/** Serial reset acceptance, with a single latest queued intention. IDs are never reused. */
export class Session {
  accepted: Run | null = null;
  pending: Run | null = null;
  queued: Run | null = null;
  desiredRunning = true;
  desiredRate: SimulationRate = 1;
  drawing = false;
  hidden = false;
  error = '';
  snapshot: SimulationSnapshot | null = null;
  private incoming: SimulationSnapshot | null = null;
  best: BestTrajectory | null = null;
  history: GenerationHistory = { runId: 0, completedGenerations: 0, entries: [] };
  private entries: GenerationStatistics[] = [];
  private nextId = 0;
  private selectionIntent: CarId | null = null;
  constructor(private readonly send: (command: SimulationCommand, transfer?: ArrayBuffer[]) => void,
    private readonly changed: (trackChanged: boolean) => void) {}
  get intention(): Run | null { return this.queued ?? this.pending ?? this.accepted; }
  get effectiveRunning(): boolean { return this.desiredRunning && !this.drawing && !this.hidden; }
  reset(track: TrackGeometry, settings: SimulationSettings = this.intention?.settings ?? DEFAULT_SETTINGS): void {
    const candidate = { id: ++this.nextId, track, settings: { ...settings } };
    this.error = '';
    if (this.pending) this.queued = candidate;
    else this.start(candidate);
    this.changed(false);
  }
  private start(candidate: Run): void {
    this.pending = candidate;
    this.send({ type: 'reset', runId: candidate.id, track: candidate.track, settings: candidate.settings });
  }
  private next(): void { const next = this.queued; this.queued = null; if (next) this.start(next); }
  running(value: boolean): void { this.desiredRunning = value; this.syncRunning(); this.changed(false); }
  rate(value: SimulationRate): void {
    this.desiredRate = value;
    if (this.accepted) this.send({ type: 'set-rate', runId: this.accepted.id, rate: value });
    this.changed(false);
  }
  syncRunning(): void {
    if (this.accepted) this.send({ type: 'set-running', runId: this.accepted.id, running: this.effectiveRunning });
  }
  select(car: CarId | null): void {
    this.selectionIntent = car;
    this.clearDisplayedSelection();
    if (this.accepted) this.send({ type: 'select', runId: this.accepted.id, car });
    this.changed(false);
  }
  private clearDisplayedSelection(): void {
    if (this.snapshot?.selected) this.snapshot = { ...this.snapshot, selected: null };
    if (this.incoming?.selected) this.incoming = { ...this.incoming, selected: null };
  }
  private recycle(snapshot: SimulationSnapshot | null): void {
    if (snapshot) this.send({ type: 'recycle', runId: snapshot.runId, storage: snapshot.storage }, snapshotTransferList(snapshot.storage));
  }
  receive(event: SimulationEvent): void {
    switch (event.type) {
      case 'ready': {
        if (event.runId !== this.pending?.id) return;
        this.recycle(this.incoming); this.recycle(this.snapshot); this.incoming = this.snapshot = null;
        this.accepted = this.pending; this.pending = null; this.error = ''; this.best = null; this.selectionIntent = null;
        this.entries = []; this.history = { runId: event.runId, completedGenerations: 0, entries: this.entries };
        this.send({ type: 'set-rate', runId: event.runId, rate: this.desiredRate }); this.syncRunning();
        this.next(); this.changed(true); break;
      }
      case 'error':
        if (event.runId === this.pending?.id) {
          this.pending = null; this.error = event.message; this.next(); this.changed(false);
        } else if (event.runId === this.accepted?.id) { this.error = event.message; this.changed(false); }
        break;
      case 'snapshot':
        if (event.snapshot.runId !== this.accepted?.id) { this.recycle(event.snapshot); return; }
        this.recycle(this.incoming);
        { const selected = event.snapshot.selected, intent = this.selectionIntent;
          const matches = selected && intent && selected.runId === intent.runId && selected.generation === intent.generation && selected.index === intent.index;
          this.incoming = selected && !matches ? { ...event.snapshot, selected: null } : event.snapshot;
        }
        break;
      case 'generation':
        if (event.statistics.runId !== this.accepted?.id || event.statistics.generation <= this.history.completedGenerations) return;
        this.selectionIntent = null; this.clearDisplayedSelection();
        if (this.entries.length === HISTORY_LIMIT) this.entries.shift();
        this.entries.push(event.statistics);
        this.history = { runId: event.statistics.runId, completedGenerations: event.statistics.generation, entries: this.entries };
        this.changed(false); break;
      case 'best':
        if (event.trajectory.car.runId !== this.accepted?.id) return;
        this.best = event.trajectory; this.changed(false); break;
    }
  }
  /** Retain the displayed slot until every synchronous consumer has finished. */
  takeSnapshot(): boolean {
    if (!this.incoming) return false;
    const previous = this.snapshot; this.snapshot = this.incoming; this.incoming = null;
    this.recycle(previous); return true;
  }
  dispose(): void { this.recycle(this.incoming); this.recycle(this.snapshot); this.incoming = this.snapshot = null; }
}
