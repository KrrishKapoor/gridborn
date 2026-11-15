import { describe, expect, it } from 'vitest';
import { CAR, CAR_STATUS, CAR_STRIDE, DEFAULT_SETTINGS, createSnapshotStorage } from '../shared/simulation';
import type { BestTrajectory, GenerationStatistics } from '../shared/simulation';
import { Engine } from './engine';
import { ovalFixture } from './fixtures/oval';
import { forward } from './network';
import { fitness, lapCrossing, progressDelta } from './progress';
import { validateSettings, validateTrack, validStorage } from './validation';

const track = ovalFixture();
const events = { generation: () => {}, best: () => {} };

describe('lap gates and honest fitness', () => {
  it('unwraps forward/reverse travel without rewarding oscillations around start', () => {
    expect(progressDelta(990, 5, 1000)).toBe(15); expect(progressDelta(5, 990, 1000)).toBe(-15);
    let net = 0;
    for (let i = 0; i < 1000; i++) { net += progressDelta(990, 5, 1000); net += progressDelta(5, 990, 1000); }
    expect(net).toBe(0);
  });
  it('requires distance, all ordered gates, forward motion and a finite start-line crossing', () => {
    const x = track.spawn.x, y = track.spawn.y, length = track.length;
    expect(lapCrossing(track, length, 7, x - 2, y, x + 2, y)).toBe(0.5);
    expect(lapCrossing(track, 1, 7, x - 2, y, x + 2, y)).toBe(-1);
    expect(lapCrossing(track, length, 6, x - 2, y, x + 2, y)).toBe(-1);
    expect(lapCrossing(track, length, 7, x + 2, y, x - 2, y)).toBe(-1);
    expect(lapCrossing(track, length, 7, x, y, x + 2, y)).toBe(-1);
    expect(lapCrossing(track, length, 7, x - 2, y + 60, x + 2, y + 60)).toBe(-1);
  });
  it('puts every valid lap before every incomplete attempt and orders by actual lap time', () => {
    expect(fitness(1000, 1000, 30, 30)).toBeGreaterThan(fitness(9999, 1000, 0, 30));
    expect(fitness(1000, 1000, 10, 30)).toBeGreaterThan(fitness(1000, 1000, 11, 30));
    expect(fitness(200, 1000, 0, 30)).toBeGreaterThan(fitness(100, 1000, 0, 30));
    expect(fitness(-500, 1000, 0, 30)).toBe(0);
  });
  it('crashes a straight-driving network at the wall, retains its pose and fades it', () => {
    const engine = new Engine(1, track, { ...DEFAULT_SETTINGS, population: 2, eliteCount: 1 }, events);
    engine.brains.fill(0);
    // Keep slot one stationary so generation does not reset when slot zero crashes.
    engine.brains[89] = 8; engine.brains[179] = -8;
    for (let i = 0; i < 500 && engine.cars[CAR.status] === CAR_STATUS.active; i++) engine.step();
    expect(engine.generation).toBe(1); expect(engine.cars[CAR.status]).toBe(CAR_STATUS.crashed);
    expect(engine.cars[CAR.speed]).toBe(0);
    const x = engine.cars[CAR.x], y = engine.cars[CAR.y];
    for (let i = 0; i < 10; i++) engine.step();
    expect(engine.cars[CAR.x]).toBe(x); expect(engine.cars[CAR.y]).toBe(y);
    expect(engine.cars[CAR.inactiveSeconds]).toBeGreaterThan(0);
    expect(engine.laps[0]).toBe(0);
  });
  it('does not turn a short deadline partial path into a lap; clears generation selection', () => {
    const records: BestTrajectory[] = [], history: GenerationStatistics[] = [];
    const engine = new Engine(1, track, { ...DEFAULT_SETTINGS, population: 16, eliteCount: 2, generationSeconds: 0.123 }, {
      best: (b) => records.push(b), generation: (s) => history.push(s),
    });
    engine.select({ runId: 1, generation: 1, index: 2 });
    for (let i = 0; i < 8; i++) engine.step();
    expect(history[0]!.ticks).toBe(8); expect(history[0]!.completedLaps).toBe(0); expect(history[0]!.bestLapSeconds).toBeNull();
    expect(records[0]!.lapSeconds).toBeNull(); expect(records[0]!.samples.at(-1)).toBeCloseTo(8 / 60);
    expect(engine.generation).toBe(2); expect(engine.tick).toBe(8); expect(engine.generationTick).toBe(0); expect(engine.selected).toBeNull();
  });
  it('copies inspection from the selected actual pose, sensor distances, genome and inference', () => {
    const engine = new Engine(9, track, { ...DEFAULT_SETTINGS, population: 16, eliteCount: 2 }, events);
    for (let i = 0; i < 120; i++) engine.step();
    engine.select({ runId: 9, generation: 1, index: 3 });
    const s = createSnapshotStorage(16); engine.copyInto(s);
    const a = s.activations.slice(); forward(s.weights, 0, a); expect(a).toEqual(s.activations);
    const b = 3 * CAR_STRIDE;
    for (let r = 0; r < 7; r++) {
      expect(s.activations[r]).toBe(s.sensors[r * 3]);
      expect(Math.hypot(s.sensors[r * 3 + 1]! - s.cars[b + CAR.x]!, s.sensors[r * 3 + 2]! - s.cars[b + CAR.y]!)).toBeCloseTo(s.sensors[r * 3]! * DEFAULT_SETTINGS.rayLength, 3);
    }
    expect(s.weights).toEqual(engine.brains.slice(3 * 90, 4 * 90));
    engine.select({ runId: 9, generation: 0, index: 3 }); expect(engine.selected).toBeNull();
  });
});

