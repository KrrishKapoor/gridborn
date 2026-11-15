// Extended pure-geometry probe using actual harness CSS scales and editor dedupe.
import { chromium } from './runner/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const base = process.argv[2] ?? 'http://127.0.0.1:5293';
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
try {
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${base}/qa/t1.html`);
    const result = await page.evaluate(async () => {
      const H = (await import('/qa/t1.ts')).harness;
      const T = await import('/src/track/index.ts');
      const fails = [];
      for (const direction of [1, -1]) for (let trial = 0; trial < 60; trial++) {
        let seed = 1000 + trial * 31;
        const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
        const v = H.view.scale, n = Math.round(2 * Math.PI * Math.sqrt((370 ** 2 + 225 ** 2) / 2) * v / 1.5);
        const points = [];
        for (let i = 0; i <= n; i++) {
          const t = -Math.PI / 2 + direction * i * 2 * Math.PI / n;
          const p = { x: 600 + 370 * Math.cos(t) + (random() - .5) * 2 / v, y: 400 + 225 * Math.sin(t) + (random() - .5) * 2 / v };
          const q = points.at(-1);
          if (!q || Math.hypot(p.x - q.x, p.y - q.y) >= 2) points.push(p);
        }
        const r = T.buildTrack(points, { id: 'jitter', width: 92 });
        if (!r.ok) fails.push({ direction, trial, issues: r.issues });
      }
      return { scale: H.view.scale, trials: 120, fails };
    });
    results.push({ width, height, ...result });
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(new URL('./css-jitter-probe.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(results);
if (results.some(r => r.fails.length)) process.exitCode = 1;
