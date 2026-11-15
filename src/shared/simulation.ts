import type { TrackGeometry } from './geometry';

export const FIXED_DT = 1 / 60;
export const MAX_POPULATION = 1000;
export const HISTORY_LIMIT = 256;
/** Relative ray headings, radians. Input order matches this order, then speed. */
export const SENSOR_ANGLES = [-Math.PI / 2, -Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3, Math.PI / 2] as const;
export const NETWORK_LAYERS = [8, 8, 2] as const;
export const WEIGHT_COUNT = 90;
export const ACTIVATION_COUNT = 18;
/** Destination-major rows: input weights then bias, hidden layer then output layer. */
export const SENSOR_STRIDE = 3; // normalized distance, world hitX, world hitY (endpoint on miss)
export const CAR_STRIDE = 8;
export const CAR = { x: 0, y: 1, heading: 2, speed: 3, progress: 4, fitness: 5, inactiveSeconds: 6, status: 7 } as const;
export const CAR_STATUS = { active: 0, crashed: 1, finished: 2 } as const;
export const TRAJECTORY_STRIDE = 4; // world x, world y, heading, elapsed seconds

export interface SimulationSettings {
  readonly seed: number; // uint32
  readonly population: number; // integer 2..MAX_POPULATION
  readonly mutationRate: number; // independent probability per weight, [0, 1]
  readonly mutationScale: number; // nonnegative mutation magnitude
  readonly eliteCount: number; // integer 1..population-1
  readonly generationSeconds: number; // positive simulated-time deadline
  readonly rayLength: number; // positive world units
  readonly maxSpeed: number; // positive world units / second
}
export const DEFAULT_SETTINGS: SimulationSettings = {
  seed: 1, population: 512, mutationRate: 0.1, mutationScale: 0.25,
  eliteCount: 8, generationSeconds: 30, rayLength: 180, maxSpeed: 240,
};
export type SimulationRate = 1 | 4 | 'fast';
/** Slot is stable only within this run and generation. Never a persistent lineage id. */
export interface CarId { readonly runId: number; readonly generation: number; readonly index: number }

/** Each array has a separate full ArrayBuffer (not subarrays or SharedArrayBuffers). */
export interface SnapshotStorage {
  readonly cars: Float32Array<ArrayBuffer>; // population * CAR_STRIDE
  readonly sensors: Float32Array<ArrayBuffer>; // SENSOR_ANGLES.length * SENSOR_STRIDE
  readonly weights: Float32Array<ArrayBuffer>; // WEIGHT_COUNT; selected car only
  readonly activations: Float32Array<ArrayBuffer>; // inputs, hidden, outputs
}
export interface SimulationSnapshot {
  readonly runId: number;
  readonly generation: number; // 1-based
  readonly tick: number; // total fixed steps since reset
  readonly generationTick: number; // starts at 0
  readonly population: number;
  readonly alive: number;
  readonly running: boolean;
  readonly rate: SimulationRate;
  readonly selected: CarId | null; // null means ignore inspection arrays
  readonly storage: SnapshotStorage;
  /** Measured work for this delivery interval; not presentation FPS. */
  readonly computeMs: number;
  readonly steps: number;
}
export interface GenerationStatistics {
  readonly runId: number;
  readonly generation: number;
  readonly ticks: number;
  readonly bestFitness: number;
  readonly meanFitness: number;
  readonly completedLaps: number;
  readonly bestLapSeconds: number | null; // this generation, null until a real completion
}
export interface GenerationHistory {
  readonly runId: number;
  readonly completedGenerations: number;
  readonly entries: readonly GenerationStatistics[]; // latest HISTORY_LIMIT, oldest first
}
/** A recorded car path, never a centerline or synthetic trajectory. */
export interface BestTrajectory {
  readonly car: CarId;
  readonly fitness: number;
  readonly lapSeconds: number | null; // non-null only for an entire valid timed lap
  readonly samples: Float32Array<ArrayBuffer>; // TRAJECTORY_STRIDE; time relative to first sample
}

/** Reset sends a structured clone of geometry/settings; only recycle transfers ownership. */
export type SimulationCommand =
  | { readonly type: 'reset'; readonly runId: number; readonly track: TrackGeometry; readonly settings: SimulationSettings }
  | { readonly type: 'set-running'; readonly runId: number; readonly running: boolean }
  | { readonly type: 'set-rate'; readonly runId: number; readonly rate: SimulationRate }
  | { readonly type: 'select'; readonly runId: number; readonly car: CarId | null }
  | { readonly type: 'recycle'; readonly runId: number; readonly storage: SnapshotStorage };
export type SimulationEvent =
  | { readonly type: 'ready'; readonly runId: number }
  | { readonly type: 'snapshot'; readonly snapshot: SimulationSnapshot }
  | { readonly type: 'generation'; readonly statistics: GenerationStatistics }
  | { readonly type: 'best'; readonly trajectory: BestTrajectory }
  | { readonly type: 'error'; readonly runId: number; readonly message: string };

/** Allocate at reset / pool creation only. Worker should keep a bounded three-slot pool. */
export function createSnapshotStorage(population: number): SnapshotStorage {
  if (!Number.isInteger(population) || population < 2 || population > MAX_POPULATION) {
    throw new RangeError('Population must be an integer between 2 and 1000.');
  }
  return {
    cars: new Float32Array(population * CAR_STRIDE),
    sensors: new Float32Array(SENSOR_ANGLES.length * SENSOR_STRIDE),
    weights: new Float32Array(WEIGHT_COUNT),
    activations: new Float32Array(ACTIVATION_COUNT),
  };
}
/** postMessage's small transfer list; allocations here are outside simulation stepping. */
export function snapshotTransferList(storage: SnapshotStorage): ArrayBuffer[] {
  return [storage.cars.buffer, storage.sensors.buffer, storage.weights.buffer, storage.activations.buffer];
}
