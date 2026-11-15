// Independent Node checks against the real bundled src/sim code (node-bundle/sim.mjs).
// Usage: node scripts/node-checks.mjs > logs/node-checks.log ; writes node-results.json
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as sim from '../node-bundle/sim.mjs';
import { makeValidator } from './lap-validate.mjs';

const { Engine, WorkerRuntime, ovalFixture, validateTrack, DEFAULT_SETTINGS, CAR, CAR_STRIDE, CAR_STATUS, FIXED_DT, WEIGHT_COUNT, progressDelta, lapCrossing, createSnapshotStorage, snapshotTransferList } = sim;
const out = {}; const log = (...a) => console.log(...a);
const track = ovalFixture();
const validate = makeValidator(track);

function evolve(settings, gens, trk = track) {
  const history = [], records = [];
  const e = new Engine(1, trk, settings, { generation: (s) => history.push(s), best: (b) => records.push({ generation: b.car.generation, index: b.car.index, fitness: b.fitness, lapSeconds: b.lapSeconds, samples: Array.from(b.samples) }) });
  const t0 = performance.now(); let activeSum = 0, steps = 0;
  while (e.generation <= gens) { activeSum += e.alive; e.step(); steps++; }
  return { history, records, ticks: e.tick, wallMs: performance.now() - t0, meanActive: activeSum / steps, engine: e };
}

// A. Replays of claimed results + other seeds
out.evolution = {};
for (const [pop, seed, gens] of [[512, 1, 30], [1000, 1, 30], [512, 0, 30], [512, 7, 30], [512, 1, 60]]) {
  const r = evolve({ ...DEFAULT_SETTINGS, population: pop, seed }, gens);
  const laps = r.records.filter((x) => x.lapSeconds !== null);
  const val = r.records.map((x) => ({ generation: x.generation, lapSeconds: x.lapSeconds, ...validate(Float32Array.from(x.samples), x.lapSeconds) }));
  const key = `pop${pop}_seed${seed}_gen${gens}`;
  out.evolution[key] = {
    ticks: r.ticks, wallMs: r.wallMs, meanActive: r.meanActive, stepsPerSec: r.ticks / r.wallMs * 1000,
    gen1: r.history[0], genLast: r.history.at(-1), firstLapGen: laps[0]?.generation ?? null,
    firstRecordLap: laps[0]?.lapSeconds ?? null, finalRecordLap: laps.at(-1)?.lapSeconds ?? null,
    improvementPct: laps.length ? (1 - laps.at(-1).lapSeconds / laps[0].lapSeconds) * 100 : null,
    recordHistory: r.records.map((x) => ({ generation: x.generation, lapSeconds: x.lapSeconds, fitness: x.fitness, points: x.samples.length / 4 })),
    history: r.history.map((h) => ({ g: h.generation, ticks: h.ticks, laps: h.completedLaps, best: h.bestLapSeconds, bestFit: h.bestFitness, mean: h.meanFitness })),
    lapValidation: val.map(({ samples, finalPose, ...v }) => ({ ...v, samples })),
    allLapsValid: val.every((v) => v.ok), monotoneRecords: laps.every((x, i) => i === 0 || x.lapSeconds < laps[i - 1].lapSeconds),
  };
  if (key === 'pop512_seed1_gen30') out.bestPath512 = r.records.at(-1);
  log(key, 'ticks', r.ticks, 'gen1 laps', r.history[0].completedLaps, 'best', r.history[0].bestLapSeconds, '→ record', laps.at(-1)?.lapSeconds, 'valid', out.evolution[key].allLapsValid, 'steps/s', (r.ticks / r.wallMs * 1000).toFixed(0));
}
const c512 = out.evolution.pop512_seed1_gen30;
out.claimCheck = { gen1Best: c512.gen1.bestLapSeconds, gen1Claim: 9.495347595214843, gen30Record: c512.finalRecordLap, gen30Claim: 8.551251983642578,
  gen30Finishers: c512.genLast.completedLaps, gen30FinishersClaim: 339,
  match: c512.gen1.bestLapSeconds === 9.495347595214843 && c512.finalRecordLap === 8.551251983642578 };
