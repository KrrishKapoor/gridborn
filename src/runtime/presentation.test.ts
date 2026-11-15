import { describe, expect, it } from 'vitest';
import { createSnapshotStorage } from '../shared/simulation';
import type { SimulationSnapshot } from '../shared/simulation';
import { Presentation } from './presentation';
function state(tick: number, x: number, generation = 1): SimulationSnapshot {
  const storage = createSnapshotStorage(2); storage.cars[0] = x;
  return { runId: 1, generation, tick, generationTick: tick, population: 2, alive: 2, running: true, rate: 1, selected: null, storage, computeMs: 0, steps: 1 };
}
describe('bounded measured-pose interpolation', () => {
  it('interpolates between real poses and never predicts beyond the received endpoint', () => {
    const p = new Presentation(); const a = state(10, 100), b = state(11, 104), c = state(12, 108);
    p.push(a, 0); p.push(b, 16.667); p.push(c, 33.334);
    expect(p.sample(c, 1000 / 60 * 2.5)[0]).toBeCloseTo(102, 4);
    expect(p.sample(c, 1000 / 60 * 4)[0]).toBe(108);
    expect(p.sample(c, 2000)[0]).toBeGreaterThanOrEqual(100);
    expect(p.sample(c, 2000)[0]).toBeLessThanOrEqual(108);
  });
  it('copies borrowed data, uses shortest-angle rotation, and never blends generations', () => {
    const p = new Presentation(), a = state(10, 100), b = state(11, 104);
    a.storage.cars[2] = Math.PI - .1; b.storage.cars[2] = -Math.PI + .1;
    p.push(a, 0); a.storage.cars.fill(999); p.push(b, 16.667);
    expect(Math.abs(p.sample(b, 1000 / 60 * 2.5)[2]!)).toBeCloseTo(Math.PI, 4);
    const c = state(12, 500, 2); p.push(c, 33.334); expect(p.sample(c, 40)[0]).toBe(500);
  });
  it('uses exact snapshot data for inspection, pause and headless mode', () => {
    const p = new Presentation(), a = state(10, 100);p.push(a, 0);
    for (const s of [{ ...a, selected: { runId: 1, generation: 1, index: 0 } }, { ...a, running: false }, { ...a, rate: 'fast' as const }]) {
      p.push(s, 20); expect(p.sample(s, 25)).toBe(s.storage.cars);
    }
  });
});
