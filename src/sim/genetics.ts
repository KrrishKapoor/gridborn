import { WEIGHT_COUNT } from '../shared/simulation';
import type { SimulationSettings } from '../shared/simulation';
import type { Random } from './rng';

export const WEIGHT_LIMIT = 8;

/** Stable rank order is supplied by the engine. Top-half tournament selection. */
export function breed(brains: Float32Array, next: Float32Array, ranking: Uint32Array,
  settings: SimulationSettings, random: Random): void {
  const { population, eliteCount, mutationRate, mutationScale } = settings;
  for (let i = 0; i < eliteCount; i++) {
    const from = ranking[i]! * WEIGHT_COUNT, to = i * WEIGHT_COUNT;
    for (let k = 0; k < WEIGHT_COUNT; k++) next[to + k] = brains[from + k]!;
  }
  const pool = Math.max(2, Math.ceil(population / 2));
  for (let i = eliteCount; i < population; i++) {
    const parentA = ranking[Math.min(Math.floor(random.next() * pool), Math.floor(random.next() * pool), Math.floor(random.next() * pool))]! * WEIGHT_COUNT;
    const parentB = ranking[Math.min(Math.floor(random.next() * pool), Math.floor(random.next() * pool), Math.floor(random.next() * pool))]! * WEIGHT_COUNT;
    for (let k = 0; k < WEIGHT_COUNT; k++) {
      let value = brains[(random.next() < 0.5 ? parentA : parentB) + k]!;
      if (random.next() < mutationRate) value += random.signed() * mutationScale;
      next[i * WEIGHT_COUNT + k] = Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, value));
    }
  }
}
