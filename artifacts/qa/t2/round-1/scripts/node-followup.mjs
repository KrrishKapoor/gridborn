// Worst-case worker cost at an evolved generation (many cars alive) + allocation window check.
import * as sim from '../node-bundle/sim.mjs';
const { Engine, ovalFixture, DEFAULT_SETTINGS } = sim; const out = {};
for (const pop of [512, 1000]) {
  const e = new Engine(1, ovalFixture(), { ...DEFAULT_SETTINGS, population: pop }, { generation() {}, best() {} });
  while (e.generation < 31) e.step();
  const rows = []; for (let w = 0; w < 8; w++) { const a0 = e.alive, t0 = performance.now(); for (let i = 0; i < 60; i++) e.step(); rows.push({ sec: w + 1, aliveStart: a0, msPerStep: +((performance.now() - t0) / 60).toFixed(4) }); }
  out[`pop${pop}_gen31_firstSeconds`] = rows;
  if (global.gc) { e.step(); global.gc(); const h0 = process.memoryUsage().heapUsed, g = e.generation, gt = e.generationTick; for (let i = 0; i < 600 && e.generation === g; i++) e.step(); const h1 = process.memoryUsage().heapUsed; out[`pop${pop}_heapBytes600StepsNoBoundary`] = { bytes: h1 - h0, sameGeneration: e.generation === g, fromTick: gt }; }
}
console.log(JSON.stringify(out, null, 1));
