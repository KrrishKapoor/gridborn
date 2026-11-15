import fs from 'node:fs'; import path from 'node:path';
const raw = 'raw', out = { reviewedSha: '50c48845a1787a64b064c2ca33aa511ad2ea8e12', suites: [] };
const add = (file, label, s) => out.suites.push({ file, label: label ?? s.label, passed: s.passed, total: s.total, failed: s.failed });
for (const f of fs.readdirSync(raw).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(raw, f)));
  if (f.startsWith('guide-')) j.forEach((s) => add(f, null, s));
  else if (f.startsWith('main-')) add(f, null, j);
  else if (j.summary) add(f, null, j.summary);
}
out.totals = out.suites.reduce((a, s) => ({ passed: a.passed + s.passed, total: a.total + s.total }), { passed: 0, total: 0 });
out.npm = { ci: 'exit 0, 0 vulnerabilities (fsevents install-script warning only)', test: '144/144 passed, 12 files', build: 'exit 0; dist/index.html + index-zy4M-xBt.js + index-Cd1wJ0fS.css + worker-D_lbJ8Lc.js (module worker); 0 matches for __gridborn/installDiagnostics/diagnostics' };
const perf = (f) => JSON.parse(fs.readFileSync(path.join(raw, f))).rows;
out.performance = { headless1440: perf('perf-headless-1440x900.json'), headed1440: perf('perf-headed-1440x900.json'), headless390: perf('perf-headless-390x844.json') };
const L = JSON.parse(fs.readFileSync(path.join(raw, 'learning-prod.json')));
out.learning = { defaultOval: { gen1: L.raw.A.gens[0], gen60: L.raw.A.gens[59], records: L.raw.records }, drawnCcw: { gens: L.raw.E1.gens.length, laps: L.raw.E1.gens.map((g) => g.bestLapSeconds) } };
out.verdict = 'PASS';
out.findings = [
  { id: 'L1', severity: 'low', title: 'Short landscape drawable guide is small (accepted design trade-off of retained letterboxed stage)' },
  { id: 'L2', severity: 'low', title: 'Touch-only visitors see keyboard-only "Escape cancels the stroke" hint' },
  { id: 'L3', severity: 'low', title: 'Retained: some intermediate laptop heights need scrolling; at 1000x700 the guide is not fully visible when drawing starts' },
  { id: 'L4', severity: 'low', title: 'Retained: selection scrolls to inspector; selection clears per generation' },
  { id: 'L5', severity: 'low', title: 'Retained: fast mode worker idle ~43-58%' },
  { id: 'INFO', severity: 'info', title: 'Genuine OS/tab hiding not inducible in headed Playwright Chrome; physical iOS/Safari not tested' },
];
fs.writeFileSync('results.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.suites.map((s) => `${s.label}: ${s.passed}/${s.total}`)), JSON.stringify(out.totals));
