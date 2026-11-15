import { mountPage } from '../src/ui/page';
import { DEFAULT_SETTINGS, createSnapshotStorage } from '../src/shared/simulation';
import type { BestTrajectory, GenerationHistory, SimulationSnapshot } from '../src/shared/simulation';
import type { PageState } from '../src/shared/presentation';
import { fitView } from '../src/shared/view';

const banner = document.createElement('div');
banner.className = 'harness-banner';
banner.textContent = 'Task T3 harness · Illustrative circuit. Engine and editor pending; no measured race data.';
document.body.prepend(banner);
const style = document.createElement('style');
style.textContent = `.harness-banner{padding:6px 20px;text-align:center;font:10px/1.4 ui-monospace,monospace;color:#5c645a;border-bottom:1px solid #d8ddd3}.harness-tools{max-width:1280px;margin:0 auto;padding:24px 20px 48px;font:12px/1.6 system-ui}.harness-tools button{font:inherit;min-height:44px;padding:8px 12px;margin:8px 8px 8px 0;background:transparent;border:1px solid #d8ddd3}.harness-tools output{display:block;color:#5c645a}.fixture-inspector{padding:24px 0;font:12px system-ui;color:#5c645a}`;
document.head.append(style);
const root = document.querySelector<HTMLElement>('#app')!;
let history: GenerationHistory = { runId: 1, completedGenerations: 0, entries: [] };
let state: PageState = { generation: 0, alive: 0, population: 512, running: false, rate: 1, drawing: false, selected: null, bestLapSeconds: null, history };
let snapshot: SimulationSnapshot | null = null;
let best: BestTrajectory | null = null;
let delay = 0;
let circuit = 0;
let destroyed = false;
const pending = new Set<ReturnType<typeof setTimeout>>();
const intents: { action: string; value: unknown }[] = [];
function intent(action: string, value: unknown, apply: () => void) {
  intents.push({ action, value });
  output.textContent = `Intent: ${action}${value === undefined ? '' : ` → ${String(value)}`}. This harness changes presentation state only.`;
  const timer = setTimeout(() => {
    pending.delete(timer);
    if (destroyed) return;
    apply(); render();
  }, delay);
  pending.add(timer);
}
function reset() {
  history = { runId: history.runId + 1, completedGenerations: 0, entries: [] };
  snapshot = null; best = null;
  state = { ...state, generation: 0, alive: 0, running: false, rate: 1, selected: null, bestLapSeconds: null, history };
}
const page = mountPage(root, {
  settings: DEFAULT_SETTINGS,
  presets: [{ id: 'oval', label: 'The oval' }, { id: 'bend', label: 'Long bend' }, { id: 'club', label: 'Club circuit' }],
  actions: {
    onRunningChange: (running) => intent('running', running, () => { state = { ...state, running }; }),
    onRateChange: (rate) => intent('rate', rate, () => { state = { ...state, rate }; }),
    onPopulationChange: (population) => intent('population', population, () => { state = { ...state, population }; reset(); }),
    onDrawingChange: (drawing) => intent('drawing', drawing, () => { state = { ...state, drawing }; }),
    onReset: () => intent('reset', undefined, reset),
    onClear: () => intent('clear drawing', undefined, () => { page.showTrackIssues([]); }),
    onPreset: (id) => intent('preset', id, () => { circuit = ['oval', 'bend', 'club'].indexOf(id); reset(); paint(); }),
    onSelectionClear: () => intent('clear selection', undefined, () => { state = { ...state, selected: null }; snapshot = null; }),
  },
});
const inspector = document.createElement('p');
inspector.className = 'fixture-inspector';
inspector.textContent = 'Inspection mounting slot · T4 supplies the actual car inspector. This harness selection is an explicitly illustrative contract fixture.';
page.inspectionRoot.append(inspector);
const tools = document.createElement('section');
tools.className = 'harness-tools';
tools.innerHTML = `<strong>T3 harness controls · presentation fixtures only</strong><div><button type="button" data-fixture-selection>Inspect fixture</button><button type="button" data-fixture-issue>Show invalid-track feedback</button><button type="button" data-fixture-delay aria-pressed="false">Delay state updates: off</button></div><output aria-live="polite">No engine, editor, lap times, or evolving populations are simulated here.</output>`;
document.body.append(tools);
const output = tools.querySelector('output')!;
function render() {
  page.update(state);
  for (const demo of page.demos) demo.update(snapshot, history, best);
}
function paint() {
  const canvas = page.heroCanvas;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, devicePixelRatio);
  for (const target of [canvas, page.editorCanvas]) {
    target.width = Math.round(rect.width * dpr); target.height = Math.round(rect.height * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const view = fitView({ minX: 70, minY: 80, maxX: 1130, maxY: 700 }, rect.width, rect.height, 28);
  ctx.save(); ctx.translate(view.offsetX, view.offsetY); ctx.scale(view.scale, view.scale);
  const paths = [
    'M330 170C160 170 140 280 140 400C140 560 250 610 430 610H800C1000 610 1060 510 1060 390C1060 230 960 170 800 170Z',
    'M300 170C110 190 110 520 300 600C430 660 490 500 620 470C790 430 820 650 990 520C1130 410 1040 190 840 170C600 140 530 130 300 170Z',
    'M300 160C100 200 130 520 310 600C450 660 470 470 600 430C730 390 930 650 1030 480C1140 280 940 120 750 180C580 250 520 110 300 160Z',
  ];
  const path = new Path2D(paths[circuit] ?? paths[0]!);
  ctx.strokeStyle = '#a8b29e'; ctx.lineWidth = 102; ctx.stroke(path);
  ctx.strokeStyle = '#f7f7f2'; ctx.lineWidth = 99; ctx.stroke(path);
  ctx.strokeStyle = '#c1c9b8'; ctx.setLineDash([5, 13]); ctx.lineWidth = 1.5; ctx.stroke(path); ctx.setLineDash([]);
  // Start line is graphic reference only; there are no simulated cars or trajectories.
  ctx.fillStyle = '#20251f';
  for (let i = 0; i < 8; i++) ctx.fillRect(620 + (i % 2) * 8, 121 + i * 12, 8, 12);
  ctx.restore();
  // Keep harness status legible in CSS pixels, including the phone viewport.
  const centerX = 600 * view.scale + view.offsetX;
  const centerY = 400 * view.scale + view.offsetY;
  ctx.textAlign = 'center'; ctx.fillStyle = '#5c645a';
  ctx.font = '9px ui-monospace, monospace'; ctx.fillText('ILLUSTRATIVE CIRCUIT', centerX, centerY - 20);
  ctx.font = '16px system-ui'; ctx.fillText('The field is ready.', centerX, centerY + 2);
  ctx.font = '10px system-ui'; ctx.fillText('Simulation connects in T4.', centerX, centerY + 22);
}
const observer = new ResizeObserver(paint);
observer.observe(page.heroCanvas);
window.addEventListener('resize', paint);
tools.querySelector('[data-fixture-selection]')!.addEventListener('click', () => {
  const selected = { runId: history.runId, generation: 1, index: 2 };
  const storage = createSnapshotStorage(state.population);
  for (let i = 0; i < 7; i++) storage.sensors[i * 3] = 0.2 + i * 0.1;
  for (let i = 0; i < storage.weights.length; i++) storage.weights[i] = Math.sin(i * 1.7) * 0.8;
  for (let i = 0; i < storage.activations.length; i++) storage.activations[i] = Math.sin(i * 0.7) * 0.6;
  snapshot = { runId: history.runId, generation: 1, tick: 0, generationTick: 0, population: state.population, alive: 0, running: false, rate: 1, selected, storage, computeMs: 0, steps: 0 };
  state = { ...state, selected };
  output.textContent = 'Illustrative selection fixture supplied. This is not an actual evolving car.';
  render();
});
tools.querySelector('[data-fixture-issue]')!.addEventListener('click', () => page.showTrackIssues([{ code: 'self-intersection', message: 'This loop crosses itself. Draw a wider loop without crossings; your current circuit is unchanged.' }]));
tools.querySelector('[data-fixture-delay]')!.addEventListener('click', (event) => {
  delay = delay ? 0 : 300;
  const button = event.currentTarget as HTMLButtonElement;
  button.setAttribute('aria-pressed', String(delay > 0)); button.textContent = `Delay state updates: ${delay ? '300 ms' : 'off'}`;
});
render();
// Harness-only QA surface. Never imported by main or included in the production build.
Object.assign(window, { t3Harness: {
  page, intents,
  get state() { return state; },
  setState(next: Partial<PageState>) { state = { ...state, ...next }; if (next.history) history = next.history; render(); },
  supply(nextSnapshot: SimulationSnapshot | null, nextHistory: GenerationHistory, nextBest: BestTrajectory | null) {
    snapshot = nextSnapshot; history = nextHistory; best = nextBest;
    state = { ...state, history }; render();
  },
  destroy() {
    destroyed = true; for (const timer of pending) clearTimeout(timer); pending.clear();
    observer.disconnect(); window.removeEventListener('resize', paint); page.destroy();
  },
} });
