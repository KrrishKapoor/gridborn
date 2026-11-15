// Production performance, observed externally. node perf.mjs [baseUrl]
import { launch, open, sleep, tap, VIEWPORTS, save } from './lib.mjs';
import os from 'node:os';
const base = process.argv[2] ?? 'http://127.0.0.1:4294/';
const vp = VIEWPORTS.desktop;
const WARM = 1000, SAMPLE = 5000;
const rows = [], raw = {};
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };

async function sample(page, label) {
  await sleep(WARM);
  await page.evaluate(() => { const Q = window.__qa; Q.heavy = false; Q.frames = []; Q.snapMeta = []; Q.record = true; Q.s0 = { t: performance.now(), gen: Q.latestMeta.gen, tick: Q.latestMeta.tick }; });
  await sleep(SAMPLE);
  const r = await page.evaluate(() => { const Q = window.__qa; Q.record = false; Q.heavy = true; return { frames: Q.frames, snaps: Q.snapMeta.filter((m) => m.t >= Q.s0.t), s0: Q.s0, s1: { t: performance.now(), gen: Q.latestMeta.gen, tick: Q.latestMeta.tick, alive: Q.latestMeta.alive, pop: Q.latestMeta.pop, rate: Q.latestMeta.rate } }; });
  const f = r.frames, secs = (r.s1.t - r.s0.t) / 1000;
  const iv = f.slice(1).map((x, i) => x.t - f[i].t);
  const drawnFrames = f.filter((x) => x.cars > 0);
  let changed = 0; for (let i = 1; i < f.length; i++) if (f[i].cars > 0 && f[i].sum !== f[i - 1].sum) changed++;
  const steps = r.snaps.reduce((a, s) => a + s.steps, 0), ms = r.snaps.reduce((a, s) => a + s.ms, 0);
  const row = { label, pop: r.s1.pop, rate: r.s1.rate, seconds: +secs.toFixed(2), genStart: r.s0.gen, genEnd: r.s1.gen,
    rafFps: +(f.length / secs).toFixed(1), frameP50: pct(iv, 0.5), frameP95: pct(iv, 0.95), frameP99: pct(iv, 0.99), frameMax: pct(iv, 1), over20ms: iv.filter((x) => x > 20).length, over33ms: iv.filter((x) => x > 33.4).length,
    callbackAvgMs: +(f.reduce((a, x) => a + x.cost, 0) / Math.max(1, f.length)).toFixed(2), callbackP95Ms: pct(f.map((x) => x.cost), 0.95),
    snapshotsPerSec: +(r.snaps.length / secs).toFixed(1), freshFrameShare: +(f.filter((x) => x.fresh > 0).length / Math.max(1, f.length)).toFixed(3),
    changingPoseFrameShare: +(changed / Math.max(1, f.length - 1)).toFixed(3), carsDrawnAvg: drawnFrames.length ? Math.round(drawnFrames.reduce((a, x) => a + x.cars, 0) / drawnFrames.length) : 0,
    headlessFrames: f.filter((x) => x.headless).length,
    simStepsPerSec: +(steps / secs).toFixed(0), workerComputeMsPerStep: steps ? +(ms / steps).toFixed(3) : null, workerBusyShare: +(ms / (secs * 1000)).toFixed(3),
    aliveMin: Math.min(...r.snaps.map((s) => s.alive)), aliveMax: Math.max(...r.snaps.map((s) => s.alive)) };
  rows.push(row); raw[label] = { frames: f.map((x) => [+x.t.toFixed(2), +x.cost.toFixed(3), x.fresh, x.cars, +x.sum.toFixed(1)]), snaps: r.snaps.map((s) => [+s.t.toFixed(2), s.tick, s.steps, +s.ms.toFixed(3), s.alive, s.gen]) };
  console.log(JSON.stringify(row));
  return row;
}
async function responsiveness(page, cdp, label) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { const b = document.querySelector('[data-running]'); window.__lat = { down: null, change: null }; b.addEventListener('pointerdown', (e) => { window.__lat.down = performance.now(); }, { once: true }); new MutationObserver((m, o) => { window.__lat.change = performance.now(); o.disconnect(); }).observe(b, { attributes: true, attributeFilter: ['aria-pressed'] }); });
    await tap(page, cdp, vp, '[data-running]');
    await sleep(250);
    const l = await page.evaluate(() => window.__lat); out.push(l.change && l.down ? +(l.change - l.down).toFixed(1) : null);
  }
  const ev = await page.evaluate(() => (window.__events || []).slice(-8));
  return { label, pauseToggleLatencyMs: out, eventTiming: ev };
}

