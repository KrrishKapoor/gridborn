import type { TrackGeometry } from '../shared/geometry';
import { ACTIVATION_COUNT, CAR, CAR_STATUS, CAR_STRIDE, FIXED_DT, SENSOR_ANGLES, SENSOR_STRIDE, WEIGHT_COUNT } from '../shared/simulation';
import type { BestTrajectory, CarId, GenerationStatistics, SimulationSettings, SnapshotStorage } from '../shared/simulation';
import { SegmentGrid, ProgressQuery } from './geometry';
import { breed } from './genetics';
import { forward, initializeBrains } from './network';
import { CAR_RADIUS, drive } from './physics';
import { fitness, lapCrossing, progressDelta } from './progress';
import { Random } from './rng';

export interface EngineEvents {
  generation(statistics: GenerationStatistics): void;
  best(trajectory: BestTrajectory): void;
}

/** Fixed-step engine. Only the genome's sensor network controls movement.
 * Geometry projection is used after driving, solely for score/lap validation. */
export class Engine {
  readonly cars: Float32Array;
  brains: Float32Array;
  private nextBrains: Float32Array;
  readonly sensors: Float32Array;
  readonly activations: Float32Array;
  readonly laps: Float64Array;
  readonly projections: Float64Array;
  readonly distances: Float64Array;
  readonly gates: Uint8Array;
  readonly ranking: Uint32Array;
  readonly trajectories: Float32Array;
  readonly sampleCounts: Uint32Array;
  readonly sampleCapacity: number;
  readonly sampleEvery: number;
  readonly deadlineTicks: number;
  readonly random: Random;
  readonly walls: SegmentGrid;
  readonly progressQuery: ProgressQuery;
  private readonly angleCos = new Float64Array(SENSOR_ANGLES.map(Math.cos));
  private readonly angleSin = new Float64Array(SENSOR_ANGLES.map(Math.sin));
  generation = 1;
  tick = 0;
  generationTick = 0;
  alive: number;
  selected: CarId | null = null;
  bestFitness = -1;
  bestLap: number | null = null;
  private readonly compareRank = (a: number, b: number): number => {
    const lapA = this.laps[a]!, lapB = this.laps[b]!;
    if (lapA > 0 || lapB > 0) return lapA > 0 && lapB > 0 ? lapA - lapB || a - b : lapA > 0 ? -1 : 1;
    return this.distances[b]! - this.distances[a]! || a - b;
  };

  constructor(readonly runId: number, readonly track: TrackGeometry, readonly settings: SimulationSettings, private readonly events: EngineEvents) {
    const n = settings.population;
    this.cars = new Float32Array(n * CAR_STRIDE);
    this.brains = new Float32Array(n * WEIGHT_COUNT); this.nextBrains = new Float32Array(this.brains.length);
    this.sensors = new Float32Array(n * SENSOR_ANGLES.length * SENSOR_STRIDE);
    this.activations = new Float32Array(n * ACTIVATION_COUNT);
    this.laps = new Float64Array(n); this.projections = new Float64Array(n); this.distances = new Float64Array(n);
    this.gates = new Uint8Array(n); this.ranking = new Uint32Array(n);
    this.deadlineTicks = Math.ceil(settings.generationSeconds / FIXED_DT);
    // At most 602 points per car, including both endpoints. 10 Hz for the default deadline.
    this.sampleEvery = Math.max(6, Math.ceil(this.deadlineTicks / 600));
    this.sampleCapacity = Math.ceil(this.deadlineTicks / this.sampleEvery) + 2;
    this.trajectories = new Float32Array(n * this.sampleCapacity * 4); this.sampleCounts = new Uint32Array(n);
    this.random = new Random(settings.seed); this.walls = new SegmentGrid(track.walls); this.progressQuery = new ProgressQuery(track);
    this.alive = n;
    initializeBrains(this.brains, this.random);
    this.spawn();
  }

