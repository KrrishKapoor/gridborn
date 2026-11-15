import type { TrackGeometry } from '../shared/geometry';

/** Signed unwrapping, never sum positive deltas (which would reward jitter). */
export function progressDelta(previous: number, next: number, length: number): number {
  let delta = next - previous;
  if (delta > length / 2) delta -= length;
  if (delta < -length / 2) delta += length;
  return delta;
}

/** Seven ordered distance gates plus a finite, forward start-line crossing.
 * Returns crossing fraction for sub-tick timing, or -1 for no valid finish. */
export function lapCrossing(track: TrackGeometry, progress: number, gates: number,
  x: number, y: number, nx: number, ny: number): number {
  if (gates < 7 || progress < track.length * 0.98) return -1;
  const f = track.startForward, a = track.startLine.a, b = track.startLine.b;
  const before = (x - track.spawn.x) * f.x + (y - track.spawn.y) * f.y;
  const after = (nx - track.spawn.x) * f.x + (ny - track.spawn.y) * f.y;
  if (before >= 0 || after < 0 || after <= before) return -1;
  const fraction = -before / (after - before);
  const ix = x + (nx - x) * fraction, iy = y + (ny - y) * fraction;
  const dx = b.x - a.x, dy = b.y - a.y;
  const along = ((ix - a.x) * dx + (iy - a.y) * dy) / (dx * dx + dy * dy);
  return along >= 0 && along <= 1 ? fraction : -1;
}

/** Finishers [2,3] always outrank incomplete [0,1]; lower real lap time wins. */
export function fitness(progress: number, length: number, lap: number, deadline: number): number {
  return lap > 0 ? 2 + Math.max(0, 1 - lap / deadline) : Math.max(0, Math.min(1, progress / length));
}
