import type { TrackGeometry, TrackIssue, TrackPreset } from './geometry';
import type { BestTrajectory, CarId, GenerationHistory, SimulationRate, SimulationSettings, SimulationSnapshot } from './simulation';

/** T3 emits intentions; T4 owns simulation, editor, rendering, and lifecycle. */
export interface PageActions {
  readonly onRunningChange: (running: boolean) => void;
  readonly onRateChange: (rate: SimulationRate) => void;
  readonly onPopulationChange: (population: number) => void;
  readonly onReset: () => void;
  readonly onDrawingChange: (enabled: boolean) => void;
  readonly onClear: () => void;
  readonly onPreset: (id: string) => void;
  readonly onSelectionClear: () => void;
}
export interface PageOptions {
  readonly actions: PageActions;
  readonly presets: readonly TrackPreset[];
  readonly settings: SimulationSettings;
}
export interface PageState {
  readonly generation: number;
  readonly alive: number;
  readonly population: number;
  readonly running: boolean;
  readonly rate: SimulationRate;
  readonly drawing: boolean;
  readonly selected: CarId | null;
  readonly bestLapSeconds: number | null;
  readonly history: GenerationHistory;
  readonly circuitLabel?: string;
  readonly pendingLabel?: string;
  readonly pendingPopulation?: number;
  readonly suspended?: boolean;
}
export interface GridbornPage {
  readonly heroCanvas: HTMLCanvasElement;
  readonly editorCanvas: HTMLCanvasElement; // transparent overlay, same CSS size/world transform
  readonly inspectionRoot: HTMLElement;
  readonly demos: readonly TeachingDemo[];
  update(state: PageState): void; // event/counter changes, not every simulation tick
  showTrackIssues(issues: readonly TrackIssue[]): void;
  destroy(): void;
}
/** Demos may borrow a snapshot only during this call; copy needed values before returning. */
export interface TeachingDemo {
  update(snapshot: SimulationSnapshot | null, history: GenerationHistory, best: BestTrajectory | null): void;
  /** Immutable main-owned geometry; never transferred to the worker. */
  setTrack?(track: TrackGeometry): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}
