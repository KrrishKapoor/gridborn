import type { Point, TrackGeometry, TrackPreset } from '../shared/geometry';
import { buildTrack } from './geometry';

export const TRACK_PRESETS: readonly TrackPreset[] = Object.freeze([
  Object.freeze({ id: 'broad-oval', label: 'Broad oval' }),
  Object.freeze({ id: 'riverbend', label: 'Riverbend' }),
  Object.freeze({ id: 'club-circuit', label: 'Club circuit' }),
]);

export function createPreset(id: string): TrackGeometry {
  if (!TRACK_PRESETS.some(p => p.id === id)) throw new RangeError(`Unknown track preset: ${id}`);
  let points: Point[];
  if (id === 'club-circuit') {
    points = [
      { x: 320, y: 160 }, { x: 730, y: 160 }, { x: 1010, y: 260 },
      { x: 1010, y: 520 }, { x: 820, y: 650 }, { x: 600, y: 510 },
      { x: 380, y: 650 }, { x: 190, y: 530 }, { x: 190, y: 280 },
    ];
  } else {
    points = Array.from({ length: 120 }, (_, i) => {
      const t = -Math.PI / 2 + i * Math.PI * 2 / 120;
      return { x: 600 + 400 * Math.cos(t), y: 400 + 230 * Math.sin(t) + (id === 'riverbend' ? 45 * Math.sin(2 * t) : 0) };
    });
  }
  const result = buildTrack(points, { id, width: 92 });
  if (!result.ok) throw new Error(`Invalid built-in track ${id}: ${result.issues.map(i => i.message).join(' ')}`);
  return result.track;
}
