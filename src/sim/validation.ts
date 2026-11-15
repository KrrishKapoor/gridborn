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
  requireValue(positive(s.rayLength) && s.rayLength <= Number.MAX_VALUE / 4, 'Ray length must be finite and positive.');
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
  const endpoints = new Map<string, number>();
  for (let i = 0; i < t.walls.length; i += 4) {
    requireValue(Math.hypot(t.walls[i + 2]! - t.walls[i]!, t.walls[i + 3]! - t.walls[i + 1]!) > 1e-4, 'Wall contains a zero-length edge.');
    for (let k = 0; k < 4; k += 2) {
      const x = t.walls[i + k]!, y = t.walls[i + k + 1]!;
      requireValue(x >= b.minX - 0.01 && x <= b.maxX + 0.01 && y >= b.minY - 0.01 && y <= b.maxY + 0.01, 'Wall is outside road bounds.');
      const key = `${x},${y}`; endpoints.set(key, (endpoints.get(key) ?? 0) + 1);
    }
  }
  requireValue([...endpoints.values()].every((degree) => degree === 2), 'Walls must form closed unbranched boundaries.');
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
