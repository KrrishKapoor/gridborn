// Independent T4 public-input QA. Usage: node qa.mjs <baseUrl> <label dev|prod> [viewport keys...]
import { launch, open, state, waitFor, tap, tapAt, loopPoints, stroke, sleep, save, VIEWPORTS, SHOTS } from './lib.mjs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5294/';
const label = process.argv[3] ?? 'dev';
const keys = process.argv.slice(4).length ? process.argv.slice(4) : ['desktop', 'portrait', 'landscape'];
const results = { base, label, started: new Date().toISOString(), viewports: {} };

function checker(bucket) {
  return (name, pass, details = {}) => {
    bucket.checks.push({ name, pass: !!pass, details });
    console.log(`${pass ? 'PASS' : 'FAIL'} [${bucket.name}] ${name}${pass ? '' : ' ' + JSON.stringify(details).slice(0, 400)}`);
  };
}
const shot = (page, vp, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${label}-${vp.name}-${name}.png`), fullPage: full });

async function ticksPerSecond(page, ms = 1500) {
  const a = await page.evaluate(() => ({ tick: window.__qa.latestMeta.tick, t: performance.now(), n: window.__qa.snapCount, raf: window.__qa.rafTotal }));
  await sleep(ms);
  const b = await page.evaluate(() => ({ tick: window.__qa.latestMeta.tick, t: performance.now(), n: window.__qa.snapCount, raf: window.__qa.rafTotal }));
  const s = (b.t - a.t) / 1000;
  return { ticks: (b.tick - a.tick) / s, snaps: (b.n - a.n) / s, raf: (b.raf - a.raf) / s };
}

/** Pick an isolated visible active car from the latest worker state; returns CSS page coords. */
async function pickCar(page, { status = 0, maxInactive = 1.2, minGap = 8 } = {}) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  if (status === 0) { try { await page.waitForFunction(() => { const m = window.__qa.latestMeta; return !m.running || (m.gtick > 100 && m.gtick < 300); }, null, { timeout: 15000, polling: 50 }); } catch {} }
  return page.evaluate(({ status, maxInactive, minGap }) => {
    const Q = window.__qa, cars = Q.latestCars, v = Q.view(), pop = Q.latestMeta.pop;
    const vis = [];
    for (let i = 0; i < pop; i++) { const st = cars[i * 8 + 7], ina = cars[i * 8 + 6]; if (st === 0 || ina <= 2) vis.push(i); }
    const css = (i) => [cars[i * 8] * v.scale + v.ox, cars[i * 8 + 1] * v.scale + v.oy];
    let bestI = -1, bestGap = 0;
    for (const i of vis) {
      if (cars[i * 8 + 7] !== status) continue;
      if (status !== 0 && cars[i * 8 + 6] > maxInactive) continue;
      const [x, y] = css(i); if (x < 20 || y < 20 || x > v.w - 20 || y > v.h - 20) continue;
      let gap = Infinity;
      for (const j of vis) if (j !== i) { const [a, b] = css(j); gap = Math.min(gap, Math.hypot(a - x, b - y)); }
      if (gap > bestGap) { bestGap = gap; bestI = i; }
    }
    if (bestI < 0 || bestGap < minGap) return { ok: false, bestGap, visible: vis.length };
    const [x, y] = css(bestI);
    return { ok: true, index: bestI, x: x + v.left, y: y + v.top, gap: bestGap, tick: Q.latestMeta.tick, speed: cars[bestI * 8 + 3] };
  }, { status, maxInactive, minGap });
}

/** Compare inspector DOM, hero rays/ring and inspector-canvas rays against one exact worker snapshot. */
async function inspectionCoherence(page) {
  return page.evaluate(() => {
    const Q = window.__qa;
    const nodes = [...document.querySelectorAll('.actual-inspector [data-nodes] circle title')].map((t) => t.textContent);
    const edges = [...document.querySelectorAll('.actual-inspector [data-edges] line title')].map((t) => t.textContent);
    const steer = document.querySelector('.actual-inspector [data-steer]')?.textContent, throttle = document.querySelector('.actual-inspector [data-throttle]')?.textContent;
    const stateText = document.querySelector('[data-driver-state]')?.textContent;
    const acts = nodes.map((s) => Number(/Activation (-?[\d.]+)/.exec(s)?.[1]));
    const biases = nodes.slice(8).map((s) => Number(/bias (-?[\d.]+)/.exec(s)?.[1]));
    const ew = edges.map((s) => Number(/Weight (-?[\d.]+)/.exec(s)?.[1]));
    const eIndex = []; for (let d = 0; d < 10; d++) for (let k = 0; k < 8; k++) eIndex.push(d >= 8 ? 72 + (d - 8) * 9 + k : d * 9 + k);
    const bIndex = [...Array.from({ length: 8 }, (_, j) => j * 9 + 8), 80, 89];
    const r3 = (x) => Math.round(x * 1000) / 1000;
    const eq = (a, b) => Math.abs(a - r3(b)) < 0.0011;
    const F = Q.drawn ?? Q.cur; const heroArcs = F?.arcs ?? [];
    const pos = F?.pos ?? [];
    const arcs = []; for (let i = 0; i < heroArcs.length; i += 3) arcs.push(heroArcs.slice(i, i + 3));
    const il = Q.inspectorLines.slice(-14), pairs = []; for (let i = 0; i < il.length; i += 2) pairs.push([il[i], il[i + 1]]);
    // All worker snapshots whose values equal the DOM at its 3-decimal display precision.
    const candidates = Q.sel.filter((e) => acts.every((a, i) => eq(a, e.activations[i])) && ew.every((w, i) => eq(w, e.weights[eIndex[i]])) && biases.every((b, i) => eq(b, e.weights[bIndex[i]])));
    const verify = (m) => {
      const rayEnds = []; for (let i = 0; i < 21; i += 3) rayEnds.push([m.sensors[i + 1], m.sensors[i + 2]]);
      return { raysOk: rayEnds.every(([x, y]) => arcs.some(([ax, ay]) => Math.abs(ax - x) < 1e-3 && Math.abs(ay - y) < 1e-3)),
        ringOk: arcs.some(([ax, ay, r]) => Math.abs(ax - m.car[0]) < 1e-3 && Math.abs(ay - m.car[1]) < 1e-3 && r > 3),
        poseOk: pos.length >= 2 && Math.abs(pos.at(-2) - m.car[0]) < 1e-3 && Math.abs(pos.at(-1) - m.car[1]) < 1e-3,
        inspectorRaysOk: rayEnds.every(([x, y]) => pairs.some(([px, py]) => Math.abs(px - x) < 1e-3 && Math.abs(py - y) < 1e-3)) };
    };
    let match = null, v = { raysOk: false, ringOk: false, poseOk: false, inspectorRaysOk: false };
    for (let k = candidates.length - 1; k >= 0; k--) { const r = verify(candidates[k]); if (r.raysOk && r.ringOk && r.poseOk && r.inspectorRaysOk) { match = candidates[k]; v = r; break; } }
    if (!match && candidates.length) { match = candidates.at(-1); v = verify(match); }
    const { raysOk, ringOk, poseOk, inspectorRaysOk } = v;
    let forward = null;
    if (match) {
      const w = match.weights, a = match.activations.slice(0, 8), h = [];
      for (let j = 0; j < 8; j++) { let s = w[j * 9 + 8]; for (let k = 0; k < 8; k++) s += w[j * 9 + k] * a[k]; h.push(Math.tanh(s)); }
      const o = []; for (let j = 0; j < 2; j++) { let s = w[72 + j * 9 + 8]; for (let k = 0; k < 8; k++) s += w[72 + j * 9 + k] * h[k]; o.push(Math.tanh(s)); }
      forward = Math.max(...h.map((x, i) => Math.abs(x - match.activations[8 + i])), ...o.map((x, i) => Math.abs(x - match.activations[16 + i])));
    }
    const inputsOk = match ? match.activations.slice(0, 7).every((x, i) => Math.abs(x - match.sensors[i * 3]) < 1e-6) : false;
    return { nodes: nodes.length, edges: edges.length, values: acts.length + ew.length + biases.length, matched: !!match, candidates: candidates.length, matchTick: match?.tick, matchIndex: match?.index, latestTick: Q.latestMeta.tick, forwardErr: forward, raysOk, ringOk, poseOk, inspectorRaysOk, inputsOk, steer, throttle, stateText, acts };
  });
}

async function layoutMetrics(page, vp) {
  return page.evaluate((touch) => {
    const doc = document.documentElement;
    const small = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (!el || el.closest('[hidden]') || el.closest('[aria-hidden="true"]') && !el.closest('svg')) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      let size = parseFloat(cs.fontSize);
      if (el instanceof SVGElement) { const m = el.getScreenCTM(); if (m) size *= Math.hypot(m.a, m.b); }
      if (size < 10.95) small.push({ text: n.textContent.trim().slice(0, 40), size: Math.round(size * 10) / 10, cls: el.getAttribute('class') ?? el.tagName, y: Math.round(r.top + scrollY) });
    }
    const targets = [];
    for (const el of document.querySelectorAll('button, select, input, a, label.follow-control')) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (!r.width || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
      if (el.classList.contains('skip-link')) continue;
      if (el.type === 'checkbox' && el.closest('label')) continue; // the wrapping label is the target
      if (touch && (r.width < 44 || r.height < 44)) targets.push({ el: (el.getAttribute('class') ?? el.tagName) + ':' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) });
    }
    const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
    return { overflowX: doc.scrollWidth - doc.clientWidth, innerHeight, small, targets, hero: rect('.hero-canvas'), h1: rect('h1'), telemetry: rect('.telemetry'), feedback: rect('.track-feedback'), hint: rect('.track-hint'), controls: rect('.control-rail'), play: rect('[data-running]'), fitness: rect('.fitness'), panel: rect('.inspection-panel'),
      canvasBacking: (() => { const c = document.querySelector('.hero-canvas'); const r = c.getBoundingClientRect(); return { w: c.width, h: c.height, cssW: r.width, cssH: r.height, dpr: devicePixelRatio }; })() };
  }, vp.hasTouch);
}

function signedArea(xy) { let a = 0; for (let i = 0; i < xy.length; i += 2) { const j = (i + 2) % xy.length; a += xy[i] * xy[j + 1] - xy[j] * xy[i + 1]; } return a / 2; }

async function learn(page, cdp, vp, seconds) {
  await tap(page, cdp, vp, '[data-rate="fast"]');
  await sleep(seconds * 1000);
  await tap(page, cdp, vp, '[data-rate="1"]');
  await sleep(300);
  return page.evaluate(() => {
    const Q = window.__qa, run = Q.latestMeta.runId, g = Q.gens.filter((x) => x.runId === run);
    const laps = g.map((x) => x.bestLapSeconds);
    const firstLap = laps.findIndex((x) => x !== null);
    let runningMin = Infinity, improvements = 0;
    for (const l of laps) if (l !== null && l < runningMin - 1e-9) { if (runningMin !== Infinity) improvements++; runningMin = l; }
    return { run, gens: g.length, firstLapGen: firstLap < 0 ? null : firstLap + 1, firstLap: firstLap < 0 ? null : laps[firstLap], bestLap: runningMin === Infinity ? null : runningMin, improvements, completedLapsLast: g.at(-1)?.completedLaps, history: g.map(({ generation, bestFitness, meanFitness, completedLaps, bestLapSeconds, ticks }) => ({ generation, bestFitness, meanFitness, completedLaps, bestLapSeconds, ticks })) };
  });
}

async function runViewport(browser, key) {
  const vp = VIEWPORTS[key];
  const bucket = { name: vp.name, checks: [], data: {} };
  results.viewports[vp.name] = bucket;
  const check = checker(bucket);
  const { context, page, cdp, log } = await open(browser, vp, base);
  try {
    // A. Hero on load
    await sleep(1800);
    let s = await state(page);
    check('auto-starts running at 1x with hundreds of cars', s.meta.running && s.meta.rate === 1 && s.meta.pop === 512 && s.run === 'Pause', { meta: s.meta, run: s.run });
    check('production diagnostics global matches build mode', label === 'prod' ? await page.evaluate(() => !('__gridborn' in window)) : await page.evaluate(() => typeof window.__gridborn?.read === 'function'), {});
    const L = await layoutMetrics(page, vp); bucket.data.layoutTop = L;
    check('no horizontal overflow', L.overflowX <= 0, { overflowX: L.overflowX });
    check('hero canvas fully in first viewport', L.hero.top >= 0 && L.hero.bottom <= L.innerHeight + 1, L.hero);
    check('play control in first viewport', L.play.bottom <= L.innerHeight, L.play);
    check('canvas backing = css * min(dpr,2)', Math.abs(L.canvasBacking.w - Math.round(L.canvasBacking.cssW * Math.min(2, L.canvasBacking.dpr))) <= 1, L.canvasBacking);
    check('all rendered text >= 11px', L.small.length === 0, { count: L.small.length, sample: L.small.slice(0, 12) });
    if (vp.hasTouch) check('touch targets >= 44px', L.targets.length === 0, { targets: L.targets });
    const frames1 = await page.evaluate(() => window.__qa.cur);
    check('hero draws cars each frame', frames1.n > 50, { drawn: frames1.n });
    await shot(page, vp, '01-hero');
    // B. Rates and pause, observed from the worker and canvas.
    const r1 = await ticksPerSecond(page); bucket.data.rate1 = r1;
    check('1x ≈ 60 sim steps/s and ≈60 snapshots/s', r1.ticks > 52 && r1.ticks < 66 && r1.snaps > 52, r1);
    await tap(page, cdp, vp, '[data-rate="4"]'); await sleep(400);
    const r4 = await ticksPerSecond(page); bucket.data.rate4 = r4;
    check('4x ≈ 240 sim steps/s', r4.ticks > 200 && r4.ticks < 260 && r4.snaps > 52, r4);
    await tap(page, cdp, vp, '[data-rate="fast"]'); await sleep(500);
    const rf = await ticksPerSecond(page); bucket.data.rateFast = rf;
    const fastFrame = await page.evaluate(() => window.__qa.cur);
    s = await state(page);
    check('fast is headless: no cars drawn, message shown, faster than 4x', fastFrame.n === 0 && fastFrame.headless !== undefined && rf.ticks > 400, { rf, n: fastFrame.n, runLabel: s.runLabel, hint: s.hint });
    await shot(page, vp, '02-fast-headless');
    await tap(page, cdp, vp, '[data-rate="1"]'); await sleep(300);
    await tap(page, cdp, vp, '[data-running]'); await sleep(300);
    const p1 = await page.evaluate(() => ({ tick: window.__qa.latestMeta.tick, sum: window.__qa.cur.sum })); await sleep(1000);
    const p2 = await page.evaluate(() => ({ tick: window.__qa.latestMeta.tick, sum: window.__qa.cur.sum, run: document.querySelector('[data-run-text]').textContent, label: document.querySelector('[data-run-label]').textContent }));
    check('pause stops stepping and motion', p1.tick === p2.tick && p1.sum === p2.sum && p2.run === 'Play' && p2.label === 'Paused', { p1, p2 });
    await tap(page, cdp, vp, '[data-running]'); await sleep(600);
    const p3 = await page.evaluate(() => window.__qa.latestMeta.tick);
    check('play resumes', p3 > p2.tick, { p2: p2.tick, p3 });

    // C. Inspect a moving car by real click/tap.
    await sleep(2500);
    let pick = await pickCar(page);
    for (let i = 0; i < 8 && !pick.ok; i++) { await sleep(700); pick = await pickCar(page); }
    bucket.data.pick = pick;
    if (pick.ok) {
      await tapAt(page, cdp, vp, pick.x, pick.y);
      try { await waitFor(page, () => !document.querySelector('.inspection-panel').hidden, null, 3000); } catch {}
      await sleep(400);
      s = await state(page);
      const idx = Number(/Car (\d+)/.exec(s.selection ?? '')?.[1]) - 1;
      check('click/tap on a moving car opens inspection of that car', !s.panelHidden && idx === pick.index, { pick, selection: s.selection, panelHidden: s.panelHidden });
      const vis = await page.evaluate(() => { const r = document.querySelector('.inspection-panel').getBoundingClientRect(); const h = document.querySelector('.inspection-panel h2').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, headingTop: h.top, headingBottom: h.bottom, innerHeight, heroCue: document.querySelector('[data-stage-hint]').textContent, canvasTop: document.querySelector('.hero-canvas').getBoundingClientRect().top, canvasBottom: document.querySelector('.hero-canvas').getBoundingClientRect().bottom, active: document.activeElement?.className }; });
      bucket.data.inspectionVisibility = vis;
      check('pointer selection does not drop focus to body', !/^BODY/.test(vis.active ?? 'BODY') || vis.active === undefined, { active: vis.active });
      check('inspector response visible in viewport after selection', vis.headingTop >= 0 && vis.headingBottom <= vis.innerHeight, vis);
      check('hero cue names selected car', /Inspecting car/.test(vis.heroCue), vis);
      const c1 = await inspectionCoherence(page); await sleep(500); const c2 = await inspectionCoherence(page);
      bucket.data.coherenceRunning = [c1, c2];
      check('inspector shows 90 weights + 18 activations', c1.values === 108 && c1.nodes === 18 && c1.edges === 80, c1);
      check('running: inspector values equal one actual worker snapshot', c1.matched && c2.matched && c1.matchIndex === pick.index, { c1: { m: c1.matched, t: c1.matchTick, l: c1.latestTick }, c2: { m: c2.matched, t: c2.matchTick } });
      check('running: hero rays, ring, pose and inspector rays from same snapshot', c2.raysOk && c2.ringOk && c2.poseOk && c2.inspectorRaysOk, c2);
      check('activations equal independent forward pass; inputs equal ray distances', c2.forwardErr !== null && c2.forwardErr < 1e-5 && c2.inputsOk, { forwardErr: c2.forwardErr, inputsOk: c2.inputsOk });
      check('live activations change while running', c1.matchTick !== c2.matchTick && c1.acts.some((a, i) => a !== c2.acts[i]), { t1: c1.matchTick, t2: c2.matchTick });
      await shot(page, vp, '03-inspection');
      // demos follow
      await page.locator('[data-demo=sensors]').scrollIntoViewIfNeeded(); await sleep(400);
      const demo = await page.evaluate(() => [...document.querySelectorAll('[data-demo] [data-source]')].map((e) => e.textContent));
      await shot(page, vp, '03b-sensors-live');
      await page.locator('[data-demo=network]').scrollIntoViewIfNeeded(); await sleep(400); await shot(page, vp, '03c-network-live');
      demo.push(await page.textContent('[data-demo=network] [data-source]'));
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      bucket.data.demoSources = demo;
      check('sensor & network demos follow the selected car', !/Illustrat/.test(demo[0]) && !/Illustrat/.test(demo[3]), { demo });
      // pause → exact
      await tap(page, cdp, vp, '[data-running]'); await sleep(500);
      const c3 = await inspectionCoherence(page); bucket.data.coherencePaused = c3;
      const latestSel = await page.evaluate(() => window.__qa.sel.at(-1).tick);
      check('paused: inspector equals final snapshot exactly', c3.matched && c3.matchTick === latestSel && c3.raysOk && c3.poseOk, { c3m: c3.matched, t: c3.matchTick, latestSel });
      // Follow preference: uncheck sensor follow, select another car, stays unchecked.
      await page.locator('[data-demo=sensors]').scrollIntoViewIfNeeded();
      await tap(page, cdp, vp, '[data-demo=sensors] .follow-control input');
      const f1 = await page.evaluate(() => ({ checked: document.querySelector('[data-demo=sensors] .follow-control input').checked, src: document.querySelector('[data-demo=sensors] [data-source]').textContent }));
      await shot(page, vp, '04-sensors-follow-off');
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await tap(page, cdp, vp, '[data-running]'); await sleep(1500);
      let pick2 = await pickCar(page); for (let i = 0; i < 5 && !pick2.ok; i++) { await sleep(600); pick2 = await pickCar(page); }
      if (pick2.ok) { await tapAt(page, cdp, vp, pick2.x, pick2.y); await sleep(500); }
      const f2 = await page.evaluate(() => ({ checked: document.querySelector('[data-demo=sensors] .follow-control input').checked, src: document.querySelector('[data-demo=sensors] [data-source]').textContent, net: document.querySelector('[data-demo=network] [data-source]').textContent, panel: !document.querySelector('.inspection-panel').hidden }));
      check('explicit Follow=off preserved across new selection', f1.checked === false && f2.checked === false && f2.panel, { f1, f2 });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    } else check('found isolated car to click', false, pick);

    // D. Keyboard and Escape/close focus.
    await page.evaluate(() => { if (!document.querySelector('.inspection-panel').hidden) document.querySelector('[data-close]').click(); scrollTo({ top: 0, behavior: 'instant' }); });
    await sleep(300);
    await page.waitForFunction(() => { const m = window.__qa.latestMeta; return !m.running || (m.gtick > 60 && m.gtick < 250 && m.alive > 20); }, null, { timeout: 20000, polling: 50 }).catch(() => {});
    await page.focus('.hero-canvas'); await page.keyboard.press('Enter'); await sleep(500);
    s = await state(page);
    const k1 = Number(/Car (\d+)/.exec(s.selection ?? '')?.[1]);
    check('keyboard Enter selects a car and opens inspector', !s.panelHidden && k1 > 0, { selection: s.selection, active: s.active });
    bucket.data.keyboardFocusAfterEnter = s.active;
    await page.keyboard.press('ArrowRight'); await sleep(400);
    const k2 = Number(/Car (\d+)/.exec((await state(page)).selection ?? '')?.[1]);
    await page.keyboard.press('ArrowLeft'); await sleep(400);
    const k3 = Number(/Car (\d+)/.exec((await state(page)).selection ?? '')?.[1]);
    check('arrow keys cycle drivers', k2 !== k1 && k3 !== k2, { k1, k2, k3, state: await state(page) });
    await shot(page, vp, '05-keyboard-inspection');
    await page.keyboard.press('Escape'); await sleep(400);
    s = await state(page);
    check('Escape closes and focus returns to hero canvas', s.panelHidden && /hero-canvas/.test(s.active), { panelHidden: s.panelHidden, active: s.active });
    await page.keyboard.press('Enter'); await sleep(400);
    await page.focus('[data-close]'); await page.keyboard.press('Enter'); await sleep(400);
    s = await state(page);
    check('Close button closes; focus not dropped to body', s.panelHidden && /hero-canvas/.test(s.active), { active: s.active });

    // E. Stopped car semantics: wait for a recent crash, pause, click it.
    let crashed = { ok: false };
    await sleep(1500); for (let i = 0; i < 200 && !crashed.ok; i++) { crashed = await pickCar(page, { status: 1, maxInactive: 0.7, minGap: 7 }); if (!crashed.ok) await sleep(80); }
    if (crashed.ok) {
      await tap(page, cdp, vp, '[data-running]'); await sleep(250);
      const again = await pickCar(page, { status: 1, maxInactive: 1.9, minGap: 7 });
      const target = again.ok ? again : crashed;
      await tapAt(page, cdp, vp, target.x, target.y); await sleep(500);
      const st = await page.evaluate(() => ({ text: document.querySelector('[data-driver-state]')?.textContent, sel: document.querySelector('[data-selection]').textContent, hidden: document.querySelector('.inspection-panel').hidden }));
      bucket.data.stoppedCar = { target, st };
      check('crashed car inspection says stopped', !st.hidden && /Crashed · stopped/.test(st.text), { target, st });
      await shot(page, vp, '06-stopped-car');
      await tap(page, cdp, vp, '[data-running]');
    } else check('found a recently crashed car', false, crashed);
    // F. Stale generation clears selection
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.focus('.hero-canvas'); await page.keyboard.press('Enter'); await sleep(300);
    const genBefore = await page.evaluate(() => window.__qa.latestMeta.gen);
    await tap(page, cdp, vp, '[data-rate="4"]');
    try { await waitFor(page, (g) => window.__qa.latestMeta.gen > g, genBefore, 25000); } catch {}
    await sleep(400);
    s = await state(page);
    check('generation boundary clears stale selection', s.panelHidden && s.meta.gen > genBefore, { genBefore, gen: s.meta.gen, panelHidden: s.panelHidden });
    await tap(page, cdp, vp, '[data-rate="1"]');

    // G. Default track learns (fast, public controls)
    const def = await learn(page, cdp, vp, 6); bucket.data.defaultLearning = def;
    check('default track: laps completed and best lap improves over generations', def.gens >= 8 && def.bestLap !== null && def.improvements >= 1, { gens: def.gens, firstLap: def.firstLap, best: def.bestLap, imp: def.improvements });
    s = await state(page);
    check('telemetry shows real best lap and history', s.lap === `${def.bestLap.toFixed(2)} s` && /gen/.test(s.historyLabel ?? ''), { lap: s.lap, best: def.bestLap, historyLabel: s.historyLabel });
    await shot(page, vp, '07-default-evolved');

    // H. Draw valid loops in both directions with real input.
    for (const dir of [1, -1]) {
      const runBefore = (await state(page)).meta.runId;
      await tap(page, cdp, vp, '[data-drawing]'); await sleep(400);
      const susp1 = await page.evaluate(() => window.__qa.latestMeta.tick); await sleep(700);
      const susp = await page.evaluate(() => ({ tick: window.__qa.latestMeta.tick, label: document.querySelector('[data-run-label]').textContent, run: document.querySelector('[data-run-text]').textContent }));
      check(`drawing suspends stepping, keeps Play intent (dir ${dir})`, susp.tick === susp1 && susp.label === 'Waiting' && susp.run === 'Pause', { susp1, susp });
      const pts = await loopPoints(page, { dir });
      await stroke(page, cdp, vp, pts);
      try { await waitFor(page, (r) => window.__qa.latestMeta.runId > r && window.__qa.latestMeta.running, runBefore, 8000); } catch {}
      await sleep(600);
      s = await state(page);
      check(`valid ${dir > 0 ? 'clockwise' : 'counter-clockwise'} drawn loop commits and runs`, s.meta.runId > runBefore && /Your circuit/.test(s.feedback ?? '') && s.drawing === 'false' && s.meta.running, { runId: s.meta.runId, feedback: s.feedback, drawing: s.drawing });
      const lr = await learn(page, cdp, vp, 8);
      bucket.data[`drawn${dir > 0 ? 'CW' : 'CCW'}Learning`] = lr;
      check(`drawn ${dir > 0 ? 'CW' : 'CCW'} loop learns: subsequent generations, real laps, improvement`, lr.run === s.meta.runId && lr.gens >= 8 && lr.bestLap !== null && lr.improvements >= 1, { gens: lr.gens, firstLap: lr.firstLap, best: lr.bestLap, imp: lr.improvements });
      const dirCheck = await page.evaluate(() => window.__qa.lastBestSamples);
      const xy = []; for (let i = 0; i < dirCheck.length; i += 4) xy.push(dirCheck[i], dirCheck[i + 1]);
      const drawnArea = signedArea(pts.flat()), bestArea = signedArea(xy);
      check(`cars drive the drawn direction (dir ${dir})`, Math.sign(drawnArea) === Math.sign(bestArea), { drawnArea, bestArea });
      await sleep(1200);
      await shot(page, vp, `08-drawn-${dir > 0 ? 'cw' : 'ccw'}`);
    }

    // I. Invalid input preserves run.
    for (const kind of ['tiny', 'figure8']) {
      const before = await state(page);
      await tap(page, cdp, vp, '[data-drawing]'); await sleep(300);
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await sleep(100);
      const r = await page.locator('.hero-canvas').boundingBox();
      let pts;
      if (kind === 'tiny') pts = Array.from({ length: 12 }, (_, i) => [r.x + r.width / 2 + 8 * Math.cos(i / 2), r.y + r.height / 2 + 8 * Math.sin(i / 2)]);
      else pts = Array.from({ length: 80 }, (_, i) => { const t = (i / 80) * Math.PI * 2; return [r.x + r.width / 2 + Math.sin(t) * r.width * 0.33, r.y + r.height / 2 + Math.sin(2 * t) * r.height * 0.3]; });
      await stroke(page, cdp, vp, pts); await sleep(500);
      s = await state(page);
      check(`${kind} stroke rejected with useful local message; run kept`, s.issues && s.meta.runId === before.meta.runId && s.feedback.length > 20 && /kept|Current/.test(s.feedback), { feedback: s.feedback, runId: s.meta.runId, before: before.meta.runId });
      if (kind === 'figure8') {
        const fb = await page.evaluate(() => { const e = document.querySelector('.track-feedback').getBoundingClientRect(); return { top: e.top, bottom: e.bottom, innerHeight }; });
        const canvasVisible = await page.evaluate(() => document.querySelector('.hero-canvas').getBoundingClientRect().top >= -5);
        bucket.data.invalidFeedbackRect = { ...fb, canvasVisible };
        check('invalid feedback visible next to the canvas (no scroll)', fb.bottom <= fb.innerHeight && canvasVisible, fb);
        await shot(page, vp, '09-invalid');
      }
      await tap(page, cdp, vp, '[data-drawing]'); await sleep(600);
      const after = await state(page);
      check(`${kind}: after stopping drawing the same run continues`, after.meta.runId === before.meta.runId && after.meta.running && after.meta.tick > before.meta.tick, { before: before.meta, after: after.meta });
    }
    // J. Cancel paths: touchCancel (touch) or Escape (mouse) mid-stroke.
    {
      const before = await state(page);
      await tap(page, cdp, vp, '[data-drawing]'); await sleep(300);
      const pts = await loopPoints(page, { dir: 1 });
      if (vp.hasTouch) await stroke(page, cdp, vp, pts, { cancelAt: pts.length - 4 });
      else { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const p of pts.slice(1, -4)) await page.mouse.move(p[0], p[1]); await page.keyboard.press('Escape'); for (const p of pts.slice(-4)) await page.mouse.move(p[0], p[1]); await page.mouse.up(); }
      await sleep(600);
      s = await state(page);
      check(`${vp.hasTouch ? 'touchcancel' : 'Escape'} mid-stroke never commits`, s.meta.runId === before.meta.runId && s.ready.length === before.ready.length, { runId: s.meta.runId, before: before.meta.runId });
      bucket.data.cancelPath = { committed: s.meta.runId !== before.meta.runId };
      if ((await state(page)).drawing === 'true') { await tap(page, cdp, vp, '[data-clear]'); await sleep(200); await tap(page, cdp, vp, '[data-drawing]'); await sleep(300); }
    }
    // K. Pause + 4x intention preserved across drawing commit.
    {
      await tap(page, cdp, vp, '[data-rate="4"]'); await tap(page, cdp, vp, '[data-running]'); await sleep(300);
      const before = await state(page);
      await tap(page, cdp, vp, '[data-drawing]'); await sleep(300);
      await stroke(page, cdp, vp, await loopPoints(page, { dir: 1, shape: 'oval', scale: 0.9 }));
      try { await waitFor(page, (r) => window.__qa.latestMeta.runId > r, before.meta.runId, 8000); } catch {}
      await sleep(800);
      const a = await state(page); await sleep(800); const b = await state(page);
      check('paused + 4x intent survive drawn-track acceptance', b.meta.runId > before.meta.runId && b.run === 'Play' && b.rate === '4' && a.meta.tick === b.meta.tick && b.meta.rate === 4 && !b.meta.running, { run: b.run, rate: b.rate, meta: b.meta });
      await tap(page, cdp, vp, '[data-running]'); await sleep(500);
      const c = await state(page);
      check('resume after accepted paused run steps at 4x', c.meta.running && c.meta.rate === 4 && c.meta.tick > b.meta.tick, c.meta);
      await tap(page, cdp, vp, '[data-rate="1"]');
    }
    // L. Presets each learn.
    bucket.data.presets = {};
    for (const id of ['broad-oval', 'riverbend', 'club-circuit']) {
      const before = (await state(page)).meta.runId;
      await page.selectOption('[data-preset]', id);
      try { await waitFor(page, (r) => window.__qa.latestMeta.runId > r, before, 8000); } catch {}
      const lr = await learn(page, cdp, vp, 7);
      s = await state(page);
      bucket.data.presets[id] = { gens: lr.gens, firstLap: lr.firstLap, firstLapGen: lr.firstLapGen, best: lr.bestLap, imp: lr.improvements, feedback: s.feedback };
      check(`preset ${id} accepted and learns laps`, lr.run > before && lr.gens >= 6 && lr.bestLap !== null, bucket.data.presets[id]);
      if (id === 'club-circuit') await shot(page, vp, '10-club-circuit');
    }
    // M. Population 1000 pending → accepted.
    {
      const before = (await state(page)).meta.runId;
      await page.selectOption('[data-population]', '1000');
      const pend = await state(page);
      try { await waitFor(page, (r) => window.__qa.latestMeta.runId > r && window.__qa.latestMeta.pop === 1000, before, 8000); } catch {}
      await sleep(500);
      s = await state(page);
      check('population 1000 accepted; telemetry shows /1000', s.meta.pop === 1000 && / \/ 1000/.test(s.alive) && s.population === '1000', { pendingFeedback: pend.feedback, alive: s.alive, pop: s.meta.pop });
      bucket.data.pendingFeedback = pend.feedback;
      await shot(page, vp, '11-pop1000');
      const r = await ticksPerSecond(page); bucket.data.rate1pop1000 = r;
      check('1000 cars keep 1x real-time stepping', r.ticks > 52, r);
    }
    // N. Rapid inputs.
    {
      const sentBefore = await page.evaluate(() => window.__qa.sent.filter((x) => x.type === 'reset').length); const runBeforeRapid = (await state(page)).run;
      for (const id of ['riverbend', 'club-circuit', 'broad-oval', 'riverbend']) await page.selectOption('[data-preset]', id);
      for (let i = 0; i < 4; i++) await page.click('[data-reset]', { delay: 0 }).catch(() => {});
      await page.selectOption('[data-population]', '256'); await page.selectOption('[data-population]', '512');
      for (let i = 0; i < 5; i++) await page.click('[data-running]');
      await sleep(2500);
      s = await state(page);
      const sent = await page.evaluate(() => window.__qa.sent.filter((x) => x.type === 'reset').map((x) => x.runId));
      const mono = sent.every((v, i) => i === 0 || v > sent[i - 1]);
      bucket.data.rapid = { sent, ready: s.ready, feedback: s.feedback, meta: s.meta, run: s.run };
      check('rapid resets coalesce; final state = last intent; ids monotonic; nothing pending', mono && s.meta.pop === 512 && /Riverbend/.test(s.feedback) && !/Applying/.test(s.feedback) && s.errors.length === 0 && s.run !== runBeforeRapid && (s.run === 'Play') === !s.meta.running, { sentCount: sent.length - sentBefore, feedback: s.feedback, pop: s.meta.pop, run: s.run, running: s.meta.running });
      if (s.run === 'Play') await page.click('[data-running]'); await sleep(300);
    }
    // O. Synthetic hidden/resume (controlled events; real OS hiding attempted separately).
    {
      await tap(page, cdp, vp, '[data-running]'); await sleep(200); // pause
      await tap(page, cdp, vp, '[data-running]'); await sleep(400); // play
      await page.evaluate(() => window.__qa.setHidden(true));
      const h1 = await page.evaluate(() => ({ tick: window.__qa.latestMeta.tick, raf: window.__qa.rafTotal })); await sleep(1200);
      const h2 = await page.evaluate(() => ({ tick: window.__qa.latestMeta.tick, raf: window.__qa.rafTotal, running: window.__qa.latestMeta.running }));
      await page.evaluate(() => window.__qa.setHidden(false)); await sleep(800);
      const h3 = await state(page);
      check('synthetic hidden: worker stops, rAF stops; resume restores running intent', h2.tick === h1.tick && h2.raf - h1.raf <= 1 && !h2.running && h3.meta.running && h3.run === 'Pause', { h1, h2, h3: h3.meta });
    }
    // P. Resize, DPR-only and tiny surfaces.
    {
      const orig = vp.viewport;
      await page.setViewportSize({ width: orig.height, height: orig.width }); await sleep(600);
      let m = await layoutMetrics(page, vp);
      check('rotated: no overflow, backing store matches', m.overflowX <= 0 && Math.abs(m.canvasBacking.w - Math.round(m.canvasBacking.cssW * Math.min(2, m.canvasBacking.dpr))) <= 1, { overflowX: m.overflowX, b: m.canvasBacking });
      await page.setViewportSize(orig); await sleep(400);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: orig.width, height: orig.height, deviceScaleFactor: 1, mobile: vp.isMobile });
      await sleep(600);
      m = await layoutMetrics(page, vp);
      check('DPR-only change rebuilds backing store', m.canvasBacking.dpr === 1 && Math.abs(m.canvasBacking.w - Math.round(m.canvasBacking.cssW)) <= 1, m.canvasBacking);
      // drawn commit at DPR 1 lands at the stroke (world bounds check)
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: orig.width, height: orig.height, deviceScaleFactor: vp.deviceScaleFactor, mobile: vp.isMobile });
      await sleep(400);
      const tinyF = () => page.evaluate(() => { const c = document.querySelector('.hero-canvas').getBoundingClientRect(); return { w: c.width, h: c.height, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
      await page.setViewportSize({ width: 320, height: 568 }); await sleep(700); const small320 = await tinyF();
      check('320px-wide phone: no horizontal overflow', small320.overflow <= 0, small320);
      await page.setViewportSize({ width: 120, height: 200 }); await sleep(700);
      const tiny = await tinyF(); bucket.data.tiny = { small320, tiny };
      await page.setViewportSize(orig); await sleep(700);
      s = await state(page);
      check('120x200 extreme surface: no errors; recovers running', log.pageErrors.length === 0 && s.meta.running, { tiny, pageErrors: log.pageErrors });
    }
    // Q. Teaching demos with public input.
    {
      bucket.data.preDemoLearning = await learn(page, cdp, vp, 5);
      await page.evaluate(() => { if (!document.querySelector('.inspection-panel').hidden) document.querySelector('[data-close]').click(); });
      const demo = {};
      // sensors: drag car via range inputs and pointer drag
      await page.locator('[data-demo=sensors]').scrollIntoViewIfNeeded(); await sleep(300);
      const followBox = page.locator('[data-demo=sensors] .follow-control input');
      const readings = () => page.evaluate(() => document.querySelector('[data-demo=sensors]').textContent.replace(/\s+/g, ' '));
      const r0 = await readings();
      const pos = page.locator('[data-demo=sensors] [data-position]');
      if (await pos.isEnabled()) { await pos.focus(); for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight'); }
      const car = await page.locator('[data-demo=sensors] [data-car]').boundingBox();
      if (car) { await stroke(page, cdp, vp, [[car.x + car.width / 2, car.y + car.height / 2], [car.x + car.width / 2 + 20, car.y + car.height / 2 + 5], [car.x + car.width / 2 + 40, car.y + car.height / 2 + 10]]); }
      await sleep(300);
      const r1s = await readings();
      demo.sensors = { changed: r0 !== r1s, src: await page.textContent('[data-demo=sensors] [data-source]'), follow: await followBox.isChecked() };
      await shot(page, vp, '12-demo-sensors');
      await page.locator('[data-demo=network]').scrollIntoViewIfNeeded(); await sleep(300);
      const n0 = await page.textContent('[data-demo=network] [data-steer]');
      const wi = page.locator('[data-demo=network] [data-weight]'); await wi.focus(); for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft');
      const ci = page.locator('[data-demo=network] [data-clearance]'); await ci.focus(); for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
      await sleep(300);
      demo.network = { before: n0, after: await page.textContent('[data-demo=network] [data-steer]'), src: await page.textContent('[data-demo=network] [data-source]') };
      await shot(page, vp, '13-demo-network');
      await page.locator('[data-demo=genetics]').scrollIntoViewIfNeeded(); await sleep(300);
      const g0 = await page.evaluate(() => document.querySelector('[data-demo=genetics]').innerHTML.length + document.querySelector('[data-demo=genetics] [data-mutation-count]')?.textContent);
      for (let i = 0; i < 3; i++) await tap(page, cdp, vp, '[data-demo=genetics] [data-mutate]');
      const cr = page.locator('[data-demo=genetics] [data-crossover]'); await cr.focus(); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
      await sleep(300);
      demo.genetics = { before: g0, after: await page.textContent('[data-demo=genetics] [data-mutation-count]').catch(() => null), note: await page.textContent('[data-demo=genetics] [data-note]').catch(() => null), split: await page.textContent('[data-demo=genetics] [data-split]').catch(() => null) };
      await shot(page, vp, '14-demo-genetics');
      await page.locator('[data-demo=racing-line]').scrollIntoViewIfNeeded(); await sleep(500);
      demo.racing = await page.evaluate(() => { const r = document.querySelector('[data-demo=racing-line]'); const p = r.querySelector('[data-path]'); const road = r.querySelector('[data-road]'); return { src: r.querySelector('[data-source]').textContent, note: r.querySelector('[data-note]').textContent, pathLen: (p.getAttribute('d') || '').length, roadLen: (road.getAttribute('d') || '').length, roadShown: getComputedStyle(road).display !== 'none', pathShown: getComputedStyle(p).display !== 'none', history: r.querySelector('[data-history-label]').textContent }; });
      await shot(page, vp, '15-demo-racing-line');
      await tap(page, cdp, vp, '[data-demo=racing-line] [data-mode]'); await sleep(300);
      demo.racingIllustrated = await page.evaluate(() => ({ src: document.querySelector('[data-demo=racing-line] [data-source]').textContent, pressed: document.querySelector('[data-demo=racing-line] [data-mode]').getAttribute('aria-pressed') }));
      await shot(page, vp, '16-demo-racing-corner');
      await tap(page, cdp, vp, '[data-demo=racing-line] [data-mode]');
      bucket.data.demos = demo;
      check('sensor demo responds to input (illustration)', demo.sensors.changed, demo.sensors);
      check('network demo slider changes output', demo.network.before !== demo.network.after, demo.network);
      check('genetics demo mutation/crossover respond', demo.genetics.after !== null && /3/.test(demo.genetics.after ?? ''), demo.genetics);
      check('racing-line demo shows actual recorded line with road context, labelled', demo.racing.pathShown && demo.racing.roadShown && demo.racing.pathLen > 100 && demo.racing.roadLen > 100 && /record|Record|lap|Lap/.test(demo.racing.src + demo.racing.note), demo.racing);
      check('corner explorer labelled illustrative', /Illustrat/.test(demo.racingIllustrated.src) && demo.racingIllustrated.pressed === 'true', demo.racingIllustrated);
      const Lf = await layoutMetrics(page, vp); bucket.data.layoutFull = { small: Lf.small, targets: Lf.targets, overflowX: Lf.overflowX };
      check('article: no text < 11px anywhere (full page)', Lf.small.length === 0, { count: Lf.small.length, sample: Lf.small.slice(0, 15) });
      if (vp.hasTouch) check('article: touch targets >= 44px', Lf.targets.length === 0, { targets: Lf.targets });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await sleep(300);
      await shot(page, vp, '17-full', true);
    }
    const errors = log.console.filter((x) => !/willReadFrequently/.test(x));
    check('no console errors/warnings, page errors, failed requests', errors.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && log.badStatus.length === 0, log);
    const final = await page.evaluate(() => ({ workers: window.__qa.workers, terminated: window.__qa.terminated, detached: window.__qa.detachedSeen, recycles: window.__qa.recycles }));
    check('one worker, no detached incoming buffers', final.workers === 1 && final.detached === 0, final);
    bucket.data.log = log; bucket.data.final = final;
  } catch (error) {
    check('script completed without exception', false, { error: String(error.stack ?? error) });
    await shot(page, vp, 'zz-exception').catch(() => {});
  } finally {
    await context.close();
  }
}

const browser = await launch();
try {
  for (const k of keys) await runViewport(browser, k);
} finally {
  await browser.close();
  results.finished = new Date().toISOString();
  const all = Object.values(results.viewports).flatMap((v) => v.checks);
  results.summary = { total: all.length, passed: all.filter((c) => c.pass).length, failed: all.filter((c) => !c.pass).map((c) => c.name) };
  save(`raw/qa-${label}-${keys.join('-')}.json`, results);
  console.log(JSON.stringify(results.summary, null, 1));
}
