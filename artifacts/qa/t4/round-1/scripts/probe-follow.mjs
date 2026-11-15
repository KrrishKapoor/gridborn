import { launch, open, state, VIEWPORTS, sleep, tap, tapAt, SHOTS } from './lib.mjs';
const b = await launch();
const out = { steps: [] };
const vpKey = process.argv[2] ?? 'portrait';
async function pick(page, status = 0, minGap = 8, maxInactive = 1.5) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  return page.evaluate(({ status, minGap, maxInactive }) => {
    const Q = window.__qa, cars = Q.latestCars, v = Q.view(), pop = Q.latestMeta.pop;
    const vis = []; for (let i = 0; i < pop; i++) if (cars[i * 8 + 7] === 0 || cars[i * 8 + 6] <= 2) vis.push(i);
    const css = (i) => [cars[i * 8] * v.scale + v.ox, cars[i * 8 + 1] * v.scale + v.oy];
    let best = -1, bestGap = 0;
    for (const i of vis) { if (cars[i * 8 + 7] !== status || (status && cars[i * 8 + 6] > maxInactive)) continue; const [x, y] = css(i); let g = 1e9; for (const j of vis) if (j !== i) { const [a, c] = css(j); g = Math.min(g, Math.hypot(a - x, c - y)); } if (g > bestGap) { bestGap = g; best = i; } }
    if (best < 0 || bestGap < minGap) return { ok: false, bestGap, vis: vis.length, gtick: Q.latestMeta.gtick };
    const [x, y] = css(best); return { ok: true, index: best, x: x + v.left, y: y + v.top, gap: bestGap, gtick: Q.latestMeta.gtick, inactive: cars[best * 8 + 6] };
  }, { status, minGap, maxInactive });
}
try {
  const vp = VIEWPORTS[vpKey];
  const { page, cdp, log } = await open(b, vp, process.argv[3] ?? 'http://127.0.0.1:5294/');
  await page.waitForFunction(() => window.__qa.latestMeta.gtick > 120, null, { timeout: 20000 });
  let p = await pick(page); for (let i = 0; i < 30 && !p.ok; i++) { await sleep(200); p = await pick(page); } out.steps.push({ p });
  await tapAt(page, cdp, vp, p.x, p.y); await sleep(500);
  out.steps.push({ afterFirst: await state(page) });
  await page.locator('[data-demo=sensors]').scrollIntoViewIfNeeded(); await sleep(300);
  await tap(page, cdp, vp, '[data-demo=sensors] .follow-control'); await sleep(300);
  out.steps.push({ followOff: await page.evaluate(() => ({ checked: document.querySelector('[data-demo=sensors] .follow-control input').checked, src: document.querySelector('[data-demo=sensors] [data-source]').textContent })) });
  // new selection
  await page.waitForFunction(() => { const m = window.__qa.latestMeta; return m.gtick > 120 && m.gtick < 330; }, null, { timeout: 20000, polling: 50 }).catch(() => {});
  p = await pick(page); for (let i = 0; i < 30 && !p.ok; i++) { await sleep(200); p = await pick(page); } out.steps.push({ p2: p });
  await tapAt(page, cdp, vp, p.x, p.y); await sleep(500);
  const s2 = await state(page);
  await page.locator('[data-demo=sensors]').scrollIntoViewIfNeeded(); await sleep(400);
  out.steps.push({ afterSecond: { selection: s2.selection, panelHidden: s2.panelHidden }, sensors: await page.evaluate(() => ({ checked: document.querySelector('[data-demo=sensors] .follow-control input').checked, src: document.querySelector('[data-demo=sensors] [data-source]').textContent })) });
  await page.screenshot({ path: `${SHOTS}/follow-${vp.name}-preserved.png` });
  await page.locator('[data-demo=network]').scrollIntoViewIfNeeded(); await sleep(400);
  out.steps.push({ network: await page.textContent('[data-demo=network] [data-source]') });
  // crashed car: wait for recent crash, pause, tap
  let c = { ok: false };
  for (let i = 0; i < 200 && !c.ok; i++) { c = await pick(page, 1, 7, 0.7); if (!c.ok) await sleep(80); }
  out.steps.push({ crashedPick: c });
  if (c.ok) {
    await tap(page, cdp, vp, '[data-running]'); await sleep(200);
    const c2 = await pick(page, 1, 7, 1.9); const t = c2.ok ? c2 : c;
    await tapAt(page, cdp, vp, t.x, t.y); await sleep(500);
    out.steps.push({ crashedTarget: t, inspect: await page.evaluate(() => ({ text: document.querySelector('[data-driver-state]')?.textContent, sel: document.querySelector('[data-selection]').textContent, hidden: document.querySelector('.inspection-panel').hidden })) });
    await page.screenshot({ path: `${SHOTS}/stopped-${vp.name}.png` });
    // the selected crashed car stays drawn beyond the fade when resumed
    await tap(page, cdp, vp, '[data-running]'); await sleep(2600);
    out.steps.push({ afterFade: await page.evaluate(() => ({ hidden: document.querySelector('.inspection-panel').hidden, text: document.querySelector('[data-driver-state]')?.textContent, sel: window.__qa.latestMeta.sel })) });
  }
  out.log = log;
} finally { await b.close(); }
console.log(JSON.stringify(out, (k, v) => (k === 'meta' || k === 'errors' || k === 'lastGen') ? undefined : v, 1));
import fs from 'node:fs'; fs.writeFileSync(new URL(`../raw/probe-follow-${vpKey}.json`, import.meta.url), JSON.stringify(out, null, 1));
