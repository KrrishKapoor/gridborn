import { createPreset, createTrackEditor, TRACK_PRESETS } from '../src/track';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../src/shared/geometry';
import type { TrackEditor, TrackEditorChange } from '../src/shared/geometry';
import { fitView } from '../src/shared/view';

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing harness element: ${selector}`);
  return result;
}
const road = element<HTMLCanvasElement>('#road');
const overlay = element<HTMLCanvasElement>('#editor');
const preset = element<HTMLSelectElement>('#preset');
const drawing = element<HTMLButtonElement>('#drawing');
const clear = element<HTMLButtonElement>('#clear');
const reset = element<HTMLButtonElement>('#reset');
const lifecycle = element<HTMLButtonElement>('#lifecycle');
const feedback = element<HTMLParagraphElement>('#feedback');
const metrics = element<HTMLSpanElement>('#metrics');
const name = element<HTMLSpanElement>('#circuit-name');
const ctx = road.getContext('2d')!;
const world = { minX: 0, minY: 0, maxX: WORLD_WIDTH, maxY: WORLD_HEIGHT };
let track = createPreset(TRACK_PRESETS[0]!.id);
let view = fitView(world, 1, 1);
let enabled = true;
let editor: TrackEditor | null = null;
const counts = { commit: 0, invalid: 0, clear: 0, draft: 0 };
let frame = 0, previousDpr = 0, disposed = false;

for (const entry of TRACK_PRESETS) preset.add(new Option(entry.label, entry.id));
const drawnOption = new Option('Your drawing', 'drawn');
drawnOption.disabled = true;
preset.add(drawnOption);

function say(message: string, kind = 'info'): void {
  feedback.textContent = message;
  feedback.dataset.kind = kind;
}
function render(): void {
  const rect = road.getBoundingClientRect();
  if (rect.width <= 24 || rect.height <= 24) return;
  ctx.setTransform(road.width / rect.width, 0, 0, road.height / rect.height, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);
  const n = track.centerline.length / 2;
  ctx.beginPath();
  for (let side = 0; side < 2; side++) {
    ctx.moveTo(track.walls[side * n * 4]!, track.walls[side * n * 4 + 1]!);
    for (let i = 1; i < n; i++) ctx.lineTo(track.walls[(side * n + i) * 4]!, track.walls[(side * n + i) * 4 + 1]!);
    ctx.closePath();
  }
  ctx.fillStyle = '#e0e4d8';
  ctx.fill('evenodd');
  ctx.strokeStyle = '#9ba690';
  ctx.lineWidth = 1.2 / view.scale;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(track.centerline[0]!, track.centerline[1]!);
  for (let i = 1; i < n; i++) ctx.lineTo(track.centerline[i * 2]!, track.centerline[i * 2 + 1]!);
  ctx.closePath();
  ctx.setLineDash([6, 10]);
  ctx.strokeStyle = '#b1bba6';
  ctx.lineWidth = 1 / view.scale;
  ctx.stroke();
  ctx.setLineDash([]);
  const { a, b } = track.startLine;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = '#253e2c';
  ctx.lineWidth = 3 / view.scale;
  ctx.stroke();
  ctx.save();
  ctx.translate(track.spawn.x, track.spawn.y);
  ctx.rotate(track.spawn.heading);
  ctx.beginPath();
  ctx.moveTo(24, 0); ctx.lineTo(10, -7); ctx.lineTo(10, 7); ctx.closePath();
  ctx.fillStyle = '#253e2c'; ctx.fill();
  ctx.restore();
  name.textContent = TRACK_PRESETS.find(p => p.id === track.id)?.label ?? 'Your circuit';
  metrics.textContent = `${Math.round(track.length).toLocaleString()} world units · ${track.width} wide · ${n * 2} walls`;
  road.dataset.trackId = track.id;
}
function resize(): void {
  const rect = road.getBoundingClientRect();
  if (rect.width <= 24 || rect.height <= 24) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view = fitView(world, rect.width, rect.height, 12);
  for (const canvas of [road, overlay]) {
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }
  previousDpr = dpr;
  render();
}
function change(event: TrackEditorChange): void {
  counts[event.type]++;
  switch (event.type) {
    case 'commit':
      track = event.track;
      preset.value = 'drawn';
      render();
      say('Circuit ready. Draw another loop to replace it.', 'commit');
      break;
    case 'invalid': say(`${event.issues.map(issue => issue.message).join(' ')} Current circuit kept.`, 'invalid'); break;
    case 'clear': say('Drawing cleared. Current circuit kept.'); break;
    case 'draft': say('Keep going around the loop. Lift to close and smooth it.', 'draft'); break;
  }
}
function attach(): void {
  editor = createTrackEditor({ canvas: overlay, initialTrack: track, getView: () => view, onChange: change });
  editor.setEnabled(enabled);
}
function setPreset(id: string): void {
  track = createPreset(id);
  editor?.setTrack(track);
  preset.value = id;
  render();
  say('Preset ready. Draw a loop to make it your own.');
}
const abort = new AbortController();
const listener = { signal: abort.signal };
drawing.addEventListener('click', () => {
  enabled = !enabled;
  editor?.setEnabled(enabled);
  drawing.setAttribute('aria-pressed', String(enabled));
  drawing.textContent = enabled ? 'Drawing on' : 'Drawing off';
  say(enabled ? 'Drawing is on. Draw a loop inside the canvas.' : 'Drawing is off. Your circuit is kept.');
}, listener);
clear.addEventListener('click', () => editor?.clear(), listener);
preset.addEventListener('change', () => setPreset(preset.value), listener);
reset.addEventListener('click', () => setPreset(TRACK_PRESETS[0]!.id), listener);
lifecycle.addEventListener('click', () => {
  if (editor) { editor.destroy(); editor = null; } else attach();
  lifecycle.textContent = editor ? 'Detach editor' : 'Attach editor';
  drawing.disabled = clear.disabled = !editor;
  say(editor ? 'Editor attached. Current circuit kept.' : 'Editor detached. Input listeners and pending work removed.');
}, listener);
const observer = new ResizeObserver(resize);
resize();
attach();
observer.observe(road);
function checkDpr(): void {
  if (disposed) return;
  if (previousDpr !== Math.min(window.devicePixelRatio || 1, 2)) resize();
  frame = requestAnimationFrame(checkDpr);
}
checkDpr();
window.addEventListener('pagehide', () => {
  disposed = true;
  cancelAnimationFrame(frame);
  observer.disconnect();
  editor?.destroy();
  abort.abort();
}, { once: true });

/** QA-only inspection; no synthetic track commits or simulation claims. */
export const harness = {
  get track() { return track; }, get view() { return view; }, get editor() { return editor; },
  counts, resize,
};
