import { describe, expect, it } from 'vitest';
import { cssToWorld, fitView, worldToCss } from './view';

describe('world / CSS coordinate boundary', () => {
  it.each([[1440, 900], [390, 844], [844, 390]])('round-trips an offset world at %i × %i CSS pixels', (width, height) => {
    const view = fitView({ minX: -100, minY: 50, maxX: 1100, maxY: 850 }, width, height, 20);
    const css = { x: 0, y: 0 };
    const world = { x: 0, y: 0 };
    worldToCss({ x: 500, y: 450 }, view, css);
    expect(css.x).toBeCloseTo(width / 2);
    expect(css.y).toBeCloseTo(height / 2);
    worldToCss({ x: 60, y: 320 }, view, css);
    cssToWorld(css.x, css.y, view, world);
    expect(world.x).toBeCloseTo(60);
    expect(world.y).toBeCloseTo(320);
  });

  it('letterboxes without distorting the logical world', () => {
    const view = fitView({ minX: 0, minY: 0, maxX: 1200, maxY: 800 }, 400, 300, 20);
    expect(view).toEqual({ scale: 0.3, offsetX: 20, offsetY: 30 });
  });

  it('rejects collapsed or non-finite viewports instead of producing NaN coordinates', () => {
    const bounds = { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
    expect(() => fitView(bounds, 0, 100)).toThrow(RangeError);
    expect(() => fitView(bounds, 40, 100, 20)).toThrow(RangeError);
    expect(() => fitView(bounds, Number.NaN, 100)).toThrow(RangeError);
    expect(() => fitView({ ...bounds, maxX: 0 }, 100, 100)).toThrow(RangeError);
  });
});
