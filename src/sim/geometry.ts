import type { TrackGeometry } from '../shared/geometry';

const EPS = 1e-9;
export const CELL_SIZE = 64;

/** Distance along a unit ray, maxLength on miss; includes endpoints/collinear hits. */
export function raySegment(x: number, y: number, dx: number, dy: number, maxLength: number,
  ax: number, ay: number, bx: number, by: number): number {
  const sx = bx - ax, sy = by - ay, qx = ax - x, qy = ay - y;
  const cross = dx * sy - dy * sx;
  if (Math.abs(cross) < EPS) {
    if (Math.abs(qx * dy - qy * dx) > EPS) return maxLength;
    const a = qx * dx + qy * dy, b = (bx - x) * dx + (by - y) * dy;
    if (Math.max(a, b) < 0) return maxLength;
    return Math.min(maxLength, Math.max(0, Math.min(a, b)));
  }
  const t = (qx * sy - qy * sx) / cross;
  const u = (qx * dy - qy * dx) / cross;
  return t >= -EPS && t <= maxLength && u >= -EPS && u <= 1 + EPS ? Math.max(0, t) : maxLength;
}

export function pointSegmentDistanceSq(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  const ex = x - ax - dx * t, ey = y - ay - dy * t;
  return ex * ex + ey * ey;
}

/** Swept circle: segment intersection or any endpoint within radius of the other segment. */
export function sweptCircle(x: number, y: number, nx: number, ny: number, radius: number,
  ax: number, ay: number, bx: number, by: number): boolean {
  const dx = nx - x, dy = ny - y, length = Math.hypot(dx, dy), r2 = radius * radius;
  if (length > 0 && raySegment(x, y, dx / length, dy / length, length + EPS, ax, ay, bx, by) <= length) return true;
  if (pointSegmentDistanceSq(x, y, ax, ay, bx, by) <= r2 || pointSegmentDistanceSq(nx, ny, ax, ay, bx, by) <= r2) return true;
  return length > 0 && (pointSegmentDistanceSq(ax, ay, x, y, nx, ny) <= r2 || pointSegmentDistanceSq(bx, by, x, y, nx, ny) <= r2);
}

