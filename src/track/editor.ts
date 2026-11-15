import type { Point, TrackEditor, TrackEditorOptions, ViewTransform } from '../shared/geometry';
import { cssToWorld } from '../shared/view';
import { buildTrack } from './geometry';

interface Surface {
  left: number; top: number; width: number; height: number;
  scale: number; offsetX: number; offsetY: number;
}

/** Owns only input and the transparent draft canvas, never the committed renderer. */
export function createTrackEditor({ canvas, initialTrack, getView, onChange }: TrackEditorOptions): TrackEditor {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Track drawing requires Canvas2D.');
  const ctx = context;
  const abort = new AbortController();
  const listenerOptions = { signal: abort.signal, passive: false };
  let enabled = false, destroyed = false, invalidDraft = false;
  let track = initialTrack, serial = 0;
  let pointer: number | null = null;
  let surface: Surface | null = null;
  let frame = 0;
  const points: Point[] = [];
  const position = { x: 0, y: 0 };
  const savedStyles = ['touch-action', 'user-select', '-webkit-user-select', '-webkit-touch-callout', 'cursor']
    .map(property => ({ property, value: canvas.style.getPropertyValue(property), priority: canvas.style.getPropertyPriority(property) }));
  canvas.style.pointerEvents = 'none';
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.setProperty('-webkit-user-select', 'none');
  canvas.style.setProperty('-webkit-touch-callout', 'none');

  function measure(): Surface | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const view = getView();
    if (!Number.isFinite(view.scale) || view.scale <= 0 || !Number.isFinite(view.offsetX) || !Number.isFinite(view.offsetY)) return null;
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, ...view };
  }
  function sameSurface(next: Surface | null): boolean {
    return !!surface && !!next && surface.left === next.left && surface.top === next.top
      && surface.width === next.width && surface.height === next.height
      && surface.scale === next.scale && surface.offsetX === next.offsetX && surface.offsetY === next.offsetY;
  }
  function erase(): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
  function release(): void {
    const id = pointer;
    pointer = null;
    surface = null;
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function cancel(announce: boolean): void {
    release();
    points.length = 0;
    invalidDraft = false;
    cancelAnimationFrame(frame);
    frame = 0;
    erase();
    if (announce && !destroyed) onChange({ type: 'clear' });
  }
  function draw(): void {
    frame = 0;
    if (destroyed) return;
    const next = measure();
    if (pointer !== null && !sameSurface(next)) { cancel(true); return; }
    erase();
    if (!next || points.length === 0 || canvas.width === 0 || canvas.height === 0) return;
    ctx.save();
    // Backing-store ratios are for drawing only. Input remains in CSS pixels.
    ctx.setTransform(canvas.width / next.width, 0, 0, canvas.height / next.height, 0, 0);
    ctx.translate(next.offsetX, next.offsetY);
    ctx.scale(next.scale, next.scale);
    ctx.strokeStyle = invalidDraft ? '#a33428' : '#26764b';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2 / next.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
    ctx.stroke();
    ctx.setLineDash([4 / next.scale, 5 / next.scale]);
    ctx.beginPath();
    ctx.moveTo(points[points.length - 1]!.x, points[points.length - 1]!.y);
    ctx.lineTo(points[0]!.x, points[0]!.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(points[0]!.x, points[0]!.y, 4 / next.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function requestDraw(): void { if (!frame && !destroyed) frame = requestAnimationFrame(draw); }
  function checkSurface(): void {
    if (pointer !== null && !sameSurface(measure())) cancel(true);
    else requestDraw();
  }
  function append(event: PointerEvent, view: ViewTransform, rect: Surface): void {
    cssToWorld(event.clientX - rect.left, event.clientY - rect.top, view, position);
    const previous = points[points.length - 1];
    if (previous && Math.hypot(position.x - previous.x, position.y - previous.y) < 2) return;
    points.push({ x: position.x, y: position.y });
  }
  function collect(event: PointerEvent): boolean {
    const next = measure();
    if (!sameSurface(next) || !next) { cancel(true); return false; }
    const samples = event.getCoalescedEvents?.() ?? [];
    for (const sample of samples) {
      if (points.length >= 20000) break;
      append(sample, next, next);
    }
    append(event, next, next);
    if (points.length > 20000) {
      cancel(false);
      onChange({ type: 'invalid', issues: [{ code: 'invalid-input', message: 'Use a shorter stroke to draw one simple loop.' }] });
      return false;
    }
    return true;
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!enabled || destroyed || !event.isPrimary || event.button !== 0 || pointer !== null) return;
    const next = measure();
    if (!next) return;
    cancel(false);
    // Capture before accepting samples; a lost/invalid pointer must never commit.
    try { canvas.setPointerCapture(event.pointerId); } catch { return; }
    pointer = event.pointerId;
    surface = next;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    append(event, next, next);
    requestDraw();
    onChange({ type: 'draft', points });
  }, listenerOptions);
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer) return;
    event.preventDefault();
    if (!collect(event)) return;
    requestDraw();
    onChange({ type: 'draft', points });
  }, listenerOptions);
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointer) return;
    event.preventDefault();
    if (!collect(event)) return;
    release();
    const result = buildTrack(points, { id: `drawn-${++serial}`, width: track.width });
    if (result.ok) {
      track = result.track;
      cancel(false);
      onChange({ type: 'commit', track });
    } else {
      invalidDraft = true;
      requestDraw();
      onChange({ type: 'invalid', issues: result.issues });
    }
  }, listenerOptions);
  const cancelPointer = (event: PointerEvent): void => { if (event.pointerId === pointer) cancel(true); };
  canvas.addEventListener('pointercancel', cancelPointer, listenerOptions);
  canvas.addEventListener('lostpointercapture', cancelPointer, listenerOptions);
  canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (pointer !== null || points.length)) { event.preventDefault(); cancel(true); }
  }, listenerOptions);
  canvas.addEventListener('contextmenu', event => { if (enabled) event.preventDefault(); }, listenerOptions);
  window.addEventListener('resize', checkSurface, listenerOptions);
  window.addEventListener('scroll', checkSurface, { ...listenerOptions, capture: true });
  window.addEventListener('blur', () => { if (pointer !== null) cancel(true); }, listenerOptions);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pointer !== null) cancel(true);
  }, listenerOptions);
  const resizeObserver = new ResizeObserver(checkSurface);
  resizeObserver.observe(canvas);
  // Backing-store changes can clear a draft even when its CSS size is unchanged.
  const backingObserver = new MutationObserver(checkSurface);
  backingObserver.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
  erase();

  return {
    setEnabled(value) {
      if (destroyed) return;
      enabled = value;
      canvas.style.pointerEvents = enabled ? 'auto' : 'none';
      canvas.style.cursor = enabled ? 'crosshair' : '';
      if (!enabled && (pointer !== null || points.length)) cancel(true);
    },
    setTrack(value) { if (!destroyed) { track = value; cancel(false); } },
    clear() { if (!destroyed) cancel(true); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      enabled = false;
      abort.abort();
      resizeObserver.disconnect();
      backingObserver.disconnect();
      cancel(false);
      for (const { property, value, priority } of savedStyles) {
        if (value) canvas.style.setProperty(property, value, priority);
        else canvas.style.removeProperty(property);
      }
      canvas.style.pointerEvents = 'none';
    },
  };
}
