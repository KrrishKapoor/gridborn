import type { TrackGeometry } from '../../shared/geometry';

/** Independent T2 fixture. Clockwise 400 × 230 ellipse, 96 edges, 92-wide normal offsets. */
export function ovalFixture(): TrackGeometry {
  const n = 96, width = 92, points = new Float32Array(n * 2), walls = new Float32Array(n * 8);
  const inner = new Float32Array(n * 2), outer = new Float32Array(n * 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const angle = i * Math.PI * 2 / n - Math.PI / 2;
    const x = 600 + 400 * Math.cos(angle), y = 400 + 230 * Math.sin(angle);
    const tx = -400 * Math.sin(angle), ty = 230 * Math.cos(angle), length = Math.hypot(tx, ty);
    const nx = -ty / length * width / 2, ny = tx / length * width / 2;
    points.set([x, y], i * 2); inner.set([x + nx, y + ny], i * 2); outer.set([x - nx, y - ny], i * 2);
    minX = Math.min(minX, x - nx, x + nx); maxX = Math.max(maxX, x - nx, x + nx);
    minY = Math.min(minY, y - ny, y + ny); maxY = Math.max(maxY, y - ny, y + ny);
  }
  const cumulativeLengths = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    cumulativeLengths[i + 1] = cumulativeLengths[i]! + Math.hypot(points[next * 2]! - points[i * 2]!, points[next * 2 + 1]! - points[i * 2 + 1]!);
    walls.set([inner[i * 2]!, inner[i * 2 + 1]!, inner[next * 2]!, inner[next * 2 + 1]!], i * 4);
    walls.set([outer[i * 2]!, outer[i * 2 + 1]!, outer[next * 2]!, outer[next * 2 + 1]!], (n + i) * 4);
  }
  return { id: 't2-oval', centerline: points, cumulativeLengths, length: cumulativeLengths[n]!, width, walls,
    bounds: { minX, minY, maxX, maxY }, spawn: { x: points[0]!, y: points[1]!, heading: 0 },
    startLine: { a: { x: inner[0]!, y: inner[1]! }, b: { x: outer[0]!, y: outer[1]! } }, startForward: { x: 1, y: 0 } };
}
