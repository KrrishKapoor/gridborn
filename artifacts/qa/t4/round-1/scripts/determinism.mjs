// Genuine improvement + deterministic replay through the normal public pipeline (production).
import { launch, open, sleep, tap, VIEWPORTS, save } from './lib.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:4294/';
const vp = VIEWPORTS.desktop;
const browser = await launch();
const out = {};
const gensOf = (page, run) => page.evaluate((r) => window.__qa.gens.filter((g) => g.runId === r).map(({ t, runId, ...g }) => g), run);
async function runUntil(page, cdp, rate, gens, timeout) {
  const before = await page.evaluate(() => window.__qa.latestMeta.runId);
  await tap(page, cdp, vp, '[data-reset]');
  await page.waitForFunction((r) => window.__qa.latestMeta.runId > r, before, { timeout: 10000 });
  const run = await page.evaluate(() => window.__qa.latestMeta.runId);
  await tap(page, cdp, vp, `[data-rate="${rate}"]`);
  await page.waitForFunction(([r, n]) => window.__qa.gens.filter((g) => g.runId === r).length >= n, [run, gens], { timeout, polling: 200 });
  return { run, gens: await gensOf(page, run), best: await page.evaluate((r) => window.__qa.bests.filter((b) => b.runId === r), run) };
}
try {
  const { context, page, cdp, log } = await open(browser, vp, base);
  const A = await runUntil(page, cdp, 'fast', 60, 120000);
  const lastBestA = await page.evaluate(() => window.__qa.lastBestSamples);
  const B = await runUntil(page, cdp, 'fast', 60, 120000);
  const C = await runUntil(page, cdp, '4', 8, 120000);
  const D = await runUntil(page, cdp, '1', 2, 120000);
  const same = (x, y, n) => JSON.stringify(x.gens.slice(0, n)) === JSON.stringify(y.gens.slice(0, n));
  const laps = A.gens.map((g) => g.bestLapSeconds);
  const firstLap = laps.find((l) => l !== null), bestLap = Math.min(...laps.filter((l) => l !== null));
  let runningBest = Infinity; const recordGens = [];
  A.gens.forEach((g) => { if (g.bestLapSeconds !== null && g.bestLapSeconds < runningBest - 1e-9) { runningBest = g.bestLapSeconds; recordGens.push([g.generation, +g.bestLapSeconds.toFixed(3)]); } });
  out.summary = {
    replayFastVsFast60: same(A, B, 60), fastVs4x8: same(A, C, 8), fastVs1x2: same(A, D, 2),
    firstLapGen: laps.findIndex((l) => l !== null) + 1, firstLap, bestLap, improvementSeconds: firstLap - bestLap, lapRecords: recordGens,
    meanFitnessGen1: A.gens[0].meanFitness, meanFitnessGen60: A.gens[59].meanFitness, completedLapsGen1: A.gens[0].completedLaps, completedLapsGen60: A.gens[59].completedLaps,
    bestEventsA: A.best.length, bestEventLapsA: A.best.map((b) => b.lap), runs: [A.run, B.run, C.run, D.run],
  };
  out.historyA = A.gens; out.historyB = B.gens.slice(0, 60); out.history4x = C.gens; out.history1x = D.gens;
  out.lastBestSamplesA = lastBestA; out.log = log;
  await context.close();
} finally { await browser.close(); }
save('raw/determinism-prod.json', out);
console.log(JSON.stringify(out.summary, null, 1));
