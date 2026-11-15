import { launch, open, state, VIEWPORTS, sleep, tap, loopPoints } from './lib.mjs';
const b = await launch();
const out = {};
try {
  const vp = VIEWPORTS.desktop;
  const { page, cdp, log } = await open(b, vp, process.argv[2] ?? 'http://127.0.0.1:5294/');
  await sleep(3000);
  const sel = async () => page.evaluate(() => ({ h: document.querySelector('[data-selection]').textContent, hidden: document.querySelector('.inspection-panel').hidden, active: document.activeElement.className + (document.activeElement.dataset.close !== undefined ? '[close]' : ''), workerSel: window.__qa.latestMeta.sel, sent: window.__qa.sent.filter(x => x.type === 'select').slice(-3).map(x => x.car && x.car.index) }));
  await page.focus('.hero-canvas'); await page.keyboard.press('Enter'); await sleep(500);
  out.afterEnter = await sel();
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) { await page.keyboard.press(k); await sleep(400); out[k + Math.random().toString(36).slice(2,5)] = await sel(); }
  // focus on hero canvas instead of panel
  await page.focus('.hero-canvas'); await page.keyboard.press('ArrowRight'); await sleep(400); out.heroArrow = await sel();
  // Escape while drawing: what is focused after pointerdown on editor
  await page.keyboard.press('Escape'); await sleep(200);
  await tap(page, cdp, vp, '[data-drawing]'); await sleep(200);
  const pts = await loopPoints(page);
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); await page.mouse.move(pts[3][0], pts[3][1]);
  out.focusDuringStroke = await page.evaluate(() => ({ active: document.activeElement.className || document.activeElement.tagName, editorTabIndex: document.querySelector('.editor-canvas').tabIndex, hasAttr: document.querySelector('.editor-canvas').hasAttribute('tabindex') }));
  await page.mouse.up();
  out.log = log;
} finally { await b.close(); }
console.log(JSON.stringify(out, null, 1));