log('claimCheck', out.claimCheck);

// B. Centerline is measurement only: replace centerline with a different (but valid) polyline;
// car motion must be identical until the first finish (finishing/selection legitimately depends on it).
function withCenterline(base, scale, n) {
  const pts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const a = i * Math.PI * 2 / n - Math.PI / 2; pts[i * 2] = 600 + 400 * Math.cos(a); pts[i * 2 + 1] = 400 + (230 + scale * Math.sin(a * 3) * 0) * Math.sin(a) + (i === 0 ? 0 : scale * Math.sin(a * 5)); }
  const cum = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; cum[i + 1] = cum[i] + Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1]); }
  return { ...base, id: 'qa-alt-centerline', centerline: pts, cumulativeLengths: cum, length: cum[n] };
}
{
  const alt = withCenterline(track, 12, 157);
  let ok = true, err = null; try { validateTrack(alt); } catch (e) { ok = false; err = e.message; }
  const s = { ...DEFAULT_SETTINGS }, a = new Engine(1, track, s, { generation() {}, best() {} }), b = ok ? new Engine(1, alt, s, { generation() {}, best() {} }) : null;
  let identicalUntil = 0, firstFinish = null;
  if (b) for (let t = 1; t <= 1800; t++) {
    a.step(); b.step();
    const finished = [...Array(s.population).keys()].some((i) => a.cars[i * CAR_STRIDE + CAR.status] === 2 || b.cars[i * CAR_STRIDE + CAR.status] === 2);
    if (finished) { firstFinish = t; break; }
    let same = true; for (let i = 0; i < s.population; i++) for (const f of [CAR.x, CAR.y, CAR.heading, CAR.speed, CAR.status]) if (a.cars[i * CAR_STRIDE + f] !== b.cars[i * CAR_STRIDE + f]) same = false;
    if (!same) break; identicalUntil = t;
  }
  out.centerlineIndependence = { altValid: ok, altError: err, identicalMotionTicks: identicalUntil, firstFinishTick: firstFinish, pass: ok && identicalUntil === firstFinish - 1 };
  log('centerlineIndependence', out.centerlineIndependence);
}

// C. Constant-control genomes (zero hidden, output biases only) through the real engine.
function constant(steerBias, throttleBias, ticks, trk = track) {
  const e = new Engine(1, trk, { ...DEFAULT_SETTINGS, population: 2, eliteCount: 1, generationSeconds: 60 }, { generation() {}, best() {} });
  e.brains.fill(0); e.brains[80] = steerBias; e.brains[89] = throttleBias; e.brains[179] = -8; // slot 1 parked
  for (let i = 0; i < 2; i++) e['sense'](i);
  const trace = []; let crashTick = null, finishTick = null;
  for (let t = 1; t <= ticks && e.generation === 1; t++) {
    e.step(); const st = e.cars[CAR.status];
    if (st === 1 && crashTick === null) crashTick = t; if (st === 2 && finishTick === null) finishTick = t;
    if (t % 30 === 0) trace.push([e.cars[CAR.x], e.cars[CAR.y], e.cars[CAR.speed], st]);
  }
  return { e, crashTick, finishTick, trace, car: Array.from(e.cars.slice(0, 8)), lap: e.laps[0], distance: e.distances[0] };
}
{
  const straight = constant(0, 8, 600);
  const x = straight.car[0], y = straight.car[1];
  let wallDist = Infinity; for (let s = 0; s < track.walls.length; s += 4) { const [ax, ay, bx, by] = track.walls.slice(s, s + 4); const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); wallDist = Math.min(wallDist, Math.hypot(x - ax - dx * t, y - ay - dy * t)); }
  const parked = constant(0, -8, 300);
  out.constantControl = {
    straightCrash: { crashTick: straight.crashTick, pose: straight.car.slice(0, 4), inactiveSeconds: straight.car[6], status: straight.car[7], wallClearance: wallDist, retainsPoseOutsideWall: wallDist >= 5 - 1e-3 },
    parked: { moved: Math.hypot(parked.car[0] - 600, parked.car[1] - 170), status: parked.car[7], progress: parked.distance, lap: parked.lap },
  };
  log('constantControl', out.constantControl);
}

