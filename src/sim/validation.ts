import { WORLD_HEIGHT, WORLD_WIDTH } from '../shared/geometry';
import type { TrackGeometry } from '../shared/geometry';
import { ACTIVATION_COUNT, CAR_STRIDE, MAX_POPULATION, SENSOR_ANGLES, SENSOR_STRIDE, WEIGHT_COUNT } from '../shared/simulation';
import type { SimulationSettings, SnapshotStorage } from '../shared/simulation';
import { CAR_RADIUS } from './physics';
import { pointSegmentDistanceSq } from './geometry';

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(message);
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function positive(value: unknown): value is number { return finite(value) && value > 0; }
function point(value: unknown): value is { x: number; y: number } {
  return !!value && typeof value === 'object' && 'x' in value && 'y' in value && finite(value.x) && finite(value.y);
}
function floats(value: unknown, min: number, max: number, stride: number): value is Float32Array {
  return value instanceof Float32Array && value.length >= min && value.length <= max && value.length % stride === 0 && value.every(Number.isFinite);
}

export function validateSettings(value: unknown): asserts value is SimulationSettings {
  requireValue(!!value && typeof value === 'object', 'Settings are required.');
  const s = value as SimulationSettings;
  requireValue(Number.isInteger(s.seed) && s.seed >= 0 && s.seed <= 0xffffffff, 'Seed must be uint32.');
  requireValue(Number.isInteger(s.population) && s.population >= 2 && s.population <= MAX_POPULATION, 'Population must be 2–1000.');
  requireValue(Number.isInteger(s.eliteCount) && s.eliteCount >= 1 && s.eliteCount < s.population, 'Elite count must be 1..population−1.');
  requireValue(finite(s.mutationRate) && s.mutationRate >= 0 && s.mutationRate <= 1, 'Mutation rate must be 0–1.');
  requireValue(finite(s.mutationScale) && s.mutationScale >= 0, 'Mutation scale must be finite and nonnegative.');
  requireValue(positive(s.generationSeconds) && Math.ceil(s.generationSeconds * 60) <= 0x7fffffff, 'Generation deadline must fit a positive signed 32-bit tick count.');
  requireValue(positive(s.rayLength) && s.rayLength <= 3.4028234663852886e38 / 4, 'Ray length must be positive and safely representable in Float32 sensor storage.');
  requireValue(positive(s.maxSpeed) && s.maxSpeed <= Number.MAX_VALUE / 4, 'Maximum speed must be finite and positive.');
}

