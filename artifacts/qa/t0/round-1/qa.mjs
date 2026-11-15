// Independent T0 QA (round 1). Playwright Chromium, isolated scratchpad install.
// Usage: node qa.mjs <playwright-module-dir> <baseUrl> <outDir>
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [pwDir, BASE, OUT] = process.argv.slice(2);
const require = createRequire(join(pwDir, 'package.json'));
const { chromium } = require('playwright');

const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900, dpr: 2, touch: false, mobile: false },
  { name: 'portrait-390x844', width: 390, height: 844, dpr: 3, touch: true, mobile: true },
  { name: 'landscape-844x390', width: 844, height: 390, dpr: 3, touch: true, mobile: true },
];

const results = { base: BASE, browser: null, viewports: [] };

function expectedWorld(rect, cssX, cssY) {
  const s = Math.min((rect.width - 48) / 1200, (rect.height - 48) / 800);
  const ox = (rect.width - 1200 * s) / 2;
  const oy = (rect.height - 800 * s) / 2;
  const clamp = (v, m) => Math.max(0, Math.min(m, v));
  return { x: Math.round(clamp((cssX - ox) / s, 1200)), y: Math.round(clamp((cssY - oy) / s, 800)), s, ox, oy };
}
function worldToCss(rect, wx, wy) {
  const { s, ox, oy } = expectedWorld(rect, 0, 0);
  return { x: rect.left + wx * s + ox, y: rect.top + wy * s + oy };
}

async function readout(page) {
  const t = await page.locator('output#position').textContent();
  const m = /x (\d+) \/ y (\d+)/.exec(t ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]), text: t } : { x: NaN, y: NaN, text: t };
}
async function rect(page) {
  return page.locator('canvas').evaluate((c) => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
}
async function settle(page) { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); }
// Sample backing-store pixel at a CSS position inside the canvas.
async function pixelAt(page, cssX, cssY) {
  return page.locator('canvas').evaluate((c, [x, y]) => {
    const r = c.getBoundingClientRect();
    const ctx = c.getContext('2d');
    const px = Math.round((x - r.left) * c.width / r.width), py = Math.round((y - r.top) * c.height / r.height);
    return Array.from(ctx.getImageData(px, py, 1, 1).data);
  }, [cssX, cssY]);
}

function check(list, name, pass, detail) { list.push({ name, pass: Boolean(pass), detail }); }

