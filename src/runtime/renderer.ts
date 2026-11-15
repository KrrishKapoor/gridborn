import type { TrackGeometry, ViewTransform } from '../shared/geometry';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../shared/geometry';
import { fitView } from '../shared/view';
import { CAR, CAR_STATUS, CAR_STRIDE, SENSOR_STRIDE, TRAJECTORY_STRIDE } from '../shared/simulation';
import type { BestTrajectory, SimulationSnapshot } from '../shared/simulation';

export function boundaryPath(track: TrackGeometry): Path2D {
  const path = new Path2D(), edges = new Map<string, [number, number][]>();
  const w = track.walls;
  for (let i = 0; i < w.length; i += 4) {
    const a = `${w[i]},${w[i + 1]}`, b = `${w[i + 2]},${w[i + 3]}`;
    if (!edges.has(a)) edges.set(a, []); if (!edges.has(b)) edges.set(b, []);
    edges.get(a)!.push([w[i + 2]!, w[i + 3]!]); edges.get(b)!.push([w[i]!, w[i + 1]!]);
  }
  const visited = new Set<string>();
  for (const start of edges.keys()) {
    if (visited.has(start)) continue;
    let key = start, first = true;
    while (!visited.has(key)) {
      visited.add(key); const [x, y] = key.split(',').map(Number);
      if (first) path.moveTo(x!, y!); else path.lineTo(x!, y!); first = false;
      const next = edges.get(key)!.find(([a, b]) => !visited.has(`${a},${b}`));
      if (!next) break; key = `${next[0]},${next[1]}`;
    }
    path.closePath();
  }
  return path;
}
export class Renderer {
  view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  width = 0; height = 0; dpr = 0;
  private road = new Path2D();
  private line = new Path2D();
  private best: BestTrajectory | null = null;
  private track: TrackGeometry | null = null;
  private readonly background = document.createElement('canvas');
  /** Borrowed until the next draw; hit testing uses exactly these visible poses. */
  poses: Float32Array | null = null;
  private readonly context: CanvasRenderingContext2D;
  private readonly car = new Path2D('M8 0L3 -4L-7 -4L-9 -2L-9 2L-7 4L3 4Z');
  constructor(readonly canvas: HTMLCanvasElement, private readonly overlay: HTMLCanvasElement) {
    this.context = canvas.getContext('2d')!;
  }
  setTrack(track: TrackGeometry): void { this.track = track; this.road = boundaryPath(track); this.setBest(null); this.cache(); }
  setBest(best: BestTrajectory | null): void {
    if (this.best === best) return;
    this.best = best; this.line = new Path2D();
    if (best) for (let i = 0; i < best.samples.length; i += TRAJECTORY_STRIDE) {
      if (!i) this.line.moveTo(best.samples[i]!, best.samples[i + 1]!);
      else this.line.lineTo(best.samples[i]!, best.samples[i + 1]!);
    }
    // Never close a partial attempt; the exact recorded end is preserved for laps too.
  }
  resize(): boolean {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (rect.width === this.width && rect.height === this.height && dpr === this.dpr) return false;
    this.width = rect.width; this.height = rect.height; this.dpr = dpr;
    for (const canvas of [this.canvas, this.overlay, this.background]) {
      canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }
    if (this.width > 2 && this.height > 2) this.view = fitView({ minX: 0, minY: 0, maxX: WORLD_WIDTH, maxY: WORLD_HEIGHT }, this.width, this.height, Math.min(16, this.width / 20, this.height / 20));
    this.cache(); return true;
  }
  private world(ctx: CanvasRenderingContext2D): void {
    const v = this.view;
    ctx.setTransform(this.canvas.width / this.width * v.scale, 0, 0, this.canvas.height / this.height * v.scale,
      v.offsetX * this.canvas.width / this.width, v.offsetY * this.canvas.height / this.height);
  }
  private cache(): void {
    if (!this.track || this.width <= 2 || this.height <= 2) return;
    const ctx = this.background.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.background.width, this.background.height);
    this.world(ctx); ctx.fillStyle = '#e1e5da'; ctx.fill(this.road, 'evenodd');
    ctx.strokeStyle = '#a6b29d'; ctx.lineWidth = 1.2 / this.view.scale; ctx.stroke(this.road);
    const { a, b } = this.track.startLine;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = '#66765e'; ctx.lineWidth = 3 / this.view.scale; ctx.setLineDash([4 / this.view.scale, 4 / this.view.scale]); ctx.stroke(); ctx.setLineDash([]);
  }
  draw(snapshot: SimulationSnapshot | null, headless: boolean, poses: Float32Array | undefined = snapshot?.storage.cars): number {
    if (this.width <= 2 || this.height <= 2) return 0;
    const ctx = this.context; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.background, 0, 0); this.world(ctx);
    if (this.best) {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 3 / this.view.scale;
      ctx.strokeStyle = '#3b953e'; ctx.shadowColor = '#66b640'; ctx.shadowBlur = 9 * this.dpr; ctx.stroke(this.line); ctx.shadowBlur = 0;
    }
    if (headless) {
      this.poses = null;
      ctx.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
      ctx.fillStyle = '#20251f'; ctx.textAlign = 'center'; ctx.font = '500 16px -apple-system, sans-serif'; ctx.fillText('Learning ahead.', this.width / 2, this.height / 2 - 8);
      ctx.fillStyle = '#5c645a'; ctx.font = '11px -apple-system, sans-serif'; ctx.fillText('Cars hidden · choose 1× or 4× to watch', this.width / 2, this.height / 2 + 14); return 0;
    }
    if (!snapshot) return 0;
    const cars = poses!; this.poses = cars; let drawn = 0;
    for (let i = 0; i < snapshot.population; i++) {
      const at = i * CAR_STRIDE, status = cars[at + CAR.status]!, inactive = cars[at + CAR.inactiveSeconds]!;
      if (status !== CAR_STATUS.active && inactive > 2 && snapshot.selected?.index !== i) continue;
      ctx.save(); ctx.translate(cars[at]!, cars[at + 1]!); ctx.rotate(cars[at + CAR.heading]!);
      ctx.globalAlpha = status === CAR_STATUS.active ? 0.68 : Math.max(0.08, 0.38 * (1 - inactive / 2));
      ctx.fillStyle = status === CAR_STATUS.finished ? '#246b32' : status === CAR_STATUS.crashed ? '#8c7869' : '#344a37';
      ctx.fill(this.car); ctx.restore(); drawn++;
    }
    if (snapshot.selected) {
      const at = snapshot.selected.index * CAR_STRIDE, x = cars[at]!, y = cars[at + 1]!;
      const sensors = snapshot.storage.sensors;
      ctx.lineWidth = 1 / this.view.scale;
      for (let i = 0; i < sensors.length; i += SENSOR_STRIDE) {
        ctx.strokeStyle = '#2e813a'; ctx.globalAlpha = 0.65; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(sensors[i + 1]!, sensors[i + 2]!); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = '#246b32'; ctx.beginPath(); ctx.arc(sensors[i + 1]!, sensors[i + 2]!, 2 / this.view.scale, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save(); ctx.translate(x, y); ctx.rotate(cars[at + CAR.heading]!); ctx.fillStyle = '#246b32'; ctx.fill(this.car); ctx.restore();
      ctx.strokeStyle = '#246b32'; ctx.beginPath(); ctx.arc(x, y, 12 / this.view.scale, 0, Math.PI * 2); ctx.stroke();
    }
    return drawn;
  }
  hit(snapshot: SimulationSnapshot, cssX: number, cssY: number): number | null {
    let best = 18 ** 2, index: number | null = null;
    const cars = this.poses ?? snapshot.storage.cars, v = this.view;
    for (let i = 0; i < snapshot.population; i++) {
      const at = i * CAR_STRIDE;
      if (cars[at + CAR.status] !== CAR_STATUS.active && cars[at + CAR.inactiveSeconds]! > 2 && i !== snapshot.selected?.index) continue;
      const d = (cars[at]! * v.scale + v.offsetX - cssX) ** 2 + (cars[at + 1]! * v.scale + v.offsetY - cssY) ** 2;
      if (d < best) { best = d; index = i; }
    }
    return index;
  }
}
