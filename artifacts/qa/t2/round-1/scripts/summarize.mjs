// Builds results.json + improvement-history.json + perf-raw.json from the raw result files.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const R = join(import.meta.dirname, '..'), J = (f) => JSON.parse(readFileSync(join(R, f), 'utf8'));
const node = J('node-results.json'), br = J('browser-results.json'), hc = J('hidden-cadence-results.json');
const ev = br.evolution;
const improvement = {}; for (const k of ['pop512_seed1_a', 'pop512_seed0_a', 'pop1000_seed1_a']) improvement[`browser_${k}`] = { records: ev[k].records.map(({ validation, ...r }) => ({ ...r, valid: validation.ok, winding: validation.winding, pathLength: validation.pathLength, maxOffCenter: validation.maxOffCenter, chordWallCrossings: validation.issues.filter((i) => i.includes('chords')).join('') || 0 })), perGeneration: ev[k].history };
for (const [k, v] of Object.entries(node.evolution)) improvement[`node_${k}`] = { records: v.recordHistory, perGeneration: v.history };
writeFileSync(join(R, 'improvement-history.json'), JSON.stringify(improvement, null, 1));
writeFileSync(join(R, 'perf-raw.json'), JSON.stringify({ conditions: br.perf.conditions, samples: br.perf.samples, rawFrameIntervalsMs: br.perf.raw, harnessRenderBenchmark: br.perf.harnessRenderBenchmark, nodeWorstCase: node.nodeWorstCase }, null, 1));
const chordHits = Object.values(ev).filter((x) => x?.records).flatMap((x) => x.records).filter((r) => r.validation.issues.some((i) => i.includes('chords'))).length;
const out = {
  subject: { path: '/Users/krrishai/.t3/worktrees/gridborn/t3-6d03a193-9765defd83188cc6', branch: 't3/evolution-simulation-worker', sha: '02ddfb14977c87f51bd96f9e5fa81dd7b3eb1bf6' },
  verdict: 'PASS (no high findings; 2 medium, 4 low)',
  environment: { cpu: 'Apple M5', os: 'macOS 27.2', node: 'v26.13.1', browser: br.browser, playwright: '1.65.1 (own install in round-1/tools)', note: 'Preview tool snapshot timed out twice; switched to isolated Playwright per policy' },
  commands: { npmTest: '66 passed / 6 files', npmBuild: 'typecheck + vite build OK (dist = T0 scaffold only)', harnessBundle: 'OK via scripts/vite.harness.config.mjs -> harness-dist (worker emitted); bundled harness evolves 5 gens identical to Node', trackedTreeClean: true },
  claimCheck: node.claimCheck,
  evolutionBrowser: Object.fromEntries(Object.entries(ev).filter(([, v]) => v?.records).map(([k, v]) => [k, { gen1: { laps: v.gen1.completedLaps, best: v.gen1.bestLapSeconds }, gen30: { laps: v.gen30.completedLaps, best: v.gen30.bestLapSeconds }, firstRecordLap: v.firstRecordLap, finalRecordLap: v.finalRecordLap, improvementPct: v.improvementPct, records: v.records.length, allRecordLapsValid: v.allRecordLapsValid, matchesNodeEngine: v.matchesNodeEngine, wallSeconds: v.wallSeconds }])),
  replayIdentity: ev.replayIdentity, eventOrder: ev.eventOrder, recordLapsWith10HzChordWallCrossings: chordHits,
  nodeEvolution: Object.fromEntries(Object.entries(node.evolution).map(([k, v]) => [k, { firstLapGen: v.firstLapGen, firstRecordLap: v.firstRecordLap, finalRecordLap: v.finalRecordLap, improvementPct: v.improvementPct, allLapsValid: v.allLapsValid, monotoneRecords: v.monotoneRecords, stepsPerSec: v.stepsPerSec }])),
  centerlineIndependence: node.centerlineIndependence, scriptedGates: node.scriptedGates, constantControl: node.constantControl, malformedMissingInnerWall: node.malformedMissingInnerWall, mirroredOval: node.mirroredOval,
  runtimeHost: node.runtime, viewports: Object.fromEntries(Object.entries(br.viewports).map(([k, v]) => [k, { horizontalOverflow: v.horizontalOverflow, layout: v.layout, rates: v.rates, pause: v.pause, selection: v.selection, pointer: v.pointerEvents?.at(-1)?.type, inspectionIssues: v.inspection?.issues, inspectionDom: v.inspectionDom, snapshotMatchesNodeReplay: v.replay, selectionAfterBoundary: v.selectionAfterBoundary, runningSelection: v.runningSelection && { selected: v.runningSelection.selected, issues: v.runningSelection.inspection?.issues }, invalidReset: v.invalidReset, staleReset: v.staleReset, rapid: v.rapid, resize: v.resize, nonFinite: v.nonFiniteSnapshots, consoleErrors: v.consoleErrors, pageErrors: v.pageErrors }])),
  lifecycleRealWorker: br.lifecycle, perf: { conditions: br.perf.conditions, samples: br.perf.samples, harnessRenderBenchmark: br.perf.harnessRenderBenchmark, nodeWorstCase: node.nodeWorstCase, consoleErrors: br.perf.consoleErrors, pageErrors: br.perf.pageErrors },
  cadence: hc, bundled: br.bundled,
  findings: [
    { id: 'M1', severity: 'medium', title: '1x/4x snapshot delivery runs at ~30-38 Hz / ~48-52 Hz instead of display rate (off-by-epsilon delivery gate)', file: 'src/sim/runtime.ts:102-104' },
    { id: 'M2', severity: 'medium', title: 'Per-run 8-error budget suppresses the error reply to a later invalid reset; pending reset never resolves', file: 'src/sim/runtime.ts:61-63,79-84' },
    { id: 'L1', severity: 'low', title: 'Track validation accepts walls inconsistent with centerline/width (missing inner wall) allowing infield laps', file: 'src/sim/validation.ts:34-101' },
    { id: 'L2', severity: 'low', title: 'Fast mode keeps the worker only ~50% busy (32-step cap + clamped setTimeout yield)', file: 'src/sim/runtime.ts:93-105' },
    { id: 'L3', severity: 'low', title: 'Stale/duplicate reset ids get no reply (contract-consistent; integration hazard)', file: 'src/sim/runtime.ts:69-70' },
    { id: 'L4', severity: 'low', title: 'Harness canvas starts below the first screen at all three viewports', file: 'qa/t2.html' },
  ],
};
writeFileSync(join(R, 'results.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ claim: out.claimCheck.match, chordHits, ev: out.evolutionBrowser, node: out.nodeEvolution }, null, 1));
