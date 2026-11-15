// Hidden-tab behaviour of the harness + root-cause probe of 1x snapshot cadence with a controlled host.
import { chromium } from '../tools/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as sim from '../node-bundle/sim.mjs';
const ROOT = join(import.meta.dirname, '..'), out = {};
const EXE = '/Users/krrishai/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(readFileSync(join(import.meta.dirname, 'qa-init.js'), 'utf8'));
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://127.0.0.1:5197/qa/t2.html'); await page.waitForFunction(() => window.t2?.state().tick > 60);
const cdp = await ctx.newCDPSession(page);
const probe = () => page.evaluate(() => ({ vis: document.visibilityState, frames: window.__qa.frames.length, snaps: window.__qa.snapCount, tick: window.t2.state().tick, t: performance.now() }));
const a = await probe();
let method = 'bringToFront other tab';
const other = await ctx.newPage(); await other.goto('about:blank'); await other.bringToFront(); await new Promise((r) => setTimeout(r, 3000));
let b = await probe();
if (b.vis === 'visible') { method = 'CDP Emulation.setFocusEmulationEnabled false + Page.setWebLifecycleState frozen not used; visibility unchanged in headless'; }
await page.bringToFront(); await new Promise((r) => setTimeout(r, 1500)); const c = await probe();
out.hidden = { method, before: a, hiddenAfter3s: b, visibleAgain: c, framesWhileHidden: b.frames - a.frames, snapshotsWhileHidden: b.snaps - a.snaps, ticksWhileHidden: b.tick - a.tick, framesAfterReturn: c.frames - b.frames, errors: errs };
await browser.close();
// Controlled host: deliveries per second at 1x with realistic timer lateness (0–1.5 ms) — no rendering involved.
class Host { constructor(j) { this.t = 0; this.q = []; this.ev = []; this.j = j; this.rt = new sim.WorkerRuntime(this); }
  now() { return this.t; } schedule(cb, d) { const h = { at: this.t + Math.max(d, 0) + this.j(), cb }; this.q.push(h); return h; } cancel(h) { this.q = this.q.filter((x) => x !== h); }
  send(e, tr = []) { const c = structuredClone(e, { transfer: tr }); this.ev.push(c); if (c.type === 'snapshot') this.rt.receive(structuredClone({ type: 'recycle', runId: c.snapshot.runId, storage: c.snapshot.storage }, { transfer: sim.snapshotTransferList(c.snapshot.storage) })); }
  run(ms) { const end = this.t + ms; while (this.q.length) { this.q.sort((x, y) => x.at - y.at); const h = this.q.shift(); if (h.at > end) { this.q.unshift(h); break; } this.t = h.at; h.cb(); } this.t = end; } }
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (const [name, jitter] of [['noJitter', () => 0], ['jitter0to1.5ms', () => rnd() * 1.5], ['jitter0to4ms', () => rnd() * 4]]) {
  for (const rate of [1, 4]) {
    const h = new Host(jitter); h.rt.receive({ type: 'reset', runId: 1, track: sim.ovalFixture(), settings: { ...sim.DEFAULT_SETTINGS, population: 64, eliteCount: 2 } });
    h.rt.receive({ type: 'set-rate', runId: 1, rate }); h.rt.receive({ type: 'set-running', runId: 1, running: true }); h.run(1000);
    const n0 = h.ev.length, t0 = h.rt.engine.tick; h.run(10000);
    const snaps = h.ev.slice(n0).filter((e) => e.type === 'snapshot');
    out[`host_${name}_rate${rate}`] = { snapshotsPerSecond: snaps.length / 10, stepsPerSecond: (h.rt.engine.tick - t0) / 10, multiStepDeliveries: snaps.filter((s) => s.snapshot.steps > rate).length / snaps.length };
  }
}
writeFileSync(join(ROOT, 'hidden-cadence-results.json'), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
