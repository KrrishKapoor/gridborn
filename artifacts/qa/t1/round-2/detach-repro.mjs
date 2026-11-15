// Round-2 reviewer: isolate the 844x390 detach/attach + stroke result.
import { chromium } from './runner/node_modules/playwright-core/index.mjs';
import { ellipse, resampleOpen } from './lib.mjs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const out = {};
for (const variant of ['no-scroll', 'scrollIntoView', 'no-detach-no-scroll-at-bottom']) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await page.goto('http://127.0.0.1:5293/qa/t1.html', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { window.__h = (await import('/qa/t1.ts')).harness; });
  await page.evaluate(() => window.scrollTo(0, 10000)); // mimic: previous steps left the page scrolled to the footer button
  if (variant !== 'no-detach-no-scroll-at-bottom') await page.evaluate(() => { for (let i = 0; i < 8; i++) document.querySelector('#lifecycle').click(); });
  if (variant === 'scrollIntoView') await page.evaluate(() => document.querySelector('.stage').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  const s = await page.evaluate(() => { const r = document.querySelector('#editor').getBoundingClientRect(); return { rect: r.toJSON(), view: { ...window.__h.view }, scrollY, counts: { ...window.__h.counts } }; });
  const css = resampleOpen(ellipse({ cx: 600, cy: 400, rx: 380, ry: 240 }).map(p => ({ x: s.rect.left + p.x * s.view.scale + s.view.offsetX, y: s.rect.top + p.y * s.view.scale + s.view.offsetY })), 3);
  const scrolls = [];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: css[0].x, y: css[0].y, id: 0 }] });
  for (let i = 1; i < css.length; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: css[i].x, y: css[i].y, id: 0 }] }); if (i % 40 === 0) scrolls.push(await page.evaluate(() => scrollY)); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(60);
  const after = await page.evaluate(() => ({ counts: { ...window.__h.counts }, feedback: document.querySelector('#feedback').textContent, scrollY }));
  out[variant] = { stageTop: s.rect.top, stageBottom: s.rect.bottom, firstY: css[0].y, maxY: Math.max(...css.map(p => p.y)), minY: Math.min(...css.map(p => p.y)), scrollBefore: s.scrollY, scrolls, before: s.counts, after };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
