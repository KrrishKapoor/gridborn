// Round-2 reviewer: hypothesis - a touch drag on the DETACHED overlay scrolls the page (road canvas allows panning); a late scroll then cancels the next stroke.
import { chromium } from './runner/node_modules/playwright-core/index.mjs';
import { ellipse, resampleOpen } from './lib.mjs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const out = {};
for (const settle of [0, 1500]) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await page.goto('http://127.0.0.1:5293/qa/t1.html', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { window.__h = (await import('/qa/t1.ts')).harness; window.__ev = []; for (const t of ['scroll', 'resize']) window.addEventListener(t, () => window.__ev.push([t, Math.round(performance.now()), scrollY, innerWidth, innerHeight]), true); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true }); await page.waitForTimeout(150);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true }); await page.waitForTimeout(settle);
  await page.evaluate(() => document.querySelector('#lifecycle').click()); // detach
  const sd = await page.evaluate(() => { const r = document.querySelector('#editor').getBoundingClientRect(); return { rect: r.toJSON(), view: { ...window.__h.view } }; });
  const dcss = resampleOpen(ellipse({ cx: 600, cy: 400, rx: 380, ry: 240 }).map(p => ({ x: sd.rect.left + p.x * sd.view.scale + sd.view.offsetX, y: sd.rect.top + p.y * sd.view.scale + sd.view.offsetY })), 5);
  const y0 = await page.evaluate(() => scrollY);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dcss[0].x, y: dcss[0].y, id: 0 }] });
  for (let i = 1; i < dcss.length; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dcss[i].x, y: dcss[i].y, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const y1 = await page.evaluate(() => scrollY);
  await page.waitForTimeout(settle);
  await page.evaluate(() => { for (let i = 0; i < 7; i++) document.querySelector('#lifecycle').click(); });
  const t0 = await page.evaluate(() => { window.__ev.length = 0; return performance.now(); });
  const s = await page.evaluate(() => { const r = document.querySelector('#editor').getBoundingClientRect(); return { rect: r.toJSON(), view: { ...window.__h.view }, counts: { ...window.__h.counts } }; });
  const css = resampleOpen(ellipse({ cx: 600, cy: 400, rx: 380, ry: 240 }).map(p => ({ x: s.rect.left + p.x * s.view.scale + s.view.offsetX, y: s.rect.top + p.y * s.view.scale + s.view.offsetY })), 3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: css[0].x, y: css[0].y, id: 0 }] });
  for (let i = 1; i < css.length; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: css[i].x, y: css[i].y, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(60);
  out[`settle${settle}ms`] = { detachedDragScrolled: [y0, y1], before: s.counts, after: await page.evaluate(() => ({ ...window.__h.counts })), surfaceEventsDuringStroke: await page.evaluate(() => window.__ev), rectBefore: s.rect, rectAfter: await page.evaluate(() => document.querySelector('#editor').getBoundingClientRect().toJSON()) };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
