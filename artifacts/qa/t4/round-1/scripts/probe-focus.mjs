import { launch, open, sleep, VIEWPORTS } from './lib.mjs';
const b = await launch();
try {
  const vp = VIEWPORTS.desktop; const { page } = await open(b, vp, 'http://127.0.0.1:4294/');
  await sleep(500);
  const r = await page.locator('.hero-canvas').boundingBox();
  await page.mouse.click(r.x + 30, r.y + 30); await sleep(200);
  const mouse = await page.evaluate(() => { const c = document.querySelector('.hero-canvas'); return { focused: document.activeElement === c, focusVisible: c.matches(':focus-visible'), outline: getComputedStyle(c).outlineStyle + ' ' + getComputedStyle(c).outlineWidth, role: c.getAttribute('role') }; });
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); await sleep(200);
  const kb = await page.evaluate(() => { const c = document.querySelector('.hero-canvas'); return { focused: document.activeElement === c, focusVisible: c.matches(':focus-visible'), outline: getComputedStyle(c).outlineStyle + ' ' + getComputedStyle(c).outlineWidth }; });
  console.log(JSON.stringify({ mouse, kb }));
} finally { await b.close(); }
