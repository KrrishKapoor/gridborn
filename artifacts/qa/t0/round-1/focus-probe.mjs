import { createRequire } from 'node:module';
const require = createRequire(process.argv[2] + '/package.json');
const { chromium } = require('playwright');
const b = await chromium.launch();
const out = {};
for (const [name, opts] of [['mouse', { viewport: { width: 1440, height: 900 } }], ['touch', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }]]) {
  const ctx = await b.newContext(opts); const p = await ctx.newPage(); await p.goto(process.argv[3]); await p.waitForTimeout(300);
  const c = p.locator('canvas'); await c.scrollIntoViewIfNeeded(); const r = await c.boundingBox();
  if (name === 'mouse') await p.mouse.click(r.x + r.width / 2 + 40, r.y + r.height / 2); else await p.touchscreen.tap(r.x + r.width / 2 + 40, r.y + r.height / 2);
  out[name] = await p.evaluate(() => { const c = document.querySelector('canvas'); return { focused: document.activeElement === c, focusVisible: c.matches(':focus-visible'), outline: getComputedStyle(c).outlineStyle }; });
  // control: same page, plain tabindex div clicked without script focus
  out[name + '_control'] = await p.evaluate(() => { const d = document.createElement('div'); d.tabIndex = 0; d.style.cssText = 'position:fixed;left:0;top:0;width:50px;height:50px'; document.body.append(d); return true; });
  if (name === 'mouse') await p.mouse.click(25, 25); else await p.touchscreen.tap(25, 25);
  out[name + '_control'] = await p.evaluate(() => ({ focusVisible: document.activeElement.matches(':focus-visible'), tag: document.activeElement.tagName }));
  if (name === 'mouse') {
    out.fonts = await p.evaluate(async () => { await document.fonts.ready; const o = document.querySelector('output'); return { family: getComputedStyle(o).fontFamily, sfmono: document.fonts.check('12px "SFMono-Regular"'), menlo: document.fonts.check('12px Menlo') }; });
    const cdp = await ctx.newCDPSession(p); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument'); const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'output' });
    out.platformFonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
    const h = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' });
    out.h1Fonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: h.nodeId })).fonts;
  }
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await b.close();
