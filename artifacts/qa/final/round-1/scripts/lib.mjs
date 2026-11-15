// Shared helpers for the final Gridborn QA. Uses an isolated playwright-core in ../_deps and system Chrome.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
const { chromium } = require(path.join(ROOT, '_deps/node_modules/playwright-core'));
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const INSTRUMENT = fs.readFileSync(path.join(here, 'instrument.js'), 'utf8');
export const VIEWPORTS = {
  desktop: { name: '1440x900', width: 1440, height: 900, dpr: 2, touch: false },
  portrait: { name: '390x844', width: 390, height: 844, dpr: 3, touch: true },
  landscape: { name: '844x390', width: 844, height: 390, dpr: 3, touch: true },
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ headless = true, args = [] } = {}) {
  return chromium.launch({ executablePath: CHROME, headless, args: ['--no-first-run', '--no-default-browser-check', ...args] });
}
export async function open(browser, url, vp, { reducedMotion = 'no-preference', instrument = true } = {}) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr,
    isMobile: vp.touch, hasTouch: vp.touch, reducedMotion });
  const page = await context.newPage();
  const log = { console: [], pageErrors: [], requestFailed: [], badResponses: [] };
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.console.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => log.pageErrors.push(String(e)));
  page.on('requestfailed', (r) => log.requestFailed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) log.badResponses.push(`${r.status()} ${r.url()}`); });
  if (instrument) await page.addInitScript(INSTRUMENT);
  await page.goto(url, { waitUntil: 'load' });
  const cdp = await context.newCDPSession(page);
  return { context, page, log, cdp };
}