// D. Scripted progress/lap accounting adversaries (same order/guards as Engine.step).
function scripted(path) {
  let proj = null, dist = 0, gates = 0, lap = -1; const q = new Engine(1, track, { ...DEFAULT_SETTINGS, population: 2, eliteCount: 1 }, { generation() {}, best() {} }).progressQuery;
  let [x, y] = path[0]; proj = q.at(x, y);
  for (let i = 1; i < path.length && lap < 0; i++) {
    const [nx, ny] = path[i], next = q.at(nx, ny), d = progressDelta(proj, next, track.length);
    if (Math.abs(d) <= Math.hypot(nx - x, ny - y) * 4 + 0.01) dist += d; proj = next;
    if (gates < 7 && dist >= (gates + 1) * track.length / 8) gates++;
    const c = lapCrossing(track, dist, gates, x, y, nx, ny); if (c >= 0) lap = i - 1 + c; x = nx; y = ny;
  }
  return { lap, dist, gates };
}
const ellipse = (a, r = 0) => [600 + (400 + r) * Math.cos(a), 400 + (230 + r) * Math.sin(a)];
{
  const top = -Math.PI / 2, res = {};
  res.jitter = scripted(Array.from({ length: 4000 }, (_, i) => [600 + (i % 2 ? 2 : -2), 170]));
  res.reverseLapThenForwardCross = scripted([...Array.from({ length: 601 }, (_, i) => ellipse(top - i * 2 * Math.PI / 600 - 0.01)), [598, 170], [602, 170]]);
  res.forward96ThenWiggleAtLine = scripted([...Array.from({ length: 577 }, (_, i) => ellipse(top + 0.01 + i * 2 * Math.PI * 0.96 / 576)), ...Array.from({ length: 200 }, (_, i) => ellipse(top + 0.01 + 2 * Math.PI * 0.96 + (i % 2 ? 0.002 : -0.002)))]);
  res.forwardLapValid = scripted(Array.from({ length: 621 }, (_, i) => ellipse(top + 0.01 + i * 2 * Math.PI / 600)));
  res.forwardLapOutsideLineExtension = scripted(Array.from({ length: 621 }, (_, i) => ellipse(top + 0.01 + i * 2 * Math.PI / 600, -60)));
  res.halfForwardHalfBack = scripted([...Array.from({ length: 300 }, (_, i) => ellipse(top + 0.01 + i * Math.PI / 299)), ...Array.from({ length: 300 }, (_, i) => ellipse(top + Math.PI - i * Math.PI / 299)), [598, 170], [602, 170]]);
  res.teleportAround = scripted([[598, 170], [1000, 400], [600, 630], [200, 400], [598, 170], [602, 170]]);
  out.scriptedGates = { ...res, pass: res.jitter.lap < 0 && res.reverseLapThenForwardCross.lap < 0 && res.forward96ThenWiggleAtLine.lap < 0 && res.forwardLapValid.lap > 0 && res.forwardLapOutsideLineExtension.lap < 0 && res.halfForwardHalfBack.lap < 0 && res.teleportAround.lap < 0 };
  log('scriptedGates', JSON.stringify(out.scriptedGates));
}

