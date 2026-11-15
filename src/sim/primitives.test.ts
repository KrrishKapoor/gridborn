import { describe, expect, it } from 'vitest';
import { CAR, CAR_STRIDE, DEFAULT_SETTINGS, FIXED_DT, WEIGHT_COUNT } from '../shared/simulation';
import { breed, WEIGHT_LIMIT } from './genetics';
import { raySegment, SegmentGrid, sweptCircle } from './geometry';
import { forward, initializeBrains } from './network';
import { ACCELERATION, drive, MAX_STEER, WHEELBASE } from './physics';
import { Random } from './rng';
import { ovalFixture } from './fixtures/oval';

describe('ray geometry and swept collisions', () => {
  it.each([
    [5, -2, 5, 2, 5], // transverse
    [5, 0, 5, 2, 5], // exact endpoint tangent
    [0, 2, 8, 2, 10], // parallel miss
    [4, 0, 8, 0, 4], // collinear
    [-4, 0, -1, 0, 10], // behind origin
    [-4, 0, 4, 0, 0], // starts on wall
    [11, -2, 11, 2, 10], // beyond range
    [5, 3, 5, 7, 10], // outside segment
  ])('casts against [%s,%s,%s,%s]', (ax, ay, bx, by, expected) => {
    expect(raySegment(0, 0, 1, 0, 10, ax, ay, bx, by)).toBe(expected);
  });
  it('agrees with brute-force casts across cell corners, boundaries and random directions', () => {
    const track = ovalFixture(), grid = new SegmentGrid(track.walls), random = new Random(81);
    for (let i = 0; i < 4000; i++) {
      const x = i < 100 ? Math.floor(random.next() * 18) * 64 : random.next() * 1200;
      const y = i < 100 ? Math.floor(random.next() * 12) * 64 : random.next() * 800;
      const angle = i % 4 === 0 ? Math.PI / 4 : random.next() * Math.PI * 2;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      expect(grid.ray(x, y, dx, dy, 350)).toBeCloseTo(grid.bruteRay(x, y, dx, dy, 350), 7);
    }
  });
  it('detects tunnelling, tangent contact and stationary overlap, with separated misses', () => {
    expect(sweptCircle(0, 0, 100, 0, 2, 50, -10, 50, 10)).toBe(true);
    expect(sweptCircle(0, 12, 100, 12, 2, 50, -10, 50, 10)).toBe(true);
    expect(sweptCircle(0, 13, 100, 13, 2, 50, -10, 50, 10)).toBe(false);
    expect(sweptCircle(49, 0, 49, 0, 2, 50, -10, 50, 10)).toBe(true);
    expect(sweptCircle(47, 0, 47, 0, 2, 50, -10, 50, 10)).toBe(false);
  });
});