/** Validate the serialized boundary, independently of T1. Limits bound reset work. */
export function validateTrack(value: unknown): asserts value is TrackGeometry {
  requireValue(!!value && typeof value === 'object', 'Track is required.');
  const t = value as TrackGeometry;
  requireValue(typeof t.id === 'string' && t.id.length > 0 && t.id.length <= 256, 'Track id is required.');
  requireValue(floats(t.centerline, 6, 4096, 2), 'Centerline must contain 3–2048 finite vertices.');
  const n = t.centerline.length / 2;
  requireValue(floats(t.cumulativeLengths, n + 1, n + 1, 1), 'Cumulative lengths do not match the centerline.');
  requireValue(positive(t.length) && positive(t.width) && t.width > CAR_RADIUS * 2 && t.width <= WORLD_HEIGHT, 'Road length/width is invalid.');
  requireValue(floats(t.walls, 24, 16384, 4), 'Walls must contain 6–4096 finite segments.');
  requireValue(t.cumulativeLengths[0] === 0, 'Cumulative lengths must start at zero.');
  let length = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const edge = Math.hypot(t.centerline[j * 2]! - t.centerline[i * 2]!, t.centerline[j * 2 + 1]! - t.centerline[i * 2 + 1]!);
    requireValue(edge > 1e-4, 'Centerline contains a zero-length edge.');
    length += edge;
    requireValue(t.cumulativeLengths[i + 1]! > t.cumulativeLengths[i]! && Math.abs(t.cumulativeLengths[i + 1]! - length) < Math.max(0.02, length * 1e-5), 'Cumulative lengths must match actual edge lengths.');
  }
  requireValue(Math.abs(length - t.length) < Math.max(0.02, length * 1e-5), 'Track length does not match its geometry.');
  const b = t.bounds;
  requireValue(b && [b.minX, b.minY, b.maxX, b.maxY].every(finite) && b.minX >= 0 && b.minY >= 0 && b.maxX <= WORLD_WIDTH && b.maxY <= WORLD_HEIGHT && b.maxX > b.minX && b.maxY > b.minY, 'Road bounds must fit the logical world.');
  for (let i = 0; i < t.centerline.length; i += 2) {
    requireValue(t.centerline[i]! >= b.minX && t.centerline[i]! <= b.maxX && t.centerline[i + 1]! >= b.minY && t.centerline[i + 1]! <= b.maxY, 'Centerline is outside road bounds.');
  }
  const endpoints = new Map<string, string[]>();
  for (let i = 0; i < t.walls.length; i += 4) {
    requireValue(Math.hypot(t.walls[i + 2]! - t.walls[i]!, t.walls[i + 3]! - t.walls[i + 1]!) > 1e-4, 'Wall contains a zero-length edge.');
    for (let k = 0; k < 4; k += 2) {
      const x = t.walls[i + k]!, y = t.walls[i + k + 1]!;
      requireValue(x >= b.minX - 0.01 && x <= b.maxX + 0.01 && y >= b.minY - 0.01 && y <= b.maxY + 0.01, 'Wall is outside road bounds.');
      const key = `${x},${y}`, other = k === 0 ? `${t.walls[i + 2]},${t.walls[i + 3]}` : `${t.walls[i]},${t.walls[i + 1]}`;
      const neighbors = endpoints.get(key); if (neighbors) neighbors.push(other); else endpoints.set(key, [other]);
    }
  }
  requireValue([...endpoints.values()].every((neighbors) => neighbors.length === 2), 'Walls must form closed unbranched boundaries.');
  const visited = new Set<string>(); const boundaries: number[][] = [];
  for (const key of endpoints.keys()) {
    if (visited.has(key)) continue;
    const boundary: number[] = [];
    let at = key;
    while (!visited.has(at)) {
      visited.add(at); boundary.push(...at.split(',').map(Number));
      at = endpoints.get(at)!.find((neighbor) => !visited.has(neighbor)) ?? key;
    }
    boundaries.push(boundary);
  }
  requireValue(boundaries.length === 2, 'Road requires two closed wall boundaries.');
  const centerSegments = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    centerSegments.set([t.centerline[i * 2]!, t.centerline[i * 2 + 1]!, t.centerline[next * 2]!, t.centerline[next * 2 + 1]!], i * 4);
  }
  requireSimple(centerSegments, 'Centerline intersects itself.');
  requireSimple(t.walls, 'Walls intersect or overlap.');
  for (let i = 0; i < centerSegments.length; i += 4) {
    for (let j = 0; j < t.walls.length; j += 4) requireValue(!intersects(centerSegments, i, t.walls, j), 'Centerline crosses a wall.');
  }
  // Both boundaries must describe the declared road, not a tiny decoy infield.
  const [one, two] = boundaries as [number[], number[]];
  requireValue(inside(one[0]!, one[1]!, two) !== inside(two[0]!, two[1]!, one), 'Road boundaries must be nested.');
  for (let i = 0; i < t.centerline.length; i += 2) {
    const x = t.centerline[i]!, y = t.centerline[i + 1]!;
    requireValue(inside(x, y, one) !== inside(x, y, two), 'Centerline must lie between the road boundaries.');
    for (const boundary of boundaries) {
      let distance = Infinity;
      for (let j = 0; j < boundary.length; j += 2) {
        const k = (j + 2) % boundary.length;
        distance = Math.min(distance, pointSegmentDistanceSq(x, y, boundary[j]!, boundary[j + 1]!, boundary[k]!, boundary[k + 1]!));
      }
      requireValue(distance >= (t.width * 0.35) ** 2 && distance <= (t.width * 0.8) ** 2,
        'Both road boundaries must follow the centerline at the declared width.');
    }
  }
  requireValue(point(t.spawn) && finite(t.spawn.heading) && point(t.startForward) && t.startLine && point(t.startLine.a) && point(t.startLine.b), 'Spawn/start line is invalid.');
  requireValue(Math.hypot(t.spawn.x - t.centerline[0]!, t.spawn.y - t.centerline[1]!) < 0.01, 'Spawn must be centerline vertex zero.');
  const f = t.startForward;
  requireValue(Math.abs(Math.hypot(f.x, f.y) - 1) < 1e-4 && Math.abs(Math.cos(t.spawn.heading) - f.x) < 1e-4 && Math.abs(Math.sin(t.spawn.heading) - f.y) < 1e-4, 'Spawn heading must match the unit forward tangent.');
  const dx = t.centerline[2]! - t.spawn.x, dy = t.centerline[3]! - t.spawn.y;
  requireValue((dx * f.x + dy * f.y) / Math.hypot(dx, dy) > 0.5, 'Start forward disagrees with centerline order.');
  const a = t.startLine.a, z = t.startLine.b, lineLength = Math.hypot(z.x - a.x, z.y - a.y);
  requireValue(lineLength > CAR_RADIUS * 2 && pointSegmentDistanceSq(t.spawn.x, t.spawn.y, a.x, a.y, z.x, z.y) < 0.01 && Math.abs((z.x - a.x) * f.x + (z.y - a.y) * f.y) < lineLength * 1e-3, 'Start line must cross spawn perpendicular to forward.');
  let clearance = Infinity, aDistance = Infinity, bDistance = Infinity;
  for (let s = 0; s < t.walls.length; s += 4) {
    clearance = Math.min(clearance, pointSegmentDistanceSq(t.spawn.x, t.spawn.y, t.walls[s]!, t.walls[s + 1]!, t.walls[s + 2]!, t.walls[s + 3]!));
    aDistance = Math.min(aDistance, pointSegmentDistanceSq(a.x, a.y, t.walls[s]!, t.walls[s + 1]!, t.walls[s + 2]!, t.walls[s + 3]!));
    bDistance = Math.min(bDistance, pointSegmentDistanceSq(z.x, z.y, t.walls[s]!, t.walls[s + 1]!, t.walls[s + 2]!, t.walls[s + 3]!));
  }
  requireValue(clearance > CAR_RADIUS ** 2 && aDistance < 0.1 && bDistance < 0.1, 'Spawn needs clearance and start endpoints must meet walls.');
}

