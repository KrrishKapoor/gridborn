// Real Playwright Chromium QA for the T2 harness + module worker.
// Usage: node scripts/qa-browser.mjs <suite...>   suites: viewports evolution lifecycle perf bundled
import { chromium } from '../tools/node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { createServer } from 'node:http';
import * as sim from '../node-bundle/sim.mjs';
import { makeValidator } from './lap-validate.mjs';

const ROOT = resolve(import.meta.dirname, '..'), SHOTS = join(ROOT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:5197';
const EXE = process.env.QA_CHROME ?? '/Users/krrishai/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const INIT = readFileSync(join(import.meta.dirname, 'qa-init.js'), 'utf8');
const suites = process.argv.slice(2);
const resultsPath = join(ROOT, 'browser-results.json');
const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : {};
const save = () => writeFileSync(resultsPath, JSON.stringify(results, null, 1));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const track = sim.ovalFixture(), validate = makeValidator(track);

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
results.browser = { version: browser.version(), executable: EXE, headless: true };
log('browser', browser.version());

async function openHarness(name, { width, height, dpr, touch }, url = `${BASE}/qa/t2.html`) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const consoleMsgs = [], pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.t2 && window.t2.state().running && window.t2.state().tick > 30, null, { timeout: 20000 });
  return { context, page, consoleMsgs, pageErrors, name };
}
const state = (page) => page.evaluate(() => window.t2.state());
const qa = (page, fn, arg) => page.evaluate(fn, arg);

// Check selected-car inspection against the snapshot's own car pose and an independent forward pass.
function checkInspection(last) {
  const sel = last.meta.sel, b = sel.index * 8, cars = last.cars, out = { index: sel.index, issues: [] };
  const x = cars[b], y = cars[b + 1], h = cars[b + 2], speed = cars[b + 3];
  if (last.sensors.length !== 21 || last.weights.length !== 90 || last.activations.length !== 18) out.issues.push('lengths');
  const A = sim.SENSOR_ANGLES;
  for (let r = 0; r < 7; r++) {
    const d = last.sensors[r * 3], hx = last.sensors[r * 3 + 1], hy = last.sensors[r * 3 + 2];
    const ex = x + Math.cos(h + A[r]) * d * 180, ey = y + Math.sin(h + A[r]) * d * 180;
    if (Math.hypot(ex - hx, ey - hy) > 0.05) out.issues.push(`ray ${r} endpoint mismatch ${Math.hypot(ex - hx, ey - hy)}`);
    if (Math.abs(last.activations[r] - d) > 1e-6) out.issues.push(`input ${r} != sensor`);
    if (d < 1) { // endpoint must lie on a wall
      let wd = Infinity; for (let s = 0; s < track.walls.length; s += 4) { const [ax, ay, bx, by] = track.walls.slice(s, s + 4); const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((hx - ax) * dx + (hy - ay) * dy) / (dx * dx + dy * dy))); wd = Math.min(wd, Math.hypot(hx - ax - dx * t, hy - ay - dy * t)); }
      if (wd > 0.05) out.issues.push(`ray ${r} hit not on wall (${wd})`);
    }
  }
  if (Math.abs(last.activations[7] - Math.min(1, Math.max(0, speed / 240))) > 1e-6) out.issues.push('speed input');
  const a = Float32Array.from(last.activations); sim.forward(Float32Array.from(last.weights), 0, a, 0);
  out.maxForwardError = Math.max(...last.activations.map((v, i) => Math.abs(v - a[i])));
  if (out.maxForwardError > 1e-6) out.issues.push(`forward pass mismatch ${out.maxForwardError}`);
  out.nonzeroWeights = last.weights.filter((w) => w !== 0).length;
  out.pose = { x, y, h, speed, status: cars[b + 7] };
  return out;
}
// Replays the engine in Node to the snapshot's tick and compares everything bit-for-bit.
function replayCompare(last, settings) {
  const e = new sim.Engine(last.meta.runId, track, settings, { generation() {}, best() {} });
  while (e.tick < last.meta.tick) e.step();
  const sameCars = last.cars.every((v, i) => Object.is(v, e.cars[i]));
  let sameSel = null;
  if (last.meta.sel) {
    const i = last.meta.sel.index;
    sameSel = last.sensors.every((v, k) => Object.is(v, e.sensors[i * 21 + k])) && last.weights.every((v, k) => Object.is(v, e.brains[i * 90 + k])) && last.activations.every((v, k) => Object.is(v, e.activations[i * 18 + k]));
  }
  return { tick: last.meta.tick, generation: e.generation, sameGeneration: e.generation === last.meta.gen, sameCars, sameSelection: sameSel };
}