// E. Malformed-but-accepted geometry: outer wall kept, inner wall replaced by a tiny loop at the start-line endpoint.
{
  const n = 96, walls = Array.from(track.walls.slice(n * 4)); // outer loop only
  const ax = track.startLine.a.x, ay = track.startLine.a.y; // inner endpoint (600,216)
  const sq = [[ax, ay], [ax + 2, ay], [ax + 2, ay + 2], [ax, ay + 2]];
  for (let i = 0; i < 4; i++) walls.push(...sq[i], ...sq[(i + 1) % 4]);
  const bad = { ...track, id: 'qa-missing-inner', walls: Float32Array.from(walls) };
  let accepted = true, error = null; try { validateTrack(bad); } catch (e) { accepted = false; error = e.message; }
  let infield = null;
  if (accepted) { // constant right turn, radius ~230 around the oval centre: drives through the (missing) infield
    const steer = Math.atanh(2 * Math.atan(26 / 230)); const r = constant(steer, 8, 1800, bad);
    infield = { lapSeconds: r.lap || null, finishTick: r.finishTick, crashTick: r.crashTick, netProgress: r.distance };
    const ev = evolve({ ...DEFAULT_SETTINGS, population: 256, eliteCount: 8 }, 15, bad);
    const laps = ev.records.filter((x) => x.lapSeconds); infield.evolvedRecord = laps.at(-1)?.lapSeconds ?? null;
    infield.evolvedRecordValidOnRealOval = laps.length ? validate(Float32Array.from(laps.at(-1).samples), laps.at(-1).lapSeconds).issues : null;
  }
  out.malformedMissingInnerWall = { accepted, error, infield };
  log('malformedMissingInnerWall', JSON.stringify(out.malformedMissingInnerWall));
}

// F. Mirrored (counter-clockwise) oval and stadium shape: learning generality (not a pass criterion).
function mirror(t) {
  const m = (arr) => { const o = Float32Array.from(arr); for (let i = 1; i < o.length; i += 2) o[i] = 800 - o[i]; return o; };
  return { ...t, id: 'qa-mirror', centerline: m(t.centerline), walls: m(t.walls), bounds: { minX: t.bounds.minX, maxX: t.bounds.maxX, minY: 800 - t.bounds.maxY, maxY: 800 - t.bounds.minY },
    spawn: { x: t.spawn.x, y: 800 - t.spawn.y, heading: 0 }, startLine: { a: { x: t.startLine.a.x, y: 800 - t.startLine.a.y }, b: { x: t.startLine.b.x, y: 800 - t.startLine.b.y } } };
}
{
  const mt = mirror(track); let ok = true, err = null; try { validateTrack(mt); } catch (e) { ok = false; err = e.message; }
  const r = ok ? evolve({ ...DEFAULT_SETTINGS }, 15, mt) : null;
  out.mirroredOval = { valid: ok, err, gen1Laps: r?.history[0].completedLaps, gen15Laps: r?.history.at(-1).completedLaps, record: r?.records.filter((x) => x.lapSeconds).at(-1)?.lapSeconds ?? null };
  log('mirroredOval', out.mirroredOval);
}

