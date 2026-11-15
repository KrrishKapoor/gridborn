import { launch, open, state, VIEWPORTS, sleep, tap, stroke, SHOTS } from './lib.mjs';
const b = await launch();
const out = {};
try {
  for (const k of ['desktop', 'portrait', 'landscape']) {
    const vp = VIEWPORTS[k];
    const { page, cdp } = await open(b, vp, process.argv[2] ?? 'http://127.0.0.1:5294/');
    await sleep(800);
    await tap(page, cdp, vp, '[data-drawing]'); await sleep(300);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `${SHOTS}/letterbox-${vp.name}-drawing-mode.png` });
    const v = await page.evaluate(() => window.__qa.view());
    // world area in CSS, and a loop that stays within the visible field but uses its full width
    const worldW = 1200 * v.scale, worldH = 800 * v.scale;
    const cx = v.left + v.w / 2, cy = v.top + v.h / 2;
    const rx = v.w * 0.42, ry = v.h * 0.36;
    const pts = Array.from({ length: 88 }, (_, i) => { const a = -Math.PI / 2 + i / 90 * 2 * Math.PI; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
    await stroke(page, cdp, vp, pts); await sleep(400);
    await page.screenshot({ path: `${SHOTS}/letterbox-${vp.name}-rejected.png` });
    const s = await state(page);
    out[vp.name] = { canvasCss: [v.w, v.h], worldCss: [Math.round(worldW), Math.round(worldH)], unusableSideBands: Math.round((v.w - worldW) / 2), unusableTopBands: Math.round((v.h - worldH) / 2), strokeFracOfField: [0.84, 0.72], feedback: s.feedback, accepted: s.meta.runId > 1 };
    await page.context().close();
  }
} finally { await b.close(); }
console.log(JSON.stringify(out, null, 1));
import fs from 'node:fs'; fs.writeFileSync(new URL('../raw/letterbox.json', import.meta.url), JSON.stringify(out, null, 1));
