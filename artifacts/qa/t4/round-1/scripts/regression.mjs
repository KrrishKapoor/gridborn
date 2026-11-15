// Controlled-host + validation regressions with the real modules, loaded through Vite SSR (no app edits).
// Compares the current runtime against the original T2 runtime from git 32a6bf5 (baseline-*.ts copies).
import { createServer } from '../../../../../node_modules/vite/dist/node/index.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../..');
const server = await createServer({ root: REPO, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
const load = (p) => server.ssrLoadModule(p);
const out = { cadence: {}, m2: {}, session: {}, validation: {} };
try {
  const cur = await load('/src/sim/runtime.ts');
  const base = await load('/artifacts/qa/t4/round-1/scripts/baseline-runtime.ts');
  const { createPreset, TRACK_PRESETS, buildTrack } = await load('/src/track/index.ts').then(async (m) => ({ ...m, ...(await load('/src/track/geometry.ts')), ...(await load('/src/track/presets.ts')) }));
  const { DEFAULT_SETTINGS } = await load('/src/shared/simulation.ts');
  const { validateTrack } = await load('/src/sim/validation.ts');
  const { validateTrack: baseValidate } = await load('/artifacts/qa/t4/round-1/scripts/baseline-validation.ts');
  const { Session } = await load('/src/runtime/session.ts');

  // Seeded PRNG for jitter.
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  /** Virtual-time host + modelled main thread (displayed/incoming slots, rAF every 1000/60 ms). */
  function simulate(Runtime, { rate, seconds = 20, jitter = 0, stepMs = 0.02, rafMs = 1000 / 60, population = 512 }) {
    let now = 0; const timers = []; let id = 0;
    const events = [];
    const host = {
      now: () => now,
      schedule: (cb, delay) => { const h = ++id; timers.push({ h, at: now + Math.max(0, delay) + (jitter ? rnd() * jitter : 0), cb }); return h; },
      cancel: (h) => { const i = timers.findIndex((t) => t.h === h); if (i >= 0) timers.splice(i, 1); },
      send: (e) => events.push({ at: now + 0.1, e }),
    };
    const rt = new Runtime.WorkerRuntime(host);
    const track = createPreset('broad-oval');
    rt.receive({ type: 'reset', runId: 1, track, settings: { ...DEFAULT_SETTINGS, population } });
    rt.receive({ type: 'set-rate', runId: 1, rate });
    rt.receive({ type: 'set-running', runId: 1, running: true });
    let displayed = null, incoming = null, nextRaf = rafMs * 0.37, frames = 0, fresh = 0, deliveries = 0;
    const stepsHist = {}; const intervals = []; let lastArrival = null; const shownTicks = [];
    const recycle = (s) => rt.receive({ type: 'recycle', runId: s.runId, storage: s.storage });
    const end = seconds * 1000;
    // Engine steps take real time in the worker: advance virtual time per step via a now() bump inside step.
    const engine = rt.engine; const origStep = engine.step.bind(engine);
    engine.step = () => { now += stepMs; origStep(); };
    while (now < end) {
      const nextTimer = timers.length ? Math.min(...timers.map((t) => t.at)) : Infinity;
      const nextEvent = events.length ? events[0].at : Infinity;
      const t = Math.min(nextTimer, nextEvent, nextRaf);
      now = Math.max(now, t);
      if (t === nextEvent) {
        const { e } = events.shift();
        if (e.type === 'snapshot') {
          deliveries++; const s = e.snapshot; stepsHist[s.steps] = (stepsHist[s.steps] ?? 0) + 1;
          if (lastArrival !== null) intervals.push(now - lastArrival); lastArrival = now;
          if (incoming) recycle(incoming); incoming = s;
        }
      } else if (t === nextTimer) {
        const i = timers.findIndex((x) => x.at === nextTimer); const tm = timers.splice(i, 1)[0]; tm.cb();
      } else {
        frames++; nextRaf += rafMs;
        if (incoming) { fresh++; if (displayed) recycle(displayed); displayed = incoming; incoming = null; shownTicks.push(displayed.tick); }
      }
    }
    intervals.sort((a, b) => a - b);
    const warm = 1; // first second ignored for rates
    return { rate, jitter, seconds, deliveriesPerSec: +(deliveries / seconds).toFixed(2), freshFrameShare: +(fresh / frames).toFixed(3), stepsPerSec: +(rt.engine.tick / seconds).toFixed(1), stepsPerDelivery: stepsHist, medianIntervalMs: +intervals[intervals.length >> 1].toFixed(2), p90IntervalMs: +intervals[Math.floor(intervals.length * 0.9)].toFixed(2), maxIntervalMs: +intervals.at(-1).toFixed(2), uniqueShownTickDeltas: [...new Set(shownTicks.slice(1).map((t, i) => t - shownTicks[i]))].sort((a, b) => a - b) };
  }
  for (const [name, R] of [['baseline-32a6bf5', base], ['current', cur]]) {
    out.cadence[name] = [];
    for (const rate of [1, 4]) for (const jitter of [0, 1.5]) out.cadence[name].push(simulate(R, { rate, jitter, seconds: 20 }));
  }

  // M2: exhausted error budget then invalid reset; real WorkerRuntime with sync host.
  function m2(R) {
    const ev = []; let now = 0;
    const host = { now: () => now, schedule: () => 1, cancel: () => {}, send: (e) => ev.push(e) };
    const rt = new R.WorkerRuntime(host);
    const track = createPreset('broad-oval');
    rt.receive({ type: 'reset', runId: 10, track, settings: DEFAULT_SETTINGS });
    rt.receive({ type: 'set-running', runId: 10, running: true });
    for (let i = 0; i < 8; i++) rt.receive(i % 2 ? { type: 'set-running', runId: 10, running: 1 } : { type: 'set-rate', runId: 10, rate: 3 });
    const errorsBefore = ev.filter((e) => e.type === 'error').length;
    const n = ev.length;
    rt.receive({ type: 'reset', runId: 11, track, settings: { ...DEFAULT_SETTINGS, population: 5000 } });
    const reply11 = ev.slice(n).find((e) => e.type === 'ready' || e.type === 'error') ?? null;
    // More invalid shapes after exhaustion: bad track, bad seed, bad run id.
    const n2 = ev.length;
    rt.receive({ type: 'reset', runId: 12, track: { ...track, width: -1 }, settings: DEFAULT_SETTINGS });
    rt.receive({ type: 'reset', runId: 13, track, settings: { ...DEFAULT_SETTINGS, seed: -1 } });
    rt.receive({ type: 'reset', runId: -5, track, settings: DEFAULT_SETTINGS });
    const replies = ev.slice(n2).filter((e) => e.type === 'error' || e.type === 'ready').map((e) => `${e.type}:${e.runId}`);
    const stillOld = rt.engine.runId;
    rt.receive({ type: 'reset', runId: 14, track, settings: DEFAULT_SETTINGS });
    return { errorsBefore, reply11: reply11 && `${reply11.type}:${reply11.runId}:${reply11.message ?? ''}`, laterInvalidReplies: replies, engineAfterInvalid: stillOld, validAfter: rt.engine.runId };
  }
  out.m2 = { baseline: m2(base), current: m2(cur) };

  // Session ⇄ real WorkerRuntime: invalid resets always resolve pending, queued intent survives.
  {
    const q = [];
    let rt; const session = new Session((cmd) => q.push(['w', structuredClone(cmd)]), () => {});
    rt = new cur.WorkerRuntime({ now: () => 0, schedule: () => 1, cancel: () => {}, send: (e) => q.push(['m', e]) });
    const pump = () => { while (q.length) { const [to, x] = q.shift(); if (to === 'w') rt.receive(x); else session.receive(x); } };
    const track = createPreset('broad-oval'); const river = createPreset('riverbend');
    session.reset(track, DEFAULT_SETTINGS); pump();
    const accepted0 = session.accepted?.id;
    for (let i = 0; i < 8; i++) rt.receive({ type: 'set-rate', runId: accepted0, rate: i }); // exhaust budget (distinct messages)
    session.reset(track, { ...DEFAULT_SETTINGS, population: 5000 }); // pending invalid
    session.reset(river, DEFAULT_SETTINGS); // queued valid behind it
    const mid = { pending: session.pending?.id, queued: session.queued?.id };
    pump();
    const r1 = { accepted: session.accepted?.id, acceptedTrack: session.accepted?.track.id, pending: session.pending, queued: session.queued, error: session.error };
    session.reset(track, { ...DEFAULT_SETTINGS, mutationRate: 7 }); pump();
    const r2 = { accepted: session.accepted?.id, pending: session.pending, error: session.error };
    out.session = { accepted0, mid, afterInvalidThenValidQueued: r1, afterSecondInvalid: r2 };
  }

  // Validation: presets + drawn loops valid; fake inner wall + inconsistent width rejected.
  const tryV = (fn, t) => { try { fn(t); return 'ok'; } catch (e) { return String(e.message ?? e); } };
  const presets = TRACK_PRESETS.map((p) => ({ id: p.id, current: tryV(validateTrack, createPreset(p.id)), baseline: tryV(baseValidate, createPreset(p.id)) }));
  const drawn = []; let builtOk = 0, builtTried = 0;
  for (const dir of [1, -1]) for (const width of [70, 92, 120]) for (const [rx, ry, wob, k] of [[400, 260, 0, 3], [330, 230, 0.12, 3], [420, 250, 0.08, 2], [300, 300, 0.15, 4], [450, 200, 0.05, 5]]) {
    const pts = []; for (let i = 0; i < 160; i++) { const a = dir * i / 160 * Math.PI * 2; const r = 1 + wob * Math.cos(k * a); pts.push({ x: 600 + Math.cos(a) * rx * r, y: 400 + Math.sin(a) * ry * r }); }
    builtTried++; const res = buildTrack(pts, { id: `drawn-${dir}-${width}-${rx}`, width });
    if (res.ok) { builtOk++; drawn.push({ id: res.track.id, current: tryV(validateTrack, res.track) }); }
  }
  // Fake inner loop: outer boundary only + 2x2 square at the inner start-line endpoint.
  const fake = (() => {
    const t = createPreset('broad-oval'), n = t.walls.length / 8;
    const loopArea = (off) => { let a = 0; for (let i = 0; i < n; i++) { const o = (off + i) * 4; a += t.walls[o] * t.walls[o + 3] - t.walls[o + 2] * t.walls[o + 1]; } return Math.abs(a / 2); };
    const outerFirst = loopArea(0) > loopArea(n);
    const outer = t.walls.slice(outerFirst ? 0 : n * 4, outerFirst ? n * 4 : n * 8);
    const p = outerFirst ? t.startLine.b : t.startLine.a;
    const sq = [p.x, p.y, p.x + 2, p.y, p.x + 2, p.y, p.x + 2, p.y + 2, p.x + 2, p.y + 2, p.x, p.y + 2, p.x, p.y + 2, p.x, p.y];
    const walls = new Float32Array(outer.length + sq.length); walls.set(outer); walls.set(sq, outer.length);
    return { ...t, walls };
  })();
  const wrongWidth = { ...createPreset('riverbend'), width: 40 };
  out.validation = {
    presets, drawnBuilt: `${builtOk}/${builtTried}`, drawnAllValid: drawn.every((d) => d.current === 'ok'), drawnFailures: drawn.filter((d) => d.current !== 'ok'),
    fakeInner: { current: tryV(validateTrack, fake), baseline: tryV(baseValidate, fake) },
    inconsistentWidth: { current: tryV(validateTrack, wrongWidth), baseline: tryV(baseValidate, wrongWidth) },
  };
  // Validation cost (outside hot loop): time per validate of the largest preset.
  const club = createPreset('club-circuit'); const t0 = performance.now(); for (let i = 0; i < 20; i++) validateTrack(club); out.validation.msPerValidate = +((performance.now() - t0) / 20).toFixed(2);
} finally {
  await server.close();
}
fs.writeFileSync(path.join(HERE, '../raw/regression.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
