import { describe, expect, it } from 'vitest';
import type { Point, TrackGeometry, TrackValidation } from '../shared/geometry';
import { buildTrack, loopIntersects, segmentsIntersect } from './geometry';
import { createPreset, TRACK_PRESETS } from './presets';

const options = { id: 'drawn', width: 92 };
function oval(count = 100, rx = 390, ry = 220, noise = 0): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i * Math.PI * 2 / count;
    return { x: 600 + rx * Math.cos(t) + noise * Math.sin(i * 7), y: 400 + ry * Math.sin(t) + noise * Math.cos(i * 3) };
  });
}
function valid(result: TrackValidation): TrackGeometry {
  expect(result.ok, JSON.stringify(result.ok ? '' : result.issues)).toBe(true);
  if (!result.ok) throw new Error('Expected a usable track');
  return result.track;
}
function expectIssue(points: Point[], code: string, width = 92): void {
  const result = buildTrack(points, { ...options, width });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0]?.code).toBe(code);
}

describe('intersection predicates', () => {
  const p = (x: number, y: number): Point => ({ x, y });
  it('detects proper crossings, endpoint touches and collinear overlaps', () => {
    expect(segmentsIntersect(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(10, 0), p(15, 8))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(3, 0), p(15, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(11, 0), p(15, 0))).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(0, 1), p(10, 1))).toBe(false);
  });
  it('checks the implicit closing edge, while excluding shared adjacent vertices', () => {
    expect(loopIntersects([p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(false);
    expect(loopIntersects([p(0, 0), p(10, 0), p(0, 10), p(10, 10)])).toBe(true);
  });
});

describe('usable geometry', () => {
  it.each(TRACK_PRESETS)('$label supplies deterministic, independent closed boundaries', ({ id }) => {
    const track = createPreset(id);
    const again = createPreset(id);
    expect(track).toEqual(again);
    expect(track.centerline).not.toBe(again.centerline);
    expect(track.width).toBe(92);
    const n = track.centerline.length / 2;
    expect(n).toBeGreaterThan(50);
    expect(n).toBeLessThan(250);
    expect(track.walls.length).toBe(n * 8);
    expect(track.cumulativeLengths.length).toBe(n + 1);
    expect(track.cumulativeLengths[0]).toBe(0);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const edge = Math.hypot(track.centerline[next * 2]! - track.centerline[i * 2]!, track.centerline[next * 2 + 1]! - track.centerline[i * 2 + 1]!);
      expect(edge).toBeGreaterThan(0);
      expect(edge).toBeLessThan(17);
      total += edge;
      expect(track.cumulativeLengths[i + 1]).toBeGreaterThan(track.cumulativeLengths[i]!);
      expect(track.cumulativeLengths[i + 1]).toBeCloseTo(total, 3);
      for (let side = 0; side < 2; side++) {
        const offset = (side * n + i) * 4;
        const following = (side * n + next) * 4;
        expect(track.walls[offset + 2]).toBe(track.walls[following]);
        expect(track.walls[offset + 3]).toBe(track.walls[following + 1]);
        expect(Math.hypot(track.walls[offset + 2]! - track.walls[offset]!, track.walls[offset + 3]! - track.walls[offset + 1]!)).toBeGreaterThan(0);
      }
    }
    expect(track.length).toBe(track.cumulativeLengths[n]);
    expect(track.bounds.minX).toBeGreaterThanOrEqual(0);
    expect(track.bounds.minY).toBeGreaterThanOrEqual(0);
    expect(track.bounds.maxX).toBeLessThanOrEqual(1200);
    expect(track.bounds.maxY).toBeLessThanOrEqual(800);
    for (let i = 0; i < track.walls.length; i += 2) {
      expect(track.walls[i]).toBeGreaterThanOrEqual(track.bounds.minX);
      expect(track.walls[i]).toBeLessThanOrEqual(track.bounds.maxX);
      expect(track.walls[i + 1]).toBeGreaterThanOrEqual(track.bounds.minY);
      expect(track.walls[i + 1]).toBeLessThanOrEqual(track.bounds.maxY);
    }
    expect(track.spawn.x).toBe(track.centerline[0]);
    expect(track.spawn.y).toBe(track.centerline[1]);
    expect(Math.hypot(track.startForward.x, track.startForward.y)).toBeCloseTo(1, 12);
    expect(track.spawn.heading).toBe(Math.atan2(track.startForward.y, track.startForward.x));
    const { a, b } = track.startLine;
    expect((a.x + b.x) / 2).toBeCloseTo(track.spawn.x, 3);
    expect((a.y + b.y) / 2).toBeCloseTo(track.spawn.y, 3);
    expect((b.x - a.x) * track.startForward.x + (b.y - a.y) * track.startForward.y).toBeCloseTo(0, 3);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(92, 0);
  });
  it('rejects unknown preset identifiers', () => expect(() => createPreset('missing')).toThrow(RangeError));
  it.each([[140, 4], [32, 9], [20, 14]])('accepts a loose %i-sample oval with %i-unit hand jitter', (count, noise) => {
    valid(buildTrack(oval(count, 390, 220, noise), options));
  });
  it('accepts sparse rounded circuits and a nontrivial concave bend', () => {
    valid(buildTrack([{ x: 220, y: 180 }, { x: 980, y: 180 }, { x: 980, y: 620 }, { x: 220, y: 620 }], options));
    valid(buildTrack(oval(100).map((p, i) => ({ x: p.x, y: p.y + 40 * Math.sin(i * Math.PI * 4 / 100) })), options));
  });
  it('handles repeated samples, an explicit closing point, and either winding', () => {
    const points = oval();
    const copy = JSON.stringify(points);
    const forward = valid(buildTrack(points, options));
    expect(valid(buildTrack(points.flatMap(p => [p, p]).concat(points[0]!), options))).toEqual(forward);
    const reversed = valid(buildTrack([...points].reverse(), options));
    expect(reversed.length).toBeCloseTo(forward.length, 0);
    expect(JSON.stringify(points)).toBe(copy);
  });
  it('is insensitive to pauses and extra samples on the same stroke edges', () => {
    const points = oval(40);
    const dense = points.flatMap((a, i) => {
      const b = points[(i + 1) % points.length]!;
      return Array.from({ length: i % 3 + 1 }, (_, j) => ({ x: a.x + (b.x - a.x) * j / (i % 3 + 1), y: a.y + (b.y - a.y) * j / (i % 3 + 1) }));
    });
    expect(valid(buildTrack(dense, options)).length).toBe(valid(buildTrack(points, options)).length);
  });
});

