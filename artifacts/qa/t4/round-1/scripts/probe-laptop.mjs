import { launch, open, sleep, save, SHOTS } from './lib.mjs';
const b = await launch(); const out = {};
try {
  for (const [w, h] of [[1280, 720], [1366, 768], [1280, 800], [1536, 864], [1000, 700]]) {
    const v = { name: `${w}x${h}`, viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: false, hasTouch: false };
    const { context, page } = await open(b, v, process.argv[2] ?? 'http://127.0.0.1:4294/');
    await sleep(500);
    out[v.name] = await page.evaluate(() => { const c = document.querySelector('.hero-canvas').getBoundingClientRect(); const Q = window.__qa.view(); const trackBottom = c.top + Q.oy + 800 * Q.scale; return { canvasTop: Math.round(c.top), canvasBottom: Math.round(c.bottom), innerHeight, visibleFrac: +(Math.max(0, Math.min(innerHeight, c.bottom) - c.top) / c.height).toFixed(2), worldBottom: Math.round(trackBottom) }; });
    await page.screenshot({ path: `${SHOTS}/laptop-${v.name}.png` });
    await context.close();
  }
} finally { await b.close(); }
save('raw/laptop-viewports.json', out); console.log(JSON.stringify(out));
