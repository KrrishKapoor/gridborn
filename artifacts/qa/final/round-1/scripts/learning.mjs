// Final QA: genuine learning, deterministic replay, rate independence, recorded paths (production, public controls).
// Usage: node learning.mjs <url> <prod|dev>
import { launch, open, VIEWPORTS, sleep, Recorder, save, stroke, ellipse, press, waitFor, ui, shot } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4394/', mode = process.argv[3] || 'prod';
const vp = VIEWPORTS.desktop, R = new Recorder(`${mode} learning`);
const b = await launch();
const raw = {};
async function history(page, run) {
  return page.evaluate((r) => ({ gens: __qa.events.generation.filter((e) => e.runId === r).map(({ t, runId, ...g }) => g),
    best: __qa.events.best.filter((e) => e.car.runId === r).map(({ t, ...x }) => x) }), run);
}
async function untilGens(page, n, timeout = 240000) {
  const run = await page.evaluate(() => __qa.last.runId);
  await waitFor(page, ([r, k]) => __qa.events.generation.filter((e) => e.runId === r).length >= k, [run, n], timeout);
  return run;
}
async function fresh(page, cdp, how) {
  const k = await page.evaluate(() => __qa.events.ready.length);
  await how();
  await waitFor(page, (n) => __qa.events.ready.length > n && __qa.last.runId === __qa.events.ready.at(-1).runId, k, 20000);
  return page.evaluate(() => __qa.last.runId);
}
const same = (a, b, n) => JSON.stringify(a.slice(0, n)) === JSON.stringify(b.slice(0, n));
try {
  const { page, log, context, cdp } = await open(b, url, vp);
  await waitFor(page, () => __qa.events.ready.length && __qa.last);
  // A: default oval, seed 1, 60 generations fast (public Reset learning).
  const N = 60;
  let runA = await fresh(page, cdp, () => press(page, cdp, vp, '[data-reset]'));
  await press(page, cdp, vp, '[data-rate="fast"]'); await untilGens(page, N); await press(page, cdp, vp, '[data-running]');
  const A = await history(page, runA);
  // B: replay
  await press(page, cdp, vp, '[data-running]');
  let runB = await fresh(page, cdp, () => press(page, cdp, vp, '[data-reset]'));
  await press(page, cdp, vp, '[data-rate="fast"]'); await untilGens(page, N); await press(page, cdp, vp, '[data-running]');
  const B = await history(page, runB);
  R.check(`default oval: run A and replay B identical for ${N} generations (stats + best paths)`, same(A.gens, B.gens, N) && JSON.stringify(A.best.filter((x) => x.car.generation <= N).map(({ car, ...x }) => [car.generation, car.index, x])) === JSON.stringify(B.best.filter((x) => x.car.generation <= N).map(({ car, ...x }) => [car.generation, car.index, x])), { a: A.gens.length, b: B.gens.length });
  const laps = A.gens.map((g) => g.bestLapSeconds);
  const firstLap = laps.find((x) => x != null), best = Math.min(...laps.filter((x) => x != null));
  const records = A.best.filter((x) => x.lapSeconds != null).map((x) => [x.car.generation, +x.lapSeconds.toFixed(4)]);
  R.check('default oval: actual best lap improves over generations', best < firstLap * 0.95 && records.length >= 8, { firstLap, best, records: records.length, firstGen: A.gens[0], lastGen: A.gens.at(-1) });
  R.check('default oval: completed laps and mean fitness rise', A.gens.at(-1).completedLaps > A.gens[0].completedLaps * 5 && A.gens.at(-1).meanFitness > A.gens[0].meanFitness + 0.5, { c: [A.gens[0].completedLaps, A.gens.at(-1).completedLaps], m: [A.gens[0].meanFitness, A.gens.at(-1).meanFitness] });
  // Recorded paths are real: sample count ~ 10 Hz of lap time, fitness formula, distinct per record, not a centerline.
  const D = Math.ceil(30 * 60) / 60;
  const pathChecks = A.best.filter((x) => x.lapSeconds != null).map((x) => {
    const m = x.samples.length / 4, tEnd = x.samples[(m - 1) * 4 + 3];
    let len = 0; for (let i = 1; i < m; i++) len += Math.hypot(x.samples[i * 4] - x.samples[(i - 1) * 4], x.samples[i * 4 + 1] - x.samples[(i - 1) * 4 + 1]);
    return { gen: x.car.generation, car: x.car.index, lap: x.lapSeconds, samples: m, tEnd, len, fitErr: Math.abs(x.fitness - (2 + Math.max(0, 1 - x.lapSeconds / D))) };
  });
  R.check('recorded best paths: ~10 Hz samples spanning the lap time, fitness = 2 + (1 - t/D)', pathChecks.every((p) => Math.abs(p.tEnd - p.lap) < 0.02 && Math.abs(p.samples - (Math.floor(p.lap * 10) + 2)) <= 2 && p.fitErr < 1e-3), { sample: pathChecks.slice(0, 3) });
  const uniq = new Set(A.best.map((x) => x.samples.slice(0, 40).join(','))).size;
  R.check('every record path is a distinct recorded trajectory (not canned)', uniq === A.best.length, { uniq, n: A.best.length });
  const track = await page.evaluate(() => __qa.resets.at(-1));
  const cl = []; for (let i = 0; i < track.centerline.length; i += 2) cl.push([track.centerline[i], track.centerline[i + 1]]);
  const lastBest = A.best.filter((x) => x.lapSeconds != null).at(-1);
  const offs = []; for (let i = 0; i < lastBest.samples.length; i += 4) { let d = 1e9; for (const [x, y] of cl) d = Math.min(d, Math.hypot(x - lastBest.samples[i], y - lastBest.samples[i + 1])); offs.push(d); }
  offs.sort((a, b) => a - b);
  const lenBest = pathChecks.at(-1).len;
  R.check('evolved best line is not the centerline (cuts inside: shorter path, large median offset, within road)', lenBest < track.length * 0.97 && offs[offs.length >> 1] > 10 && offs.at(-1) < track.width / 2 + 1, { lenBest, centerline: track.length, medianOffset: offs[offs.length >> 1], maxOffset: offs.at(-1) });
  // C: rate independence: 4x for 3 generations equals fast
  await press(page, cdp, vp, '[data-running]');
  const runC = await fresh(page, cdp, () => press(page, cdp, vp, '[data-reset]'));
  await press(page, cdp, vp, '[data-rate="4"]'); await untilGens(page, 3, 120000);
  const C = await history(page, runC);
  R.check('4x presentation produces the identical first 3 generations as fast', same(C.gens, A.gens, 3), { c: C.gens.slice(0, 3).map((g) => g.bestLapSeconds), a: A.gens.slice(0, 3).map((g) => g.bestLapSeconds) });
  // 1x for 1 generation (~10-30 s)
  const runD = await fresh(page, cdp, () => press(page, cdp, vp, '[data-reset]'));
  await press(page, cdp, vp, '[data-rate="1"]'); await untilGens(page, 1, 60000);
  const Dh = await history(page, runD);
  R.check('1x presentation produces identical generation 1', same(Dh.gens, A.gens, 1), { d: Dh.gens[0], a: A.gens[0] });
  // E: drawn circuit replay — same real stroke twice gives identical learning.
  const shape = ellipse(600, 400, 440, 260, { n: 100, clockwise: false });
  const drawOnce = async () => { const k = await page.evaluate(() => __qa.events.ready.length); await press(page, cdp, vp, '[data-drawing]'); await sleep(200); await stroke(page, cdp, vp, shape);
    await waitFor(page, (n) => __qa.events.ready.length > n && __qa.last.runId === __qa.events.ready.at(-1).runId, k, 20000); return page.evaluate(() => __qa.last.runId); };
  const runE1 = await drawOnce(); await press(page, cdp, vp, '[data-rate="fast"]'); await untilGens(page, 25); await press(page, cdp, vp, '[data-running]');
  const E1 = await history(page, runE1);
  await press(page, cdp, vp, '[data-running]');
  const runE2 = await drawOnce(); await press(page, cdp, vp, '[data-rate="fast"]'); await untilGens(page, 25); await press(page, cdp, vp, '[data-running]');
  const E2 = await history(page, runE2);
  const t1 = await page.evaluate(([a, b]) => { const r = __qa.resets; const x = r.find((q) => q.runId === a), y = r.find((q) => q.runId === b); return JSON.stringify(x.centerline) === JSON.stringify(y.centerline); }, [runE1, runE2]);
  R.check('drawn CCW circuit: identical geometry from identical stroke', t1);
  R.check('drawn CCW circuit: replay identical for 25 generations', same(E1.gens, E2.gens, 25));
  const eLaps = E1.gens.map((g) => g.bestLapSeconds).filter((x) => x != null);
  R.check('drawn CCW circuit: actual best lap improves', eLaps.length && Math.min(...eLaps) < eLaps[0] * 0.97, { first: eLaps[0], best: Math.min(...eLaps), records: E1.best.filter((x) => x.lapSeconds != null).length });
  await press(page, cdp, vp, '[data-running]'); await sleep(1200); await page.locator('.track-stage').scrollIntoViewIfNeeded();
  await shot(page, `${mode}-1440x900-learning-drawn-ccw-evolved`);
  if (mode === 'dev') {
    await press(page, cdp, vp, '[data-running]'); await sleep(500); // pause: no race between the two reads
    const d = await page.evaluate(() => { const r = window.__gridborn.read(); return { entries: r.history.entries.map(({ runId, ...e }) => e), bestLap: r.best?.lapSeconds, run: r.snapshot.runId }; });
    const mine = (await history(page, d.run)).gens;
    R.check('DEV diagnostics history equals intercepted worker generation events', JSON.stringify(d.entries.map((e) => [e.generation, e.bestLapSeconds, e.completedLaps])) === JSON.stringify(mine.map((e) => [e.generation, e.bestLapSeconds, e.completedLaps])), { n: d.entries.length });
  }
  raw.A = { gens: A.gens, best: A.best.map(({ samples, ...x }) => x) }; raw.B = { gens: B.gens }; raw.C = C.gens; raw.D = Dh.gens; raw.E1 = { gens: E1.gens, best: E1.best.map(({ samples, ...x }) => x) }; raw.E2 = E2.gens; raw.pathChecks = pathChecks; raw.records = records;
  raw.bestLineSamples = lastBest.samples;
  R.check('no console/page/request errors', !log.console.length && !log.pageErrors.length && !log.requestFailed.length && !log.badResponses.length, log);
  await context.close();
} finally { await b.close(); }
save(`learning-${mode}.json`, { summary: R.summary(), results: R.results, raw });
console.log(JSON.stringify(R.summary()));
