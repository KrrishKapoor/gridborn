// Controlled visibility (not genuine OS hiding) during a stroke, plus 4x CPU-throttled 1000-car sample.
import { launch, open, VIEWPORTS, sleep, Recorder, save, stroke, ellipse, press, waitFor, ui } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4394/', R = new Recorder('prod hidden-draw/throttle'), raw = {};
const b = await launch();
try {
  for (const vp of [VIEWPORTS.desktop, VIEWPORTS.portrait]) {
    const { page, context, cdp, log } = await open(b, url, vp);
    await waitFor(page, () => __qa.events.ready.length && __qa.last);
    await press(page, cdp, vp, '[data-drawing]'); await sleep(200);
    const k = await page.evaluate(() => __qa.resets.length);
    const setHidden = (h) => page.evaluate((hid) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hid }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hid ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, h);
    let mid;
    await stroke(page, cdp, vp, ellipse(600, 400, 400, 250, { n: 90 }), { beforeUp: async () => { mid = (await ui(page)).active; await setHidden(true); await sleep(200); await setHidden(false); await sleep(200); } });
    await sleep(400);
    const u = await ui(page);
    const guide = await page.evaluate(() => { const c = document.querySelector('.hero-canvas'), d = c.getContext('2d').getImageData(2, Math.round(c.height / 2), 1, 1).data; return d[3]; });
    R.check(`${vp.name}: controlled hide mid-stroke cancels; release does not commit; drawing ends, guide removed, focus to hero`, (await page.evaluate(() => __qa.resets.length)) === k && u.drawingPressed === 'false' && guide === 0 && u.active === 'hero-canvas' && mid === 'editor-canvas', { mid, u: [u.drawingPressed, u.active, u.runLabel], guide });
    R.check(`${vp.name}: running intent restored after controlled visibility`, (await page.evaluate(() => __qa.last.running)) && u.running === 'true');
    await page.evaluate(() => { delete document.hidden; delete document.visibilityState; });
    R.check(`${vp.name}: no errors`, !log.pageErrors.length && !log.console.length, log);
    await context.close();
  }
  // 4x CPU throttle (main thread emulation of a slower device), 1000 cars, 1x, early generation
  const vp = VIEWPORTS.desktop; const { page, context, cdp } = await open(b, url, vp);
  await waitFor(page, () => __qa.events.ready.length && __qa.last);
  await page.selectOption('[data-population]', '1000'); await waitFor(page, () => __qa.last.population === 1000, null, 20000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await sleep(1500);
  await page.evaluate(() => { __qa.frames = []; __qa.deliveries = []; __qa.sampling = true; __qa.t0 = performance.now(); }); await sleep(5000);
  const r = await page.evaluate(() => { __qa.sampling = false; const g = new Map(); for (const f of __qa.frames) { const x = g.get(f[0]) || { d: 0, n: 0, ch: 0 }; x.d += f[1]; x.n += f[3]; x.ch |= f[5]; g.set(f[0], x); }
    const fs = [...g.values()], dur = performance.now() - __qa.t0; return { fps: fs.length / (dur / 1000), cb: fs.reduce((s, f) => s + f.d, 0) / fs.length, cbMax: Math.max(...fs.map((f) => f.d)), changing: fs.filter((f) => f.n && f.ch).length / fs.filter((f) => f.n).length, snaps: __qa.deliveries.length / (dur / 1000), steps: __qa.deliveries.reduce((s, d) => s + d[2], 0) / (dur / 1000), alive: __qa.deliveries.at(-1)?.[4] }; });
  raw.throttle4x1000 = r;
  R.check('4x CPU throttle, 1000 cars @1x: informational sample recorded', true, r);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await context.close();
} finally { await b.close(); }
save('probe-hidden-draw-throttle.json', { summary: R.summary(), results: R.results, raw });
console.log(JSON.stringify(R.summary()));
