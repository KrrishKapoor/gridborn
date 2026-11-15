import { launch, open, state, VIEWPORTS, sleep, tap, loopPoints, stroke } from './lib.mjs';
const b = await launch();
try {
  const vp = VIEWPORTS[process.argv[2] ?? 'desktop'];
  const { page, cdp, log } = await open(b, vp, process.argv[3] ?? 'http://127.0.0.1:5294/');
  await sleep(1000);
  for (const [scale, shape] of [[1,'bean'],[0.9,'bean'],[0.8,'oval'],[1,'oval']]) {
    await tap(page, cdp, vp, '[data-drawing]'); await sleep(300);
    const pts = await loopPoints(page, { dir: 1, shape, scale });
    const box = await page.locator('.hero-canvas').boundingBox();
    const ed = await page.locator('.editor-canvas').boundingBox();
    const xs = pts.map(p=>p[0]), ys = pts.map(p=>p[1]);
    await stroke(page, cdp, vp, pts); await sleep(500);
    const s = await state(page);
    console.log(scale, shape, JSON.stringify({ box, ed, minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) }), s.feedback, s.drawing, s.meta.runId);
    if (s.drawing === 'true') { await tap(page, cdp, vp, '[data-drawing]'); await sleep(200); }
  }
  console.log(log);
} finally { await b.close(); }
