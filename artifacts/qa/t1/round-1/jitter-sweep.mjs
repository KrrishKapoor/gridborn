// Real CDP touch jitter sweep at 390x844 (DPR 3). Usage: node jitter-sweep.mjs [baseUrl]
import { chromium } from './runner/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const base = process.argv[2] ?? 'http://127.0.0.1:5291';
const browser = await chromium.launch({ channel: 'chrome' });
const out = {};
for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 3, isMobile: vp.w < 500, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${base}/qa/t1.html`);
  await page.evaluate(async () => { window.__H = (await import('/qa/t1.ts')).harness; document.querySelector('.stage').scrollIntoView({ block: 'center' }); });
  const cdp = await context.newCDPSession(page);
  for (const spacing of [1.5, 3, 5]) for (const amp of [0.25, 0.5, 1]) {
    let ok = 0; const N = 6;
    for (let trial = 0; trial < N; trial++) {
      const pts = await page.evaluate(({ spacing, amp, trial }) => {
        let s = 1000 + trial * 31; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
        const v = window.__H.view, r = document.querySelector('#editor').getBoundingClientRect();
        const cx = r.left + 600 * v.scale + v.offsetX, cy = r.top + 400 * v.scale + v.offsetY, rx = 370 * v.scale, ry = 225 * v.scale;
        const per = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2); const n = Math.round(per / spacing);
        return Array.from({ length: n + 1 }, (_, i) => { const t = -Math.PI / 2 + i * 2 * Math.PI / n; return { x: cx + rx * Math.cos(t) + (rnd() - .5) * 2 * amp, y: cy + ry * Math.sin(t) + (rnd() - .5) * 2 * amp }; });
      }, { spacing, amp, trial });
      const before = await page.evaluate(() => window.__H.counts.commit);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pts[0], id: 0 }] });
      for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 0 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(20);
      if (await page.evaluate(() => window.__H.counts.commit) > before) ok++;
    }
    out[`${vp.w}x${vp.h} spacing=${spacing}px jitter=±${amp}px`] = `${ok}/${N} committed`;
    console.log(`${vp.w}x${vp.h} spacing=${spacing}px jitter=±${amp}px: ${ok}/${N} committed`);
  }
  await context.close();
}
await browser.close();
writeFileSync(new URL('./jitter-sweep.json', import.meta.url), JSON.stringify(out, null, 2));
