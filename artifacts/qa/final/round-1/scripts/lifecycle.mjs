// Final QA: genuine-hiding attempts (headed), reduced motion, pagehide, short-landscape guide usability,
// laptop heights, focus styling crops. Usage: node lifecycle.mjs <url>
import { launch, open, VIEWPORTS, sleep, Recorder, save, stroke, ellipse, press, waitFor, ui, shot, stage, heroAlpha } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4394/';
const R = new Recorder('prod lifecycle'), raw = {};
// 1. Headed: attempt genuine OS/browser hiding (minimize, background tab). Report what actually happened.
{
  const b = await launch({ headless: false });
  try {
    const { page, context, cdp } = await open(b, url, VIEWPORTS.desktop);
    await waitFor(page, () => __qa.events.ready.length && __qa.last);
    await page.evaluate(() => { window.__vis = []; document.addEventListener('visibilitychange', () => __vis.push([performance.now(), document.visibilityState])); });
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }); await sleep(2500);
    const minimized = await page.evaluate(() => ({ hidden: document.hidden, vis: __vis.slice(), tick: __qa.last.tick }));
    await sleep(1500); const minimized2 = await page.evaluate(() => __qa.last.tick);
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }); await sleep(1500);
    const restored = await page.evaluate(() => ({ hidden: document.hidden, vis: __vis.slice(), tick: __qa.last.tick, running: __qa.last.running }));
    const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront(); await sleep(2000);
    const bg = await page.evaluate(() => ({ hidden: document.hidden, vis: __vis.slice(), tick: __qa.last.tick })); await sleep(1500);
    const bg2 = await page.evaluate(() => __qa.last.tick);
    await page.bringToFront(); await other.close(); await sleep(1500);
    const back = await page.evaluate(() => ({ hidden: document.hidden, vis: __vis.slice(), running: __qa.last.running, tick: __qa.last.tick }));
    raw.genuineHiding = { minimized, minimizedTickDelta: minimized2 - minimized.tick, restored, backgroundTab: bg, backgroundTickDelta: bg2 - bg.tick, back };
    const induced = minimized.hidden || bg.hidden;
    R.check('genuine hiding attempt recorded (informational; pass = no errors either way)', true, raw.genuineHiding);
    if (induced) R.check('when genuinely hidden, simulation pauses and resumes running', (minimized.hidden ? minimized2 === minimized.tick : bg2 === bg.tick) && back.running, raw.genuineHiding);
    await context.close();
  } finally { await b.close(); }
}
const b = await launch();
try {
  // 2. Reduced motion
  {
    const { page, context, log } = await open(b, url, VIEWPORTS.portrait, { reducedMotion: 'reduce' });
    await waitFor(page, () => __qa.events.ready.length && __qa.last); await sleep(1000);
    const s = await page.evaluate(() => ({ sb: getComputedStyle(document.documentElement).scrollBehavior, running: __qa.last.running, tick: __qa.last.tick }));
    await page.locator('.read-link').click(); await sleep(60); const y1 = await page.evaluate(() => scrollY); await sleep(600); const y2 = await page.evaluate(() => scrollY);
    R.check('reduced motion: no smooth scrolling, sim runs, no errors', s.sb !== 'smooth' && s.running && y1 === y2 && y1 > 0 && !log.pageErrors.length && !log.console.length, { s, y1, y2 });
    await context.close();
  }
  // 3. pagehide (non-persisted) disposes worker; bfcache-persisted does not
  {
    const { page, context } = await open(b, url, VIEWPORTS.desktop);
    await waitFor(page, () => __qa.events.ready.length && __qa.last);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); await sleep(300);
    const p1 = await page.evaluate(() => ({ term: __qa.terminated, kids: document.querySelector('#app').children.length }));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))); await sleep(300);
    const r0 = await page.evaluate(() => __qa.rafCount); await sleep(500);
    const p2 = await page.evaluate(() => ({ term: __qa.terminated, kids: document.querySelector('#app').children.length }));
    const r1 = await page.evaluate(() => __qa.rafCount);
    R.check('pagehide persisted keeps app; non-persisted terminates worker, empties root, stops rAF', p1.term === 0 && p1.kids > 0 && p2.term === 1 && p2.kids === 0 && r1 - r0 <= 1, { p1, p2, raf: r1 - r0 });
    await context.close();
  }
  // 4. Short landscape and other sizes: guide fully visible when drawing starts; valid inside-guide stroke accepted
  const sizes = [[667, 375, 2], [740, 360, 3], [844, 390, 3], [915, 412, 2.6], [1024, 600, 2], [1280, 720, 2], [1366, 768, 1], [1000, 700, 2]];
  raw.sizes = [];
  for (const [w, h, dpr] of sizes) {
    const vp = { name: `${w}x${h}`, width: w, height: h, dpr, touch: w < 1000 };
    const { page, context, cdp, log } = await open(b, url, vp);
    await waitFor(page, () => __qa.events.ready.length && __qa.last); await sleep(300);
    const heroVis = await page.evaluate(() => { const r = document.querySelector('.hero-canvas').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, visibleShare: Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height }; });
    await press(page, cdp, vp, '[data-drawing]'); await sleep(250);
    const st = await stage(page);
    const guide = { x: st.left + st.offsetX + 54 * st.scale, y: st.top + st.offsetY + 54 * st.scale, w: 1092 * st.scale, h: 692 * st.scale };
    const guideVisible = guide.y >= 0 && guide.y + guide.h <= vp.height;
    const hint = await page.evaluate(() => { const r = document.querySelector('[data-stage-hint]').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
    const k = await page.evaluate(() => __qa.resets.length);
    await stroke(page, cdp, vp, ellipse(600, 400, 500, 300, { n: 100 }), { jitterCss: vp.touch ? 0.5 : 0, seed: w });
    await sleep(400);
    const accepted = (await page.evaluate(() => __qa.resets.length)) > k, fb = (await ui(page)).feedback;
    await press(page, cdp, vp, '[data-drawing]'); await sleep(200);
    await page.locator('.track-stage').scrollIntoViewIfNeeded(); await shot(page, `size-${w}x${h}-drawing-guide`);
    const row = { size: vp.name, heroVisibleShareAtLoad: +heroVis.visibleShare.toFixed(2), guideCssPx: [Math.round(guide.w), Math.round(guide.h)], guideFullyVisibleWhenDrawing: guideVisible, hintVisible: hint, insideGuideStrokeAccepted: accepted, feedback: fb, errors: log.pageErrors.length + log.console.length };
    raw.sizes.push(row);
    R.check(`${vp.name}: inside-guide stroke accepted, no errors`, accepted && !row.errors, row);
    await press(page, cdp, vp, '[data-drawing]').catch(() => {});
    await context.close();
  }
  // 5. Focus styling crops: keyboard focus on hero and Draw button
  {
    const vp = VIEWPORTS.desktop; const { page, context } = await open(b, url, vp);
    await waitFor(page, () => __qa.events.ready.length && __qa.last);
    await page.keyboard.press('Tab'); let guard = 0;
    while (guard++ < 30 && !(await page.evaluate(() => document.activeElement.classList.contains('hero-canvas')))) await page.keyboard.press('Tab');
    const fv = await page.evaluate(() => ({ fv: document.activeElement.matches(':focus-visible'), outline: getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth }));
    await page.locator('.track-stage').screenshot({ path: `${process.cwd()}/../screens/focus-hero-keyboard-1440.png` });
    R.check('keyboard Tab reaches hero with visible focus outline', fv.fv && /solid/.test(fv.outline), fv);
    await context.close();
  }
} finally { await b.close(); }
save('lifecycle.json', { summary: R.summary(), results: R.results, raw });
console.log(JSON.stringify(R.summary()), JSON.stringify(raw.sizes));