// G. Runtime/protocol edge cases with a controlled host (real structured clone + transfers).
class Host {
  constructor() { this.time = 0; this.events = []; this.tasks = new Map(); this.n = 0; this.runtime = new WorkerRuntime(this); }
  now() { return this.time; } schedule(cb) { this.tasks.set(++this.n, cb); return this.n; } cancel(h) { this.tasks.delete(h); }
  send(ev, transfer = []) { this.events.push(structuredClone(ev, { transfer })); }
  cmd(c) { this.runtime.receive(c); }
  pump(ms = 0) { this.time += ms; const f = this.tasks.entries().next().value; if (f) { this.tasks.delete(f[0]); f[1](); } }
  snaps() { return this.events.filter((e) => e.type === 'snapshot').map((e) => e.snapshot); }
  recycle(s) { this.runtime.receive(structuredClone({ type: 'recycle', runId: s.runId, storage: s.storage }, { transfer: snapshotTransferList(s.storage) })); }
}
const reset = (h, runId, ch = {}, trk = ovalFixture()) => h.cmd({ type: 'reset', runId, track: trk, settings: { ...DEFAULT_SETTINGS, population: 32, eliteCount: 2, ...ch } });
{
  const r = {};
  // 1. error cap: 8 malformed commands, then an invalid reset: does main get any answer?
  let h = new Host(); reset(h, 1);
  for (let i = 0; i < 8; i++) h.cmd(i % 2 ? { type: 'set-rate', runId: 1, rate: 100 } : { type: 'set-running', runId: 1, running: 'yes' }); // alternate => distinct consecutive messages
  const before = h.events.length; reset(h, 2, { population: 5000 });
  const reply = h.events.slice(before).map((e) => e.type);
  r.invalidResetAfterErrorCap = { errorsBefore: h.events.filter((e) => e.type === 'error').length, repliesToInvalidReset: reply, silent: reply.length === 0 };
  // ...and a valid reset afterwards still works
  reset(h, 3); r.invalidResetAfterErrorCap.validResetAfter = h.events.slice(-2).map((e) => e.type);
  // 2. stale/duplicate reset ids
  h = new Host(); reset(h, 5); const n5 = h.events.length; reset(h, 5); reset(h, 4); reset(h, 3, { population: 9999 });
  r.staleResets = { replies: h.events.slice(n5).map((e) => e.type), engineRun: h.runtime.engine.runId };
  // 3. invalid inputs keep accepted run (running) intact
  h = new Host(); reset(h, 1); h.cmd({ type: 'set-running', runId: 1, running: true }); for (let i = 0; i < 20; i++) h.pump(16.7);
  const tickBefore = h.runtime.engine.tick, brains = h.runtime.engine.brains.slice();
  const bads = {
    nullTrack: { track: null }, nanCenter: { track: { ...ovalFixture(), centerline: Float32Array.from(ovalFixture().centerline, (v, i) => (i === 10 ? NaN : v)) } },
    plainArrays: { track: { ...ovalFixture(), centerline: Array.from(ovalFixture().centerline) } },
    figure8: (() => { const t = ovalFixture(); const c = Float32Array.from(t.centerline); [c[20], c[100]] = [c[100], c[20]]; return { track: { ...t, centerline: c } }; })(),
    outOfWorld: (() => { const t = ovalFixture(); return { track: { ...t, bounds: { ...t.bounds, maxX: 1300 } } }; })(),
    openWalls: (() => { const t = ovalFixture(); return { track: { ...t, walls: t.walls.slice(4) } }; })(),
    reversedForward: (() => { const t = ovalFixture(); return { track: { ...t, startForward: { x: -1, y: 0 }, spawn: { ...t.spawn, heading: Math.PI } } }; })(),
    seedNeg: { settings: { seed: -1 } }, seedHuge: { settings: { seed: 2 ** 32 } }, pop1: { settings: { population: 1 } }, pop1001: { settings: { population: 1001 } },
    eliteEqPop: { settings: { eliteCount: 32 } }, mutNaN: { settings: { mutationRate: NaN } }, genInf: { settings: { generationSeconds: Infinity } }, gen0: { settings: { generationSeconds: 0 } },
    raySmall: { settings: { rayLength: 0 } }, speedNeg: { settings: { maxSpeed: -1 } }, settingsNull: { settingsNull: true },
  };
  let id = 10; r.invalidInputs = {};
  for (const [name, b] of Object.entries(bads)) {
    const k = h.events.length; const settings = b.settingsNull ? null : { ...DEFAULT_SETTINGS, population: 32, eliteCount: 2, ...(b.settings || {}) };
    h.cmd({ type: 'reset', runId: ++id, track: b.track === undefined ? ovalFixture() : b.track, settings });
    r.invalidInputs[name] = h.events.slice(k).map((e) => e.type === 'error' ? `error: ${e.message}` : e.type).join(' | ') || '(no reply)';
    if (Object.keys(r.invalidInputs).length % 7 === 0) reset(h, ++id), h.cmd({ type: 'set-running', runId: id, running: true }); // successful reset clears error cap
  }
  r.invalidInputsRunKept = h.runtime.engine.runId;
  // run intact check on a separate host with < 8 errors
  h = new Host(); reset(h, 1); h.cmd({ type: 'set-running', runId: 1, running: true }); for (let i = 0; i < 20; i++) h.pump(16.7);
  const t1 = h.runtime.engine.tick, b1 = h.runtime.engine.brains.slice(), rng = h.runtime.engine.random.state;
  reset(h, 2, { population: 5000 }); reset(h, 3, {}, { ...ovalFixture(), walls: new Float32Array(24) });
  r.transactionalInvalid = { runId: h.runtime.engine.runId, tickSame: h.runtime.engine.tick === t1, brainsSame: h.runtime.engine.brains.every((v, i) => v === b1[i]), rngSame: h.runtime.engine.random.state === rng, stillRunning: h.runtime.running };
  for (let i = 0; i < 5; i++) h.pump(16.7); r.transactionalInvalid.continuesStepping = h.runtime.engine.tick > t1;
  // 4. pause: no ticks for a long time, no catch-up after resume
  h = new Host(); reset(h, 1); h.cmd({ type: 'set-running', runId: 1, running: true }); for (let i = 0; i < 10; i++) h.pump(16.7);
  h.cmd({ type: 'set-running', runId: 1, running: false }); const tp = h.runtime.engine.tick; for (let i = 0; i < 50; i++) h.pump(10000);
  r.pause = { ticksWhilePaused: h.runtime.engine.tick - tp, queued: h.tasks.size };
  h.time += 60000; h.cmd({ type: 'set-running', runId: 1, running: true }); const tr = h.runtime.engine.tick; h.pump(0); h.pump(16.7);
  r.pause.stepsFirstTwoPumpsAfterResume = h.runtime.engine.tick - tr;
  // 5. suspension while running (timer delayed 30 s): bounded to 0.25 s * rate
  for (const rate of [1, 4]) {
    h = new Host(); reset(h, 1); h.cmd({ type: 'set-rate', runId: 1, rate }); h.cmd({ type: 'set-running', runId: 1, running: true }); for (let i = 0; i < 5; i++) h.pump(16.7);
    const ts = h.runtime.engine.tick; h.pump(30000); const burst = h.runtime.engine.tick - ts; let after = 0; for (let i = 0; i < 20; i++) { const a = h.runtime.engine.tick; h.pump(0); after += h.runtime.engine.tick - a; }
    r[`suspension_rate${rate}`] = { stepsInFirstPumpAfter30sStall: burst, followUpZeroElapsedSteps: after, simSecondsGained: (burst + after) * FIXED_DT };
  }
  // 6. pool bounds, unsolicited recycles, foreign buffers
  h = new Host(); reset(h, 1); h.cmd({ type: 'set-rate', runId: 1, rate: 'fast' }); h.cmd({ type: 'set-running', runId: 1, running: true });
  for (let i = 0; i < 200; i++) h.pump(10);
  const delivered = h.snaps().length; const ticksNoRecycle = h.runtime.engine.tick;
  for (let i = 0; i < 6; i++) h.cmd({ type: 'recycle', runId: 1, storage: createSnapshotStorage(32) }); // foreign but well-formed
  const afterForeign = h.snaps().length;
  h.cmd({ type: 'set-running', runId: 1, running: false });
  r.pool = { deliveredWithoutRecycle: delivered, ticksAdvanced: ticksNoRecycle, snapshotsAfter6ForeignRecycles: afterForeign, poolLen: h.runtime.pool.length, outstanding: h.runtime.outstanding,
    note: 'foreign full-size buffers are accepted up to outstanding credit (documented limit)' };
  // detached / wrong-size / shared recycle
  const k = h.events.length; const bad = createSnapshotStorage(32); structuredClone(bad.cars.buffer, { transfer: [bad.cars.buffer] });
  h.cmd({ type: 'recycle', runId: 1, storage: bad }); h.cmd({ type: 'recycle', runId: 1, storage: createSnapshotStorage(33) });
  const shared = createSnapshotStorage(32); h.cmd({ type: 'recycle', runId: 1, storage: { ...shared, weights: new Float32Array(shared.cars.buffer, 0, 90) } });
  r.badRecycles = h.events.slice(k).map((e) => e.type === 'error' ? e.message : e.type);
  // 7. selection: stale/invalid car ids; clears at generation boundary
  h = new Host(); reset(h, 1, { generationSeconds: 0.2 });
  const sels = [{ runId: 1, generation: 1, index: 3 }, { runId: 1, generation: 2, index: 3 }, { runId: 9, generation: 1, index: 3 }, { runId: 1, generation: 1, index: 32 }, { runId: 1, generation: 1, index: 1.5 }, { runId: 1, generation: 1, index: -1 }, { runId: 1, generation: 1, index: NaN }, 'garbage', { runId: 1, generation: 1 }];
  r.selection = sels.map((car) => { h.cmd({ type: 'select', runId: 1, car }); return h.snaps().at(-1).selected; });
  h.cmd({ type: 'select', runId: 1, car: { runId: 1, generation: 1, index: 3 } }); h.cmd({ type: 'set-running', runId: 1, running: true });
  for (let i = 0; i < 30; i++) { h.pump(16.7); const s = h.snaps().at(-1); if (s) h.recycle(s); }
  const g2 = h.snaps().find((s) => s.generation === 2); r.selectionClearedOnGen2 = g2 ? g2.selected === null : 'no gen2 snapshot';
  // 8. scheduling/observation independence: three schedules must reach identical state at equal ticks
  const run = (sched) => { const hh = new Host(); reset(hh, 1, { population: 64, eliteCount: 4 }); hh.cmd({ type: 'set-rate', runId: 1, rate: sched.rate }); hh.cmd({ type: 'set-running', runId: 1, running: true });
    let i = 0; while (hh.runtime.engine.tick < 4000) { hh.pump(sched.ms(i)); if (sched.recycle && i % 3 === 0) { const s = hh.snaps().at(-1); if (s && s.storage.cars.byteLength) hh.recycle(s); } if (sched.select && i % 7 === 0) hh.cmd({ type: 'select', runId: 1, car: { runId: 1, generation: hh.runtime.engine.generation, index: i % 64 } }); i++; }
    // step a fresh engine to the same tick
    const e = hh.runtime.engine; return { tick: e.tick, cars: Array.from(e.cars), brains: Array.from(e.brains), gen: e.generation }; };
  const A = run({ rate: 1, ms: () => 16.7, recycle: true }), B = run({ rate: 'fast', ms: () => 0, recycle: false, select: true }), C = run({ rate: 4, ms: (i) => (i % 5) * 9.3, recycle: true, select: true });
  const ref = new Engine(1, ovalFixture(), { ...DEFAULT_SETTINGS, population: 64, eliteCount: 4 }, { generation() {}, best() {} });
  const cmp = (X) => { while (ref.tick < X.tick) ref.step(); return ref.tick === X.tick && X.cars.every((v, i) => Object.is(v, ref.cars[i])) && X.brains.every((v, i) => Object.is(v, ref.brains[i])); };
  // ticks differ by batching; compare each against a fresh reference stepped to its own tick
  const res = []; for (const X of [A, B, C].sort((p, q) => p.tick - q.tick)) res.push({ tick: X.tick, identicalToDirectEngine: cmp(X) });
  r.scheduleIndependence = res;
  out.runtime = r;
  log('runtime', JSON.stringify(r, null, 1));
}

