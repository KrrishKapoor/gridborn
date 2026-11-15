// Final QA main public-input suite. Usage: node main.mjs <url> <prod|dev> [desktop|portrait|landscape]
import { launch, open, VIEWPORTS, sleep, stage, ui, qa, shot, Recorder, save, stroke, ellipse, press, tap, waitFor, toCss } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4394/', mode = process.argv[3] || 'prod', only = process.argv[4];
const b = await launch();
const out = [];
const SENSOR_ANGLES = [-Math.PI / 2, -Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3, Math.PI / 2];
const lastRun = (p) => p.evaluate(() => __qa.last?.runId);
const nResets = (p) => p.evaluate(() => __qa.resets.length);
async function waitReady(page, n) { await waitFor(page, (k) => __qa.events.ready.length >= k && __qa.last && __qa.last.runId === __qa.events.ready.at(-1).runId, n, 20000); }
async function ensureDrawing(page, cdp, vp, on) { if (((await ui(page)).drawingPressed === 'true') !== on) { await press(page, cdp, vp, '[data-drawing]'); await sleep(200); } }
function signedArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
function figure8() { const p = []; for (let i = 0; i <= 120; i++) { const t = -Math.PI / 2 + (i / 120) * 2 * Math.PI; p.push({ x: 600 + 380 * Math.sin(2 * (t + Math.PI / 2)) / 2 * 2, y: 400 + 250 * Math.cos(t + Math.PI / 2) }); } return p; }
function lobeTail() { // full oval then a tail that loops across the start region (crossing, not a simple overshoot)
  const p = ellipse(600, 400, 380, 240, { n: 90 }); const s = p[0];
  for (let i = 1; i <= 20; i++) { const a = (i / 20) * 2 * Math.PI; p.push({ x: s.x + 60 * Math.sin(a), y: s.y + 60 - 60 * Math.cos(a) + 40 }); }
  return p;
}
function doubleLap() { return ellipse(600, 400, 380, 240, { n: 90, overshoot: 0.9 }); }
async function runFast(page, cdp, vp, gens, timeoutMs = 90000) {
  await press(page, cdp, vp, '[data-rate="fast"]');
  const run = await lastRun(page);
  await waitFor(page, ([r, g]) => __qa.events.generation.filter((e) => e.runId === r).length >= g, [run, gens], timeoutMs).catch(() => {});
  await press(page, cdp, vp, '[data-rate="1"]'); await sleep(300);
  return page.evaluate((r) => ({ gens: __qa.events.generation.filter((e) => e.runId === r).map(({ generation, bestLapSeconds, completedLaps, bestFitness, meanFitness, ticks }) => ({ generation, bestLapSeconds, completedLaps, bestFitness, meanFitness, ticks })),
    best: __qa.events.best.filter((e) => e.car.runId === r).map(({ car, lapSeconds, fitness, n, samples }) => ({ car, lapSeconds, fitness, n, first: samples.slice(0, 2), area: (() => { let a = 0; const m = samples.length / 4; for (let i = 0; i < m; i++) { const j = (i + 1) % m; a += samples[i * 4] * samples[j * 4 + 1] - samples[j * 4] * samples[i * 4 + 1]; } return a / 2; })() })) }), run);
}
function summarizeLearning(h) {
  const laps = h.gens.map((g) => g.bestLapSeconds).filter((x) => x != null);
  const firstLapGen = h.gens.find((g) => g.bestLapSeconds != null)?.generation ?? null;
  const records = h.best.filter((x) => x.lapSeconds != null).map((x) => +x.lapSeconds.toFixed(3));
  return { generations: h.gens.length, firstLapGen, firstLap: laps[0] ?? null, bestLap: laps.length ? Math.min(...laps) : null, lapRecords: records, completedFirst: h.gens[0]?.completedLaps, completedLast: h.gens.at(-1)?.completedLaps, meanFirst: h.gens[0]?.meanFitness, meanLast: h.gens.at(-1)?.meanFitness };
}
function forward(w, inputs) {
  const hidden = [], outp = [];
  for (let d = 0; d < 8; d++) { let s = w[d * 9 + 8]; for (let i = 0; i < 8; i++) s += w[d * 9 + i] * inputs[i]; hidden.push(Math.tanh(s)); }
  for (let o = 0; o < 2; o++) { let s = w[80 + o * 9]; for (let i = 0; i < 8; i++) s += w[72 + o * 9 + i] * hidden[i]; outp.push(Math.tanh(s)); }
  return [...inputs, ...hidden, ...outp];
}
try {
  for (const [key, vp] of Object.entries(VIEWPORTS)) {
    if (only && only !== key) continue;
    const R = new Recorder(`${mode} ${vp.name} main`), tag = `${mode}-${vp.name}`;
    const { page, log, context, cdp } = await open(b, url, vp);
    const learning = {};
    const section = async (name, fn) => { try { await fn(); } catch (e) { R.check(`${name} (section completed without exception)`, false, { error: String(e).slice(0, 300) }); try { await page.keyboard.press('Escape'); } catch {} } };
    await section('initial hero', async () => {
      await waitReady(page, 1);
      const t0 = await page.evaluate(() => __qa.last.tick); await sleep(1500);
      const s = await qa(page), u = await ui(page);
      R.check('hero autostarts: 512 cars, running at 1x, ticks advancing', s.last.population === 512 && s.last.running && s.last.rate === 1 && s.last.tick - t0 > 60, { ticks: s.last.tick - t0, u });
      R.check('hero visible above the fold at this viewport', await page.evaluate(() => { const r = document.querySelector('.hero-canvas').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
      R.check('one module worker from built/served asset', s.workers === 1 && (await page.evaluate(() => __qa.workerType)) === 'module', { url: await page.evaluate(() => __qa.workerUrl) });
      R.check(`diagnostics global ${mode === 'prod' ? 'absent' : 'present'}`, (await page.evaluate(() => '__gridborn' in window)) === (mode === 'dev'));
      await shot(page, `${tag}-01-hero`);
    });
    // ---- Drawing: valid (both directions, overshoot, jitter) ----
    await section('drawing', async () => {
      const cases = [
        ['cw', ellipse(600, 400, 400, 250, { n: 90 }), {}],
        ['ccw', ellipse(600, 400, 400, 250, { n: 90, clockwise: false }), {}],
        ['cw-overshoot-120', ellipse(600, 400, 400, 250, { n: 90, overshoot: 0.06 }), {}],
        ['ccw-overshoot-150', ellipse(600, 400, 380, 240, { n: 90, clockwise: false, overshoot: 0.075 }), {}],
        ['cw-jitter-1px-a', ellipse(600, 400, 400, 250, { n: 120 }), { jitterCss: 1, seed: 11 }],
        ['ccw-jitter-1px-b', ellipse(600, 400, 390, 245, { n: 120, clockwise: false }), { jitterCss: 1, seed: 23 }],
        ['cw-jitter-1px-overshoot', ellipse(600, 400, 400, 250, { n: 120, overshoot: 0.06 }), { jitterCss: 1, seed: 5 }],
      ];
      learning.drawResults = {};
      for (const [name, pts, opt] of cases) {
        await ensureDrawing(page, cdp, vp, true);
        const r0 = await nResets(page);
        const css = await stroke(page, cdp, vp, pts, opt); await sleep(400);
        const r1 = await nResets(page), u = await ui(page);
        let detail = { committed: r1 > r0, feedback: u.feedback };
        if (r1 > r0) {
          await waitReady(page, (await page.evaluate(() => __qa.events.ready.length)) );
          const rs = await page.evaluate(() => __qa.resets.at(-1));
          // drawn direction preserved: signed area of committed centreline vs stroke
          const cl = []; for (let i = 0; i < rs.centerline.length; i += 2) cl.push({ x: rs.centerline[i], y: rs.centerline[i + 1] });
          detail = { ...detail, trackId: rs.trackId, length: rs.length, sameDirection: Math.sign(signedArea(cl)) === Math.sign(signedArea(pts)), bounds: rs.bounds };
        } else await press(page, cdp, vp, '[data-clear]');
        learning.drawResults[name] = detail;
        const mustPass = !name.includes('jitter');
        R.check(`draw ${name}: ${mustPass ? 'accepted' : 'accepted (jitter; accepted-low limit if rejected)'}`, mustPass ? detail.committed && detail.sameDirection : true, detail);
        if (name === 'cw') await shot(page, `${tag}-02-drawn-cw-gen1`);
      }
      const jit = Object.entries(learning.drawResults).filter(([n]) => n.includes('jitter'));
      R.check('jitter strokes: at least 2/3 accepted (T1R)', jit.filter(([, d]) => d.committed).length >= 2, Object.fromEntries(jit.map(([n, d]) => [n, d.committed])));
    });
    // ---- Invalid strokes preserve previous valid track ----
    await section('invalid', async () => {
      await ensureDrawing(page, cdp, vp, false);
      const runBefore = await lastRun(page), label = (await ui(page)).feedback;
      const invalid = [['tiny', ellipse(600, 400, 30, 20, { n: 40 })], ['figure-eight', figure8()], ['crossing-lobe-tail', lobeTail()], ['double-lap-retrace', doubleLap()],
        ['out-of-world', ellipse(600, 400, 650, 250, { n: 90 })], ['open-line', [{ x: 200, y: 400 }, { x: 1000, y: 400 }].flatMap((p, i, a) => i ? Array.from({ length: 40 }, (_, k) => ({ x: a[0].x + (p.x - a[0].x) * k / 39, y: 400 })) : [])]];
      learning.invalid = {};
      for (const [name, pts] of invalid) {
        await ensureDrawing(page, cdp, vp, true);
        const r0 = await nResets(page); await stroke(page, cdp, vp, pts); await sleep(350);
        const u = await ui(page), r1 = await nResets(page);
        learning.invalid[name] = { rejected: r1 === r0, feedback: u.feedback };
        R.check(`invalid ${name} rejected with feedback; previous run kept`, r1 === r0 && (await lastRun(page)) === runBefore && u.feedback && !/^Current: [^.]+\. Draw a loop/.test(u.feedback), learning.invalid[name]);
        if (name === 'figure-eight') await shot(page, `${tag}-03-invalid-figure8`);
      }
      await press(page, cdp, vp, '[data-clear]'); await ensureDrawing(page, cdp, vp, false);
      R.check('after rejections the previous circuit still runs', (await qa(page)).last.running && (await lastRun(page)) === runBefore, { label });
    });
    // ---- Draw a fresh CW circuit and watch it learn (actual laps) ----
    await section('drawn learning', async () => {
      await ensureDrawing(page, cdp, vp, true);
      const shape = ellipse(600, 400, 420, 250, { n: 100 }).map((p, i) => ({ x: p.x + 50 * Math.sin(i / 100 * 4 * Math.PI) * (p.y > 400 ? 1 : 0), y: p.y })); // bean-ish
      const r0 = await nResets(page); await stroke(page, cdp, vp, shape); await sleep(300);
      R.check('custom bean circuit committed', (await nResets(page)) === r0 + 1, { fb: (await ui(page)).feedback });
      await waitReady(page, await page.evaluate(() => __qa.events.ready.length));
      const h = await runFast(page, cdp, vp, 18);
      const s = summarizeLearning(h); learning.drawnBean = { ...s, history: h.gens, best: h.best.map(({ first, ...x }) => x) };
      R.check('drawn circuit: cars complete real laps after evolving', s.bestLap != null, s);
      R.check('drawn circuit: best lap improves across generations', s.bestLap != null && s.firstLap != null && s.bestLap < s.firstLap && s.lapRecords.length >= 2, s);
      R.check('drawn circuit: best trajectory drives the drawn (clockwise) direction', h.best.length && h.best.every((x) => Math.sign(x.area) === Math.sign(signedArea(shape))));
      await sleep(1500); await shot(page, `${tag}-04-drawn-evolved-best-line`);
      const u = await ui(page);
      R.check('telemetry best lap equals min actual generation lap', u.lap === s.bestLap?.toFixed(2) || (u.lap && Math.abs(parseFloat(u.lap) - s.bestLap) < 0.006), { ui: u.lap, actual: s.bestLap });
      R.check('sparkline/history label reflects completed generations', /\d+ gen/.test(u.history), { history: u.history });
    });
    // ---- Presets ----
    await section('presets', async () => {
      const names = await page.evaluate(() => [...document.querySelectorAll('[data-preset] option')].map((o) => [o.value, o.textContent]));
      for (const [value, label] of names.filter(([v]) => v)) {
        const r0 = await nResets(page); await page.selectOption('[data-preset]', value); await sleep(200);
        await waitReady(page, await page.evaluate(() => __qa.events.ready.length + 0)).catch(() => {});
        await sleep(600);
        const rs = await page.evaluate(() => __qa.resets.at(-1)), u = await ui(page);
        R.check(`preset ${label} loads and runs`, (await nResets(page)) === r0 + 1 && rs.trackId === value && u.feedback.includes(label) && (await qa(page)).last.runId === rs.runId, { fb: u.feedback });
      }
      await shot(page, `${tag}-05-preset-last`);
    });
    // ---- Controls ----
    await section('controls', async () => {
      await press(page, cdp, vp, '[data-running]'); await sleep(400);
      const t1 = (await qa(page)).last.tick; await sleep(700); const t2 = (await qa(page)).last.tick, u = await ui(page);
      R.check('pause freezes ticks and labels Paused', t1 === t2 && u.runLabel === 'Paused' && u.running === 'false', { t1, t2, u: u.runLabel });
      await press(page, cdp, vp, '[data-running]'); await sleep(600);
      R.check('play resumes', (await qa(page)).last.tick > t2 && (await ui(page)).runLabel === 'Running');
      await press(page, cdp, vp, '[data-rate="4"]'); await sleep(300);
      const a = await page.evaluate(() => ({ t: performance.now(), tick: __qa.last.tick, n: __qa.snapshots })); await sleep(2000);
      const c = await page.evaluate(() => ({ t: performance.now(), tick: __qa.last.tick, n: __qa.snapshots }));
      const sps = (c.tick - a.tick) / ((c.t - a.t) / 1000);
      R.check('4x ~240 steps/s', sps > 200 && sps < 260, { sps: +sps.toFixed(1), snaps: (c.n - a.n) / 2 });
      await press(page, cdp, vp, '[data-rate="fast"]'); await sleep(1500);
      const f0 = await page.evaluate(() => ({ t: performance.now(), tick: __qa.last.tick, n: __qa.snapshots, cars: __qa.lastFrameAt })); await sleep(2000);
      const f1 = await page.evaluate(() => ({ t: performance.now(), tick: __qa.last.tick, n: __qa.snapshots, cars: __qa.lastFrameAt }));
      const fsps = (f1.tick - f0.tick) / ((f1.t - f0.t) / 1000);
      R.check('fast: headless (no car draws) and much faster than 4x', f1.cars === f0.cars && fsps > 600, { stepsPerSec: Math.round(fsps), snapsPerSec: (f1.n - f0.n) / 2 });
      R.check('fast: canvas explains cars are hidden', /Headless|Learning ahead/.test((await ui(page)).hint + (await ui(page)).runLabel), await ui(page));
      await shot(page, `${tag}-06-fast-headless`);
      await press(page, cdp, vp, '[data-rate="1"]'); await sleep(1500);
      const o0 = await page.evaluate(() => ({ t: performance.now(), tick: __qa.last.tick })); await sleep(1500); const o1 = await page.evaluate(() => ({ t: performance.now(), tick: __qa.last.tick }));
      R.check('1x ~60 steps/s', Math.abs((o1.tick - o0.tick) / ((o1.t - o0.t) / 1000) - 60) < 8);
      // rapid controls
      for (let i = 0; i < 7; i++) await press(page, cdp, vp, '[data-running]');
      for (const r of ['4', 'fast', '1', '4', '1']) await press(page, cdp, vp, `[data-rate="${r}"]`);
      await sleep(800);
      const fin = await ui(page), q = await qa(page);
      R.check('rapid play/rate input converges to last intent (paused, 1x)', fin.running === 'false' && fin.rate === '1' && q.last.running === false && q.last.rate === 1, { fin: [fin.running, fin.rate], worker: [q.last.running, q.last.rate] });
      await press(page, cdp, vp, '[data-running]'); await sleep(300);
      // population 1000
      const r0 = await nResets(page); await page.selectOption('[data-population]', '1000'); await sleep(200);
      await waitFor(page, () => __qa.last?.population === 1000, null, 20000);
      await sleep(1000);
      R.check('population 1000 accepted and running', (await qa(page)).last.population === 1000 && (await ui(page)).alive.includes('/ 1000') && (await nResets(page)) === r0 + 1, { alive: (await ui(page)).alive });
      await shot(page, `${tag}-07-pop1000`);
      await page.selectOption('[data-population]', '512'); await waitFor(page, () => __qa.last?.population === 512, null, 20000);
      // rapid presets/resets coalesce
      const before = await page.evaluate(() => __qa.resets.length);
      await page.selectOption('[data-preset]', 'riverbend'); await page.selectOption('[data-preset]', 'club-circuit'); await press(page, cdp, vp, '[data-reset]'); await page.selectOption('[data-preset]', 'broad-oval');
      await sleep(2500);
      const rs = await page.evaluate(() => __qa.resets.map((r) => [r.runId, r.trackId])), last = await qa(page);
      const ids = rs.map((r) => r[0]);
      R.check('rapid preset/reset input: monotonic IDs, final run is the last intent', ids.every((v, i) => !i || v > ids[i - 1]) && rs.at(-1)[1] === 'broad-oval' && last.last.runId === rs.at(-1)[0] && !(await ui(page)).feedback.includes('Applying'), { sent: rs.slice(before - rs.length) });
    });
    // ---- Inspection (pointer) ----
    await section('inspection', async () => {
      await waitFor(page, () => __qa.last && __qa.last.generationTick > 120 && __qa.last.alive > 20, null, 30000);
      await press(page, cdp, vp, '[data-running]'); await sleep(500); // pause for a stable target
      await page.locator('.track-stage').scrollIntoViewIfNeeded();
      const st = await stage(page);
      const target = await page.evaluate(() => {
        const c = __qa.lastFrameCars, s = __qa.last, cars = s.cars, pick = [];
        for (let k = 0; k < c.length; k += 2) {
          let idx = -1; for (let i = 0; i < s.population; i++) if (Math.abs(cars[i * 8] - c[k]) < 0.01 && Math.abs(cars[i * 8 + 1] - c[k + 1]) < 0.01 && cars[i * 8 + 7] === 0) { idx = i; break; }
          if (idx < 0) continue; let near = 0;
          for (let m = 0; m < c.length; m += 2) if (m !== k && Math.hypot(c[m] - c[k], c[m + 1] - c[k + 1]) < 60) near++;
          pick.push({ idx, x: c[k], y: c[k + 1], near });
        }
        pick.sort((a, b) => a.near - b.near); return pick[0];
      });
      const p = toCss(st, target);
      await tap(page, cdp, vp, p.x, p.y);
      await waitFor(page, (i) => __qa.lastSelected && __qa.lastSelected.selected?.index === i, target.idx, 5000).catch(() => {});
      await sleep(400);
      const sel = await page.evaluate(() => __qa.lastSelected), u = await ui(page);
      R.check('tap/click on a drawn car selects exactly that car', sel?.selected?.index === target.idx, { target, got: sel?.selected });
      R.check('inspector shown with car number and hero cue', !u.inspectionHidden && u.selection.includes(String(target.idx + 1)) && /Inspecting car/.test(u.hint), { sel: u.selection, hint: u.hint });
      // NN and ray correctness against the exact worker snapshot
      const fw = forward(sel.weights, sel.activations.slice(0, 8));
      const err = Math.max(...fw.map((v, i) => Math.abs(v - sel.activations[i])));
      R.check('activations equal an independent tanh forward pass of the actual weights', err < 1e-5, { err });
      const at = target.idx * 8, cx = sel.cars[at], cy = sel.cars[at + 1], hd = sel.cars[at + 2];
      let rayErr = 0, inputErr = 0;
      for (let i = 0; i < 7; i++) { const d = sel.sensors[i * 3], ex = cx + d * 180 * Math.cos(hd + SENSOR_ANGLES[i]), ey = cy + d * 180 * Math.sin(hd + SENSOR_ANGLES[i]);
        rayErr = Math.max(rayErr, Math.hypot(ex - sel.sensors[i * 3 + 1], ey - sel.sensors[i * 3 + 2])); inputErr = Math.max(inputErr, Math.abs(d - sel.activations[i])); }
      R.check('7 ray endpoints consistent with car pose/heading and distances; inputs = distances', rayErr < 0.05 && inputErr < 1e-6, { rayErr, inputErr });
      const dom = await page.evaluate(() => ({ titles: [...document.querySelectorAll('.inspection-root line title')].map((t) => t.textContent).slice(0, 80), steer: document.querySelector('[data-steer]').textContent, thr: document.querySelector('[data-throttle]').textContent, state: document.querySelector('[data-driver-state]').textContent }));
      const w0 = parseFloat(dom.titles[0].replace('Weight ', ''));
      R.check('inspector edges show actual weights; outputs shown', dom.titles.length === 80 && Math.abs(w0 - sel.weights[0]) < 0.0006 && dom.steer.includes(sel.activations[16].toFixed(2).replace('-0.00', '0.00').replace(/^(?!-)/, '')), { w0, actual: sel.weights[0], steer: dom.steer, thr: dom.thr, state: dom.state });
      // Hero draws the rays: arc endpoints are translate-free; check a selection ring by pixel at car
      await shot(page, `${tag}-08-inspection`);
      await page.locator('.track-stage').scrollIntoViewIfNeeded(); await shot(page, `${tag}-08b-selected-in-hero`);
      // Live while running
      await press(page, cdp, vp, '[data-running]'); await sleep(600);
      const a1 = await page.evaluate(() => __qa.lastSelected?.activations.slice()); await sleep(500); const a2 = await page.evaluate(() => __qa.lastSelected?.activations.slice());
      const still = await page.evaluate(() => __qa.last.selected);
      const status = await page.evaluate(() => { const s = __qa.lastSelected; return s && s.selected ? s.cars[s.selected.index * 8 + 7] : null; });
      const domState = await page.evaluate(() => document.querySelector('[data-driver-state]').textContent);
      R.check('inspection updates live while running (driving car), or shows stopped state honestly', !still || (a1 && a2 && a1.some((v, i) => v !== a2[i])) || (status !== 0 && /stopped/.test(domState)), { still: !!still, status, domState });
      // Close button returns focus to hero
      if (still) {
        await page.locator('[data-close]').click(); await sleep(300);
        R.check('Close hides inspector and focuses hero', (await ui(page)).inspectionHidden && (await ui(page)).active === 'hero-canvas');
      }
    });
    // ---- Keyboard inspection ----
    await section('keyboard', async () => {
      await waitFor(page, () => __qa.last && __qa.last.generationTick > 60 && __qa.last.alive > 20, null, 30000);
      await page.locator('.hero-canvas').focus();
      await page.keyboard.press('Enter'); await sleep(400);
      const s1 = await page.evaluate(() => __qa.last.selected), u1 = await ui(page);
      R.check('keyboard Enter selects a driving car and focuses Close', s1 && !u1.inspectionHidden && /quiet-button|BUTTON/.test(u1.active), { s1, active: u1.active });
      await page.keyboard.press('ArrowRight'); await sleep(300);
      const s2 = await page.evaluate(() => __qa.last.selected);
      const k1 = await page.evaluate(() => ({ a: __qa.lastSelected?.activations.slice(), st: __qa.lastSelected?.cars[__qa.lastSelected.selected.index * 8 + 7] })); await sleep(250);
      const k2 = await page.evaluate(() => ({ a: __qa.lastSelected?.activations.slice(), st: __qa.lastSelected?.cars[__qa.lastSelected.selected.index * 8 + 7], sel: __qa.last.selected }));
      R.check('keyboard-selected driving car: activations change live while running', k2.sel && k1.st === 0 && k2.st === 0 ? k1.a.some((v, i) => v !== k2.a[i]) : true, { st: [k1.st, k2.st], sel: !!k2.sel });
      R.check('ArrowRight cycles to another car (or same if only one alive)', s2 && (s2.index !== s1.index || (await qa(page)).last.alive <= 1), { s1: s1?.index, s2: s2?.index });
      if (key === 'desktop') await shot(page, `${tag}-09-keyboard-inspection`);
      await page.keyboard.press('Escape'); await sleep(300);
      const u3 = await ui(page);
      R.check('Escape closes inspection and restores hero focus with visible ring', u3.inspectionHidden && u3.active === 'hero-canvas' && u3.activeFocusVisible, { u3: [u3.inspectionHidden, u3.active, u3.activeFocusVisible] });
    });
    // ---- DPR / rotation / tiny ----
    await section('resize', async () => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.touch }); await sleep(500);
      const b1 = await page.evaluate(() => { const c = document.querySelector('.hero-canvas'), r = c.getBoundingClientRect(); return [c.width, Math.round(r.width * Math.min(2, devicePixelRatio))]; });
      R.check('DPR-only change rebuilds hero backing store', b1[0] === b1[1], { b1 });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.height, height: vp.width, deviceScaleFactor: vp.dpr, mobile: vp.touch }); await sleep(600);
      const rot = await ui(page);
      R.check('rotation: no overflow, still running, no errors', rot.overflowX === 0 && (await qa(page)).last.running && !log.pageErrors.length);
      await shot(page, `${tag}-10-rotated`);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true }); await sleep(500);
      R.check('320x568: no horizontal overflow', (await ui(page)).overflowX === 0);
      await cdp.send('Emulation.clearDeviceMetricsOverride'); await page.setViewportSize({ width: vp.width, height: vp.height }); await sleep(600);
    });
    // ---- Controlled visibility ----
    await section('visibility', async () => {
      const setHidden = (h) => page.evaluate((hid) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hid }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hid ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, h);
      await setHidden(true); await sleep(400);
      const h0 = await page.evaluate(() => ({ tick: __qa.last.tick, raf: __qa.rafCount })); await sleep(1200);
      const h1 = await page.evaluate(() => ({ tick: __qa.last.tick, raf: __qa.rafCount }));
      R.check('controlled hidden: worker ticks stop and rAF loop stops', h1.tick === h0.tick && h1.raf - h0.raf <= 2, { h0, h1 });
      await setHidden(false); await sleep(800);
      R.check('controlled visible: running intent resumes without catch-up burst', (await qa(page)).last.running && (await page.evaluate(() => __qa.last.tick)) - h1.tick < 120, { dt: (await page.evaluate(() => __qa.last.tick)) - h1.tick });
      await page.evaluate(() => { delete document.hidden; delete document.visibilityState; });
    });
    // ---- Demos ----
    await section('demos', async () => {
      const res = {};
      await page.evaluate(() => scrollTo(0, 0));
      if ((await ui(page)).running === 'false') await press(page, cdp, vp, '[data-running]');
      await runFast(page, cdp, vp, 3);
      for (const d of ['sensors', 'network', 'genetics', 'racing-line']) {
        const el = page.locator(`[data-demo="${d}"]`); await el.scrollIntoViewIfNeeded(); await sleep(400);
        const before = await el.innerText();
        const range = el.locator('input[type=range]').first();
        if (d === 'genetics') await press(page, cdp, vp, `[data-demo="${d}"] button`);
        else if (d === 'racing-line') { }
        else { await range.focus(); for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight'); }
        await sleep(300);
        const after = await el.innerText();
        res[d] = { changed: before !== after, text: after.replace(/\s+/g, ' ').slice(0, 300) };
        await el.screenshot({ path: `${process.cwd()}/../screens/${tag}-11-demo-${d}.png` });
      }
      R.check('sensors demo responds to input', res.sensors.changed, res.sensors);
      R.check('network demo responds to input', res.network.changed, res.network);
      R.check('genetics demo mutates on button', res.genetics.changed, res.genetics);
      R.check('racing-line demo shows the actual recorded best on the actual road', /Recorded best/i.test(res['racing-line'].text) && /recorded from the simulation/i.test(res['racing-line'].text), res['racing-line']);
      R.check('demos label illustration vs live honestly', /Illustrat/i.test(res.genetics.text) && /Illustrat|Example/i.test(res.sensors.text + res.network.text), {});
      learning.demos = res;
    });
    // ---- Layout polish ----
    await section('layout', async () => {
      await page.evaluate(() => scrollTo(0, 0)); await sleep(300);
      const m = await page.evaluate(() => { let min = 99, where = ''; for (const e of document.querySelectorAll('.gridborn *')) { if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        let fs = parseFloat(cs.fontSize); if (e instanceof SVGElement && e.ownerSVGElement) { const svg = e.ownerSVGElement, vb = svg.viewBox.baseVal; if (vb && vb.width) fs = fs * svg.getBoundingClientRect().width / vb.width; }
        if (fs < min) { min = fs; where = e.tagName + '.' + (e.getAttribute('class') || '') + ':' + e.textContent.trim().slice(0, 30); } } return { min: +min.toFixed(2), where }; });
      R.check('smallest rendered text >= 10.5px', m.min >= 10.5, m);
      const tt = await page.evaluate(() => [...document.querySelectorAll('button, select, input, label')].filter((e) => e.getBoundingClientRect().width).map((e) => { const r = e.getBoundingClientRect(); return [e.tagName + ':' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => h < 44 || w < 44));
      R.check(vp.touch ? 'touch targets >= 44px (inputs inside >=44 labels allowed)' : 'controls present', !vp.touch || tt.filter(([n]) => !/^INPUT|^SPAN/.test(n)).length === 0, { small: tt.slice(0, 12) });
      R.check('no horizontal overflow', (await ui(page)).overflowX === 0);
      await shot(page, `${tag}-12-full`, { fullPage: true });
      const sel = await page.evaluate(() => { const c = document.querySelector('.hero-canvas'), s = getComputedStyle(c), e = getComputedStyle(document.querySelector('.editor-canvas')); return { ua: s.userSelect, wus: s.webkitUserSelect, callout: s.webkitTouchCallout, touch: s.touchAction, eTouch: e.touchAction }; });
      R.check('canvases: no selection/callout, touch-action none', sel.ua === 'none' && sel.touch === 'none' && sel.eTouch === 'none' && (sel.callout === 'none' || sel.callout === undefined), sel);
    });
    const errs = await page.evaluate(() => __qa.errors);
    R.check('no console errors/warnings, page errors, failed or >=400 requests', !log.console.length && !log.pageErrors.length && !log.requestFailed.length && !log.badResponses.length && !errs.length, { ...log, errs });
    out.push({ ...R.summary(), results: R.results, learning });
    save(`main-${mode}-${vp.name}.json`, out.at(-1));
    await context.close();
  }
} finally { await b.close(); }
console.log(JSON.stringify(out.map(({ label, passed, total, failed }) => ({ label, passed, total, failed }))));
