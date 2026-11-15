// Independent T1 geometry probe. Loads the real modules through the Vite dev server
// and checks contract properties with reviewer-written expectations (not worker-asserted output).
// Usage: node geometry-probe.mjs [baseUrl]
import { chromium } from './runner/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] ?? 'http://127.0.0.1:5293';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}/qa/t1.html`);
const out = await page.evaluate(async () => {
  const T = await import('/src/track/index.ts');
  const W = 1200, H = 800;
  const P = (x, y) => ({ x, y });
  const ellipse = (cx, cy, rx, ry, n = 100, dir = 1, start = -Math.PI / 2, wob = (t) => 0) =>
    Array.from({ length: n }, (_, i) => { const t = start + dir * i * 2 * Math.PI / n; const r = 1 + wob(t); return P(cx + rx * r * Math.cos(t), cy + ry * r * Math.sin(t)); });
  // deterministic pseudo-random for jitter
  let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  function segX(a, b, c, d) {
    const cr = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = cr(a, b, c), d2 = cr(a, b, d), d3 = cr(c, d, a), d4 = cr(c, d, b);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  function inspect(track, stroke) {
    const n = track.centerline.length / 2;
    const c = i => P(track.centerline[(i % n) * 2], track.centerline[(i % n) * 2 + 1]);
    const finite = [...track.centerline, ...track.walls, ...track.cumulativeLengths].every(Number.isFinite);
    let minWall = Infinity, maxWall = 0, reversed = 0, minClear = Infinity, maxClear = 0, minEdge = Infinity, maxEdge = 0;
    const segs = [];
    for (let k = 0; k < track.walls.length; k += 4) segs.push([P(track.walls[k], track.walls[k + 1]), P(track.walls[k + 2], track.walls[k + 3])]);
    for (let k = 0; k < segs.length; k++) {
      const [a, b] = segs[k]; const L = Math.hypot(b.x - a.x, b.y - a.y);
      minWall = Math.min(minWall, L); maxWall = Math.max(maxWall, L);
      const i = k % n; const ca = c(i), cb = c(i + 1);
      if ((b.x - a.x) * (cb.x - ca.x) + (b.y - a.y) * (cb.y - ca.y) <= 0) reversed++;
    }
    const distSeg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y; const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy))); return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
    for (let i = 0; i < n; i++) {
      const p = c(i); let best = Infinity;
      for (const [a, b] of segs) best = Math.min(best, distSeg(p, a, b));
      minClear = Math.min(minClear, best); maxClear = Math.max(maxClear, best);
      const e = Math.hypot(c(i + 1).x - p.x, c(i + 1).y - p.y); minEdge = Math.min(minEdge, e); maxEdge = Math.max(maxEdge, e);
    }
    // wall-vs-wall proper crossings (independent predicate)
    let crossings = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 2; j < segs.length; j++) {
      if (i % n === 0 && j === i + n - 1 && false) continue;
      const adjacent = (Math.floor(i / n) === Math.floor(j / n)) && ((j - i) === 1 || (j - i) === n - 1);
      if (!adjacent && segX(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) crossings++;
    }
    // ray from spawn along heading and both normals
    const ray = (o, dx, dy) => { let best = Infinity; for (const [a, b] of segs) { const ex = b.x - a.x, ey = b.y - a.y; const den = dx * ey - dy * ex; if (Math.abs(den) < 1e-12) continue; const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den; const u = ((a.x - o.x) * dy - (a.y - o.y) * dx) / den; if (t > 1e-6 && u >= 0 && u <= 1) best = Math.min(best, t); } return best; };
    const f = track.startForward, sp = track.spawn;
    const left = ray(sp, f.y, -f.x), right = ray(sp, -f.y, f.x), ahead = ray(sp, f.x, f.y);
    // winding: signed area of centerline (y down: positive = clockwise on screen)
    let area = 0; for (let i = 0; i < n; i++) { const a = c(i), b = c(i + 1); area += a.x * b.y - b.x * a.y; }
    let strokeArea = null, startDot = null, spawnToStrokeStart = null;
    if (stroke) {
      strokeArea = 0; for (let i = 0; i < stroke.length; i++) { const a = stroke[i], b = stroke[(i + 1) % stroke.length]; strokeArea += a.x * b.y - b.x * a.y; }
      const s0 = stroke[0], s1 = stroke[Math.min(5, stroke.length - 1)];
      const L = Math.hypot(s1.x - s0.x, s1.y - s0.y); startDot = ((s1.x - s0.x) * f.x + (s1.y - s0.y) * f.y) / L;
      spawnToStrokeStart = Math.hypot(sp.x - s0.x, sp.y - s0.y);
    }
    const sl = track.startLine;
    return {
      id: track.id, n, length: track.length, width: track.width, finite, walls: segs.length,
      cumulativeOk: track.cumulativeLengths[0] === 0 && track.cumulativeLengths[n] === track.length && [...track.cumulativeLengths].every((v, i, a) => i === 0 || v > a[i - 1]),
      minWall, maxWall, reversedWallSegments: reversed, minCenterClearance: minClear, maxCenterClearance: maxClear,
      minEdge, maxEdge, wallCrossings: crossings, rayLeft: left, rayRight: right, rayAhead: ahead,
      startLineLength: Math.hypot(sl.a.x - sl.b.x, sl.a.y - sl.b.y), headingUnit: Math.hypot(f.x, f.y),
      centerlineClockwise: area > 0, strokeClockwise: strokeArea === null ? null : strokeArea > 0,
      forwardMatchesStrokeDirection: startDot === null ? null : startDot > 0.5, spawnToStrokeStart,
      bounds: track.bounds,
    };
  }
  const results = {};
  const run = (name, pts, width = 92) => {
    const t0 = performance.now(); const r = T.buildTrack(pts, { id: name, width }); const ms = performance.now() - t0;
    results[name] = r.ok ? { ok: true, ms: +ms.toFixed(1), ...inspect(r.track, pts) } : { ok: false, ms: +ms.toFixed(1), issues: r.issues };
    return r;
  };
  // Presets: determinism and contract
  for (const p of T.TRACK_PRESETS) {
    const a = T.createPreset(p.id), b = T.createPreset(p.id);
    results['preset:' + p.id] = { ...inspect(a), deterministic: JSON.stringify([...a.centerline, ...a.walls]) === JSON.stringify([...b.centerline, ...b.walls]) && a.length === b.length, freshArrays: a.centerline !== b.centerline };
  }
  try { T.createPreset('nope'); results.unknownPreset = 'no throw'; } catch (e) { results.unknownPreset = e.constructor.name; }
  // Valid shapes
  run('oval-cw', ellipse(600, 400, 380, 230, 120, 1));
  run('oval-ccw', ellipse(600, 400, 380, 230, 120, -1));
  run('oval-sparse-8', ellipse(600, 400, 380, 230, 8, 1));
  run('oval-sparse-5', ellipse(600, 400, 380, 230, 5, 1));
  run('square-4', [P(250, 200), P(950, 200), P(950, 600), P(250, 600)]);
  run('triangle-3', [P(600, 120), P(1000, 650), P(200, 650)]);
  s = 7; run('oval-jitter-6', ellipse(600, 400, 360, 220, 300, 1).map(p => P(p.x + (rnd() - .5) * 12, p.y + (rnd() - .5) * 12)));
  s = 9; run('oval-jitter-15', ellipse(600, 400, 360, 220, 300, 1).map(p => P(p.x + (rnd() - .5) * 30, p.y + (rnd() - .5) * 30)));
  run('kidney-ccw', ellipse(600, 400, 400, 250, 160, -1, -Math.PI / 2, t => 0.28 * Math.max(0, Math.sin(t)) ** 3 * -1));
  run('bean-concave', ellipse(600, 400, 420, 260, 200, 1, -Math.PI / 2, t => -0.35 * Math.exp(-((t - Math.PI / 2) ** 2) * 4)));
  run('small-oval-ok', ellipse(600, 400, 150, 110, 80));
  run('rotated-start-left', ellipse(600, 400, 380, 230, 120, 1, Math.PI));
  // near closure: undershoot gaps
  for (const gapFrac of [0.03, 0.08, 0.2, 0.4]) {
    const n = 200, keep = Math.round(n * (1 - gapFrac));
    run(`gap-${gapFrac}`, ellipse(600, 400, 380, 230, n).slice(0, keep));
  }
  // overshoot past start (common hand behaviour), with small lateral hand offset
  for (const over of [10, 25, 50, 90]) {
    const n = 240; const base = ellipse(600, 400, 380, 230, n);
    const per = 2 * Math.PI / n; const extra = Math.round(over / (380 * per));
    const tail = Array.from({ length: extra }, (_, i) => { const t = -Math.PI / 2 + (i + 1) * per; return P(600 + 380 * Math.cos(t) * 0.985, 400 + 230 * Math.sin(t) * 0.985); });
    run(`overshoot-${over}`, base.concat(tail));
  }
  // invalid shapes
  run('tiny', ellipse(600, 400, 30, 20, 40));
  run('dot', [P(600, 400)]);
  run('empty', []);
  run('line-back-forth', [P(200, 400), P(900, 400), P(200, 402)]);
  run('figure-eight', Array.from({ length: 120 }, (_, i) => { const t = i * 2 * Math.PI / 120; return P(600 + 420 * Math.sin(t), 400 + 230 * Math.sin(2 * t)); }));
  run('out-of-bounds-raw', ellipse(600, 400, 640, 230));
  run('out-of-bounds-road', ellipse(600, 400, 570, 230));
  run('edge-touch-road', ellipse(600, 400, 380, 360));
  run('needle', ellipse(600, 400, 420, 40));
  run('narrow-neck', [[220,140],[430,140],[540,370],[660,370],[770,140],[980,140],[1080,400],[980,660],[770,660],[660,430],[540,430],[430,660],[220,660],[120,400]].map(([x,y]) => P(x,y)));
  run('nan', [P(NaN, 1), P(2, 3), P(4, 5)]);
  run('width-0', ellipse(600, 400, 380, 230), 0);
  // width variation (editor inherits width)
  run('width-60', ellipse(600, 400, 380, 230), 60);
  run('width-140', ellipse(600, 400, 380, 230), 140);
  // robustness / perf: 20k noisy points, and 20001
  s = 3; run('huge-20000', Array.from({ length: 20000 }, (_, i) => { const t = i * 2 * Math.PI / 20000; return P(600 + 380 * Math.cos(t) + (rnd() - .5) * 3, 400 + 230 * Math.sin(t) + (rnd() - .5) * 3); }));
  run('huge-20001', Array.from({ length: 20001 }, (_, i) => { const t = i * 2 * Math.PI / 20001; return P(600 + 380 * Math.cos(t), 400 + 230 * Math.sin(t)); }));
  // spiral-ish many laps (long perimeter)
  run('multi-lap', Array.from({ length: 2000 }, (_, i) => { const t = i * 2 * Math.PI * 5 / 2000; return P(600 + (380 - i * 0.05) * Math.cos(t), 400 + (230 - i * 0.05) * Math.sin(t)); }));
  // determinism of drawn input and input non-mutation
  const pts = ellipse(600, 400, 380, 230, 97); const copy = JSON.stringify(pts);
  const a = T.buildTrack(pts, { id: 'd', width: 92 }), b = T.buildTrack(pts, { id: 'd', width: 92 });
  results.drawnDeterministic = a.ok && b.ok && JSON.stringify([...a.track.walls]) === JSON.stringify([...b.track.walls]);
  results.inputUnmutated = JSON.stringify(pts) === copy;
  // structured clone (future worker transfer) keeps the arrays
  const cl = structuredClone(a.track); results.structuredClone = cl.walls instanceof Float32Array && cl.walls.length === a.track.walls.length;
  return results;
});
await browser.close();
writeFileSync(join(here, 'geometry-probe.json'), JSON.stringify({ base, errors, results: out }, null, 2));
const brief = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, typeof v !== 'object' ? v : v.ok === false ? `INVALID ${v.issues.map(i => i.code).join(',')} (${v.ms}ms)` : `ok n=${v.n} len=${v.length?.toFixed?.(0)} minWall=${v.minWall?.toFixed?.(2)} rev=${v.reversedWallSegments} clear=${v.minCenterClearance?.toFixed?.(1)}-${v.maxCenterClearance?.toFixed?.(1)} X=${v.wallCrossings} cw=${v.centerlineClockwise}/${v.strokeClockwise} fwd=${v.forwardMatchesStrokeDirection} spawnΔ=${v.spawnToStrokeStart?.toFixed?.(0)} rays=${v.rayLeft?.toFixed?.(1)}/${v.rayRight?.toFixed?.(1)}/${v.rayAhead?.toFixed?.(0)} ${v.ms ?? ''}ms${v.deterministic !== undefined ? ' det=' + v.deterministic : ''}`]));
console.log(JSON.stringify({ errors, brief }, null, 1));
