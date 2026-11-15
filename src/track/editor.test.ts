import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackEditor, TrackEditorChange, ViewTransform } from '../shared/geometry';
import { createTrackEditor } from './editor';
import { createPreset } from './presets';

// Minimal DOM boundary double: geometry remains real; browser smoke covers native capture.
class Canvas extends EventTarget {
  width = 1200; height = 800;
  rect = { left: 30, top: 50, width: 600, height: 400 };
  captured = new Set<number>();
  properties = new Map<string, string>();
  style = {
    pointerEvents: '', touchAction: '', userSelect: '', cursor: '',
    getPropertyValue: (name: string) => this.properties.get(name) ?? '',
    getPropertyPriority: () => '',
    setProperty: (name: string, value: string) => this.properties.set(name, value),
    removeProperty: (name: string) => this.properties.delete(name),
  };
  context = Object.fromEntries(['save', 'restore', 'setTransform', 'clearRect', 'translate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'setLineDash', 'arc', 'fill'].map(name => [name, vi.fn()]));
  getContext() { return this.context; }
  getBoundingClientRect() { return this.rect; }
  focus() {}
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
}
let canvas: Canvas;
let view: ViewTransform;
let changes: TrackEditorChange[];
let editor: TrackEditor;
let resize: () => void;
let mutation: () => void;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
function pointer(type: string, x: number, y: number, extra: Record<string, unknown> = {}): void {
  canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse',
    clientX: canvas.rect.left + x * view.scale + view.offsetX,
    clientY: canvas.rect.top + y * view.scale + view.offsetY,
    ...extra,
  }));
}
function stroke(type = 'mouse'): void {
  pointer('pointerdown', 980, 400, { pointerType: type });
  for (let i = 1; i <= 80; i++) {
    const t = i * Math.PI * 2 / 80;
    pointer('pointermove', 600 + 380 * Math.cos(t), 400 + 220 * Math.sin(t), { pointerType: type });
  }
  pointer('pointerup', 980, 400, { pointerType: type });
}
function commits(): Extract<TrackEditorChange, { type: 'commit' }>[] {
  return changes.filter((c): c is Extract<TrackEditorChange, { type: 'commit' }> => c.type === 'commit');
}

beforeEach(() => {
  canvas = new Canvas();
  view = { scale: .5, offsetX: 0, offsetY: 0 };
  changes = [];
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { mutation = callback; } observe() {} disconnect() {} });
  editor = createTrackEditor({
    canvas: canvas as unknown as HTMLCanvasElement, initialTrack: createPreset('broad-oval'), getView: () => view,
    onChange: change => changes.push(change.type === 'draft' ? { ...change, points: [...change.points] } : change),
  });
});
afterEach(() => { editor.destroy(); vi.unstubAllGlobals(); });

describe('track editor lifecycle', () => {
  it('starts disabled and routes input only when explicitly enabled', () => {
    expect(canvas.style.pointerEvents).toBe('none');
    stroke(); expect(changes).toHaveLength(0);
    editor.setEnabled(true); expect(canvas.style.pointerEvents).toBe('auto');
    editor.setEnabled(false); expect(canvas.style.pointerEvents).toBe('none');
  });
  it.each(['mouse', 'touch'])('commits a %s stroke in CSS/world coordinates at DPR 2', type => {
    editor.setEnabled(true); stroke(type);
    expect(commits()).toHaveLength(1);
    const track = commits()[0]!.track;
    expect(track.bounds.maxX).toBeGreaterThan(950);
    expect(track.bounds.maxX).toBeLessThan(1050);
    expect(track.spawn.y).toBeCloseTo(400, 2);
    expect(canvas.captured.size).toBe(0);
  });
  it('uses coalesced samples and ignores secondary pointers and mouse buttons', () => {
    editor.setEnabled(true);
    pointer('pointerdown', 300, 200, { isPrimary: false });
    pointer('pointerdown', 300, 200, { button: 2 });
    expect(changes).toHaveLength(0);
    pointer('pointerdown', 300, 200);
    pointer('pointermove', 600, 200, { pointerId: 2 });
    pointer('pointermove', 330, 200, { getCoalescedEvents: () => [
      { clientX: 185, clientY: 150 }, { clientX: 190, clientY: 150 },
    ] });
    const last = changes[changes.length - 1]!;
    expect(last.type).toBe('draft');
    if (last.type === 'draft') expect(last.points.map(p => p.x)).toEqual([300, 310, 320, 330]);
  });
  it.each(['pointercancel', 'lostpointercapture', 'disable', 'clear', 'setTrack', 'destroy', 'resize', 'view', 'blur'])('cancels safely on %s, and never commits on the late pointerup', action => {
    editor.setEnabled(true);
    pointer('pointerdown', 980, 400);
    pointer('pointermove', 900, 500);
    if (action === 'disable') { editor.setEnabled(false); editor.setEnabled(true); }
    else if (action === 'clear') editor.clear();
    else if (action === 'setTrack') editor.setTrack(createPreset('riverbend'));
    else if (action === 'destroy') editor.destroy();
    else if (action === 'resize') { canvas.rect.width = 500; resize(); }
    else if (action === 'view') view = { ...view, offsetX: 10 };
    else if (action === 'blur') window.dispatchEvent(new Event('blur'));
    else pointer(action, 900, 500);
    pointer('pointerup', 980, 400);
    expect(commits()).toHaveLength(0);
    expect(canvas.captured.size).toBe(0);
  });
  it('allows DPR-only backing changes without distorting a gesture', () => {
    editor.setEnabled(true); pointer('pointerdown', 980, 400);
    canvas.width = 600; canvas.height = 400; mutation();
    for (let i = 1; i <= 80; i++) pointer('pointermove', 600 + 380 * Math.cos(i * Math.PI / 40), 400 + 220 * Math.sin(i * Math.PI / 40));
    pointer('pointerup', 980, 400);
    expect(commits()).toHaveLength(1);
  });
  it('keeps the last valid track through invalid/clear and accepts another stroke', () => {
    editor.setEnabled(true); stroke();
    pointer('pointerdown', 600, 400); pointer('pointerup', 602, 401);
    expect(changes[changes.length - 1]?.type).toBe('invalid');
    editor.clear(); expect(changes[changes.length - 1]?.type).toBe('clear');
    expect(commits()).toHaveLength(1);
    stroke(); expect(commits()).toHaveLength(2);
  });
  it('sets a track without recursive commits and uses its width on the next drawing', () => {
    editor.setTrack({ ...createPreset('riverbend'), width: 80 });
    expect(changes).toHaveLength(0);
    editor.setEnabled(true); stroke();
    expect(commits()[0]?.track.width).toBe(80);
  });
  it('destroys idempotently, cancels render work, and ignores all later methods/events', () => {
    editor.setEnabled(true); pointer('pointerdown', 300, 300);
    expect(frames.size).toBe(1);
    editor.destroy(); editor.destroy();
    const count = changes.length;
    editor.setEnabled(true); editor.clear(); editor.setTrack(createPreset('riverbend')); stroke();
    expect(changes).toHaveLength(count);
    expect(frames.size).toBe(0);
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.captured.size).toBe(0);
  });
  it('ignores an unmeasurable surface or failed pointer capture', () => {
    editor.setEnabled(true); canvas.rect.width = 0;
    pointer('pointerdown', 500, 500); expect(changes).toHaveLength(0);
    canvas.rect.width = 600;
    canvas.setPointerCapture = () => { throw new Error('Pointer is no longer active'); };
    pointer('pointerdown', 500, 500); expect(changes).toHaveLength(0);
  });
});
