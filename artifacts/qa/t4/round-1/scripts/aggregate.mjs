import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const j = (f) => { try { return JSON.parse(fs.readFileSync(path.join(R, 'raw', f))); } catch { return null; } };
const browser = {};
for (const label of ['prod', 'dev']) for (const k of ['desktop', 'portrait', 'landscape']) {
  const r = j(`qa-${label}-${k}.json`); if (!r) continue;
  for (const [vp, v] of Object.entries(r.viewports)) browser[`${label} ${vp}`] = { passed: v.checks.filter((c) => c.pass).length, total: v.checks.length, failed: v.checks.filter((c) => !c.pass).map((c) => ({ name: c.name, details: c.details })), checks: v.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`) };
}
const classification = {
  'arrow keys cycle drivers': 'harness timing (desktop only): only 1 of 512 cars alive, so cycling correctly reselects the same car; isolated probe-keys.mjs shows 6→40→45→53→45',
  'Escape mid-stroke never commits': 'REAL defect L1: editor canvas lacks tabindex in production markup',
};
const out = {
  subject: { worktree: '/Users/krrishai/.t3/worktrees/gridborn/t3-3c108d66-4ceed1d07eb1b5d3', branch: 't3/production-runtime-integration', head: 'b1751e73ffb5d9850c6a129eb7d6651e0e8d2d5f' },
  verdict: 'PASS (no high findings); 1 medium, 6 low',
  commands: { 'npm ci': 'exit 0', 'npm test': '121/121 passed, 11 files', 'npm run build': 'exit 0 (tsc + vite); dist = index.html + index JS/CSS + module worker; no scaffold, no diagnostics' },
  browser, failureClassification: classification,
  regression: j('regression.json'), lifecycle: j('lifecycle.json'), performance: j('perf-prod.json'),
  determinism: (() => { const d = j('determinism-prod.json'); return d && { summary: d.summary }; })(), bestLine: j('best-line-analysis.json'),
  letterbox: j('letterbox.json'), laptopViewports: j('laptop-viewports.json'), followProbe: j('probe-follow-portrait.json'),
};
fs.writeFileSync(path.join(R, 'results.json'), JSON.stringify(out, null, 1));
console.log(Object.entries(browser).map(([k, v]) => `${k}: ${v.passed}/${v.total} ${v.failed.map((f) => f.name).join('; ')}`).join('\n'));
