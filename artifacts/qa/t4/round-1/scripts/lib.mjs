import { chromium } from '../runner/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHOTS = path.join(ROOT, 'screens');
export const RAW = path.join(ROOT, 'raw');
export const INSTRUMENT = fs.readFileSync(path.join(ROOT, 'scripts/instrument.js'), 'utf8');
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const VIEWPORTS = {
  desktop: { name: '1440x900', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  portrait: { name: '390x844', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  landscape: { name: '844x390', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(extra = []) {
  return chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', ...extra] });
}

export async function open(browser, vp, url, opts = {}) {
  const context = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch, reducedMotion: opts.reducedMotion ?? 'no-preference' });
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  const log = { console: [], pageErrors: [], failed: [], badStatus: [] };
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.console.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => log.pageErrors.push(String(e)));
  page.on('requestfailed', (r) => log.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) log.badStatus.push(`${r.status()} ${r.url()}`); });
  const cdp = await context.newCDPSession(page);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__qa && window.__qa.ready.length > 0 && window.__qa.snapCount > 2, null, { timeout: 15000 });
  return { context, page, cdp, log };
}

export async function state(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const t = (s) => q(s)?.textContent?.trim() ?? null;
    const Q = window.__qa;
    return {
      generation: t('[data-generation]'), alive: t('[data-alive]'), lap: t('[data-lap-value]'), lapLabel: q('[data-lap]')?.getAttribute('aria-label'),
      historyLabel: t('.fitness [data-history-label]') ?? t('[data-history-label]'), run: t('[data-run-text]'), runPressed: q('[data-running]')?.getAttribute('aria-pressed'),
      rate: [...document.querySelectorAll('[data-rate]')].find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.rate ?? null,
      feedback: t('[data-feedback]'), issues: q('.track-feedback')?.classList.contains('has-issues'), hint: t('[data-stage-hint]'), runLabel: t('[data-run-label]'),
      panelHidden: q('.inspection-panel')?.hidden, selection: t('[data-selection]'), population: q('[data-population]')?.value,
      drawing: q('[data-drawing]')?.getAttribute('aria-pressed'), active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) + (document.activeElement.dataset?.close !== undefined ? '[close]' : '') : null,
      meta: Q.latestMeta, ready: Q.ready.map((r) => r.runId), errors: Q.errors, gens: Q.gens.length, workers: Q.workers, terminated: Q.terminated,
      lastGen: Q.gens.at(-1) ?? null,
    };
  });
}

export async function waitFor(page, fn, arg, timeout = 30000) {
  return page.waitForFunction(fn, arg, { timeout, polling: 100 });
}

export async function tap(page, cdp, vp, selector) {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (vp.hasTouch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else await page.mouse.click(x, y);
  await sleep(60);
}

export async function tapAt(page, cdp, vp, x, y) {
  if (vp.hasTouch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else await page.mouse.click(x, y);
}

/** Loop points in CSS page coordinates over the hero/editor canvas. */
export async function loopPoints(page, { dir = 1, n = 90, endFrac = 0.97, shape = 'bean', scale = 1 } = {}) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await sleep(100);
  // Inside the drawable world area (the hero letterboxes a 1200x800 world).
  const v = await page.evaluate(() => window.__qa.view());
  const W = 1200 * v.scale, H = 800 * v.scale;
  const cx = v.left + v.w / 2, cy = v.top + v.h / 2;
  const pts = [];
  for (let i = 0; i <= n * endFrac; i++) {
    const a = -Math.PI / 2 + dir * (i / n) * Math.PI * 2;
    const k = shape === 'bean' ? 1 + 0.08 * Math.cos(3 * a) : 1;
    pts.push([cx + Math.cos(a) * W * 0.36 * k * scale, cy + Math.sin(a) * H * 0.33 * k * scale]);
  }
  return pts;
}

export async function stroke(page, cdp, vp, pts, { cancel = false, cancelAt = null } = {}) {
  if (vp.hasTouch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1], id: 7 }] });
    for (let i = 1; i < pts.length; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i][0], y: pts[i][1], id: 7 }] });
      if (cancelAt === i) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); return; }
    }
    if (cancel) await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
    for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i][0], pts[i][1]);
    await page.mouse.up();
  }
}

export function save(name, data) { fs.writeFileSync(path.join(ROOT, name), JSON.stringify(data, null, 1)); }
