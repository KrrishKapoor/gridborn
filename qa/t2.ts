import { CAR, CAR_STATUS, CAR_STRIDE, DEFAULT_SETTINGS, snapshotTransferList } from '../src/shared/simulation';
import type { BestTrajectory, GenerationStatistics, SimulationCommand, SimulationEvent, SimulationRate, SimulationSnapshot } from '../src/shared/simulation';
import { fitView } from '../src/shared/view';
import type { ViewTransform } from '../src/shared/geometry';
import { ovalFixture } from '../src/sim/fixtures/oval';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>('world'), ctx = canvas.getContext('2d')!;
const background = document.createElement('canvas'), bg = background.getContext('2d')!;
const track = ovalFixture(), worker = new Worker(new URL('../src/sim/worker.ts', import.meta.url), { type: 'module' });
let runId = 0, requested = 0, pending = 0, autoplay = true, rate: SimulationRate = 1, desiredRate: SimulationRate = 1, running = false;
let displayed: SimulationSnapshot | null = null, incoming: SimulationSnapshot | null = null;
let best: BestTrajectory | null = null, history: GenerationStatistics[] = [];
let records: { generation: number; fitness: number; lapSeconds: number | null; points: number }[] = [];
let view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
let cssWidth = 0, cssHeight = 0, backingRatio = 0;
let tickReceived = 0, generationsCompleted = 0, workerMs = 0, workerSteps = 0, maxSnapshotGap = 0, previousSnapshotTime = 0;
let frameTimes: number[] = [], drawTimes: number[] = [], drawnCounts: number[] = [];
let lastFrame = 0, lastStats = 0, inspectionAt = 0, workerSamples: { ms: number; steps: number; alive: number; population: number }[] = [];
let measuring = false;
const errors: string[] = [], waiters: (() => void)[] = [];
const command = (message: SimulationCommand) => worker.postMessage(message);
function recycle(snapshot: SimulationSnapshot | null): void {
  if (snapshot) worker.postMessage({ type: 'recycle', runId: snapshot.runId, storage: snapshot.storage } satisfies SimulationCommand, snapshotTransferList(snapshot.storage));
}
function setRunning(value: boolean): void { command({ type: 'set-running', runId, running: value }); }
function setRate(value: SimulationRate): void { desiredRate = value; element<HTMLSelectElement>('rate').value = String(value); command({ type: 'set-rate', runId, rate: value }); }
function reset(population = Number(element<HTMLSelectElement>('population').value), seed = Number(element<HTMLInputElement>('seed').value), play = true): void {
  pending = ++requested; autoplay = play;
  element<HTMLSelectElement>('population').value = String(population); element<HTMLInputElement>('seed').value = String(seed);
  element('error').textContent = '';
  command({ type: 'reset', runId: pending, track, settings: { ...DEFAULT_SETTINGS, population, seed, eliteCount: Math.min(8, population - 1) } });
}
worker.onerror = (event) => { errors.push(event.message); element('error').textContent = event.message; };
worker.onmessage = ({ data }: MessageEvent<SimulationEvent>) => {
  if (data.type === 'ready') {
    if (data.runId !== pending) return;
    recycle(displayed); recycle(incoming); displayed = incoming = null;
    runId = data.runId; pending = 0; best = null; history = []; records = []; generationsCompleted = 0;
    tickReceived = 0; workerMs = 0; workerSteps = 0; workerSamples = []; maxSnapshotGap = 0; previousSnapshotTime = 0;
    element('records').textContent = 'No completed generation yet.'; element('history').textContent = '';
    command({ type: 'set-rate', runId, rate: desiredRate }); command({ type: 'set-running', runId, running: autoplay });
  } else if (data.type === 'snapshot') {
    const s = data.snapshot;
    if (s.runId !== runId) { recycle(s); return; }
    recycle(incoming); incoming = s; running = s.running; rate = s.rate; tickReceived = s.tick;
    workerMs += s.computeMs; workerSteps += s.steps;
    if (s.steps) { workerSamples.push({ ms: s.computeMs, steps: s.steps, alive: s.alive, population: s.population }); if (workerSamples.length > 2000) workerSamples.shift(); }
    const now = performance.now(); if (previousSnapshotTime) maxSnapshotGap = Math.max(maxSnapshotGap, now - previousSnapshotTime); previousSnapshotTime = now;
    element('running').textContent = running ? 'Pause' : 'Play'; element<HTMLSelectElement>('rate').value = String(rate);
    element('generation').textContent = String(s.generation); element('alive').textContent = `${s.alive} / ${s.population}`;
    element('status').textContent = `Run ${runId} · tick ${s.tick} · ${running ? (rate === 'fast' ? 'Fast batches; cars not rendered' : `Running ${rate}×`) : 'Paused'} · fixed 1/60 s steps`;
    element('lap').textContent = best?.lapSeconds ? `${best.lapSeconds.toFixed(4)} s` : 'No lap yet';
  } else if (data.type === 'generation' && data.statistics.runId === runId) {
    generationsCompleted++; history.push(data.statistics); if (history.length > 256) history.shift();
    element('history').innerHTML = history.slice(-12).reverse().map((h) => `<tr><td>${h.generation}</td><td>${h.completedLaps}</td><td>${h.bestLapSeconds?.toFixed(4) ?? 'No lap'}</td><td>${h.bestFitness.toFixed(5)}</td></tr>`).join('');
  } else if (data.type === 'best' && data.trajectory.car.runId === runId) {
    best = data.trajectory;
    records.push({ generation: best.car.generation, fitness: best.fitness, lapSeconds: best.lapSeconds, points: best.samples.length / 4 });
    element('records').textContent = JSON.stringify(records, null, 2);
    element('path').textContent = `Generation ${best.car.generation}, car ${best.car.index} · ${best.samples.length / 4} recorded poses · ${best.lapSeconds === null ? 'partial path, no completed lap' : `complete lap ${best.lapSeconds.toFixed(4)} s`}`;
  } else if (data.type === 'error') {
    if (data.runId === pending) pending = 0;
    errors.push(data.message); element('error').textContent = `Run ${data.runId} rejected: ${data.message} Accepted run ${runId} continues.`;
  }
  for (const check of waiters.slice()) check();
};

