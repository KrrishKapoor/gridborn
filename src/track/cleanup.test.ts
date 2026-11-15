import { describe, expect, it } from 'vitest';
import type { Point, TrackGeometry } from '../shared/geometry';
import { buildTrack, loopIntersects, segmentsIntersect } from './geometry';
import { createPreset } from './presets';

const options = { id: 'regression', width: 92 };
const ellipse = (count = 480, direction = 1, offset = 1): Point[] => Array.from({ length: count }, (_, i) => {
  const t = -Math.PI / 2 + direction * i * 2 * Math.PI / count;
  return { x: 600 + 380 * offset * Math.cos(t), y: 400 + 230 * offset * Math.sin(t) };
});
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
function build(points: Point[]): TrackGeometry {
  const result = buildTrack(points, options);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error('Expected valid geometry');
  return result.track;
}
function reject(points: Point[], code = 'self-intersection'): void {
  const result = buildTrack(points, options);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0]!.code).toBe(code);
}
function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Every accepted regression must still describe an honest full-width road.
function contract(track: TrackGeometry, direction: number): void {
  const center = Array.from({ length: track.centerline.length / 2 }, (_, i) => ({ x: track.centerline[i * 2]!, y: track.centerline[i * 2 + 1]! }));
  const walls = Array.from({ length: track.walls.length / 4 }, (_, i) => ({
    a: { x: track.walls[i * 4]!, y: track.walls[i * 4 + 1]! },
    b: { x: track.walls[i * 4 + 2]!, y: track.walls[i * 4 + 3]! },
  }));
  const n = center.length;
  expect(track.width).toBe(92);
  expect(loopIntersects(center)).toBe(false);
  expect(loopIntersects(walls.slice(0, n).map(w => w.a))).toBe(false);
  expect(loopIntersects(walls.slice(n).map(w => w.a))).toBe(false);
  let crossings = 0;
  for (const left of walls.slice(0, n)) for (const right of walls.slice(n)) {
    if (segmentsIntersect(left.a, left.b, right.a, right.b)) crossings++;
  }
  expect(crossings).toBe(0);
  for (let i = 0; i < n; i++) {
    expect(track.cumulativeLengths[i + 1]!).toBeGreaterThan(track.cumulativeLengths[i]!);
    expect(Math.min(...walls.map(w => pointSegmentDistance(center[i]!, w.a, w.b)))).toBeCloseTo(46, 3);
  }
  expect(track.length).toBe(track.cumulativeLengths[n]);
  expect(center.reduce((area, p, i) => area + p.x * center[(i + 1) % n]!.y - p.y * center[(i + 1) % n]!.x, 0) * direction).toBeGreaterThan(0);
  expect(distance(track.spawn, center[0]!)).toBe(0);
  expect(distance(track.startForward, { x: 0, y: 0 })).toBeCloseTo(1, 12);
  expect(track.startForward.x * direction).toBeGreaterThan(0.95);
  for (const w of walls) {
    expect(distance(w.a, w.b)).toBeGreaterThan(0.1);
    expect(w.a.x).toBeGreaterThanOrEqual(track.bounds.minX);
    expect(w.a.x).toBeLessThanOrEqual(track.bounds.maxX);
    expect(w.a.y).toBeGreaterThanOrEqual(track.bounds.minY);
    expect(w.a.y).toBeLessThanOrEqual(track.bounds.maxY);
  }
  expect(track.bounds.minX).toBeGreaterThanOrEqual(0);
  expect(track.bounds.minY).toBeGreaterThanOrEqual(0);
  expect(track.bounds.maxX).toBeLessThanOrEqual(1200);
  expect(track.bounds.maxY).toBeLessThanOrEqual(800);
}
function noise(points: Point[], seed: number, amplitude: number): Point[] {
  // Match the committed probe2 random sequence, including its JS multiplication.
  const random = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const result: Point[] = [];
  for (const p of points) {
    const next = { x: p.x + (random() - .5) * 2 * amplitude, y: p.y + (random() - .5) * 2 * amplitude };
    if (!result.length || distance(next, result[result.length - 1]!) >= 2) result.push(next);
  }
  return result;
}

