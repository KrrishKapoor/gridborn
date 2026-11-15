// Round-2 reviewer: inspect one failing jitter+overshoot stroke in detail.
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
const g = await server.ssrLoadModule('/src/track/geometry.ts');
const c = await server.ssrLoadModule('/src/track/cleanup.ts');
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const { rng, resampleOpen, ellipse, hand } = await import('./lib.mjs');
const W = 92;
const h = { k: 1200 / 790, spacingPx: 1, ampPx: 1, quantize: true };
let shown = 0;
for (let s = 1; s <= 40 && shown < 3; s++) {
  const pts = hand(ellipse({ cx: 760, cy: 430, rx: 300, ry: 220, dir: -1, a0: -1, extra: 140, offset: -8 }), { ...h, seed: s * 7919 + 13 + 101 });
  let cl = []; for (const p of pts) if (!cl.length || d(cl.at(-1), p) >= 1) cl.push(p);
  const L = [0]; for (let i = 1; i < cl.length; i++) L.push(L[i - 1] + d(cl[i - 1], cl[i]));
  const total = L.at(-1);
  const clo = c.findClosingTail(cl, W);
  let loop = clo ? clo.loop : cl;
  // all crossing pairs with travel
  const pairs = [];
  const n = loop.length;
  const LL = [0]; for (let i = 0; i < n; i++) LL.push(LL[i] + d(loop[i], loop[(i + 1) % n]));
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (g.segmentsIntersect(loop[i], loop[(i + 1) % n], loop[j], loop[(j + 1) % n])) { const gap = LL[j] - LL[i]; pairs.push({ i, j, travel: +Math.min(gap, LL[n] - gap).toFixed(1), at: [+loop[i].x.toFixed(1), +loop[i].y.toFixed(1)], alongI: +LL[i].toFixed(0) }); } }
  const big = pairs.filter(p => p.travel > 32);
  if (!g.buildTrack(pts, { id: 'x', width: W }).ok) {
    shown++;
    // closest approach of tail region to start, for closure diagnosis
    let best = Infinity, bestAlong = 0; for (let i = 0; i < cl.length; i++) if (total - L[i] <= 200 && L[i] > 552) { const dd = d(cl[i], cl[0]); if (dd < best) { best = dd; bestAlong = L[i]; } }
    console.log(JSON.stringify({ seed: s, points: cl.length, total: +total.toFixed(0), closure: !!clo, trimmedTo: clo ? clo.loop.length : null, tailLen: clo ? clo.tail.length : null, closestTailToStart: +best.toFixed(2), closestAlong: +bestAlong.toFixed(0), crossings: pairs.length, nonlocal: big.slice(0, 6), start: cl[0] }));
  }
}
await server.close();