const browser = await launch();
const env = { chrome: (await browser.version()), cpu: os.cpus()[0].model, cores: os.cpus().length, mem: os.totalmem(), loadavgAtStart: os.loadavg(), viewport: '1440x900', dpr: 2, headless: true, warmupMs: WARM, sampleMs: SAMPLE };
const resp = [];
try {
  for (const pop of [512, 1000]) {
    const { context, page, cdp, log } = await open(browser, vp, base);
    await page.evaluate(() => { window.__events = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__events.push({ name: e.name, duration: e.duration, delay: +(e.processingStart - e.startTime).toFixed(1) }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); });
    const resetTo = async () => {
      const before = await page.evaluate(() => window.__qa.latestMeta.runId);
      if (pop === 1000 && (await page.evaluate(() => window.__qa.latestMeta.pop)) !== 1000) await page.selectOption('[data-population]', '1000');
      else await tap(page, cdp, vp, '[data-reset]');
      await page.waitForFunction((r) => window.__qa.latestMeta.runId > r, before, { timeout: 10000 });
    };
    for (const rate of ['1', '4', 'fast']) {
      await resetTo(); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await tap(page, cdp, vp, `[data-rate="${rate}"]`);
      await sample(page, `${pop}-early-${rate}`);
      if (rate === '4') resp.push(await responsiveness(page, cdp, `${pop}-early-4x`));
    }
    // Evolve with fast mode, then sample each rate on the same evolved run.
    await tap(page, cdp, vp, '[data-rate="fast"]'); await sleep(pop === 1000 ? 30000 : 20000);
    for (const rate of ['1', '4', 'fast']) {
      await tap(page, cdp, vp, `[data-rate="${rate}"]`);
      await sample(page, `${pop}-evolved-${rate}`);
      if (rate === '4') resp.push(await responsiveness(page, cdp, `${pop}-evolved-4x`));
      if (rate === '1') {
        // Bounded interpolation: every drawn pose lies on a segment between two received worker poses of the same car.
        const bound = await page.evaluate(async () => {
          const Q = window.__qa; Q.heavy = true; const res = [];
          for (let k = 0; k < 12; k++) {
            await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
            const F = Q.cur, ring = Q.ring.filter((x) => x.gen === Q.latestMeta.gen); if (!F || !F.pos || ring.length < 2) continue;
            let worst = 0, checked = 0;
            for (let p = 0; p < F.pos.length; p += 2) {
              const x = F.pos[p], y = F.pos[p + 1]; let best = Infinity;
              for (let i = 0; i < ring[0].cars.length && best > 1e-3; i += 8) for (let s = 0; s + 1 < ring.length; s++) {
                const ax = ring[s].cars[i], ay = ring[s].cars[i + 1], bx = ring[s + 1].cars[i], by = ring[s + 1].cars[i + 1];
                const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? ((x - ax) * dx + (y - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
                best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
              }
              worst = Math.max(worst, best); checked++;
            }
            res.push({ checked, worstDistance: +worst.toFixed(5) });
          }
          return res;
        });
        raw[`${pop}-interpolation-bound`] = bound; console.log('interp', pop, JSON.stringify(bound.slice(0, 4)));
      }
    }
    raw[`${pop}-log`] = log;
    await context.close();
  }
} finally { await browser.close(); }
env.loadavgAtEnd = os.loadavg();
save('raw/perf-prod.json', { env, rows, responsiveness: resp });
save('raw/perf-prod-raw.json', raw);
console.log(JSON.stringify({ env, resp }, null, 1));