describe('natural closure and local jitter', () => {
  it.each([1, -1])('trims 50–160 units of forward overshoot in direction %i, with inward/outward offset', direction => {
    const baseline = build(ellipse(480, direction));
    for (const over of [50, 60, 70, 80, 90, 120, 160]) for (const offset of [.98, 1, 1.02]) {
      const count = Math.round(over / (380 * 2 * Math.PI / 480));
      const points = ellipse(480, direction).concat(ellipse(480, direction, offset).slice(1, count + 1));
      const original = structuredClone(points);
      const track = build(points);
      expect(build(points)).toEqual(track);
      expect(points).toEqual(original);
      expect(Math.abs(track.length - baseline.length)).toBeLessThan(3);
      expect(distance(track.spawn, baseline.spawn)).toBeLessThan(3);
      for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(Math.abs(track.bounds[key] - baseline.bounds[key])).toBeLessThan(2);
      contract(track, direction);
    }
  });
  it.each([1, -1])('accepts the QA overshoot120 and seeded ±3 world-unit noise in direction %i', direction => {
    const oval = ellipse(100, direction);
    const tail = ellipse(100, direction).slice(1, 6).map(p => ({ x: 600 + (p.x - 600) * 372 / 380, y: 400 + (p.y - 400) * 225 / 230 }));
    contract(build([...oval, oval[0]!, ...tail]), direction);
    for (let trial = 0; trial < 20; trial++) {
      const points = noise(ellipse(Math.round(1900 / 4), direction), trial * 7919 + 1, 3);
      const track = build(points);
      expect(build(points)).toEqual(track);
      expect(track.length).toBeGreaterThan(1850);
      expect(track.length).toBeLessThan(1980);
      contract(track, direction);
    }
  });
  it('recognizes closure at arbitrary starting angles and translated positions', () => {
    for (const start of [0, Math.PI / 3, Math.PI, 5 * Math.PI / 4]) for (const direction of [1, -1]) {
      const point = (i: number): Point => ({ x: 635 + 360 * Math.cos(start + direction * i * Math.PI / 240), y: 365 + 220 * Math.sin(start + direction * i * Math.PI / 240) });
      const loop = Array.from({ length: 480 }, (_, i) => point(i));
      const baseline = build(loop);
      const extended = build([...loop, ...Array.from({ length: 25 }, (_, i) => point(i))]);
      expect(Math.abs(extended.length - baseline.length)).toBeLessThan(3);
      expect(distance(extended.spawn, baseline.spawn)).toBeLessThan(3);
      for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(Math.abs(extended.bounds[key] - baseline.bounds[key])).toBeLessThan(2);
    }
  });
  it('preserves an unfinished generous loop despite a pause/jitter near its beginning', () => {
    const points = ellipse(480).slice(0, 430);
    points.splice(1, 0, { x: 601, y: 171 }, { x: 599, y: 169 }, { x: 602, y: 170 });
    const track = build(points);
    expect(track.length).toBeGreaterThan(1800);
    expect(track.bounds.maxY).toBeGreaterThan(660);
    expect(track.bounds.minX).toBeLessThan(190);
    contract(track, 1);
  });
  it.each([.6575, .275, .2325])('accepts ±1 CSS-pixel noise at 1.5px spacing (scale %s), both orientations', scale => {
    const count = Math.round(2 * Math.PI * Math.sqrt((370 ** 2 + 225 ** 2) / 2) * scale / 1.5);
    for (const direction of [1, -1]) for (let trial = 0; trial < 6; trial++) {
      const points = ellipse(count, direction).map(p => ({ x: 600 + (p.x - 600) * 370 / 380, y: 400 + (p.y - 400) * 225 / 230 }));
      points.push(points[0]!);
      contract(build(noise(points, 1000 + trial * 31, 1 / scale)), direction);
    }
  });
  it.each([.6575, .275, .2325])('accepts a 120-unit overshoot with simultaneous ±1px jitter (scale %s)', scale => {
    const count = Math.round(1900 * scale / 1.5);
    for (const direction of [1, -1]) for (let trial = 0; trial < 6; trial++) {
      const loop = ellipse(count, direction);
      const extra = Math.round(120 / (380 * 2 * Math.PI / count));
      contract(build(noise([...loop, ...loop.slice(0, extra)], 1000 + trial * 31, 1 / scale)), direction);
    }
  });
  it.each([
    ['broad-oval', 2605260130], ['riverbend', 3596915833], ['club-circuit', 3249471356],
  ] as const)('keeps every %s preset geometry byte unchanged from accepted T1', (id, expected) => {
    const track = createPreset(id);
    const packed = new Float32Array([...track.centerline, ...track.walls, ...track.cumulativeLengths]);
    let hash = 2166136261;
    for (const byte of new Uint8Array(packed.buffer)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    expect(hash).toBe(expected);
  });
});

describe('cleanup cannot conceal meaningful intersections', () => {
  it('treats a shallow crossing between distant stroke sections as nonlocal', () => {
    const points = [
      { x: 200, y: 400 }, { x: 1000, y: 400 }, { x: 1000, y: 650 }, { x: 600, y: 650 },
      { x: 600, y: 397 }, { x: 590, y: 403 }, { x: 580, y: 397 }, { x: 200, y: 150 },
    ];
    expect(loopIntersects(points, 32)).toBe(true);
    reject(points);
    reject(points.reverse());
  });
  it.each([1, -1])('rejects genuine crossings, repeated loops, and reversing/escaping tails in direction %i', direction => {
    const eight = Array.from({ length: 481 }, (_, i) => {
      const t = direction * i * 2 * Math.PI / 480;
      return { x: 600 + 380 * Math.sin(t), y: 400 + 230 * Math.sin(2 * t) };
    });
    for (let trial = 0; trial < 6; trial++) reject(noise(eight, trial * 7919 + 1, 3));
    // A short closure tail must not hide crossings elsewhere in the completed loop.
    reject([...eight, ...eight.slice(1, 12)]);
    const loop = ellipse(480, direction);
    reject([...loop, ...loop]);
    reject([...loop, ...loop.slice(0, 100)]); // longer than the closure budget
    reject([...loop, loop[0]!, ...loop.slice(-24).reverse()]); // reverse along the incoming arc
    reject([...loop, loop[0]!, { x: 600 + direction * 80, y: 130 }, { x: 600 + direction * 80, y: 230 }]);
    // A new crossing can fit inside the closure corridor and still be meaningful.
    // Check the discarded tail's topology independently of its proximity/progress.
    const p = loop[15]!;
    reject([...loop, loop[0]!, ...loop.slice(1, 16),
      { x: p.x + direction * 10, y: p.y - 14 }, { x: p.x + direction * 10, y: p.y + 14 }, p,
      ...loop.slice(16, 31)]);
  });
  it.each([false, true])('retains collinear overlaps and macroscopic local loops (reverse=%s)', reverse => {
    const shapes = [
      // Long, narrow retrace: distance-only simplification would erase this.
      [[250, 180], [800, 180], [500, 180], [980, 180], [980, 620], [220, 620]],
      // A 70-unit loop across the opening straight, not finger jitter.
      [[250, 180], [500, 180], [540, 145], [540, 215], [500, 180], [980, 180], [980, 620], [220, 620]],
    ];
    for (const shape of shapes) {
      const points = shape.map(([x, y]) => ({ x: x!, y: y! }));
      reject(reverse ? points.reverse() : points);
    }
  });
  it('checks out-of-world samples even when they occur on a potentially disposable tail', () => {
    reject([...ellipse(), ellipse()[0]!, { x: 601, y: -1 }], 'out-of-bounds');
  });
  it('continues to reject sharp triangles with an actionable fixed-width message', () => {
    for (const scale of [1, .8, .6]) {
      const result = buildTrack([
        { x: 600, y: 430 - 330 * scale }, { x: 600 + 420 * scale, y: 430 + 300 * scale }, { x: 600 - 420 * scale, y: 430 + 300 * scale },
      ], options);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]).toEqual({ code: 'too-tight', message: 'Widen the tight bends so the road has room to turn.' });
    }
  });
});
