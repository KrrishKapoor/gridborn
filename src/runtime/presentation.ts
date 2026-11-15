import { CAR, CAR_STRIDE, FIXED_DT } from '../shared/simulation';
import type { SimulationSnapshot } from '../shared/simulation';

/** Two display intervals of bounded latency. Interpolates measured poses only;
 * never predicts past the last received state or blends across a generation.
 * Inspection bypasses this entirely to preserve exact ray/inference coherence. */
export class Presentation {
  cars = new Float32Array(0);
  tick = 0;
  private slots: Float32Array[] = [];
  private ticks = new Float64Array(4);
  private count = 0;
  private cursor = 0;
  private run = 0;
  private generation = 0;
  private rate = 0;
  private anchorTick = 0;
  private anchorTime = 0;
  push(s: SimulationSnapshot, now: number): void {
    if (s.rate === 'fast' || !s.running || s.selected) { this.count = 0; return; }
    if (this.cars.length !== s.storage.cars.length) {
      this.cars = new Float32Array(s.storage.cars.length);
      this.slots = Array.from({ length: 4 }, () => new Float32Array(s.storage.cars.length)); this.count = 0;
    }
    if (s.runId !== this.run || s.generation !== this.generation || s.rate !== this.rate) this.count = 0;
    if (!this.count) {
      this.run = s.runId; this.generation = s.generation; this.rate = s.rate;
      this.cursor = 0; this.anchorTime = now; this.anchorTick = s.tick - 2 * s.rate;
    } else if (this.ticks[(this.cursor + 3) % 4] === s.tick) return;
    this.slots[this.cursor]!.set(s.storage.cars); this.ticks[this.cursor] = s.tick;
    this.cursor = (this.cursor + 1) % 4; this.count = Math.min(4, this.count + 1);
  }
  sample(s: SimulationSnapshot, now: number): Float32Array {
    if (!this.count || !s.running || s.rate === 'fast' || s.selected) { this.tick = s.tick; return s.storage.cars; }
    const newest = (this.cursor + 3) % 4, oldest = (this.cursor + 4 - this.count) % 4;
    let target = this.anchorTick + (now - this.anchorTime) / (FIXED_DT * 1000) * this.rate;
    // A stalled transport/tab must not cause extrapolation or long catch-up.
    if (target > this.ticks[newest]! + this.rate * 2 || target < this.ticks[oldest]! - this.rate * 2) {
      this.anchorTime = now; this.anchorTick = this.ticks[newest]! - 2 * this.rate; target = this.anchorTick;
    }
    target = Math.max(this.ticks[oldest]!, Math.min(this.ticks[newest]!, target)); this.tick = target;
    let left = oldest, right = oldest;
    for (let i = 1; i < this.count; i++) {
      right = (oldest + i) % 4;
      if (this.ticks[right]! >= target) break;
      left = right;
    }
    const a = this.slots[left]!, b = this.slots[right]!, span = this.ticks[right]! - this.ticks[left]!;
    const alpha = span > 0 ? (target - this.ticks[left]!) / span : 0;
    this.cars.set(a);
    for (let i = 0; i < a.length; i += CAR_STRIDE) {
      this.cars[i] = a[i]! + (b[i]! - a[i]!) * alpha;
      this.cars[i + 1] = a[i + 1]! + (b[i + 1]! - a[i + 1]!) * alpha;
      const angle = b[i + CAR.heading]! - a[i + CAR.heading]!;
      this.cars[i + CAR.heading] = a[i + CAR.heading]! + Math.atan2(Math.sin(angle), Math.cos(angle)) * alpha;
      this.cars[i + CAR.inactiveSeconds] = a[i + CAR.inactiveSeconds]! + (b[i + CAR.inactiveSeconds]! - a[i + CAR.inactiveSeconds]!) * alpha;
      if (alpha === 1) this.cars[i + CAR.status] = b[i + CAR.status]!;
    }
    return this.cars;
  }
  clear(): void { this.count = 0; }
}