describe('safe rejection', () => {
  it.each([[], [{ x: 1, y: 1 }], [{ x: 200, y: 200 }, { x: 201, y: 201 }, { x: 202, y: 200 }], oval(50, 25, 25)].map(points => ({ points })))('rejects tiny or empty drawings', ({ points }) => expectIssue(points, 'too-short'));
  it('rejects nonfinite points, invalid width and invalid identifiers', () => {
    expectIssue([{ x: NaN, y: 5 }], 'invalid-input');
    expectIssue([{ x: 5, y: Infinity }], 'invalid-input');
    expectIssue(new Array<Point>(3), 'invalid-input');
    for (const width of [0, -1, NaN, Infinity, 801]) expectIssue(oval(), 'invalid-input', width);
    expect(buildTrack(oval(), { id: '', width: 92 }).ok).toBe(false);
  });
  it('rejects a figure eight before smoothing can conceal its crossing', () => {
    expectIssue(Array.from({ length: 80 }, (_, i) => {
      const t = i * Math.PI * 2 / 80;
      return { x: 600 + 400 * Math.sin(t), y: 400 + 220 * Math.sin(2 * t) };
    }), 'self-intersection');
  });
  it('rejects collinear backtracking and needle-like turns', () => {
    expect(buildTrack([{ x: 200, y: 400 }, { x: 600, y: 400 }, { x: 1000, y: 400 }], options).ok).toBe(false);
    expectIssue(oval(100, 400, 60), 'too-tight');
  });
  it('rejects roads crossing the world boundary, including an in-bounds centerline', () => {
    expectIssue(oval(100, 610, 220), 'out-of-bounds');
    expectIssue(oval(100, 580, 250), 'out-of-bounds');
  });
  it('rejects a narrow neck where the two sides of the road overlap', () => {
    const neck = [
      [220, 140], [430, 140], [540, 365], [660, 365], [770, 140], [980, 140],
      [1080, 400], [980, 660], [770, 660], [660, 435], [540, 435], [430, 660], [220, 660], [120, 400],
    ].map(([x, y]) => ({ x: x!, y: y! }));
    expectIssue(neck, 'too-tight');
    const result = buildTrack(neck, options);
    if (!result.ok) expect(result.issues[0]?.message).toContain('overlaps');
  });
});
