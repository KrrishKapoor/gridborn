import { createServer } from '../../../../../node_modules/vite/dist/node/index.js';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const REPO = path.resolve(HERE, '../../../../..');
const server = await createServer({ root: REPO, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
try {
  const { createPreset } = await server.ssrLoadModule('/src/track/presets.ts');
  const t = createPreset('broad-oval'); const d = JSON.parse(fs.readFileSync(path.join(HERE, '../raw/determinism-prod.json')));
  const s = d.lastBestSamplesA, c = t.centerline, n = c.length / 2;
  const offs = []; let len = 0;
  for (let i = 0; i < s.length; i += 4) {
    let best = Infinity, sign = 0;
    for (let k = 0; k < n; k++) { const ax = c[2 * k], ay = c[2 * k + 1], bx = c[(2 * k + 2) % c.length], by = c[(2 * k + 3) % c.length];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let u = ((s[i] - ax) * dx + (s[i + 1] - ay) * dy) / L; u = Math.max(0, Math.min(1, u));
      const px = ax + u * dx, py = ay + u * dy, dd = Math.hypot(s[i] - px, s[i + 1] - py); if (dd < best) { best = dd; sign = Math.sign(dx * (s[i + 1] - ay) - dy * (s[i] - ax)); } }
    offs.push(best * sign); if (i) len += Math.hypot(s[i] - s[i - 4], s[i + 1] - s[i - 3]);
  }
  const abs = offs.map(Math.abs).sort((a, b) => a - b);
  const out = { samples: s.length / 4, lapSecondsLastSample: s.at(-1), pathLength: +len.toFixed(1), centerlineLength: +t.length.toFixed(1), halfWidth: t.width / 2,
    medianAbsOffset: +abs[abs.length >> 1].toFixed(1), maxAbsOffset: +abs.at(-1).toFixed(1), shareBeyond20: +(abs.filter((x) => x > 20).length / abs.length).toFixed(2), withinRoad: abs.at(-1) < t.width / 2 };
  fs.writeFileSync(path.join(HERE, '../raw/best-line-analysis.json'), JSON.stringify(out, null, 1)); console.log(out);
} finally { await server.close(); }
