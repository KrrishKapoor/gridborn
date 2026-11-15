// Supplementary layout probe: sparkline/fitness, hint, and inspection placement per viewport.
import { createRequire } from 'node:module'; import { join } from 'node:path'; import { writeFileSync } from 'node:fs';
const [pwDir, BASE] = process.argv.slice(2);
const { chromium } = createRequire(join(pwDir, 'package.json'))('playwright-core');
const b = await chromium.launch({ channel: 'chrome', headless: true }); const out = {};
for (const [name, w, h, m] of [['desktop-1440x900', 1440, 900, false], ['portrait-390x844', 390, 844, true], ['landscape-844x390', 844, 390, true]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m, deviceScaleFactor: 2 }); const p = await c.newPage();
  await p.goto(`${BASE}/qa/t3.html`, { waitUntil: 'networkidle' });
  out[name] = await p.evaluate(() => { const r = (s) => { const e = document.querySelector(s).getBoundingClientRect(); return { top: Math.round(e.top), bottom: Math.round(e.bottom), left: Math.round(e.left), right: Math.round(e.right) }; };
    const rail = r('.control-rail'); const reset = r('[data-reset]');
    return { vh: innerHeight, fitness: r('.fitness'), fitnessSvg: r('[data-fitness]'), hint: r('.track-hint'), feedback: r('.track-feedback'), canvas: r('.hero-canvas'), rail, resetBottom: reset.bottom, railEmptyBelowReset: rail.bottom - reset.bottom, harnessBanner: r('.harness-banner'), labBottom: r('.lab').bottom, liveDrawLabel: document.querySelector('[data-drawing]').textContent }; });
  // After an update, does the drawing button keep its aria-hidden arrow?
  await p.evaluate(() => window.t3Harness.setState({ drawing: false }));
  out[name].drawingButtonAfterUpdate = await p.evaluate(() => ({ text: document.querySelector('[data-drawing]').textContent, hasHiddenSpan: !!document.querySelector('[data-drawing] [aria-hidden]'), lapSmall: !!document.querySelector('[data-lap] small') }));
  await c.close();
}
await b.close(); writeFileSync(new URL('./probe-results.json', import.meta.url), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1));