/** Compact uniform grid; built once. Queries allocate nothing. Bounds include one-cell padding. */
export class SegmentGrid {
  readonly minX: number;
  readonly minY: number;
  readonly columns: number;
  readonly rows: number;
  readonly offsets: Uint32Array;
  readonly indices: Uint32Array;
  constructor(readonly segments: Float32Array, padding = 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < segments.length; i += 2) {
      minX = Math.min(minX, segments[i]!); maxX = Math.max(maxX, segments[i]!);
      minY = Math.min(minY, segments[i + 1]!); maxY = Math.max(maxY, segments[i + 1]!);
    }
    this.minX = Math.floor((minX - padding) / CELL_SIZE) * CELL_SIZE - CELL_SIZE;
    this.minY = Math.floor((minY - padding) / CELL_SIZE) * CELL_SIZE - CELL_SIZE;
    this.columns = Math.ceil((maxX + padding - this.minX) / CELL_SIZE) + 1;
    this.rows = Math.ceil((maxY + padding - this.minY) / CELL_SIZE) + 1;
    const lists: number[][] = Array.from({ length: this.columns * this.rows }, () => []);
    for (let s = 0; s < segments.length; s += 4) {
      const x0 = this.column(Math.min(segments[s]!, segments[s + 2]!) - padding);
      const x1 = this.column(Math.max(segments[s]!, segments[s + 2]!) + padding);
      const y0 = this.row(Math.min(segments[s + 1]!, segments[s + 3]!) - padding);
      const y1 = this.row(Math.max(segments[s + 1]!, segments[s + 3]!) + padding);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) lists[y * this.columns + x]!.push(s);
    }
    this.offsets = new Uint32Array(lists.length + 1);
    for (let i = 0; i < lists.length; i++) this.offsets[i + 1] = this.offsets[i]! + lists[i]!.length;
    this.indices = new Uint32Array(this.offsets[lists.length]!);
    for (let i = 0; i < lists.length; i++) this.indices.set(lists[i]!, this.offsets[i]!);
  }
  column(x: number): number { return Math.max(0, Math.min(this.columns - 1, Math.floor((x - this.minX) / CELL_SIZE))); }
  row(y: number): number { return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.minY) / CELL_SIZE))); }

  ray(x: number, y: number, dx: number, dy: number, length: number): number {
    let cx = Math.floor((x - this.minX) / CELL_SIZE), cy = Math.floor((y - this.minY) / CELL_SIZE);
    // Engine queries start on the road inside this grid. Outside queries use the exact fallback.
    if (cx < 0 || cy < 0 || cx >= this.columns || cy >= this.rows) return this.bruteRay(x, y, dx, dy, length);
    const sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;
    const deltaX = Math.abs(dx) < EPS ? Infinity : CELL_SIZE / Math.abs(dx);
    const deltaY = Math.abs(dy) < EPS ? Infinity : CELL_SIZE / Math.abs(dy);
    let tx = Math.abs(dx) < EPS ? Infinity : (this.minX + (cx + (sx > 0 ? 1 : 0)) * CELL_SIZE - x) / dx;
    let ty = Math.abs(dy) < EPS ? Infinity : (this.minY + (cy + (sy > 0 ? 1 : 0)) * CELL_SIZE - y) / dy;
    let hit = length;
    while (cx >= 0 && cy >= 0 && cx < this.columns && cy < this.rows) {
      const cell = cy * this.columns + cx;
      for (let i = this.offsets[cell]!; i < this.offsets[cell + 1]!; i++) {
        const s = this.indices[i]!;
        hit = raySegment(x, y, dx, dy, hit, this.segments[s]!, this.segments[s + 1]!, this.segments[s + 2]!, this.segments[s + 3]!);
      }
      if (Math.min(tx, ty) > hit) break;
      if (tx < ty) { cx += sx; tx += deltaX; } else { cy += sy; ty += deltaY; }
    }
    return hit;
  }
  bruteRay(x: number, y: number, dx: number, dy: number, length: number): number {
    let hit = length;
    for (let s = 0; s < this.segments.length; s += 4) {
      hit = raySegment(x, y, dx, dy, hit, this.segments[s]!, this.segments[s + 1]!, this.segments[s + 2]!, this.segments[s + 3]!);
    }
    return hit;
  }
  collision(x: number, y: number, nx: number, ny: number, radius: number): boolean {
    const x0 = this.column(Math.min(x, nx) - radius), x1 = this.column(Math.max(x, nx) + radius);
    const y0 = this.row(Math.min(y, ny) - radius), y1 = this.row(Math.max(y, ny) + radius);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const cell = cy * this.columns + cx;
      for (let i = this.offsets[cell]!; i < this.offsets[cell + 1]!; i++) {
        const s = this.indices[i]!;
        if (sweptCircle(x, y, nx, ny, radius, this.segments[s]!, this.segments[s + 1]!, this.segments[s + 2]!, this.segments[s + 3]!)) return true;
      }
    }
    return false;
  }
}

export class ProgressQuery {
  readonly grid: SegmentGrid;
  constructor(readonly track: TrackGeometry) {
    const points = track.centerline, segments = new Float32Array(points.length * 2);
    for (let i = 0; i < points.length; i += 2) {
      const next = (i + 2) % points.length;
      segments.set([points[i]!, points[i + 1]!, points[next]!, points[next + 1]!], i * 2);
    }
    this.grid = new SegmentGrid(segments, track.width);
  }
  at(x: number, y: number): number {
    const g = this.grid, cell = g.row(y) * g.columns + g.column(x);
    const begin = g.offsets[cell]!, end = g.offsets[cell + 1]!;
    let best = Infinity, progress = 0;
    // Nearby candidates suffice inside a valid road. Exact fallback handles arbitrary test queries.
    for (let k = begin; k < (begin === end ? g.segments.length / 4 : end); k++) {
      const s = begin === end ? k * 4 : g.indices[k]!;
      const ax = g.segments[s]!, ay = g.segments[s + 1]!;
      const dx = g.segments[s + 2]! - ax, dy = g.segments[s + 3]! - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      const ex = x - ax - dx * t, ey = y - ay - dy * t, distance = ex * ex + ey * ey;
      if (distance < best) {
        best = distance;
        const i = s / 4;
        progress = this.track.cumulativeLengths[i]! + t * (this.track.cumulativeLengths[i + 1]! - this.track.cumulativeLengths[i]!);
      }
    }
    return progress;
  }
}