// H. Worst-case worker cost: all cars active (first 120 ticks of generation 1), plus allocation check.
{
  const perf = {};
  for (const pop of [512, 1000]) {
    const e = new Engine(1, track, { ...DEFAULT_SETTINGS, population: pop }, { generation() {}, best() {} });
    for (let i = 0; i < 30; i++) e.step();
    const t0 = performance.now(); for (let i = 0; i < 120; i++) e.step(); const ms = (performance.now() - t0) / 120;
    perf[`pop${pop}_allActiveFirstSeconds`] = { msPerStep: ms, alive: e.alive, stepsPerSecOneCore: 1000 / ms, rate4CoreShare: ms * 240 / 1000 };
  }
  if (global.gc) {
    const e = new Engine(1, track, { ...DEFAULT_SETTINGS, population: 512 }, { generation() {}, best() {} });
    for (let i = 0; i < 50; i++) e.step(); global.gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1500; i++) e.step(); const h1 = process.memoryUsage().heapUsed; global.gc(); const h2 = process.memoryUsage().heapUsed;
    perf.heapGrowthBytesOver1500StepsNoBoundary = { preGc: h1 - h0, postGc: h2 - h0, generation: e.generation };
  }
  out.nodeWorstCase = perf; log('nodeWorstCase', perf);
}

writeFileSync(resolve(import.meta.dirname, '../node-results.json'), JSON.stringify(out, null, 1));
log('wrote node-results.json');
