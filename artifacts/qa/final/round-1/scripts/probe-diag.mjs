// DEV-only: compare window.__gridborn.read() with intercepted worker events while paused (no race).
import { launch, open, VIEWPORTS, sleep, press, waitFor, save } from './lib.mjs';
const vp = VIEWPORTS.desktop, b = await launch();
try {
  const { page, cdp, context, log } = await open(b, 'http://127.0.0.1:5394/', vp);
  await waitFor(page, () => __qa.events.ready.length && __qa.last);
  await press(page, cdp, vp, '[data-rate="fast"]');
  await waitFor(page, () => __qa.events.generation.length >= 20, null, 120000);
  await press(page, cdp, vp, '[data-running]'); await sleep(500);
  const r = await page.evaluate(() => { const d = window.__gridborn.read(); const mine = __qa.events.generation.filter((e) => e.runId === __qa.last.runId);
    return { diag: d.history.entries.map((e) => [e.generation, e.bestLapSeconds, e.completedLaps, e.meanFitness]), mine: mine.map((e) => [e.generation, e.bestLapSeconds, e.completedLaps, e.meanFitness]),
      diagBest: d.best && [d.best.car, d.best.lapSeconds], mineBest: __qa.events.best.at(-1) && [__qa.events.best.at(-1).car, __qa.events.best.at(-1).lapSeconds],
      snapTick: d.snapshot.tick, mineTick: __qa.last.tick, desired: [d.desiredRunning, d.desiredRate] }; });
  const ok = JSON.stringify(r.diag) === JSON.stringify(r.mine) && JSON.stringify(r.diagBest) === JSON.stringify(r.mineBest) && r.snapTick === r.mineTick;
  console.log(ok ? 'PASS' : 'FAIL', 'DEV diagnostics read() equals intercepted worker events while paused', JSON.stringify({ n: r.diag.length, m: r.mine.length, best: r.diagBest, tick: [r.snapTick, r.mineTick], desired: r.desired, log }));
  save('probe-diag-dev.json', { ok, ...r });
  await context.close();
} finally { await b.close(); }
