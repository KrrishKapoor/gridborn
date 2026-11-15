// Final QA performance on the production build, measured externally (no app hooks).
// Usage: node perf.mjs <url> [headed] [viewportKey]
import { execSync } from 'node:child_process';
import { launch, open, VIEWPORTS, sleep, press, waitFor, save, shot } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4394/', headed = process.argv[3] === 'headed', vkey = process.argv[4] || 'desktop';
const vp = VIEWPORTS[vkey];
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const r2 = (x) => Math.round(x * 100) / 100;
function analyse(frames, deliveries, durMs) {
  const groups = new Map();
  for (const [t, d, fresh, n, sum, changed] of frames) { const g = groups.get(t) || { t, d: 0, fresh: 0, n: 0, changed: 0 }; g.d += d; g.fresh |= fresh; g.n += n; g.changed |= changed; groups.set(t, g); }
  const fs = [...groups.values()].sort((a, b) => a.t - b.t), iv = fs.slice(1).map((f, i) => f.t - fs[i].t);
  const drawnFrames = fs.filter((f) => f.n > 0);
  const steps = deliveries.reduce((s, d) => s + d[2], 0), compute = deliveries.reduce((s, d) => s + d[3], 0);
  return { frames: fs.length, rafFps: r2(fs.length / (durMs / 1000)), intervalP50: r2(pct(iv, 0.5)), intervalP99: r2(pct(iv, 0.99)), intervalMax: r2(Math.max(...iv)), over20ms: iv.filter((x) => x > 20).length,
    callbackAvg: r2(fs.reduce((s, f) => s + f.d, 0) / fs.length), callbackP95: r2(pct(fs.map((f) => f.d), 0.95)), callbackMax: r2(Math.max(...fs.map((f) => f.d))),
    freshShare: r2(fs.filter((f) => f.fresh).length / fs.length), changingPoseShare: drawnFrames.length ? r2(drawnFrames.filter((f) => f.changed).length / drawnFrames.length) : 0,
    identicalDrawnFrames: drawnFrames.filter((f) => !f.changed).length, drawnFrameShare: r2(drawnFrames.length / fs.length), carsDrawnAvg: drawnFrames.length ? Math.round(drawnFrames.reduce((s, f) => s + f.n, 0) / drawnFrames.length) : 0,
    snapshotsPerSec: r2(deliveries.length / (durMs / 1000)), stepsPerSec: Math.round(steps / (durMs / 1000)), workerMsPerStep: steps ? r2(compute / steps) : 0, workerBusy: r2(compute / durMs),
    alive: deliveries.length ? [Math.min(...deliveries.map((d) => d[4])), Math.max(...deliveries.map((d) => d[4]))] : null, generations: deliveries.length ? [deliveries[0][5], deliveries.at(-1)[5]] : null };
}
const b = await launch({ headless: !headed });
const rows = [], rawRows = {};
const load0 = execSync('uptime').toString().trim();
try {
  const { page, context, cdp, log } = await open(b, url, vp);
  await waitFor(page, () => __qa.events.ready.length && __qa.last);
  await page.evaluate(() => { window.__long = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => __long.push(e.duration))).observe({ type: 'longtask', buffered: false }); } catch {} });
  await page.locator('.track-stage').scrollIntoViewIfNeeded();
  async function sample(label) {
    await sleep(1000);
    await page.evaluate(() => { __qa.frames = []; __qa.deliveries = []; __long.length = 0; __qa.sampling = true; __qa.t0 = performance.now(); });
    await sleep(5000);
    const r = await page.evaluate(() => { __qa.sampling = false; return { frames: __qa.frames, deliveries: __qa.deliveries, dur: performance.now() - __qa.t0, long: __long.slice() }; });
    const a = analyse(r.frames, r.deliveries, r.dur); a.longTasks = r.long.length; a.longTaskMax = r.long.length ? r2(Math.max(...r.long)) : 0;
    rows.push({ label, ...a }); rawRows[label] = { frames: r.frames.slice(0, 2000), deliveries: r.deliveries };
    console.log(label, JSON.stringify(a));
  }
  for (const pop of ['512', '1000']) {
    const k = await page.evaluate(() => __qa.events.ready.length);
    if (pop !== '512') { await page.selectOption('[data-population]', pop); } else { await press(page, cdp, vp, '[data-reset]'); }
    await waitFor(page, ([n, p]) => __qa.events.ready.length > n && __qa.last.population === +p && __qa.last.runId === __qa.events.ready.at(-1).runId, [k, pop], 20000);
    for (const rate of ['1', '4', 'fast']) {
      // early: fresh reset before each rate so the population is generation 1
      const k2 = await page.evaluate(() => __qa.events.ready.length); await press(page, cdp, vp, '[data-reset]');
      await waitFor(page, (n) => __qa.events.ready.length > n && __qa.last.runId === __qa.events.ready.at(-1).runId, k2, 20000);
      await press(page, cdp, vp, `[data-rate="${rate}"]`); await page.locator('.track-stage').scrollIntoViewIfNeeded();
      await sample(`${pop} early ${rate}`);
    }
    await press(page, cdp, vp, '[data-rate="fast"]');
    const run = await page.evaluate(() => __qa.last.runId);
    await waitFor(page, ([r, g]) => __qa.last.runId === r && __qa.last.generation >= g, [run, pop === '512' ? 60 : 40], 240000);
    for (const rate of ['1', '4', 'fast']) { await press(page, cdp, vp, `[data-rate="${rate}"]`); await page.locator('.track-stage').scrollIntoViewIfNeeded(); await sample(`${pop} evolved ${rate}`); }
    await press(page, cdp, vp, '[data-rate="1"]'); await sleep(1500);
    await shot(page, `perf-${headed ? 'headed' : 'headless'}-${vp.name}-${pop}-evolved-1x`);
  }
  // input responsiveness under load (1000 cars, 4x): pointerdown -> aria-pressed change
  await press(page, cdp, vp, '[data-rate="4"]'); await sleep(1000);
  const resp = [];
  for (let i = 0; i < 6; i++) {
    const box = await page.locator('[data-running]').boundingBox();
    await page.evaluate(() => { const b = document.querySelector('[data-running]'); window.__before = b.getAttribute('aria-pressed'); window.__t = 0; b.addEventListener('pointerdown', () => { window.__t = performance.now(); }, { once: true });
      new MutationObserver((m, o) => { window.__lat = performance.now() - window.__t; o.disconnect(); }).observe(b, { attributes: true, attributeFilter: ['aria-pressed'] }); });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await sleep(150);
    resp.push(await page.evaluate(() => window.__lat));
  }
  rows.push({ label: 'input latency 1000 @4x (pointerdown->aria-pressed, ms)', values: resp.map(r2) });
  console.log('latency', resp.map(r2));
  rows.push({ label: 'errors', ...log });
  await context.close();
} finally { await b.close(); }
const load1 = execSync('uptime').toString().trim();
const env = { browser: 'Chrome 157.0.8103.51 ' + (headed ? 'headed' : 'headless'), hardware: 'Apple M5, 10 cores, 24 GB', viewport: vp, loadStart: load0, loadEnd: load1, url };
save(`perf-${headed ? 'headed' : 'headless'}-${vp.name}.json`, { env, rows });
save(`perf-${headed ? 'headed' : 'headless'}-${vp.name}-raw.json`, rawRows);
console.log(JSON.stringify(env));
