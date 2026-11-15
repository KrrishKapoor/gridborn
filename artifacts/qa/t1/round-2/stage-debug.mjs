// Round-2 reviewer: locate which cleanup stage rejects jittery overshoot strokes.
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
const g = await server.ssrLoadModule('/src/track/geometry.ts');
const c = await server.ssrLoadModule('/src/track/cleanup.ts');
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const { rng, resampleOpen, ellipse, hand } = await import('./lib.mjs');
const W = 92, LT = Math.min(32, W * 0.4);
function stages(pts) {
  let cl = []; for (const p of pts) if (!cl.length || d(cl.at(-1), p) >= 1) cl.push(p);
  const clo = c.findClosingTail(cl, W);
  const tailOk = clo ? !g.loopIntersects(clo.tail, LT, false) : null;
  if (clo && tailOk) cl = clo.loop;
  while (cl.length > 3 && d(cl[0], cl.at(-1)) < 12) cl.pop();
  const raw = g.loopIntersects(cl), gate = raw && g.loopIntersects(cl, LT);
  let post = null, seam = null;
  if (raw && !gate) {
    const s = c.simplifyJitter(cl, W); post = g.loopIntersects(s);
    // is the remaining crossing across the seam (involving the first/last 32 units)?
    if (post) { const open = g.loopIntersects(s, 0, false); seam = !open; }
  }
  return { closure: !!clo, tailOk, raw, gate, post, seamOnly: seam, ok: g.buildTrack(pts, { id: 'x', width: W }).ok };
}
const cases = [
  ['smallOvCcw desktop sp1 a1 q', () => ellipse({ cx: 760, cy: 430, rx: 300, ry: 220, dir: -1, a0: -1, extra: 140, offset: -8 }), { k: 1200/790, spacingPx: 1, ampPx: 1, quantize: true }],
  ['smallOvCcw portrait sp1 a1 float', () => ellipse({ cx: 760, cy: 430, rx: 300, ry: 220, dir: -1, a0: -1, extra: 140, offset: -8 }), { k: 3.64, spacingPx: 1, ampPx: 1, quantize: false }],
  ['smallOvCcw portrait sp1.5 a1.5 float', () => ellipse({ cx: 760, cy: 430, rx: 300, ry: 220, dir: -1, a0: -1, extra: 140, offset: -8 }), { k: 3.64, spacingPx: 1.5, ampPx: 1.5, quantize: false }],
  ['ovalCw landscape sp1 a1 q', () => ellipse({ dir: 1 }), { k: 4.3, spacingPx: 1, ampPx: 1, quantize: true }],
  ['ovalCw portrait sp1.5 a1.5 q', () => ellipse({ dir: 1 }), { k: 3.64, spacingPx: 1.5, ampPx: 1.5, quantize: true }],
];
const out = {};
for (const [name, mk, h] of cases) {
  const tally = {};
  for (let s = 1; s <= 40; s++) {
    const st = stages(hand(mk(), { ...h, seed: s * 7919 + h.spacingPx * 13 + h.ampPx * 101 }));
    const key = st.ok ? 'ok' : !st.raw ? 'later-stage' : st.gate ? 'gate:nonlocal>32' : st.seamOnly ? 'post-DP:seam-only' : 'post-DP:interior';
    tally[key] = (tally[key] ?? 0) + 1;
    if (st.closure === false || st.tailOk === false) tally[`closure=${st.closure},tailOk=${st.tailOk}`] = (tally[`closure=${st.closure},tailOk=${st.tailOk}`] ?? 0) + 1;
  }
  out[name] = tally;
}
console.log(JSON.stringify(out, null, 1));
writeFileSync('artifacts/qa/t1/round-2/stage-debug.json', JSON.stringify(out, null, 1));
await server.close();