// ---------------------------------------------------------------------------------------------
async function viewports() {
  results.viewports = {};
  const sizes = [['desktop-1440x900', { width: 1440, height: 900, dpr: 2, touch: false }], ['portrait-390x844', { width: 390, height: 844, dpr: 3, touch: true }], ['landscape-844x390', { width: 844, height: 390, dpr: 3, touch: true }]];
  for (const [name, vp] of sizes) {
    const r = {}; results.viewports[name] = r;
    const h = await openHarness(name, vp), { page } = h;
    try {
      await sleep(2500);
      r.layout = await page.evaluate(() => {
        const c = document.getElementById('world').getBoundingClientRect(), btns = [...document.querySelectorAll('button,select,input')];
        return { scrollWidth: document.documentElement.scrollWidth, innerWidth, innerHeight, canvas: { x: c.x, y: c.y, w: c.width, h: c.height, backing: [document.getElementById('world').width, document.getElementById('world').height] },
          canvasFullyInFirstScreen: c.bottom <= innerHeight, smallTargets: btns.filter((b) => { const r = b.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((b) => b.id || b.textContent),
          touchAction: getComputedStyle(document.getElementById('world')).touchAction, userSelect: getComputedStyle(document.getElementById('world')).userSelect, callout: getComputedStyle(document.getElementById('world')).webkitTouchCallout };
      });
      r.horizontalOverflow = r.layout.scrollWidth > r.layout.innerWidth;
      await page.screenshot({ path: join(SHOTS, `${name}-1-running.png`) });
      // Rates: measure fixed steps per wall second from snapshots.
      const rate = async (value, ms = 3000) => {
        await page.evaluate((v) => window.t2.setRate(v), value); await sleep(400);
        const a = await state(page), t0 = Date.now(); await sleep(ms); const b = await state(page);
        return { rate: value, stepsPerWallSecond: (b.tick - a.tick) / ((Date.now() - t0) / 1000), reported: b.rate, generationChanged: b.generation !== a.generation };
      };
      r.rates = [await rate(1), await rate(4), await rate('fast', 2000)];
      await page.screenshot({ path: join(SHOTS, `${name}-2-fast-mode.png`) });
      await rate(1, 500);
      // Pause / resume
      await page.click('#running'); await sleep(300);
      const p0 = await state(page); await sleep(2000); const p1 = await state(page);
      r.pause = { running: p1.running, ticksDuringPause: p1.tick - p0.tick, buttonText: await page.textContent('#running') };
      // Select a car by real pointer input while paused (deterministic target), using the harness world/CSS transform.
      const target = await page.evaluate(async () => {
        const { fitView } = await import('/src/shared/view.ts');
        const q = window.__qa, c = q.last.cars, canvas = document.getElementById('world'), rect = canvas.getBoundingClientRect();
        const view = fitView({ minX: 100, minY: 80, maxX: 1100, maxY: 720 }, rect.width, rect.height, 12);
        let best = -1, bp = -Infinity; for (let i = 0; i < c.length / 8; i++) if (c[i * 8 + 7] === 0 && c[i * 8 + 4] > bp) { bp = c[i * 8 + 4]; best = i; }
        if (best < 0) for (let i = 0; i < c.length / 8; i++) if (c[i * 8 + 6] < 1) { best = i; break; }
        return { index: best, x: rect.left + c[best * 8] * view.scale + view.offsetX, y: rect.top + c[best * 8 + 1] * view.scale + view.offsetY, gen: q.last.meta.gen };
      });
      await page.evaluate(({ y }) => window.scrollTo(0, Math.max(0, window.scrollY + y - innerHeight / 2)), target);
      const t2 = await page.evaluate(async (t) => { const { fitView } = await import('/src/shared/view.ts'); const q = window.__qa, c = q.last.cars, rect = document.getElementById('world').getBoundingClientRect(); const v = fitView({ minX: 100, minY: 80, maxX: 1100, maxY: 720 }, rect.width, rect.height, 12); return { ...t, x: rect.left + c[t.index * 8] * v.scale + v.offsetX, y: rect.top + c[t.index * 8 + 1] * v.scale + v.offsetY }; }, target);
      if (vp.touch) await page.touchscreen.tap(t2.x, t2.y); else await page.mouse.click(t2.x, t2.y);
      await page.waitForFunction((i) => window.__qa.last.meta.sel && window.__qa.last.meta.sel.index === i, t2.index, { timeout: 5000 }).catch(() => {});
      await sleep(300);
      const last = await qa(page, () => window.__qa.last);
      r.pointerEvents = await qa(page, () => window.__qa.pointer.slice(-2));
      r.selection = { target: t2, selected: last.meta.sel, matched: last.meta.sel?.index === t2.index };
      if (last.meta.sel) {
        r.inspection = checkInspection(last);
        r.inspectionDom = await page.evaluate(() => ({ selectedText: document.getElementById('selected').textContent, sensorRows: document.querySelectorAll('#sensors tr').length, activationRows: document.querySelectorAll('#activations .activation').length, weightLines: document.getElementById('weights').textContent.split('\n').length }));
        r.replay = replayCompare(last, { ...sim.DEFAULT_SETTINGS });
      }
      await page.screenshot({ path: join(SHOTS, `${name}-3-inspection-paused.png`) });
      if (vp.touch) await page.screenshot({ path: join(SHOTS, `${name}-3b-inspection-fullpage.png`), fullPage: true });
      // Resume: selection persists within the generation and inspection stays live; then it clears at the boundary.
      await page.click('#running'); await sleep(800);
      const live = await qa(page, () => window.__qa.last);
      r.liveSelection = live.meta.sel ? { ...checkInspection(live), tick: live.meta.tick } : { cleared: true, gen: live.meta.gen };
      await page.evaluate(() => window.t2.setRate(4));
      const g0 = (await state(page)).generation;
      await page.waitForFunction((g) => window.t2.state().generation > g, g0, { timeout: 60000 });
      await sleep(300);
      r.selectionAfterBoundary = await page.evaluate((g) => { const m = window.__qa.metas.find((x) => x.gen === g + 1); return { firstSnapshotOfNextGenSelected: m ? m.sel : 'missing', domText: document.getElementById('selected').textContent }; }, g0);
      // Reach an evolved generation, then show 1x running with best path.
      await page.evaluate(() => window.t2.setRate('fast'));
      await page.waitForFunction(() => window.t2.state().generation >= 8, null, { timeout: 60000 });
      await page.evaluate(() => window.t2.setRate(1)); await sleep(2500);
      await page.screenshot({ path: join(SHOTS, `${name}-4-evolved-running.png`) });
      if (vp.touch) await page.screenshot({ path: join(SHOTS, `${name}-4b-evolved-fullpage.png`), fullPage: true });
      // Live mouse/touch selection while running at 1x (moving target, real latency).
      const mv = await page.evaluate(async () => { const { fitView } = await import('/src/shared/view.ts'); const q = window.__qa, c = q.last.cars, rect = document.getElementById('world').getBoundingClientRect(); const v = fitView({ minX: 100, minY: 80, maxX: 1100, maxY: 720 }, rect.width, rect.height, 12);
        let best = -1; for (let i = 0; i < c.length / 8; i++) if (c[i * 8 + 7] === 0) { best = i; break; } return best < 0 ? null : { index: best, x: rect.left + c[best * 8] * v.scale + v.offsetX, y: rect.top + c[best * 8 + 1] * v.scale + v.offsetY, inView: rect.top >= 0 }; });
      if (mv) { if (vp.touch) await page.touchscreen.tap(mv.x, mv.y); else await page.mouse.click(mv.x, mv.y); await sleep(500); const l2 = await qa(page, () => window.__qa.last); r.runningSelection = { target: mv, selected: l2.meta.sel, inspection: l2.meta.sel ? checkInspection(l2) : null }; }
      await page.screenshot({ path: join(SHOTS, `${name}-5-running-inspection.png`) });
      // Invalid reset via harness control keeps the accepted run.
      const before = await state(page);
      await page.click('#invalid'); await sleep(700);
      const after = await state(page);
      r.invalidReset = { runIdBefore: before.runId, runIdAfter: after.runId, running: after.running, tickAdvanced: after.tick > before.tick, errorText: await page.textContent('#error'), pendingCleared: after.pending === 0 };
      await page.screenshot({ path: join(SHOTS, `${name}-6-rejected-reset.png`) });
      // Stale reset through the real worker (runId lower than accepted) is ignored, no ready/error, run continues.
      const nReady = await qa(page, () => window.__qa.readies.length), nErr = await qa(page, () => window.__qa.errs.length);
      await page.evaluate(() => { const s = window.t2.state(); window.__qa.worker.postMessage({ type: 'reset', runId: 1, track: null, settings: null }); window.__qa.worker.postMessage({ type: 'set-running', runId: s.runId - 1, running: false }); });
      await sleep(600); const st = await state(page);
      r.staleReset = { newReadies: (await qa(page, () => window.__qa.readies.length)) - nReady, newErrors: (await qa(page, () => window.__qa.errs.length)) - nErr, runId: st.runId, running: st.running };
      // Rapid actions: toggles, rate changes, population resets.
      await page.evaluate(async () => { for (let i = 0; i < 30; i++) { document.getElementById('running').click(); window.t2.setRate([1, 4, 'fast'][i % 3]); } });
      for (const pop of ['128', '1000', '512', '128', '512']) await page.selectOption('#population', pop);
      await sleep(1500);
      const rs = await state(page);
      r.rapid = { runId: rs.runId, pending: rs.pending, running: rs.running, rate: rs.rate, population: await qa(page, () => window.__qa.last.meta && window.__qa.last.cars.length / 8), errors: rs.errors };
      // Resize keeps world/sim state and rebuilds backing store.
      const rb = await state(page);
      await page.setViewportSize({ width: Math.round(vp.width * 0.7), height: vp.height }); await sleep(500);
      await page.setViewportSize({ width: vp.width, height: vp.height }); await sleep(500);
      const ra = await state(page);
      r.resize = { sameRun: ra.runId === rb.runId, tickContinued: ra.tick > rb.tick, backing: await page.evaluate(() => [document.getElementById('world').width, document.getElementById('world').height]) };
      r.nonFiniteSnapshots = await qa(page, () => window.__qa.nonFinite);
      r.snapshotsSeen = await qa(page, () => window.__qa.snapCount);
    } catch (e) { r.exception = String(e.stack || e); log(name, 'EXC', e); }
    r.consoleErrors = h.consoleMsgs; r.pageErrors = h.pageErrors;
    await h.context.close(); save(); log(name, JSON.stringify({ overflow: r.horizontalOverflow, sel: r.selection?.matched, insp: r.inspection?.issues, replay: r.replay, err: r.consoleErrors.length + r.pageErrors.length }));
  }
}

// ---------------------------------------------------------------------------------------------
async function evolution() {
  const h = await openHarness('evolution', { width: 1440, height: 900, dpr: 2, touch: false }), { page } = h;
  const r = results.evolution = {};
  const runEvolve = async (gens, pop, seed) => {
    const t0 = Date.now();
    const res = await page.evaluate(async ([g, p, s]) => { const n0 = window.__qa.bests.length; const out = await window.t2.evolve(g, p, s); const st = window.t2.state(); return { ...out, bests: window.__qa.bests.slice(n0).filter((b) => b.car.runId === st.runId), runId: st.runId }; }, [gens, pop, seed]);
    res.wallSeconds = (Date.now() - t0) / 1000; return res;
  };
  try {
    const node512 = JSON.parse(readFileSync(join(ROOT, 'node-results.json'), 'utf8')).evolution;
    for (const [pop, seed, label] of [[512, 1, 'a'], [512, 1, 'b'], [512, 0, 'a'], [1000, 1, 'a']]) {
      const e = await runEvolve(30, pop, seed), key = `pop${pop}_seed${seed}_${label}`;
      const firstLap = e.bests.find((b) => b.lapSeconds !== null), lastLap = e.bests.filter((b) => b.lapSeconds !== null).at(-1);
      const nodeRef = node512[`pop${pop}_seed${seed}_gen30`];
      const history30 = e.history.slice(0, 30);
      r[key] = { wallSeconds: e.wallSeconds, tick: e.tick, workerSteps: e.workerSteps, workerMs: e.workerMs,
        gen1: history30[0], gen30: history30[29], firstRecordLap: firstLap?.lapSeconds, finalRecordLap: lastLap?.lapSeconds,
        improvementPct: firstLap && lastLap ? (1 - lastLap.lapSeconds / firstLap.lapSeconds) * 100 : null,
        records: e.bests.map((b) => ({ generation: b.car.generation, index: b.car.index, lapSeconds: b.lapSeconds, fitness: b.fitness, points: b.samples.length / 4, validation: (({ finalPose, ...v }) => v)(validate(Float32Array.from(b.samples), b.lapSeconds)) })),
        history: history30.map((x) => ({ g: x.generation, ticks: x.ticks, laps: x.completedLaps, best: x.bestLapSeconds, bestFit: x.bestFitness, mean: x.meanFitness })),
        matchesNodeEngine: nodeRef ? JSON.stringify(history30.map((x) => [x.generation, x.ticks, x.completedLaps, x.bestLapSeconds, x.bestFitness, x.meanFitness])) === JSON.stringify(nodeRef.history.slice(0, 30).map((x) => [x.g, x.ticks, x.laps, x.best, x.bestFit, x.mean])) : null,
        samplesSig: e.bests.map((b) => b.samples.join(',')).join('|').length, allRecordLapsValid: e.bests.every((b) => validate(Float32Array.from(b.samples), b.lapSeconds).ok) };
      if (key === 'pop512_seed1_a') { r._bestsA = e.bests; writeFileSync(join(ROOT, 'best-trajectories-pop512-seed1.json'), JSON.stringify(e.bests)); }
      if (key === 'pop512_seed1_b') {
        const A = r._bestsA, B = e.bests;
        r.replayIdentity = { sameRecordCount: A.length === B.length, identicalSamples: A.length === B.length && A.every((x, i) => x.samples.length === B[i].samples.length && x.samples.every((v, k) => Object.is(v, B[i].samples[k])) && x.lapSeconds === B[i].lapSeconds),
          identicalHistory: JSON.stringify(r.pop512_seed1_a.history) === JSON.stringify(r.pop512_seed1_b.history) };
        delete r._bestsA;
      }
      log(key, 'gen1', history30[0].completedLaps, history30[0].bestLapSeconds, '→ gen30', history30[29].completedLaps, lastLap?.lapSeconds, 'node match', r[key].matchesNodeEngine, 'valid', r[key].allRecordLapsValid, `${e.wallSeconds}s`);
      save();
    }
    // Draw the actual best path for visual inspection
    await page.evaluate(() => window.t2.setRate(1)); await page.evaluate(() => window.t2.setRunning(true)); await sleep(1500);
    await page.screenshot({ path: join(SHOTS, 'desktop-1440x900-7-after-30-generations-1000.png') });
    const recordsText = await page.textContent('#records'); r.harnessRecordsShown = recordsText.length;
  } catch (e) { r.exception = String(e.stack || e); log('evolution EXC', e); }
  r.consoleErrors = h.consoleMsgs; r.pageErrors = h.pageErrors; r.nonFinite = await qa(page, () => window.__qa.nonFinite).catch(() => 'n/a');
  // event order: exactly one generation event per generation, before next generation's snapshots
  r.eventOrder = await page.evaluate(() => { const o = window.__qa.order, byRun = {}; let violations = 0, dupes = 0;
    for (const [k, run, g] of o) { const s = byRun[run] ??= { done: new Set(), maxSnapGen: 0 }; if (k === 'g') { if (s.done.has(g)) dupes++; s.done.add(g); } else { if (g > 1 && !s.done.has(g - 1)) violations++; s.maxSnapGen = Math.max(s.maxSnapGen, g); } }
    return { violations, dupes, runs: Object.keys(byRun).length, orderLen: o.length }; });
  await h.context.close(); save();
}

// ---------------------------------------------------------------------------------------------
// Raw protocol tests against the real module worker on a blank same-origin page.
async function lifecycle() {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage(); const pageErrors = [], consoleMsgs = [];
  page.on('pageerror', (e) => pageErrors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') consoleMsgs.push(m.text()); });
  await page.route(`${BASE}/qa-raw.html`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>raw</title><body>raw worker QA</body>' }));
  await page.goto(`${BASE}/qa-raw.html`);
  const r = results.lifecycle = {};
  try {
    await page.evaluate(async () => {
      const { ovalFixture } = await import('/src/sim/fixtures/oval.ts');
      const S = await import('/src/shared/simulation.ts');
      const w = new Worker('/src/sim/worker.ts', { type: 'module' });
      const L = window.L = { w, S, track: ovalFixture(), ev: [], held: [], autoRecycle: false, nonFinite: 0 };
      L.recycle = (s) => w.postMessage({ type: 'recycle', runId: s.runId, storage: s.storage }, S.snapshotTransferList(s.storage));
      w.onmessage = ({ data }) => { const t = performance.now();
        if (data.type === 'snapshot') { const s = data.snapshot; for (const v of s.storage.cars) if (!Number.isFinite(v)) { L.nonFinite++; break; }
          L.ev.push({ t, type: 'snapshot', runId: s.runId, tick: s.tick, gen: s.generation, running: s.running, rate: s.rate, steps: s.steps, ms: s.computeMs, sel: s.selected, alive: s.alive, cars: L.keepCars ? Array.from(s.storage.cars) : null });
          if (L.autoRecycle) L.recycle(s); else L.held.push(s); }
        else L.ev.push({ t, ...data, trajectory: undefined, lap: data.trajectory?.lapSeconds }); };
      L.reset = (runId, ch = {}, track = L.track) => w.postMessage({ type: 'reset', runId, track, settings: { ...S.DEFAULT_SETTINGS, ...ch } });
      L.cmd = (m) => w.postMessage(m);
      L.wait = (ms) => new Promise((res) => setTimeout(res, ms));
      L.snaps = (from = 0) => L.ev.slice(from).filter((e) => e.type === 'snapshot');
    });
    // 1. reset → ready + paused initial snapshot
    r.initial = await page.evaluate(async () => { L.reset(1); await L.wait(500); return L.ev.map((e) => e.type === 'snapshot' ? { type: 'snapshot', runId: e.runId, tick: e.tick, gen: e.gen, running: e.running, rate: e.rate, sel: e.sel } : { type: e.type, runId: e.runId }); });
    // 2. backpressure: never recycle, fast
    r.backpressure = await page.evaluate(async () => {
      L.cmd({ type: 'set-rate', runId: 1, rate: 'fast' }); L.cmd({ type: 'set-running', runId: 1, running: true }); const n0 = L.ev.length;
      await L.wait(2500); const delivered = L.snaps(n0).length, heldCount = L.held.length;
      L.cmd({ type: 'set-running', runId: 1, running: false }); await L.wait(400); const whilePausedNoSlot = L.snaps(n0).length - delivered;
      const one = L.held.shift(); L.recycle(one); const detached = one.storage.cars.byteLength === 0 && one.storage.weights.byteLength === 0;
      await L.wait(300); const rec = L.snaps(n0).slice(delivered + whilePausedNoSlot);
      const t1 = rec.at(-1)?.tick; await L.wait(1500);
      // recycle the rest and make sure paused tick is stable
      while (L.held.length) L.recycle(L.held.shift()); L.autoRecycle = true; await L.wait(300);
      const tA = L.snaps().at(-1).tick; await L.wait(1500); const tB = L.snaps().at(-1).tick;
      return { snapshotsWithoutRecycle: delivered, heldCount, whilePausedNoSlot, detachedAfterRecycle: detached, recoveredSnapshot: rec.map((s) => ({ tick: s.tick, running: s.running, steps: s.steps, ms: s.ms })), pausedTickStable: tA === tB && tA === t1, pausedTick: tA };
    });
    // 3. ticks never advance while paused (autoRecycle) over 3 s; resume gives no burst
    r.pauseResume = await page.evaluate(async () => {
      L.cmd({ type: 'set-rate', runId: 1, rate: 1 }); await L.wait(200); const a = L.snaps().at(-1).tick; await L.wait(3000); const b = L.snaps().at(-1).tick;
      const n0 = L.ev.length; L.cmd({ type: 'set-running', runId: 1, running: true }); await L.wait(250); const first = L.snaps(n0);
      await L.wait(2000); const all = L.snaps(n0); const rate = (all.at(-1).tick - all[0].tick) / ((all.at(-1).t - all[0].t) / 1000);
      // snapshot cadence at 1x with immediate recycling
      const iv = []; for (let i = 1; i < all.length; i++) iv.push(all[i].t - all[i - 1].t); iv.sort((x, y) => x - y);
      return { ticksDuringPause3s: b - a, ticksIn250msAfterResume: first.at(-1).tick - a, stepsPerSecond1x: rate, snapshotsPerSecond: all.length / ((all.at(-1).t - all[0].t) / 1000), intervalMedian: iv[iv.length >> 1], intervalP90: iv[Math.floor(iv.length * 0.9)], intervalMax: iv.at(-1), share30plus: iv.filter((x) => x > 25).length / iv.length };
    });
    // 4. suspension: freeze page (incl. dedicated worker) 3 s via CDP lifecycle, then measure burst
    const cdp = await context.newCDPSession(page);
    for (const rate of [1, 4]) {
      await page.evaluate((rt) => L.cmd({ type: 'set-rate', runId: 1, rate: rt }), rate); await sleep(500);
      const before = await page.evaluate(() => ({ tick: L.snaps().at(-1).tick, t: performance.now() }));
      let frozeOk = true; try { await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await sleep(3000); await cdp.send('Page.setWebLifecycleState', { state: 'active' }); } catch (e) { frozeOk = String(e); }
      const after = await page.evaluate(async (b) => { const n0 = L.ev.length; await L.wait(300); const s = L.snaps().filter((e) => e.t > b.t); const ticksAll = L.snaps().at(-1).tick - b.tick; const wall = (performance.now() - b.t) / 1000; return { ticksSinceBefore: ticksAll, wallSeconds: wall, firstAfterGap: s.slice(0, 4).map((e) => ({ tick: e.tick, steps: e.steps, dt: +(e.t - b.t).toFixed(0) })) }; }, before);
      r[`freeze_rate${rate}`] = { frozeOk, ...after, expectedIfNoFreeze: after.wallSeconds * 60 * rate };
    }
    // 5. reset to run 2 while run-1 slots outstanding; obsolete recycles/commands ignored; stale & invalid resets
    r.resetSemantics = await page.evaluate(async () => {
      L.autoRecycle = false; L.cmd({ type: 'set-running', runId: 1, running: true }); await L.wait(300); // hold run-1 slots
      const held1 = L.held.splice(0); const n0 = L.ev.length;
      L.reset(2, { population: 128, eliteCount: 4 }); await L.wait(300);
      const afterReset = L.ev.slice(n0).map((e) => e.type + (e.runId ? `:${e.runId}` : '') + (e.type === 'snapshot' ? `:t${e.tick}:${e.running}` : ''));
      for (const s of held1) L.recycle(s); L.cmd({ type: 'set-running', runId: 1, running: true }); L.cmd({ type: 'set-rate', runId: 1, rate: 'fast' }); await L.wait(500);
      const run2Tick = L.snaps().at(-1).tick, obsoleteEvents = L.ev.slice(n0).length - afterReset.length;
      const n1 = L.ev.length; L.reset(2); L.reset(1, { population: 64, eliteCount: 2 }); await L.wait(400); const staleReplies = L.ev.slice(n1).map((e) => e.type);
      const n2 = L.ev.length; L.reset(3, { population: 2000 }); await L.wait(300); const invalid = L.ev.slice(n2).map((e) => e.type === 'error' ? `error:${e.runId}:${e.message}` : e.type);
      while (L.held.length) L.recycle(L.held.shift()); L.autoRecycle = true;
      L.cmd({ type: 'set-running', runId: 2, running: true }); await L.wait(800); const s = L.snaps().at(-1);
      return { afterReset, run2TickAfterObsoleteCommands: run2Tick, obsoleteEvents, staleReplies, invalid, run2Continues: { runId: s.runId, tick: s.tick, running: s.running } };
    });
    // 6. error cap: 8 distinct malformed commands, then an invalid reset — does main get a reply?
    r.errorCap = await page.evaluate(async () => {
      L.reset(10, { population: 64, eliteCount: 2 }); await L.wait(300); const n0 = L.ev.length;
      for (let i = 0; i < 8; i++) L.cmd(i % 2 ? { type: 'set-rate', runId: 10, rate: 3 } : { type: 'set-running', runId: 10, running: 1 });
      await L.wait(200); const errors = L.ev.slice(n0).filter((e) => e.type === 'error').length; const n1 = L.ev.length;
      L.reset(11, { population: 5000 }); await L.wait(400); const reply = L.ev.slice(n1).map((e) => e.type);
      const n2 = L.ev.length; L.reset(12, { population: 64, eliteCount: 2 }); await L.wait(300);
      return { errorsEmitted: errors, repliesToInvalidReset11: reply, nextValidReset12: L.ev.slice(n2).map((e) => e.type) };
    });
    // 7. invalid geometry/settings via real structured clone
    r.invalidGeometry = await page.evaluate(async () => {
      const t = L.track, out = {}; let id = 20;
      const cases = { emptyObject: {}, missingWalls: { ...t, walls: undefined }, plainArrayWalls: { ...t, walls: Array.from(t.walls) }, float64Centerline: { ...t, centerline: Float64Array.from(t.centerline) },
        nanLength: { ...t, length: NaN }, hugeCoords: { ...t, centerline: t.centerline.map((v) => v * 1e6) }, twoVertex: { ...t, centerline: t.centerline.slice(0, 4), cumulativeLengths: t.cumulativeLengths.slice(0, 3) },
        startLineAlong: { ...t, startLine: { a: { x: 560, y: 170 }, b: { x: 640, y: 170 } } }, spawnOffCenter: { ...t, spawn: { ...t.spawn, x: 610 } }, widthZero: { ...t, width: 0 } };
      for (const [name, track] of Object.entries(cases)) { L.reset(++id, { population: 64, eliteCount: 2 }, track); await L.wait(80); const e = L.ev.at(-1); out[name] = e.type === 'error' && e.runId === id ? `error: ${e.message}` : `${e.type}:${e.runId}`; if (Object.keys(out).length === 6) { L.reset(++id, { population: 64, eliteCount: 2 }); await L.wait(150); } }
      const nonCloneable = (() => { try { L.w.postMessage({ type: 'reset', runId: ++id, track: { ...t, fn: () => 1 }, settings: L.S.DEFAULT_SETTINGS }); return 'posted'; } catch (e) { return `main threw ${e.name}`; } })();
      L.cmd('garbage'); L.cmd(null); L.cmd({ type: 'nope', runId: L.snaps().at(-1).runId }); await L.wait(200);
      return { ...out, nonCloneable, garbageReplies: L.ev.slice(-3).map((e) => e.type === 'error' ? e.message : e.type), lastRun: L.snaps().at(-1).runId };
    });
    // 8. crash pose/fade + finish stop + finite outputs across real generations (fast, 512)
    r.crashFinish = await page.evaluate(async () => {
      L.keepCars = true; L.reset(40); await L.wait(200); L.cmd({ type: 'set-rate', runId: 40, rate: 'fast' }); L.cmd({ type: 'set-running', runId: 40, running: true });
      await new Promise((res) => { const iv = setInterval(() => { if (L.snaps().at(-1).gen >= 6) { clearInterval(iv); res(); } }, 50); });
      L.cmd({ type: 'set-rate', runId: 40, rate: 1 }); await L.wait(9500); L.cmd({ type: 'set-running', runId: 40, running: false }); await L.wait(200); L.keepCars = false;
      const snaps = L.snaps().filter((s) => s.runId === 40 && s.cars && s.rate === 1); const issues = []; const seen = {}; let crashedChecked = 0, finishedChecked = 0, fadeMax = 0;
      for (let k = 1; k < snaps.length; k++) { const a = snaps[k - 1], b = snaps[k]; if (a.gen !== b.gen) continue;
        for (let i = 0; i < b.cars.length / 8; i++) { const o = i * 8, st = b.cars[o + 7];
          if (st !== 0 && a.cars[o + 7] === st) { if (b.cars[o] !== a.cars[o] || b.cars[o + 1] !== a.cars[o + 1] || b.cars[o + 3] !== 0) issues.push(`car ${i} moved after stop`); if (!(b.cars[o + 6] > a.cars[o + 6]) && b.tick > a.tick) issues.push(`car ${i} fade not increasing`); fadeMax = Math.max(fadeMax, b.cars[o + 6]); if (st === 1) crashedChecked++; else finishedChecked++; }
          if (st === 2 && !seen[i + ':' + b.gen]) { seen[i + ':' + b.gen] = 1; if (Math.abs(b.cars[o] - 600) > 0.01 || b.cars[o + 1] < 124 || b.cars[o + 1] > 216) issues.push(`finish pose off line ${b.cars[o]},${b.cars[o + 1]}`); }
          if (st === 0 && b.cars[o + 6] !== 0) issues.push('active car has inactiveSeconds'); } }
      const gensSeen = [...new Set(snaps.map((s) => s.gen))];
      return { snapshotsAnalysed: snaps.length, gensSeen, crashedChecked, finishedChecked, fadeMax, issues: issues.slice(0, 10), issueCount: issues.length, nonFinite: L.nonFinite,
        lastAliveCount: snaps.at(-1)?.alive };
    });
    r.events = await page.evaluate(() => ({ total: L.ev.length, errors: L.ev.filter((e) => e.type === 'error').map((e) => `${e.runId}:${e.message}`) }));
  } catch (e) { r.exception = String(e.stack || e); log('lifecycle EXC', e); }
  r.pageErrors = pageErrors; r.consoleErrors = consoleMsgs;
  await context.close(); save(); log('lifecycle', JSON.stringify(r).slice(0, 3000));
}

// ---------------------------------------------------------------------------------------------
async function perf() {
  const r = results.perf = { conditions: { viewport: '1440x900', dpr: 2, browser: browser.version(), headless: true, cpu: 'Apple M5', os: 'macOS 27.2', warmupMs: 2000, sampleMs: 6000, renderMode: 'harness Canvas2D: track bitmap + best path + every active/fading car triangle; fast mode does not draw cars' } };
  const h = await openHarness('perf', { width: 1440, height: 900, dpr: 2, touch: false }), { page } = h;
  await page.evaluate(() => { window.__qa.keepCars = false; });
  const measure = async (label, pop, rate, opts = {}) => {
    if (!opts.keep) { await page.evaluate(([p]) => window.t2.reset(p, 1, true), [pop]); await page.waitForFunction(() => window.t2.state().pending === 0 && window.t2.state().running, null, { timeout: 20000 }); }
    if (opts.toGen) { await page.evaluate(() => window.t2.setRate('fast')); await page.waitForFunction((g) => window.t2.state().generation >= g, opts.toGen, { timeout: 120000 }); }
    await page.evaluate((rt) => window.t2.setRate(rt), rate); await sleep(2000);
    const res = await page.evaluate(async (ms) => {
      const q = window.__qa, f0 = q.frames.length, m0 = q.metas.length, s0 = window.t2.state(), t0 = performance.now();
      // input responsiveness: main-thread handler latency of a synthetic task + worker pause round trip
      await new Promise((r) => setTimeout(r, ms));
      const fr = q.frames.slice(f0), metas = q.metas.slice(m0), s1 = window.t2.state(), wall = (performance.now() - t0) / 1000;
      const iv = []; for (let i = 1; i < fr.length; i++) iv.push(fr[i][0] - fr[i - 1][0]);
      const cb = fr.map((x) => x[1]); const fresh = fr.filter((x, i) => i > 0 && x[2] !== fr[i - 1][2]).length;
      const sorted = (a) => a.slice().sort((x, y) => x - y), pct = (a, p) => sorted(a)[Math.min(a.length - 1, Math.floor(a.length * p))];
      const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
      const ms_ = metas.reduce((x, m) => x + m.ms, 0), st = metas.reduce((x, m) => x + m.steps, 0);
      return { frames: fr.length, fps: (fr.length - 1) / ((fr.at(-1)[0] - fr[0][0]) / 1000), frameIntervalP50: pct(iv, 0.5), frameIntervalP95: pct(iv, 0.95), frameIntervalP99: pct(iv, 0.99), framesOver25ms: iv.filter((x) => x > 25).length,
        frameCallbackMeanMs: mean(cb), frameCallbackP95Ms: pct(cb, 0.95), framesWithNewSnapshotShare: fresh / Math.max(1, fr.length - 1), snapshotsPerSecond: metas.length / wall,
        stepsPerWallSecond: (s1.tick - s0.tick) / wall, workerMsPerStep: ms_ / Math.max(1, st), workerBusyShare: ms_ / (wall * 1000),
        aliveMean: mean(metas.map((m) => m.alive)), drawableMean: mean(metas.map((m) => m.drawable)), crashedMean: mean(metas.map((m) => m.crashed)), finishedMean: mean(metas.map((m) => m.finished)),
        generationFrom: s0.generation, generationTo: s1.generation, rawFrameIntervals: iv.map((x) => +x.toFixed(2)) };
    }, 6000);
    // pause round trip (click → snapshot reporting paused)
    const rt = await page.evaluate(async () => { const n = window.__qa.metas.length, t0 = performance.now(); document.getElementById('running').click(); await new Promise((r) => { const c = () => (window.__qa.metas.slice(n).some((m) => !m.running) ? r() : setTimeout(c, 1)); c(); }); const d = performance.now() - t0; document.getElementById('running').click(); return d; });
    res.pauseRoundTripMs = rt; res.population = pop; res.rate = rate; res.label = label;
    const { rawFrameIntervals, ...summary } = res; (r.samples ??= []).push(summary); (r.raw ??= {})[label] = rawFrameIntervals; save();
    log('perf', label, JSON.stringify(summary));
  };
  try {
    for (const pop of [512, 1000]) {
      await measure(`${pop}-1x-gen1`, pop, 1);
      await measure(`${pop}-4x-early`, pop, 4, { keep: true });
      await measure(`${pop}-fast`, pop, 'fast', { keep: true });
      await measure(`${pop}-1x-evolved-gen15`, pop, 1, { toGen: 15 });
      await measure(`${pop}-4x-evolved`, pop, 4, { keep: true, toGen: 0 });
    }
    // Render-only stress: paused at spawn draws all cars (stacked) every frame — harness benchmark API
    for (const pop of [512, 1000]) { const b = await page.evaluate((p) => window.t2.benchmark('render', p, 4000), pop); (r.harnessRenderBenchmark ??= []).push(b); log('render bench', JSON.stringify(b)); }
  } catch (e) { r.exception = String(e.stack || e); log('perf EXC', e); }
  r.consoleErrors = h.consoleMsgs; r.pageErrors = h.pageErrors;
  await h.context.close(); save();
}

// ---------------------------------------------------------------------------------------------
async function bundled() {
  const dist = join(ROOT, 'harness-dist'), types = { '.html': 'text/html', '.js': 'text/javascript' };
  const server = createServer((req, res) => { const p = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p)); });
  await new Promise((r) => server.listen(5198, '127.0.0.1', r));
  const r = results.bundled = {};
  try {
    const h = await openHarness('bundled', { width: 1440, height: 900, dpr: 2, touch: false }, 'http://127.0.0.1:5198/qa/t2.html');
    const e = await h.page.evaluate(async () => { const o = await window.t2.evolve(5, 512, 1); return { gens: o.history.map((x) => [x.generation, x.completedLaps, x.bestLapSeconds]), tick: o.tick }; });
    r.evolve5 = e; r.consoleErrors = h.consoleMsgs; r.pageErrors = h.pageErrors;
    const nodeHist = JSON.parse(readFileSync(join(ROOT, 'node-results.json'), 'utf8')).evolution.pop512_seed1_gen30.history.slice(0, 5).map((x) => [x.g, x.laps, x.best]);
    r.matchesNode = JSON.stringify(e.gens.slice(0, 5)) === JSON.stringify(nodeHist);
    await h.context.close();
  } catch (e) { r.exception = String(e.stack || e); }
  server.close(); save(); log('bundled', JSON.stringify(r));
}

const all = { viewports, evolution, lifecycle, perf, bundled };
for (const s of suites) { log('suite', s); await all[s](); }
await browser.close(); save(); log('done');
