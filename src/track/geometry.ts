import { WORLD_HEIGHT, WORLD_WIDTH } from '../shared/geometry';
import type { Point, TrackBuildOptions, TrackIssueCode, TrackValidation } from '../shared/geometry';
import { findClosingTail, simplifyJitter } from './cleanup';

const EPSILON = 1e-7;
const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const cross = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Includes endpoint touches and collinear overlap, not just proper crossings. */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.max(a.x, b.x) + EPSILON < Math.min(c.x, d.x)
    || Math.max(c.x, d.x) + EPSILON < Math.min(a.x, b.x)
    || Math.max(a.y, b.y) + EPSILON < Math.min(c.y, d.y)
    || Math.max(c.y, d.y) + EPSILON < Math.min(a.y, b.y)) return false;
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  return ((abC >= -EPSILON && abD <= EPSILON) || (abD >= -EPSILON && abC <= EPSILON))
    && ((cdA >= -EPSILON && cdB <= EPSILON) || (cdB >= -EPSILON && cdA <= EPSILON));
}

// A nonzero localTravel is only for the raw jitter gate. Even then, every
// crossing spanning more stroke travel is rejected before any simplification.
// Final centerline and wall checks always use zero (no ignored intersections).
export function loopIntersects(points: readonly Point[], localTravel = 0, closed = true): boolean {
  const edgeCount = closed ? points.length : Math.max(0, points.length - 1);
  const lengths = [0];
  if (localTravel > 0) for (let i = 0; i < edgeCount; i++) {
    lengths.push(lengths[i]! + distance(points[i]!, points[(i + 1) % points.length]!));
  }
  // Sort edge bounds to avoid a quadratic scan for densely sampled freehand loops.
  const edges = points.slice(0, edgeCount).map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    return { a, b, i, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x) };
  }).sort((a, b) => a.minX - b.minX || a.i - b.i);
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]!;
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j]!;
      if (b.minX > a.maxX + EPSILON) break;
      const gap = Math.abs(a.i - b.i);
      if (gap === 1 || (closed && gap === points.length - 1)) continue;
      if (segmentsIntersect(a.a, a.b, b.a, b.b)) {
        if (localTravel > 0) {
          const first = Math.min(a.i, b.i), last = Math.max(a.i, b.i);
          const ax = a.b.x - a.a.x, ay = a.b.y - a.a.y;
          const bx = b.b.x - b.a.x, by = b.b.y - b.a.y;
          const denominator = ax * by - ay * bx;
          if (Math.abs(denominator) > EPSILON) {
            const dx = b.a.x - a.a.x, dy = b.a.y - a.a.y;
            const ta = Math.max(0, Math.min(1, (dx * by - dy * bx) / denominator));
            const tb = Math.max(0, Math.min(1, (dx * ay - dy * ax) / denominator));
            const gap = Math.abs(lengths[a.i]! + ta * distance(a.a, a.b) - lengths[b.i]! - tb * distance(b.a, b.b));
            if ((closed ? Math.min(gap, lengths[edgeCount]! - gap) : gap) <= localTravel) continue;
            return true;
          }
          // Collinear overlap has multiple contacts: bound the whole arc,
          // including both edges, rather than choosing one convenient contact.
          const forward = lengths[last + 1]! - lengths[first]!;
          const wrapped = closed ? lengths[edgeCount]! - lengths[last]! + lengths[first + 1]! : Infinity;
          if (Math.min(forward, wrapped) <= localTravel) continue;
        }
        return true;
      }
    }
  }
  return false;
}

function perimeter(points: readonly Point[]): number {
  let length = 0;
  for (let i = 0; i < points.length; i++) length += distance(points[i]!, points[(i + 1) % points.length]!);
  return length;
}

