import { createRequire } from 'node:module';
const require = createRequire(process.argv[2] + '/package.json');
const { chromium } = require('playwright');
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage(); await p.goto(process.argv[3]); await p.waitForTimeout(300);
await p.evaluate(() => { window.__ev = []; addEventListener('resize', () => __ev.push('resize')); matchMedia('(resolution: 1dppx)').addEventListener('change', () => __ev.push('mq-change')); });
const cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await p.waitForTimeout(300);
console.log(JSON.stringify(await p.evaluate(() => ({ ev: __ev, dpr: devicePixelRatio, bw: document.querySelector('canvas').width, cw: document.querySelector('canvas').getBoundingClientRect().width }))));
// a later real resize corrects it?
await p.setViewportSize({ width: 1400, height: 900 }); await p.waitForTimeout(300);
console.log(JSON.stringify(await p.evaluate(() => ({ ev: __ev, dpr: devicePixelRatio, bw: document.querySelector('canvas').width, cw: document.querySelector('canvas').getBoundingClientRect().width }))));
await b.close();
