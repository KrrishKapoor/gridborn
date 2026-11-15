import type { Bounds, Point, ViewTransform } from './geometry';

/** Letterbox a world bounds into a CSS viewport. Call on resize, not per car. */
export function fitView(bounds: Bounds, width: number, height: number, padding = 0): ViewTransform {
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, width, height, padding].every(Number.isFinite)
    || worldWidth <= 0 || worldHeight <= 0 || padding < 0 || width <= padding * 2 || height <= padding * 2) {
    throw new RangeError('View bounds and available CSS size must be finite and positive.');
  }
  const scale = Math.min((width - padding * 2) / worldWidth, (height - padding * 2) / worldHeight);
  return {
    scale,
    offsetX: (width - worldWidth * scale) / 2 - bounds.minX * scale,
    offsetY: (height - worldHeight * scale) / 2 - bounds.minY * scale,
  };
}

/** Write into caller storage. Subtract canvas rect.left/top from clientX/Y first. */
export function cssToWorld(x: number, y: number, view: ViewTransform, out: { x: number; y: number }): void {
  out.x = (x - view.offsetX) / view.scale;
  out.y = (y - view.offsetY) / view.scale;
}

export function worldToCss(point: Point, view: ViewTransform, out: { x: number; y: number }): void {
  out.x = point.x * view.scale + view.offsetX;
  out.y = point.y * view.scale + view.offsetY;
}