export class Recorder {
  constructor(label) { this.label = label; this.results = []; }
  check(name, pass, detail = {}) {
    this.results.push({ name, pass: !!pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} [${this.label}] ${name}${detail && Object.keys(detail).length ? ' ' + JSON.stringify(detail).slice(0, 400) : ''}`);
    return !!pass;
  }
  summary() { const p = this.results.filter((r) => r.pass).length; return { label: this.label, passed: p, total: this.results.length, failed: this.results.filter((r) => !r.pass).map((r) => r.name) }; }
}
export function save(name, data) { fs.writeFileSync(path.join(ROOT, 'raw', name), JSON.stringify(data, null, 1)); }
export async function shot(page, name, opts = {}) { const p = path.join(ROOT, 'screens', name + '.png'); await page.screenshot({ path: p, ...opts }); return p; }

// Hero geometry: canvas rect + the app's view transform (same formula as renderer.ts/fitView).
export async function stage(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.hero-canvas'), r = c.getBoundingClientRect();
    const pad = Math.min(16, r.width / 20, r.height / 20), scale = Math.min((r.width - 2 * pad) / 1200, (r.height - 2 * pad) / 800);
    return { left: r.left, top: r.top, width: r.width, height: r.height, scale, offsetX: (r.width - 1200 * scale) / 2, offsetY: (r.height - 800 * scale) / 2, scrollY };
  });
}
export const toCss = (st, p) => ({ x: st.left + st.offsetX + p.x * st.scale, y: st.top + st.offsetY + p.y * st.scale });

export function ellipse(cx, cy, rx, ry, { n = 90, clockwise = true, overshoot = 0, start = -Math.PI / 2 } = {}) {
  const pts = [], total = 2 * Math.PI * (1 + overshoot);
  for (let i = 0; i <= n * (1 + overshoot); i++) {
    const a = start + (clockwise ? 1 : -1) * (i / n) * 2 * Math.PI;
    if ((i / n) * 2 * Math.PI > total + 1e-9) break;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}
export function seeded(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Real input: Playwright mouse, or CDP touch events (emulated touch, not a physical device).
export async function stroke(page, cdp, vp, worldPts, { jitterCss = 0, seed = 7, beforeUp = null, steps = 1 } = {}) {
  const st = await stage(page), rnd = seeded(seed);
  const css = worldPts.map((p) => { const c = toCss(st, p); return { x: c.x + (jitterCss ? (rnd() * 2 - 1) * jitterCss : 0), y: c.y + (jitterCss ? (rnd() * 2 - 1) * jitterCss : 0) }; });
  if (!vp.touch) {
    await page.mouse.move(css[0].x, css[0].y); await page.mouse.down();
    for (const c of css.slice(1)) await page.mouse.move(c.x, c.y, { steps });
    if (beforeUp) await beforeUp();
    await page.mouse.up();
  } else {
    const pt = (c) => [{ x: c.x, y: c.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(css[0]) });
    for (const c of css.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(c) });
    if (beforeUp) await beforeUp();
    try { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } catch (e) { if (!/TouchStart first/.test(String(e))) throw e; }
  }
  await sleep(150);
  return css;
}
export async function tap(page, cdp, vp, x, y) {
  if (!vp.touch) { await page.mouse.click(x, y); return; }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
export async function press(page, cdp, vp, selector) {
  const el = page.locator(selector).first(); await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox(); await tap(page, cdp, vp, b.x + b.width / 2, b.y + b.height / 2); await sleep(80);
}
export const qa = (page) => page.evaluate(() => ({ snapshots: __qa.snapshots, resets: __qa.resets.map((r) => ({ runId: r.runId, trackId: r.trackId, pop: r.settings.population })),
  ready: __qa.events.ready.map((r) => r.runId), errors: __qa.events.error, last: __qa.last && { runId: __qa.last.runId, generation: __qa.last.generation, tick: __qa.last.tick, alive: __qa.last.alive, running: __qa.last.running, rate: __qa.last.rate, selected: __qa.last.selected, population: __qa.last.population },
  gens: __qa.events.generation.length, workers: __qa.workers, terminated: __qa.terminated, pageErrors: __qa.errors }));
export const ui = (page) => page.evaluate(() => {
  const t = (s) => document.querySelector(s)?.textContent?.trim();
  return { generation: t('[data-generation]'), alive: t('[data-alive]'), lap: t('[data-lap-value]'), noLap: !document.querySelector('[data-no-lap]')?.hidden,
    history: t('[data-history-label]'), hint: t('[data-stage-hint]'), runLabel: t('[data-run-label]'), feedback: t('[data-feedback]'),
    drawingPressed: document.querySelector('[data-drawing]')?.getAttribute('aria-pressed'), running: document.querySelector('[data-running]')?.getAttribute('aria-pressed'),
    rate: [...document.querySelectorAll('[data-rate]')].find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.rate,
    editorPE: document.querySelector('.editor-canvas').style.pointerEvents, active: document.activeElement?.className || document.activeElement?.tagName,
    activeFocusVisible: document.activeElement?.matches?.(':focus-visible') ?? false, isDrawingClass: document.querySelector('.gridborn')?.classList.contains('is-drawing') ?? document.querySelector('.is-drawing') != null,
    inspectionHidden: document.querySelector('.inspection-panel')?.hidden, selection: t('[data-selection]'),
    overflowX: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth };
});
// Hero canvas alpha at CSS points (stage-relative), to detect the drawing guide shading.
export async function heroAlpha(page, points) {
  return page.evaluate((pts) => {
    const c = document.querySelector('.hero-canvas'), r = c.getBoundingClientRect(), ctx = c.getContext('2d');
    return pts.map(([x, y]) => { const d = ctx.getImageData(Math.round(x * c.width / r.width), Math.round(y * c.height / r.height), 1, 1).data; return [d[0], d[1], d[2], d[3]]; });
  }, points);
}
export async function waitFor(page, fn, arg, timeout = 15000) { return page.waitForFunction(fn, arg, { timeout, polling: 50 }); }
export async function setRate(page, cdp, vp, rate) { await press(page, cdp, vp, `[data-rate="${rate}"]`); }
export async function clickRun(page, cdp, vp) { await press(page, cdp, vp, '[data-running]'); }