const browser = await chromium.launch();
results.browser = browser.version();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, hasTouch: vp.touch, isMobile: vp.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  const harnessNotes = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { if (m.text().includes('willReadFrequently')) harnessNotes.push('QA getImageData readback warning (caused by QA pixel sampling, not app)'); else errors.push(`console.${m.type()}: ${m.text()}`); } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page.addInitScript(() => {
    window.__qa = { pointers: [], contextmenu: 0, scrolls: 0 };
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      document.addEventListener(t, (e) => window.__qa.pointers.push({ t, type: e.pointerType, id: e.pointerId, primary: e.isPrimary }), true);
    }
    document.addEventListener('contextmenu', () => { window.__qa.contextmenu++; }, true);
  });
  const checks = [];
  const v = { name: vp.name, viewport: `${vp.width}x${vp.height}`, dpr: vp.dpr, touch: vp.touch, checks, screenshots: [], errors, harnessNotes };
  results.viewports.push(v);
  const cdp = await context.newCDPSession(page);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await settle(page);
  const shot = async (label, opts = {}) => {
    const file = `${vp.name}-${label}.png`;
    await page.screenshot({ path: join(OUT, file), ...opts });
    v.screenshots.push(file);
  };
  await shot('initial');
  await shot('full', { fullPage: true });

  // Layout & overflow
  const layout = await page.evaluate(() => {
    const de = document.documentElement;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > de.clientWidth + 0.5 || r.left < -0.5) && !el.classList.contains('skip-link') && !el.classList.contains('sr-only')) offenders.push(`${el.tagName}.${el.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    const c = document.querySelector('canvas');
    const cs = getComputedStyle(c);
    const bodyCs = getComputedStyle(document.querySelector('.preview-intro p'));
    const btn = document.querySelector('.reset-button').getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    return {
      scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, scrollHeight: de.scrollHeight, offenders,
      canvasCss: { w: cr.width, h: cr.height, top: cr.top, bottom: cr.bottom }, backing: { w: c.width, h: c.height }, dpr: devicePixelRatio,
      touchAction: cs.touchAction, userSelect: cs.userSelect, webkitUserSelect: cs.webkitUserSelect, callout: cs.webkitTouchCallout ?? cs.getPropertyValue('-webkit-touch-callout'),
      textUserSelect: bodyCs.userSelect, button: { w: btn.width, h: btn.height }, canvasBorder: cs.borderWidth, canvasPadding: cs.padding,
      title: document.title, h1: document.querySelector('h1').textContent,
    };
  });
  v.layout = layout;
  check(checks, 'no horizontal overflow', layout.scrollWidth <= layout.clientWidth && layout.offenders.length === 0, { scrollWidth: layout.scrollWidth, clientWidth: layout.clientWidth, offenders: layout.offenders });
  const capDpr = Math.min(vp.dpr, 2);
  check(checks, 'backing store = round(css * min(dpr,2))', layout.backing.w === Math.round(layout.canvasCss.w * capDpr) && layout.backing.h === Math.round(layout.canvasCss.h * capDpr), layout);
  check(checks, 'canvas touch-action/user-select/callout none', layout.touchAction === 'none' && layout.userSelect === 'none' && (layout.callout === 'none' || layout.callout === '' ), { touchAction: layout.touchAction, userSelect: layout.userSelect, callout: layout.callout });
  check(checks, 'page text remains selectable', layout.textUserSelect !== 'none', layout.textUserSelect);
  check(checks, 'reset button >= 44px tall', layout.button.h >= 44, layout.button);
  check(checks, 'canvas fully visible in first viewport', layout.canvasCss.bottom <= vp.height, layout.canvasCss);

  // Bring canvas into view for pointer tests (landscape starts below the fold)
  await page.locator('canvas').evaluate((c) => c.scrollIntoView({ block: 'center' }));
  await settle(page);
  v.scrollForPointerTests = await page.evaluate(() => scrollY);
  if (v.scrollForPointerTests) await shot('canvas-in-view');
  // Initial render: marker centered and pixel at center = accent
  let r = await rect(page);
  const centre = worldToCss(r, 600, 400);
  const px0 = await pixelAt(page, centre.x, centre.y);
  check(checks, 'initial marker drawn at world centre (accent #246b32)', px0[0] === 0x24 && px0[1] === 0x6b && px0[2] === 0x32, { readout: await readout(page), pixel: px0 });

  // Pointer interaction: mouse (desktop) or real CDP touch (mobile)
  const target = { x: r.left + r.width * 0.25, y: r.top + r.height * 0.3 };
  const expA = expectedWorld(r, target.x - r.left, target.y - r.top);
  const scrollBefore = await page.evaluate(() => scrollY);
  if (!vp.touch) {
    await page.mouse.move(r.left + r.width * 0.7, r.top + r.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(r.left + r.width * 0.5, r.top + r.height * 0.5, { steps: 5 });
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
  } else {
    await page.evaluate(() => { window.__qa.pointers.length = 0; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.left + r.width * 0.7, y: r.top + r.height * 0.7, id: 1 }] });
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.left + r.width * (0.7 - 0.45 * t), y: r.top + r.height * (0.7 - 0.4 * t) + 0, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x, y: target.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await settle(page);
  const afterDrag = await readout(page);
  const mA = worldToCss(r, afterDrag.x, afterDrag.y);
  const pxA = await pixelAt(page, mA.x, mA.y);
  const scrollAfter = await page.evaluate(() => scrollY);
  const ptrs = await page.evaluate(() => window.__qa.pointers.slice(-40));
  check(checks, `${vp.touch ? 'touch' : 'mouse'} drag places marker at mapped world coords`, Math.abs(afterDrag.x - expA.x) <= 1 && Math.abs(afterDrag.y - expA.y) <= 1, { expected: { x: expA.x, y: expA.y }, actual: afterDrag.text });
  check(checks, 'marker pixel drawn at mapped (clamped) world position', pxA[0] === 0x24 && pxA[1] === 0x6b && pxA[2] === 0x32, pxA);
  check(checks, 'drag on canvas does not scroll page', scrollBefore === scrollAfter, { scrollBefore, scrollAfter });
  if (vp.touch) check(checks, 'events were genuine touch pointers', ptrs.some((p) => p.t === 'pointerdown' && p.type === 'touch'), ptrs.slice(0, 4));
  await shot('after-drag');

  // Drag beyond the canvas edge (pointer capture) clamps
  if (!vp.touch) {
    await page.mouse.move(r.left + r.width / 2, r.top + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.left - 200, r.top - 200, { steps: 4 });
    await page.mouse.up();
  } else {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.left + r.width / 2, y: r.top + r.height / 2, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 2, y: Math.max(2, r.top - 100), id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await settle(page);
  const clamped = await readout(page);
  check(checks, 'drag outside canvas is captured and clamped to world', clamped.x === 0 && clamped.y === 0, clamped.text);

  // Pointer cancellation (touch only - CDP touchCancel -> pointercancel), then recovery
  if (vp.touch) {
    await page.evaluate(() => { window.__qa.pointers.length = 0; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.left + r.width * 0.8, y: r.top + r.height * 0.8, id: 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.left + r.width * 0.75, y: r.top + r.height * 0.75, id: 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await settle(page);
    const afterCancel = await readout(page);
    const cancelPtrs = await page.evaluate(() => window.__qa.pointers.map((p) => p.t));
    // a later move from another touch must not move the marker unless it is a new gesture
    const tapPt = { x: r.left + r.width * 0.4, y: r.top + r.height * 0.6 };
    const expT = expectedWorld(r, tapPt.x - r.left, tapPt.y - r.top);
    await page.touchscreen.tap(tapPt.x, tapPt.y);
    await settle(page);
    const afterTap = await readout(page);
    check(checks, 'touchcancel fires pointercancel and leaves state usable', cancelPtrs.includes('pointercancel') && Math.abs(afterTap.x - expT.x) <= 1 && Math.abs(afterTap.y - expT.y) <= 1, { cancelPtrs, afterCancel: afterCancel.text, afterTap: afterTap.text, expected: expT });

    // second (non-primary) finger ignored while first active
    const f1 = { x: r.left + r.width * 0.3, y: r.top + r.height * 0.5 };
    const expF1 = expectedWorld(r, f1.x - r.left, f1.y - r.top);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: f1.x, y: f1.y, id: 10 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: f1.x, y: f1.y, id: 10 }, { x: r.left + r.width * 0.9, y: r.top + r.height * 0.2, id: 11 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: f1.x, y: f1.y, id: 10 }, { x: r.left + r.width * 0.85, y: r.top + r.height * 0.25, id: 11 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(page);
    const mt = await readout(page);
    check(checks, 'second finger ignored (primary pointer only)', Math.abs(mt.x - expF1.x) <= 1 && Math.abs(mt.y - expF1.y) <= 1, { expected: expF1, actual: mt.text });

    // long-press: no selection, note contextmenu count
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.left + r.width / 2, y: r.top + r.height / 2, id: 20 }] });
    await page.waitForTimeout(1200);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const lp = await page.evaluate(() => ({ sel: String(getSelection()), ctx: window.__qa.contextmenu }));
    check(checks, 'long-press on canvas creates no text selection', lp.sel === '', lp);

    // touch-scroll outside canvas still scrolls the page (when scrollable)
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight);
    if (scrollable) {
      await page.evaluate(() => scrollTo(0, 0));
      const x = vp.width / 2, y0 = Math.min(vp.height - 20, 200);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 30 }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - i * 12, id: 30 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(400);
      const sy = await page.evaluate(() => scrollY);
      check(checks, 'touch-scroll on text area scrolls the page normally', sy > 0, { scrollY: sy, startY: y0 });
      await page.locator('canvas').evaluate((c) => c.scrollIntoView({ block: 'center' }));
      await settle(page);
    }
    r = await rect(page);
  }

  // Rapid clicks/taps
  const pts = Array.from({ length: 25 }, (_, i) => ({ x: r.left + r.width * (0.1 + ((i * 37) % 80) / 100), y: r.top + r.height * (0.1 + ((i * 53) % 80) / 100) }));
  for (const p of pts) { if (vp.touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); }
  await settle(page);
  const last = pts[pts.length - 1];
  const expLast = expectedWorld(r, last.x - r.left, last.y - r.top);
  const afterRapid = await readout(page);
  check(checks, `rapid ${vp.touch ? 'taps' : 'clicks'} (25) end on the last position`, Math.abs(afterRapid.x - expLast.x) <= 1 && Math.abs(afterRapid.y - expLast.y) <= 1, { expected: expLast, actual: afterRapid.text });

  // Keyboard operation: Tab order and arrows/shift/Home + button
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await settle(page);
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement?.className);
  await page.keyboard.press('Tab');
  const second = await page.evaluate(() => document.activeElement?.tagName);
  await page.keyboard.press('Tab');
  const third = await page.evaluate(() => document.activeElement?.className);
  check(checks, 'Tab order: skip link -> canvas -> Center button', first === 'skip-link' && second === 'CANVAS' && third === 'reset-button', { first, second, third });
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Home');
  await settle(page);
  const home = await readout(page);
  const sBefore = await page.evaluate(() => scrollY);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('Shift+ArrowLeft');
  await settle(page);
  const keyed = await readout(page);
  const sAfter = await page.evaluate(() => scrollY);
  const announce = await page.locator('#announcement').textContent();
  check(checks, 'Home centres; arrows step 10, Shift 50', home.x === 600 && home.y === 400 && keyed.x === 570 && keyed.y === 360, { home: home.text, keyed: keyed.text });
  check(checks, 'arrow keys on canvas do not scroll page', sBefore === sAfter, { sBefore, sAfter });
  check(checks, 'status announcement reflects position', announce === 'Marker at 570, 360 world units.', announce);
  const focusRing = await page.locator('canvas').evaluate((c) => { const s = getComputedStyle(c); return { outline: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, focusVisible: c.matches(':focus-visible') }; });
  check(checks, 'visible keyboard focus ring on canvas', focusRing.focusVisible && focusRing.outline !== 'none' && parseFloat(focusRing.width) >= 2, focusRing);
  await shot('keyboard-focus');
  for (let i = 0; i < 200; i++) await page.keyboard.press('Shift+ArrowRight');
  await settle(page);
  check(checks, 'keyboard clamps at world edge', (await readout(page)).x === 1200, (await readout(page)).text);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await settle(page);
  const btnReset = await readout(page);
  await page.keyboard.press('ArrowRight'); // focus on button: should not move marker
  await settle(page);
  check(checks, 'Center button resets via keyboard (Enter)', btnReset.x === 600 && btnReset.y === 400 && (await readout(page)).x === 600, btnReset.text);

  // Resize & DPR: world position survives and backing store tracks size
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowLeft'); // 590,400
  await settle(page);
  const sizes = vp.name.startsWith('desktop') ? [[1024, 768], [1920, 1080], [1440, 900]] : vp.name.startsWith('portrait') ? [[360, 740], [430, 932], [390, 844]] : [[740, 360], [932, 430], [844, 390]];
  const resizeLog = [];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    await settle(page);
    const l = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { cw: r.width, ch: r.height, bw: c.width, bh: c.height, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }; });
    const rr = await rect(page);
    const mc = worldToCss(rr, 590, 400);
    const px = await pixelAt(page, mc.x, mc.y);
    resizeLog.push({ w, h, ...l, readout: (await readout(page)).text, markerPixel: px });
  }
  check(checks, 'resize keeps world position, redraws marker, no overflow', resizeLog.every((e) => e.readout === 'x 0590 / y 0400' && e.markerPixel[0] === 0x24 && e.sw <= e.vw && e.bw === Math.round(e.cw * capDpr)), resizeLog);
  // DPR change via CDP device metrics
  const dprLog = [];
  for (const d of [1, 1.5, 2, 3]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: d, mobile: vp.mobile });
    await page.waitForTimeout(200);
    await settle(page);
    const l = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { dpr: devicePixelRatio, cw: r.width, bw: c.width, bh: c.height, ch: r.height }; });
    dprLog.push({ requested: d, ...l, expectedBw: Math.round(l.cw * Math.min(d, 2)), readout: (await readout(page)).text });
  }
  check(checks, 'DPR change resizes backing store (cap 2) without resetting world', dprLog.every((e) => e.bw === e.expectedBw && e.readout === 'x 0590 / y 0400'), dprLog);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
  await settle(page);

  // Hidden-tab recovery: background the page via a second tab, interact, foreground
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await page.waitForTimeout(200);
  const hiddenState = await page.evaluate(() => document.visibilityState);
  await page.locator('canvas').evaluate(() => {}); // no-op
  await page.bringToFront();
  await other.close();
  await page.waitForTimeout(200);
  await settle(page);
  const visibleState = await page.evaluate(() => document.visibilityState);
  r = await rect(page);
  const hp = { x: r.left + r.width * 0.6, y: r.top + r.height * 0.4 };
  const expH = expectedWorld(r, hp.x - r.left, hp.y - r.top);
  if (vp.touch) await page.touchscreen.tap(hp.x, hp.y); else await page.mouse.click(hp.x, hp.y);
  await settle(page);
  const afterHidden = await readout(page);
  check(checks, 'after background/foreground the canvas still responds', Math.abs(afterHidden.x - expH.x) <= 1 && Math.abs(afterHidden.y - expH.y) <= 1, { hiddenState, visibleState, actual: afterHidden.text, expected: expH });

  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await shot('final');
  check(checks, 'no console errors/warnings, page errors or failed requests', errors.length === 0, errors);
  await context.close();
}

await browser.close();
const all = results.viewports.flatMap((v) => v.checks.map((c) => ({ viewport: v.name, ...c })));
results.summary = { total: all.length, passed: all.filter((c) => c.pass).length, failed: all.filter((c) => !c.pass).map((c) => `${c.viewport}: ${c.name}`) };
writeFileSync(join(OUT, 'browser-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.summary, null, 2));
for (const v of results.viewports) for (const c of v.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} [${v.name}] ${c.name}${c.pass ? '' : ' :: ' + JSON.stringify(c.detail).slice(0, 400)}`);