/** Equal arc-length samples make smoothing independent of drawing speed. */
function resample(points: readonly Point[], spacing: number): Point[] {
  const length = perimeter(points);
  const count = Math.max(24, Math.ceil(length / spacing));
  const result: Point[] = [];
  let edge = 0, before = 0;
  let edgeLength = distance(points[0]!, points[1]!);
  for (let i = 0; i < count; i++) {
    const target = i * length / count;
    while (before + edgeLength < target && edge < points.length - 1) {
      before += edgeLength;
      edge++;
      edgeLength = distance(points[edge]!, points[(edge + 1) % points.length]!);
    }
    const a = points[edge]!, b = points[(edge + 1) % points.length]!;
    const t = edgeLength > 0 ? (target - before) / edgeLength : 0;
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return result;
}

function smooth(points: readonly Point[], width: number): Point[] {
  const samples = resample(points, 10);
  const step = perimeter(points) / samples.length;
  const sigma = Math.max(14, width * 0.68) / step;
  const radius = Math.min(Math.ceil(sigma * 3), Math.floor(samples.length / 3));
  const weights = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-0.5 * ((i - radius) / sigma) ** 2));
  const sum = weights.reduce((a, b) => a + b, 0);
  const filtered = samples.map((_, i) => {
    let x = 0, y = 0;
    for (let j = -radius; j <= radius; j++) {
      const p = samples[(i + j + samples.length) % samples.length]!;
      const w = weights[j + radius]!;
      x += p.x * w;
      y += p.y * w;
    }
    return { x: x / sum, y: y / sum };
  });
  // Round before validation: consumers see precisely this Float32 geometry.
  return resample(filtered, 16).map(({ x, y }) => ({ x: Math.fround(x), y: Math.fround(y) }));
}

function invalid(code: TrackIssueCode, message: string): TrackValidation {
  return { ok: false, issues: [{ code, message }] };
}