describe('sensor network and physical motion', () => {
  it('uses destination-major biases and two actual tanh layers', () => {
    const w = new Float32Array(90), a = new Float32Array(18);
    a[0] = 0.5; a[7] = 0.25;
    w[0] = 2; w[7] = -1; w[8] = 0.5; w[17] = -0.3;
    w[72] = 0.8; w[73] = -0.4; w[80] = 0.1; w[81] = -0.5; w[89] = 0.2;
    forward(w, 0, a);
    expect(a[8]).toBeCloseTo(Math.tanh(1.25), 6);
    expect(a[9]).toBeCloseTo(Math.tanh(-0.3), 6);
    expect(a[16]).toBeCloseTo(Math.tanh(0.8 * Math.tanh(1.25) - 0.4 * Math.tanh(-0.3) + 0.1), 6);
    expect(a[17]).toBeCloseTo(Math.tanh(-0.5 * Math.tanh(1.25) + 0.2), 6);
  });
  it('changes decisions with sensors and never reads geometry', () => {
    const w = new Float32Array(90), a = new Float32Array(18);
    w[0] = 1; w[72] = 1;
    forward(w, 0, a); const left = a[16]!;
    a[0] = 1; forward(w, 0, a);
    expect(a[16]!).toBeGreaterThan(left);
  });
  it('applies the documented unbiased-direction, movement-biased initialization repeatably', () => {
    const a = new Float32Array(512 * 90), b = new Float32Array(a.length);
    initializeBrains(a, new Random(1)); initializeBrains(b, new Random(1)); expect(a).toEqual(b);
    let steerBias = 0;
    for (let i = 0; i < 512; i++) { expect(a[i * 90 + 89]).toBeGreaterThanOrEqual(0.5); steerBias += a[i * 90 + 80]!; }
    expect(Math.abs(steerBias / 512)).toBeLessThan(0.03);
  });
  it('accelerates from rest using fixed seconds and never reverses', () => {
    const car = new Float32Array(CAR_STRIDE);
    drive(car, 0, 0, 1, 240);
    expect(car[CAR.speed]).toBeCloseTo(ACCELERATION * FIXED_DT);
    expect(car[CAR.x]).toBeCloseTo(0.5 * ACCELERATION * FIXED_DT ** 2);
    expect(car[CAR.y]).toBe(0);
    for (let i = 0; i < 3000; i++) drive(car, 0, 0, -1, 240);
    expect(car[CAR.speed]).toBeGreaterThanOrEqual(0);
  });
  it('caps speed and turns clockwise with positive steering, mirrored by negative steering', () => {
    const a = new Float32Array(CAR_STRIDE), b = new Float32Array(CAR_STRIDE);
    a[CAR.speed] = b[CAR.speed] = 240;
    drive(a, 0, 1, 1, 240); drive(b, 0, -1, 1, 240);
    expect(a[CAR.speed]).toBe(240);
    expect(a[CAR.heading]).toBeCloseTo(240 / WHEELBASE * Math.tan(MAX_STEER) * FIXED_DT);
    expect(a[CAR.x]).toBe(b[CAR.x]); expect(a[CAR.y]).toBe(-b[CAR.y]!);
  });
});

describe('seeded genetic operators', () => {
  it('has repeatable, nonconstant sequences including seed zero', () => {
    const a = new Random(0), b = new Random(0), c = new Random(1);
    const values = Array.from({ length: 100 }, () => a.next());
    expect(values).toEqual(Array.from({ length: 100 }, () => b.next()));
    expect(values).not.toEqual(Array.from({ length: 100 }, () => c.next()));
    expect(new Set(values).size).toBe(100);
    expect(values.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it('preserves exact elites in rank order, and performs seeded crossover without mutation', () => {
    const population = 40, brains = new Float32Array(population * WEIGHT_COUNT), rank = new Uint32Array(population);
    for (let i = 0; i < population; i++) { rank[i] = population - 1 - i; brains.fill(i / 10, i * 90, (i + 1) * 90); }
    const a = new Float32Array(brains.length), b = new Float32Array(brains.length);
    const settings = { ...DEFAULT_SETTINGS, population, eliteCount: 2, mutationRate: 0 };
    breed(brains, a, rank, settings, new Random(18)); breed(brains, b, rank, settings, new Random(18));
    expect(a).toEqual(b); expect(a.slice(0, 90)).toEqual(brains.slice(39 * 90, 40 * 90));
    expect(a.slice(90, 180)).toEqual(brains.slice(38 * 90, 39 * 90));
    let mixed = 0;
    for (let i = 2; i < population; i++) {
      const genes = new Set(a.slice(i * 90, (i + 1) * 90));
      expect(genes.size).toBeLessThanOrEqual(2); if (genes.size === 2) mixed++;
      expect([...genes].every((x) => brains.includes(x))).toBe(true);
    }
    expect(mixed).toBeGreaterThan(20);
  });
  it('mutates nonelites only, respects magnitude and clamps weights to finite bounds', () => {
    const population = 10, brains = new Float32Array(population * 90), out = new Float32Array(brains.length);
    const rank = Uint32Array.from({ length: population }, (_, i) => i);
    breed(brains, out, rank, { ...DEFAULT_SETTINGS, population, eliteCount: 1, mutationRate: 1, mutationScale: 0.25 }, new Random(0));
    expect(out.slice(0, 90).every((x) => x === 0)).toBe(true);
    expect(out.slice(90).every((x) => x !== 0 && Math.abs(x) <= 0.25)).toBe(true);
    breed(brains, out, rank, { ...DEFAULT_SETTINGS, population, eliteCount: 1, mutationRate: 1, mutationScale: Number.MAX_VALUE }, new Random(0));
    expect(out.every((x) => Number.isFinite(x) && Math.abs(x) <= WEIGHT_LIMIT)).toBe(true);
  });
});
