import { WEIGHT_COUNT } from '../shared/simulation';
import type { Random } from './rng';

/** Destination-major 8 → 8 → 2 tanh. Inputs occupy a[base..base+7]. */
export function forward(weights: Float32Array, offset: number, a: Float32Array, base = 0): void {
  for (let j = 0; j < 8; j++) {
    const row = offset + j * 9;
    let sum = weights[row + 8]!;
    for (let k = 0; k < 8; k++) sum += weights[row + k]! * a[base + k]!;
    a[base + 8 + j] = Math.tanh(sum);
  }
  for (let j = 0; j < 2; j++) {
    const row = offset + 72 + j * 9;
    let sum = weights[row + 8]!;
    for (let k = 0; k < 8; k++) sum += weights[row + k]! * a[base + 8 + k]!;
    a[base + 16 + j] = Math.tanh(sum);
  }
}

/** Movement prior only: modest initial steering, positive throttle bias.
 * No track input, predefined reflex, chosen curvature, or expert genome. */
export function initializeBrains(weights: Float32Array, random: Random): void {
  for (let b = 0; b < weights.length; b += WEIGHT_COUNT) {
    for (let k = 0; k < WEIGHT_COUNT; k++) {
      weights[b + k] = random.signed() * (k < 72 ? 1 : 0.35);
    }
    weights[b + 89] = 0.8 + random.signed() * 0.3;
  }
}