  private spawn(): void {
    this.cars.fill(0); this.laps.fill(0); this.distances.fill(0); this.projections.fill(0); this.gates.fill(0); this.sampleCounts.fill(0);
    this.alive = this.settings.population; this.generationTick = 0; this.selected = null;
    for (let i = 0; i < this.settings.population; i++) {
      const b = i * CAR_STRIDE;
      this.cars[b + CAR.x] = this.track.spawn.x; this.cars[b + CAR.y] = this.track.spawn.y; this.cars[b + CAR.heading] = this.track.spawn.heading;
      this.projections[i] = this.progressQuery.at(this.track.spawn.x, this.track.spawn.y);
      this.ranking[i] = i;
      this.sense(i); this.record(i, 0);
    }
  }

  private sense(i: number): void {
    const b = i * CAR_STRIDE, a = i * ACTIVATION_COUNT, start = i * SENSOR_ANGLES.length * SENSOR_STRIDE;
    const x = this.cars[b + CAR.x]!, y = this.cars[b + CAR.y]!, heading = this.cars[b + CAR.heading]!;
    const cos = Math.cos(heading), sin = Math.sin(heading), length = this.settings.rayLength;
    for (let ray = 0; ray < SENSOR_ANGLES.length; ray++) {
      const dx = cos * this.angleCos[ray]! - sin * this.angleSin[ray]!;
      const dy = sin * this.angleCos[ray]! + cos * this.angleSin[ray]!;
      const distance = this.walls.ray(x, y, dx, dy, length), s = start + ray * SENSOR_STRIDE;
      this.sensors[s] = distance / length; this.sensors[s + 1] = x + dx * distance; this.sensors[s + 2] = y + dy * distance;
      this.activations[a + ray] = this.sensors[s]!;
    }
    this.activations[a + 7] = Math.max(0, Math.min(1, this.cars[b + CAR.speed]! / this.settings.maxSpeed));
    forward(this.brains, i * WEIGHT_COUNT, this.activations, a);
  }

  private record(i: number, time: number): void {
    const count = this.sampleCounts[i]!, start = i * this.sampleCapacity * 4;
    // Replace an equal-time endpoint; never append the same pose twice at a sample boundary.
    const duplicate = count > 0 && Math.abs(this.trajectories[start + (count - 1) * 4 + 3]! - time) < 1e-5;
    const at = duplicate ? count - 1 : count;
    if (at >= this.sampleCapacity) throw new Error('Trajectory capacity invariant failed.');
    const t = start + at * 4, b = i * CAR_STRIDE;
    this.trajectories[t] = this.cars[b + CAR.x]!; this.trajectories[t + 1] = this.cars[b + CAR.y]!;
    this.trajectories[t + 2] = this.cars[b + CAR.heading]!; this.trajectories[t + 3] = time;
    if (!duplicate) this.sampleCounts[i] = count + 1;
  }

