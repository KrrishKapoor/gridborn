// Round-2 reviewer: subject vs accepted-T1 baseline on a few behaviours unrelated to the new cleanup.
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
const { ellipse, resampleOpen } = await import('./lib.mjs');
const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
const s = await server.ssrLoadModule('/src/track/geometry.ts');
const b = await server.ssrLoadModule('/artifacts/qa/t1/round-2/baseline/src/track/geometry.ts');
const o = { id: 'x', width: 92 };
const rows = {};
for (const turns of [0.6, 0.7, 0.8, 0.9]) { const p = resampleOpen(ellipse({ turns }), 4); const a = s.buildTrack(p, o), c = b.buildTrack(p, o); rows[`partial-${turns}`] = { subject: a.ok || a.issues[0].code, baseline: c.ok || c.issues[0].code, sameBytes: a.ok && c.ok ? Buffer.from(a.track.walls.buffer).equals(Buffer.from(c.track.walls.buffer)) : null }; }
for (const [name, p] of Object.entries({ cleanOval: resampleOpen(ellipse(), 4), cleanSmall: resampleOpen(ellipse({ rx: 250, ry: 180 }), 3), sparse7: Array.from({ length: 7 }, (_, i) => ({ x: 600 + 400 * Math.cos(i / 7 * 6.283), y: 400 + 250 * Math.sin(i / 7 * 6.283) })) })) {
  const a = s.buildTrack(p, o), c = b.buildTrack(p, o);
  rows[name] = { subject: a.ok || a.issues[0].code, baseline: c.ok || c.issues[0].code, sameBytes: a.ok && c.ok ? Buffer.from(a.track.walls.buffer).equals(Buffer.from(c.track.walls.buffer)) : null };
}
console.log(rows); writeFileSync('artifacts/qa/t1/round-2/baseline-compare.json', JSON.stringify(rows, null, 1));
await server.close();