function resize(): void {
  const rect = canvas.getBoundingClientRect(), ratio = Math.min(2, devicePixelRatio || 1);
  if (rect.width === cssWidth && rect.height === cssHeight && ratio === backingRatio) return;
  cssWidth = rect.width; cssHeight = rect.height; backingRatio = ratio;
  canvas.width = background.width = Math.max(1, Math.round(cssWidth * ratio)); canvas.height = background.height = Math.max(1, Math.round(cssHeight * ratio));
  if (cssWidth <= 24 || cssHeight <= 24) return;
  view = fitView({ minX: 100, minY: 80, maxX: 1100, maxY: 720 }, cssWidth, cssHeight, 12);
  bg.setTransform(canvas.width / cssWidth, 0, 0, canvas.height / cssHeight, 0, 0); bg.fillStyle = '#f7f7f2'; bg.fillRect(0, 0, cssWidth, cssHeight);
  bg.translate(view.offsetX, view.offsetY); bg.scale(view.scale, view.scale);
  bg.beginPath(); for (let i = 0; i < track.centerline.length; i += 2) { if (i) bg.lineTo(track.centerline[i]!, track.centerline[i + 1]!); else bg.moveTo(track.centerline[i]!, track.centerline[i + 1]!); } bg.closePath();
  bg.strokeStyle = '#e7eadd'; bg.lineWidth = track.width; bg.lineJoin = 'round'; bg.stroke();
  bg.beginPath(); for (let i = 0; i < track.walls.length; i += 4) { bg.moveTo(track.walls[i]!, track.walls[i + 1]!); bg.lineTo(track.walls[i + 2]!, track.walls[i + 3]!); } bg.strokeStyle = '#89917f'; bg.lineWidth = 1.5; bg.stroke();
  bg.beginPath(); bg.moveTo(track.startLine.a.x, track.startLine.a.y); bg.lineTo(track.startLine.b.x, track.startLine.b.y); bg.strokeStyle = '#20251f'; bg.lineWidth = 3; bg.stroke();
}
function paint(): number {
  resize(); if (cssWidth <= 24 || cssHeight <= 24) return 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(background, 0, 0);
  ctx.setTransform(canvas.width / cssWidth * view.scale, 0, 0, canvas.height / cssHeight * view.scale,
    canvas.width / cssWidth * view.offsetX, canvas.height / cssHeight * view.offsetY);
  if (best) {
    ctx.beginPath(); for (let i = 0; i < best.samples.length; i += 4) { if (i) ctx.lineTo(best.samples[i]!, best.samples[i + 1]!); else ctx.moveTo(best.samples[i]!, best.samples[i + 1]!); }
    ctx.strokeStyle = '#246b32'; ctx.lineWidth = 3; ctx.stroke();
  }
  let drawn = 0;
  if (displayed && rate !== 'fast') {
    const cars = displayed.storage.cars;
    for (let i = 0; i < displayed.population; i++) {
      const b = i * CAR_STRIDE, active = cars[b + CAR.status] === CAR_STATUS.active;
      const alpha = active ? 0.55 : Math.max(0, 0.4 - cars[b + CAR.inactiveSeconds]! / 5);
      if (alpha <= 0) continue;
      drawn++; ctx.globalAlpha = alpha; ctx.fillStyle = displayed.selected?.index === i ? '#195bb5' : '#20251f';
      const x = cars[b + CAR.x]!, y = cars[b + CAR.y]!, angle = cars[b + CAR.heading]!, dx = Math.cos(angle), dy = Math.sin(angle);
      ctx.beginPath(); ctx.moveTo(x + dx * 7, y + dy * 7); ctx.lineTo(x - dx * 5 + dy * 3, y - dy * 5 - dx * 3);
      ctx.lineTo(x - dx * 5 - dy * 3, y - dy * 5 + dx * 3); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (displayed.selected) {
      const b = displayed.selected.index * CAR_STRIDE, sensors = displayed.storage.sensors;
      ctx.beginPath(); for (let r = 0; r < 7; r++) { ctx.moveTo(cars[b + CAR.x]!, cars[b + CAR.y]!); ctx.lineTo(sensors[r * 3 + 1]!, sensors[r * 3 + 2]!); }
      ctx.strokeStyle = '#195bb5'; ctx.lineWidth = 1.7; ctx.stroke();
    }
  }
  return drawn;
}
function inspect(): void {
  const s = displayed;
  if (!s?.selected) { element('selected').textContent = 'Select a car to inspect its actual inputs and activations.'; element('sensors').textContent = ''; element('activations').textContent = ''; element('weights').textContent = 'No selection'; return; }
  const b = s.selected.index * CAR_STRIDE;
  element('selected').textContent = `Car ${s.selected.index} · generation ${s.selected.generation} · speed ${s.storage.cars[b + CAR.speed]!.toFixed(1)} · ${['active', 'crashed', 'finished'][s.storage.cars[b + CAR.status]!]}`;
  element('sensors').innerHTML = Array.from({ length: 7 }, (_, r) => `<tr><td>${r + 1}</td><td>${s.storage.sensors[r * 3]!.toFixed(3)}</td><td>${s.storage.sensors[r * 3 + 1]!.toFixed(1)}, ${s.storage.sensors[r * 3 + 2]!.toFixed(1)}</td></tr>`).join('');
  element('activations').innerHTML = Array.from({ length: 10 }, (_, i) => { const v = s.storage.activations[i + 8]!; return `<div class="activation"><span>${i < 8 ? `H${i + 1}` : i === 8 ? 'steer' : 'power'}</span><span class="bar" style="width:${Math.abs(v) * 100}%;background:${v < 0 ? '#89917f' : '#246b32'}"></span><span>${v.toFixed(3)}</span></div>`; }).join('');
  element('weights').textContent = Array.from({ length: 10 }, (_, i) => Array.from(s.storage.weights.slice(i * 9, i * 9 + 9), (w) => w.toFixed(3)).join(' ')).join('\n');
}
function frame(now: number): void {
  if (incoming) { recycle(displayed); displayed = incoming; incoming = null; }
  const start = performance.now(), drawn = paint(), ms = performance.now() - start;
  if (lastFrame) { frameTimes.push(now - lastFrame); drawTimes.push(ms); drawnCounts.push(drawn); if (frameTimes.length > 2400) { frameTimes.shift(); drawTimes.shift(); drawnCounts.shift(); } }
  lastFrame = now;
  if (now - inspectionAt > 120) { inspect(); inspectionAt = now; }
  if (now - lastStats > 1000) {
    const recent = frameTimes.slice(-60), times = drawTimes.slice(-60);
    element('fps').textContent = recent.length ? (1000 / mean(recent)).toFixed(1) : '—';
    element('render').textContent = times.length ? `${mean(times).toFixed(2)} ms` : '—';
    element('compute').textContent = workerSteps ? `${(workerMs / workerSteps).toFixed(3)} ms` : '—'; lastStats = now;
  }
  requestAnimationFrame(frame);
}
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const percentile = (values: number[], q: number) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0;
function until(condition: () => boolean, timeout = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { remove(); reject(new Error('Harness wait timed out')); }, timeout);
    const remove = () => { clearTimeout(timer); const i = waiters.indexOf(check); if (i >= 0) waiters.splice(i, 1); };
    const check = () => { if (condition()) { remove(); resolve(); } };
    waiters.push(check); check();
  });
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function benchmark(kind: 'render' | 'worker' | 'live', population: number, duration = 5000) {
  if (measuring) throw new Error('Benchmark already running'); measuring = true;
  try {
    element('benchmark').textContent = `${kind} measurement running…`;
    desiredRate = kind === 'worker' ? 'fast' : 1; reset(population, 1, kind !== 'render');
    await until(() => pending === 0 && incoming !== null); await delay(1000);
    frameTimes = []; drawTimes = []; drawnCounts = []; workerSamples = [];
    const start = performance.now(), ms = workerMs, steps = workerSteps, tick = tickReceived;
    await delay(duration);
    const elapsed = performance.now() - start;
    const result = { kind, population, rate, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, wallMs: elapsed,
      frames: frameTimes.length, presentationFps: 1000 / mean(frameTimes), frameP95Ms: percentile(frameTimes, 0.95),
      renderMeanMs: mean(drawTimes), renderP95Ms: percentile(drawTimes, 0.95), drawnCarsMean: mean(drawnCounts),
      workerSteps: workerSteps - steps, workerComputeMs: workerMs - ms, workerMsPerStep: (workerMs - ms) / Math.max(1, workerSteps - steps),
      workerStepsPerWallSecond: (tickReceived - tick) / (elapsed / 1000), sampledAliveMean: mean(workerSamples.map((s) => s.alive)),
      generation: displayed?.generation, bestLapSeconds: best?.lapSeconds ?? null };
    setRunning(false); element('benchmark').textContent = JSON.stringify(result, null, 2); return result;
  } finally { measuring = false; }
}
function inspectMoving(): void {
  if (!displayed) return;
  let index = -1, progress = -Infinity;
  for (let i = 0; i < displayed.population; i++) { const b = i * CAR_STRIDE; if (displayed.storage.cars[b + CAR.status] === 0 && displayed.storage.cars[b + CAR.progress]! > progress) { index = i; progress = displayed.storage.cars[b + CAR.progress]!; } }
  if (index >= 0) command({ type: 'select', runId, car: { runId, generation: displayed.generation, index } });
}
element('running').onclick = () => setRunning(!running);
element('reset').onclick = () => reset();
element<HTMLSelectElement>('rate').onchange = (event) => { const value = (event.target as HTMLSelectElement).value; setRate(value === 'fast' ? 'fast' : Number(value) as 1 | 4); };
element<HTMLSelectElement>('population').onchange = () => reset();
element('inspect').onclick = inspectMoving;
element('clear').onclick = () => command({ type: 'select', runId, car: null });
element('invalid').onclick = () => { pending = ++requested; command({ type: 'reset', runId: pending, track, settings: { ...DEFAULT_SETTINGS, population: 1001 } }); };
element('render-bench').onclick = () => { void benchmark('render', Number(element<HTMLSelectElement>('population').value)); };
element('worker-bench').onclick = () => { void benchmark('worker', Number(element<HTMLSelectElement>('population').value)); };
canvas.onpointerdown = (event) => {
  if (!displayed || rate === 'fast') return;
  const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left - view.offsetX) / view.scale, y = (event.clientY - rect.top - view.offsetY) / view.scale;
  let index = -1, distance = (18 / view.scale) ** 2;
  for (let i = 0; i < displayed.population; i++) { const b = i * CAR_STRIDE; const d = (displayed.storage.cars[b + CAR.x]! - x) ** 2 + (displayed.storage.cars[b + CAR.y]! - y) ** 2; if (d < distance) { distance = d; index = i; } }
  command({ type: 'select', runId, car: index < 0 ? null : { runId, generation: displayed.generation, index } });
};
window.addEventListener('pagehide', () => worker.terminate());

// QA-only API; this entry is neither imported by the product nor included in dist/.
Object.assign(window, { t2: {
  reset, setRunning, setRate, inspectMoving, benchmark,
  state: () => ({ runId, pending, running, rate, tick: tickReceived, generation: displayed?.generation, generationsCompleted, bestLap: best?.lapSeconds ?? null,
    history, records, errors, maxSnapshotGap, selected: displayed?.selected ?? null,
    inspection: displayed?.selected ? { sensors: Array.from(displayed.storage.sensors), weights: Array.from(displayed.storage.weights), activations: Array.from(displayed.storage.activations), car: Array.from(displayed.storage.cars.slice(displayed.selected.index * CAR_STRIDE, (displayed.selected.index + 1) * CAR_STRIDE)) } : null }),
  evolve: async (generations = 30, population = 512, seed = 1) => { desiredRate = 'fast'; reset(population, seed, true); await until(() => pending === 0 && generationsCompleted >= generations, 60000); setRunning(false); await until(() => !running); return { history: history.slice(), records: records.slice(), tick: tickReceived, workerMs, workerSteps }; },
} });
reset(); requestAnimationFrame(frame);
