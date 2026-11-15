import type { Point } from '../shared/geometry';

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

function project(p: Point, a: Point, b: Point): { point: Point; t: number; distance: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, distance: distance(p, point) };
}

/** A late return followed by a short, forward retrace of the opening stroke. */
export function findClosingTail(points: Point[], width: number): { loop: Point[]; tail: Point[] } | null {
  if (points.length < 4) return null;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + distance(points[i - 1]!, points[i]!));
  const total = lengths[lengths.length - 1]!;
  const tailLimit = Math.min(200, total * 0.12);
  const corridor = Math.min(18, width * 0.2);
  let best: { edge: number; point: Point; distance: number; along: number } | undefined;
  for (let i = 1; i < points.length; i++) {
    if (total - lengths[i]! > tailLimit) continue;
    const hit = project(points[0]!, points[i - 1]!, points[i]!);
    const along = lengths[i - 1]! + hit.t * (lengths[i]! - lengths[i - 1]!);
    if (along < Math.max(240, width * 6) || total - along > tailLimit || hit.distance > corridor) continue;
    if (!best || hit.distance < best.distance) best = { edge: i, ...hit, along };
  }
  if (!best || total - best.along < 12) return null;

  // Proximity to the start alone is not enough: a second lobe, reversal, or
  // departing tail must stay available to the crossing/road validators.
  let furthest = 0;
  const tail = [best.point, ...points.slice(best.edge)];
  for (const p of tail) {
    let nearest = Infinity, along = 0;
    for (let j = 1; j < best.edge && lengths[j - 1]! <= tailLimit + corridor; j++) {
      const hit = project(p, points[j - 1]!, points[j]!);
      if (hit.distance < nearest) {
        nearest = hit.distance;
        along = lengths[j - 1]! + hit.t * (lengths[j]! - lengths[j - 1]!);
      }
    }
    if (nearest > corridor || along < furthest - 12) return null;
    furthest = Math.max(furthest, along);
  }
  // The caller must also validate this open tail before discarding it.
  return { loop: [...points.slice(0, best.edge), best.point], tail };
}

/** Bounded Douglas–Peucker: shortcuts stay within 6 units and 32 units of travel.
 * The travel cap preserves long thin overlaps/retracing that distance alone hides.
 * Only used when the original loop intersects; ordinary/preset geometry is intact.
 */
export function simplifyJitter(points: Point[], width: number): Point[] {
  const tolerance = Math.min(6, width * 0.07), maxTravel = Math.min(32, width * 0.4);
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + distance(points[i - 1]!, points[i]!));
  const keep = new Set([0, points.length - 1]);
  const pending: [number, number][] = [[0, points.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop()!;
    if (last - first < 2) continue;
    let split = -1;
    if (lengths[last]! - lengths[first]! > maxTravel) {
      const middle = (lengths[first]! + lengths[last]!) / 2;
      split = first + 1;
      while (split < last - 1 && lengths[split]! < middle) split++;
    } else {
      let furthest = tolerance;
      for (let i = first + 1; i < last; i++) {
        const deviation = project(points[i]!, points[first]!, points[last]!).distance;
        if (deviation > furthest) { furthest = deviation; split = i; }
      }
    }
    if (split !== -1) { keep.add(split); pending.push([first, split], [split, last]); }
  }
  return points.filter((_, i) => keep.has(i));
}