export function validStorage(value: unknown, population: number): value is SnapshotStorage {
  if (!value || typeof value !== 'object') return false;
  const s = value as SnapshotStorage;
  const arrays = [s.cars, s.sensors, s.weights, s.activations];
  const sizes = [population * CAR_STRIDE, SENSOR_ANGLES.length * SENSOR_STRIDE, WEIGHT_COUNT, ACTIVATION_COUNT];
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    if (!(a instanceof Float32Array) || !(a.buffer instanceof ArrayBuffer) || a.length !== sizes[i] || a.byteOffset !== 0 || a.byteLength !== a.buffer.byteLength) return false;
    for (let j = 0; j < i; j++) if (a.buffer === arrays[j]!.buffer) return false;
  }
  return true;
}


/** Reset-only topology checks. AABB rejection keeps ordinary sampled loops cheap. */
function intersects(a: Float32Array, i: number, b: Float32Array, j: number): boolean {
  const ax = a[i]!, ay = a[i + 1]!, bx = a[i + 2]!, by = a[i + 3]!;
  const cx = b[j]!, cy = b[j + 1]!, dx = b[j + 2]!, dy = b[j + 3]!;
  if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx)
    || Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) return false;
  const c1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const c2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const c3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const c4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return c1 * c2 <= 0 && c3 * c4 <= 0;
}
function requireSimple(segments: Float32Array, message: string): void {
  for (let i = 0; i < segments.length; i += 4) for (let j = i + 4; j < segments.length; j += 4) {
    if (!intersects(segments, i, segments, j)) continue;
    let shared = false;
    for (let a = 0; a < 4; a += 2) for (let b = 0; b < 4; b += 2) {
      if (segments[i + a] !== segments[j + b] || segments[i + a + 1] !== segments[j + b + 1]) continue;
      const ax = segments[i + 2 - a]! - segments[i + a]!, ay = segments[i + 3 - a]! - segments[i + a + 1]!;
      const bx = segments[j + 2 - b]! - segments[j + b]!, by = segments[j + 3 - b]! - segments[j + b + 1]!;
      // Adjacent segments may meet, but must not double back along the same ray.
      requireValue(Math.abs(ax * by - ay * bx) > 1e-8 || ax * bx + ay * by < 0, message);
      shared = true;
    }
    requireValue(shared, message);
  }
}

/** Ray parity works with either winding; called only during reset validation. */
function inside(x: number, y: number, loop: number[]): boolean {
  let result = false;
  for (let i = 0, j = loop.length - 2; i < loop.length; j = i, i += 2) {
    const ax = loop[i]!, ay = loop[i + 1]!, bx = loop[j]!, by = loop[j + 1]!;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) result = !result;
  }
  return result;
}