/** Pure construction; failures never mutate the input or produce partial geometry. */
export function buildTrack(points: readonly Point[], options: TrackBuildOptions): TrackValidation {
  if (!options || typeof options.id !== 'string' || !options.id.trim()
    || !Number.isFinite(options.width) || options.width <= 0 || options.width > WORLD_HEIGHT
    || !Array.isArray(points) || points.length > 20000) {
    return invalid('invalid-input', 'Use a finite road width and draw one simple loop.');
  }
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return invalid('invalid-input', 'Use finite points to draw one simple loop.');
    }
  }
  if (points.some(p => p.x < 0 || p.x > WORLD_WIDTH || p.y < 0 || p.y > WORLD_HEIGHT)) {
    return invalid('out-of-bounds', 'Keep the whole loop inside the drawing area, with room for the road.');
  }
  let cleaned: Point[] = [];
  for (const p of points) {
    if (!cleaned.length || distance(cleaned[cleaned.length - 1]!, p) >= 1) cleaned.push({ x: p.x, y: p.y });
  }
  // Bound the original travel before cleanup can shorten pathological strokes.
  if (cleaned.length >= 3 && perimeter(cleaned) > 20000) return invalid('invalid-input', 'Use fewer turns; draw one simple loop.');
  const localTravel = Math.min(32, options.width * 0.4);
  const closure = findClosingTail(cleaned, options.width);
  // A forward tail may retrace the opening, but must not contain its own new
  // nonlocal crossing/lobe. Validate it as an open path (no invented last→first).
  if (closure && !loopIntersects(closure.tail, localTravel, false)) cleaned = closure.loop;
  // Remove repeated/nearby closing samples, including the selected closure.
  while (cleaned.length > 3 && distance(cleaned[0]!, cleaned[cleaned.length - 1]!) < 12) cleaned.pop();
  const rawLength = cleaned.length >= 3 ? perimeter(cleaned) : 0;
  if (rawLength < Math.max(240, options.width * 6)) {
    return invalid('too-short', 'Draw a larger loop with room for a full-width road.');
  }
  if (loopIntersects(cleaned)) {
    if (loopIntersects(cleaned, localTravel)) {
      return invalid('self-intersection', 'The loop crosses itself. Draw a loop without crossings.');
    }
    cleaned = simplifyJitter(cleaned, options.width);
    if (loopIntersects(cleaned)) return invalid('self-intersection', 'The loop crosses itself. Draw a loop without crossings.');
  }

  const center = smooth(cleaned, options.width);
  const n = center.length, half = options.width / 2;
  if (perimeter(center) < Math.max(240, options.width * 6)) {
    return invalid('too-short', 'Draw a larger loop with room for a full-width road.');
  }
  if (loopIntersects(center)) return invalid('self-intersection', 'These turns cross after smoothing. Give them more space.');
  const left: Point[] = [], right: Point[] = [];
  const tangents: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = center[(i + n - 1) % n]!, b = center[i]!, c = center[(i + 1) % n]!;
    const incoming = distance(a, b), outgoing = distance(b, c);
    const ux = (b.x - a.x) / incoming, uy = (b.y - a.y) / incoming;
    const vx = (c.x - b.x) / outgoing, vy = (c.y - b.y) / outgoing;
    const sum = Math.hypot(ux + vx, uy + vy);
    const sinHalf = Math.sqrt(Math.max(0, (1 - (ux * vx + uy * vy)) / 2));
    const radius = Math.min(incoming, outgoing) / (2 * Math.max(sinHalf, EPSILON));
    if (!Number.isFinite(radius) || incoming < 0.1 || outgoing < 0.1 || sum < 0.1 || radius <= half * 1.08) {
      return invalid('too-tight', 'Widen the tight bends so the road has room to turn.');
    }
    const tx = (ux + vx) / sum, ty = (uy + vy) / sum;
    const offset = half / (tx * ux + ty * uy);
    tangents.push({ x: tx, y: ty });
    left.push({ x: Math.fround(b.x - ty * offset), y: Math.fround(b.y + tx * offset) });
    right.push({ x: Math.fround(b.x + ty * offset), y: Math.fround(b.y - tx * offset) });
  }
  if (loopIntersects(left) || loopIntersects(right)) {
    return invalid('too-tight', 'The road overlaps itself. Space the turns farther apart.');
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (segmentsIntersect(left[i]!, left[(i + 1) % n]!, right[j]!, right[(j + 1) % n]!)) {
        return invalid('too-tight', 'The road overlaps itself. Space the turns farther apart.');
      }
    }
  }
  const boundaries = [...left, ...right];
  const bounds = {
    minX: Math.min(...boundaries.map(p => p.x)), minY: Math.min(...boundaries.map(p => p.y)),
    maxX: Math.max(...boundaries.map(p => p.x)), maxY: Math.max(...boundaries.map(p => p.y)),
  };
  if (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX > WORLD_WIDTH || bounds.maxY > WORLD_HEIGHT) {
    return invalid('out-of-bounds', 'Move the loop away from the edge to leave room for the road.');
  }
  const centerline = new Float32Array(n * 2);
  const cumulativeLengths = new Float32Array(n + 1);
  const walls = new Float32Array(n * 8);
  let length = 0;
  for (let i = 0; i < n; i++) {
    centerline.set([center[i]!.x, center[i]!.y], i * 2);
    length += distance(center[i]!, center[(i + 1) % n]!);
    cumulativeLengths[i + 1] = length;
    for (const [side, boundary] of [left, right].entries()) {
      const a = boundary[i]!, b = boundary[(i + 1) % n]!;
      walls.set([a.x, a.y, b.x, b.y], (side * n + i) * 4);
    }
  }
  const startForward = tangents[0]!;
  return { ok: true, track: {
    id: options.id, centerline, cumulativeLengths, length: cumulativeLengths[n]!, width: options.width, walls, bounds,
    startLine: { a: left[0]!, b: right[0]! }, startForward,
    spawn: { ...center[0]!, heading: Math.atan2(startForward.y, startForward.x) },
  } };
}
