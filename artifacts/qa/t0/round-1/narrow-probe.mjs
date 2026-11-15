import { createRequire } from 'node:module';
const require = createRequire(process.argv[2] + '/package.json');
const { chromium } = require('playwright');
const b = await chromium.launch(); const out = [];
for (const w of [320, 120, 80]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 600 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(process.argv[3]); await p.waitForTimeout(300);
  out.push({ viewportWidth: w, canvasWidth: await p.evaluate(() => document.querySelector('canvas').getBoundingClientRect().width), errs });
  await ctx.close();
}
console.log(JSON.stringify(out)); await b.close();