describe('serialized reset and buffer validation', () => {
  it('accepts the fixture and documented defaults, including seed zero', () => {
    expect(() => validateTrack(track)).not.toThrow(); expect(() => validateSettings({ ...DEFAULT_SETTINGS, seed: 0 })).not.toThrow();
  });
  it.each([
    { seed: -1 }, { seed: 2 ** 32 }, { population: 1 }, { population: 1001 }, { population: 3.2 },
    { eliteCount: 0 }, { eliteCount: 512 }, { mutationRate: 1.1 }, { mutationRate: NaN }, { mutationScale: -1 },
    { generationSeconds: 0 }, { generationSeconds: Infinity }, { rayLength: 0 }, { maxSpeed: NaN },
  ])('rejects malformed settings %j', (change) => { expect(() => validateSettings({ ...DEFAULT_SETTINGS, ...change })).toThrow(); });
  it('rejects invalid lengths, open walls, NaNs, bounds, spawn and direction', () => {
    expect(() => validateTrack({ ...track, length: track.length + 100 })).toThrow();
    expect(() => validateTrack({ ...track, walls: track.walls.slice(4) })).toThrow();
    const bad = track.centerline.slice(); bad[0] = NaN;
    expect(() => validateTrack({ ...track, centerline: bad })).toThrow();
    expect(() => validateTrack({ ...track, bounds: { ...track.bounds, maxX: 1400 } })).toThrow();
    expect(() => validateTrack({ ...track, spawn: { ...track.spawn, x: 5 } })).toThrow();
    expect(() => validateTrack({ ...track, startForward: { x: -1, y: 0 } })).toThrow();
  });
  it('requires full distinct ArrayBuffers of exact lengths, never detached/subarray/shared buffers', () => {
    const s = createSnapshotStorage(16); expect(validStorage(s, 16)).toBe(true); expect(validStorage(s, 15)).toBe(false);
    expect(validStorage({ ...s, weights: new Float32Array(91).subarray(1) }, 16)).toBe(false);
    expect(validStorage({ ...s, weights: new Float32Array(new SharedArrayBuffer(90 * 4)) }, 16)).toBe(false);
    structuredClone(s, { transfer: [s.cars.buffer] }); expect(validStorage(s, 16)).toBe(false);
  });
});
