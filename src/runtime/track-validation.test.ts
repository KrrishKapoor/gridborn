import { describe, expect, it } from 'vitest';
import { buildTrack, createPreset, TRACK_PRESETS } from '../track';
import { validateTrack } from '../sim/validation';
import { ovalFixture } from '../sim/fixtures/oval';

describe('production road boundary validation', () => {
  it('accepts all presets, the independent T2 fixture, and a sensible drawn loop', () => {
    for (const preset of TRACK_PRESETS) expect(() => validateTrack(createPreset(preset.id))).not.toThrow();
    expect(() => validateTrack(ovalFixture())).not.toThrow();
    const points = Array.from({ length: 100 }, (_, i) => ({ x: 600 + 370 * Math.sin(i * Math.PI / 50), y: 400 - 220 * Math.cos(i * Math.PI / 50) }));
    const drawn = buildTrack(points, { id: 'drawn-test', width: 92 });
    expect(drawn.ok).toBe(true);
    if (drawn.ok) expect(() => validateTrack(drawn.track)).not.toThrow();
  });
  it('rejects the original outer-wall + tiny fake inner loop repro', () => {
    const track = ovalFixture(), outer = track.walls.slice(track.walls.length / 2);
    const { x, y } = track.startLine.a;
    const walls = new Float32Array(outer.length + 16); walls.set(outer);
    walls.set([x,y,x+2,y, x+2,y,x+2,y+2, x+2,y+2,x,y+2, x,y+2,x,y], outer.length);
    expect(() => validateTrack({ ...track, walls })).toThrow(/width|between/);
  });
  it('rejects a declared width inconsistent with both real boundaries', () => {
    expect(() => validateTrack({ ...ovalFixture(), width: 200 })).toThrow(/width/);
  });
});