  step(): void {
    this.tick++; this.generationTick++;
    const time = this.generationTick * FIXED_DT;
    for (let i = 0; i < this.settings.population; i++) {
      const b = i * CAR_STRIDE;
      if (this.cars[b + CAR.status] !== CAR_STATUS.active) {
        this.cars[b + CAR.inactiveSeconds] = this.cars[b + CAR.inactiveSeconds]! + FIXED_DT;
        continue;
      }
      const x = this.cars[b + CAR.x]!, y = this.cars[b + CAR.y]!, heading = this.cars[b + CAR.heading]!;
      drive(this.cars, b, this.activations[i * ACTIVATION_COUNT + 16]!, this.activations[i * ACTIVATION_COUNT + 17]!, this.settings.maxSpeed);
      const nx = this.cars[b + CAR.x]!, ny = this.cars[b + CAR.y]!;
      if (this.walls.collision(x, y, nx, ny, CAR_RADIUS)) {
        // Keep the last safe pose; no tunnelling or wall penetration at high speeds.
        this.cars[b + CAR.x] = x; this.cars[b + CAR.y] = y; this.cars[b + CAR.heading] = heading;
        this.cars[b + CAR.status] = CAR_STATUS.crashed; this.cars[b + CAR.speed] = 0; this.alive--;
        this.record(i, time);
      } else {
        const next = this.progressQuery.at(nx, ny);
        const delta = progressDelta(this.projections[i]!, next, this.track.length);
        // Guard ambiguous projection jumps at close branches. Physical travel bounds progress.
        if (Math.abs(delta) <= Math.hypot(nx - x, ny - y) * 4 + 0.01) this.distances[i] = this.distances[i]! + delta;
        this.projections[i] = next;
        if (this.gates[i]! < 7 && this.distances[i]! >= (this.gates[i]! + 1) * this.track.length / 8) this.gates[i] = this.gates[i]! + 1;
        const crossing = lapCrossing(this.track, this.distances[i]!, this.gates[i]!, x, y, nx, ny);
        if (crossing >= 0) {
          this.laps[i] = (this.generationTick - 1 + crossing) * FIXED_DT;
          this.cars[b + CAR.x] = x + (nx - x) * crossing; this.cars[b + CAR.y] = y + (ny - y) * crossing;
          const turn = Math.atan2(Math.sin(this.cars[b + CAR.heading]! - heading), Math.cos(this.cars[b + CAR.heading]! - heading));
          this.cars[b + CAR.heading] = heading + turn * crossing;
          this.cars[b + CAR.status] = CAR_STATUS.finished; this.cars[b + CAR.speed] = 0; this.alive--;
          this.record(i, this.laps[i]!);
        } else if (this.generationTick % this.sampleEvery === 0 || this.generationTick === this.deadlineTicks) this.record(i, time);
      }
      this.cars[b + CAR.progress] = this.distances[i]!;
      this.cars[b + CAR.fitness] = fitness(this.distances[i]!, this.track.length, this.laps[i]!, this.deadlineTicks * FIXED_DT);
      // Cache the actual next decision at the displayed pose, even for an inactive inspected car.
      this.sense(i);
    }
    if (this.alive === 0 || this.generationTick >= this.deadlineTicks) this.finishGeneration();
  }

  private finishGeneration(): void {
    this.ranking.sort(this.compareRank);
    const winner = this.ranking[0]!, lap = this.laps[winner]! || null;
    const score = fitness(this.distances[winner]!, this.track.length, this.laps[winner]!, this.deadlineTicks * FIXED_DT);
    if (this.bestLap === null ? score > this.bestFitness : lap !== null && lap < this.bestLap) {
      this.bestFitness = score; this.bestLap = lap;
      const offset = winner * this.sampleCapacity * 4;
      this.events.best({ car: { runId: this.runId, generation: this.generation, index: winner }, fitness: score, lapSeconds: lap,
        samples: this.trajectories.slice(offset, offset + this.sampleCounts[winner]! * 4) });
    }
    let sum = 0, completed = 0, bestLap = Infinity;
    for (let i = 0; i < this.settings.population; i++) {
      sum += fitness(this.distances[i]!, this.track.length, this.laps[i]!, this.deadlineTicks * FIXED_DT);
      if (this.laps[i]! > 0) { completed++; bestLap = Math.min(bestLap, this.laps[i]!); }
    }
    this.events.generation({ runId: this.runId, generation: this.generation, ticks: this.generationTick, bestFitness: score,
      meanFitness: sum / this.settings.population, completedLaps: completed, bestLapSeconds: completed ? bestLap : null });
    breed(this.brains, this.nextBrains, this.ranking, this.settings, this.random);
    const swap = this.brains; this.brains = this.nextBrains; this.nextBrains = swap;
    this.generation++; this.spawn();
  }

  select(car: CarId | null): void {
    this.selected = car && car.runId === this.runId && car.generation === this.generation && Number.isInteger(car.index)
      && car.index >= 0 && car.index < this.settings.population ? { runId: car.runId, generation: car.generation, index: car.index } : null;
  }
  copyInto(storage: SnapshotStorage): void {
    storage.cars.set(this.cars);
    const i = this.selected?.index;
    if (i === undefined) { storage.sensors.fill(0); storage.weights.fill(0); storage.activations.fill(0); return; }
    for (let k = 0; k < storage.sensors.length; k++) storage.sensors[k] = this.sensors[i * storage.sensors.length + k]!;
    for (let k = 0; k < WEIGHT_COUNT; k++) storage.weights[k] = this.brains[i * WEIGHT_COUNT + k]!;
    for (let k = 0; k < ACTIVATION_COUNT; k++) storage.activations[k] = this.activations[i * ACTIVATION_COUNT + k]!;
  }
}
