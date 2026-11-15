// Round-2 reviewer: does a stroke get cancelled by a page-generated scroll at some landscape scroll offsets?
// For each scrollY, detach+attach (sets the "Editor attached" message), then draw one CDP-touch loop; record outcome and scroll events.
import { chromium } from './runner/node_modules/playwright-core/index.mjs';
import { writeFileSync } from 'node:fs';
import { ellipse, resampleOpen } from './lib.mjs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const out = {};
for (const vp of [{ w: 844, h: 390 }, { w: 390, h: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await page.goto('http://127.0.0.1:5293/qa/t1.html', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { window.__h = (await import('/qa/t1.ts')).harness; window.__ev = []; window.addEventListener('scroll', () => window.__ev.push([Math.round(scrollY), document.documentElement.scrollHeight, Math.round(document.querySelector('#feedback').getBoundingClientRect().height)]), true); });
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const rows = [];
  for (const pre of ['attached-msg', 'invalid-msg']) for (let y = 0; y <= max; y += Math.max(1, Math.floor(max / 20))) {
    await page.evaluate(y => window.scrollTo(0, y), y);
    if (pre === 'attached-msg') await page.evaluate(() => { document.querySelector('#lifecycle').click(); document.querySelector('#lifecycle').click(); });
    else await page.evaluate(() => { const f = document.querySelector('#feedback'); f.textContent = 'The loop crosses itself. Draw a loop without crossings. Current circuit kept.'; f.dataset.kind = 'invalid'; });
    await page.waitForTimeout(120);
    const s = await page.evaluate(() => { window.__ev.length = 0; const r = document.querySelector('#editor').getBoundingClientRect(); return { rect: r.toJSON(), view: { ...window.__h.view }, c: { ...window.__h.counts }, sy: scrollY, fh: document.querySelector('#feedback').getBoundingClientRect().height }; });
    if (s.rect.top < 0 || s.rect.bottom > vp.h) { rows.push({ pre, y, skipped: 'stage not fully visible' }); continue; }
    const css = resampleOpen(ellipse({ cx: 600, cy: 400, rx: 380, ry: 240 }).map(p => ({ x: s.rect.left + p.x * s.view.scale + s.view.offsetX, y: s.rect.top + p.y * s.view.scale + s.view.offsetY })), 4);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: css[0].x, y: css[0].y, id: 0 }] });
    for (let i = 1; i < css.length; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: css[i].x, y: css[i].y, id: 0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(60);
    const a = await page.evaluate(() => ({ c: { ...window.__h.counts }, ev: window.__ev.slice(), sy: scrollY, fh: document.querySelector('#feedback').getBoundingClientRect().height }));
    rows.push({ pre, y: s.sy, max, commit: a.c.commit - s.c.commit, clear: a.c.clear - s.c.clear, feedbackHeight: [s.fh, a.fh], scrollEvents: a.ev });
  }
  out[`${vp.w}x${vp.h}`] = rows;
  await ctx.close();
}
await browser.close();
writeFileSync('scroll-sweep.json', JSON.stringify(out, null, 1));
for (const [k, rows] of Object.entries(out)) { const bad = rows.filter(r => r.commit === 0); console.log(k, 'strokes', rows.filter(r => !r.skipped).length, 'cancelled', bad.length, JSON.stringify(bad.slice(0, 4))); }
