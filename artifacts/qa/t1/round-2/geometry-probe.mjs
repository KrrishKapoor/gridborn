// Independent T1 round-2 geometry probe. Authored by the round-2 reviewer.
// Loads the subject modules and the accepted-T1 baseline (git show 0d3dcc5) through Vite,
// and checks every accepted track with this file's own topology/clearance predicates.
// Usage (from repo root): node artifacts/qa/t1/round-2/geometry-probe.mjs
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
const subject = await server.ssrLoadModule('/src/track/index.ts');
const basePresets = await server.ssrLoadModule('/artifacts/qa/t1/round-2/baseline/src/track/presets.ts');
const baseGeom = await server.ssrLoadModule('/artifacts/qa/t1/round-2/baseline/src/track/geometry.ts');
const { buildTrack, createPreset, TRACK_PRESETS } = subject;
const W = 92;
const out = { meta: { root, date: new Date().toISOString() }, sections: {} };
const failures = [];
const fail = (section, name, detail) => failures.push({ section, name, detail });

// ---------- independent predicates ----------
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segHit(a, b, c, e) { // closed segments touch or cross (incl. collinear overlap)
  const o1 = orient(a, b, c), o2 = orient(a, b, e), o3 = orient(c, e, a), o4 = orient(c, e, b);
  const eps = 1e-9;
  const on = (p, q, r) => Math.min(p.x, r.x) - eps <= q.x && q.x <= Math.max(p.x, r.x) + eps && Math.min(p.y, r.y) - eps <= q.y && q.y <= Math.max(p.y, r.y) + eps;
  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true;
  if (Math.abs(o1) <= eps && on(a, c, b)) return true;
  if (Math.abs(o2) <= eps && on(a, e, b)) return true;
  if (Math.abs(o3) <= eps && on(c, a, e)) return true;
  if (Math.abs(o4) <= eps && on(c, b, e)) return true;
  return false;
}
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const polyDist = (p, pts, closed) => {
  let m = Infinity; const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) m = Math.min(m, segDist(p, pts[i], pts[(i + 1) % n]));
  return m;
};
const area = pts => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; } return s / 2; };
function loopSimple(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segHit(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
  }
  return true;
}
const centerOf = t => Array.from({ length: t.centerline.length / 2 }, (_, i) => ({ x: t.centerline[2 * i], y: t.centerline[2 * i + 1] }));

/** Full independent contract check of an accepted track. `stroke` = raw input (world). */
function checkTrack(t, stroke, { keepFrac = 1 } = {}) {
  const issues = [];
  const n = t.centerline.length / 2;
  const c = centerOf(t);
  if (t.walls.length !== n * 8 || t.cumulativeLengths.length !== n + 1) issues.push('array sizes');
  for (const arr of [t.centerline, t.walls, t.cumulativeLengths]) if (!arr.every(Number.isFinite)) issues.push('nonfinite');
  if (t.cumulativeLengths[0] !== 0 || t.cumulativeLengths[n] !== t.length) issues.push('cumulative ends');
  for (let i = 1; i <= n; i++) if (!(t.cumulativeLengths[i] > t.cumulativeLengths[i - 1])) { issues.push('cumulative not increasing'); break; }
  const segs = [];
  for (let k = 0; k < 2 * n; k++) segs.push({ a: { x: t.walls[4 * k], y: t.walls[4 * k + 1] }, b: { x: t.walls[4 * k + 2], y: t.walls[4 * k + 3] }, side: k < n ? 0 : 1, i: k % n });
  for (const s of segs) { const nx = segs[s.side * n + (s.i + 1) % n]; if (s.b.x !== nx.a.x || s.b.y !== nx.a.y) { issues.push('wall loop not closed'); break; } }
  let crossings = 0;
  for (let p = 0; p < segs.length; p++) for (let q = p + 1; q < segs.length; q++) {
    const A = segs[p], B = segs[q];
    if (A.side === B.side && (Math.abs(A.i - B.i) === 1 || Math.abs(A.i - B.i) === n - 1)) continue;
    if (segHit(A.a, A.b, B.a, B.b)) crossings++;
  }
  if (crossings) issues.push(`wall crossings ${crossings}`);
  if (!loopSimple(c)) issues.push('centerline self-intersects');
  // clearance: vertices and edge midpoints vs every wall
  let minV = Infinity, minM = Infinity;
  for (let i = 0; i < n; i++) {
    const v = c[i], m = { x: (c[i].x + c[(i + 1) % n].x) / 2, y: (c[i].y + c[(i + 1) % n].y) / 2 };
    for (const s of segs) { minV = Math.min(minV, segDist(v, s.a, s.b)); minM = Math.min(minM, segDist(m, s.a, s.b)); }
  }
  if (minV < t.width / 2 - 0.01) issues.push(`vertex clearance ${minV.toFixed(3)}`);
  if (minM < t.width / 2 - 1.5) issues.push(`midpoint clearance ${minM.toFixed(3)}`);
  // inner/outer walls really are on opposite sides (area signs equal, |inner| < |outer|)
  const L = segs.slice(0, n).map(s => s.a), R = segs.slice(n).map(s => s.a);
  if (Math.sign(area(L)) !== Math.sign(area(R)) || Math.sign(area(L)) !== Math.sign(area(c))) issues.push('wall orientation');
  // bounds
  const xs = [...L, ...R].map(p => p.x), ys = [...L, ...R].map(p => p.y);
  const b = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  if (b.minX !== t.bounds.minX || b.maxX !== t.bounds.maxX || b.minY !== t.bounds.minY || b.maxY !== t.bounds.maxY) issues.push('bounds mismatch');
  if (b.minX < 0 || b.minY < 0 || b.maxX > 1200 || b.maxY > 800) issues.push('outside world');
  // start/spawn
  const sl = d(t.startLine.a, t.startLine.b), f = t.startForward;
  // startLine joins the miter points left[0]/right[0] (pre-existing T1 behaviour): width <= length <= ~1.02*width
  if (sl < t.width - 0.05 || sl > t.width * 1.02) issues.push(`start line length ${sl}`);
  if (Math.abs(Math.hypot(f.x, f.y) - 1) > 1e-6) issues.push('startForward not unit');
  const sx = t.startLine.b.x - t.startLine.a.x, sy = t.startLine.b.y - t.startLine.a.y;
  if (Math.abs((sx * f.x + sy * f.y) / sl) > 1e-3) issues.push('start line not perpendicular');
  if (Math.abs(Math.atan2(f.y, f.x) - t.spawn.heading) > 1e-9) issues.push('heading');
  // fidelity to the drawn stroke
  const keep = stroke.slice(0, Math.max(3, Math.floor(stroke.length * keepFrac)));
  const sign = Math.sign(area(keep));
  if (sign !== Math.sign(area(c))) issues.push('direction reversed');
  let c2s = 0; for (const p of c) c2s = Math.max(c2s, polyDist(p, keep, true));
  let s2c = 0; for (let i = 0; i < keep.length; i += 2) s2c = Math.max(s2c, polyDist(keep[i], c, true));
  const spawnErr = d(t.spawn, stroke[0]);
  if (c2s > 45 || s2c > 45) issues.push(`shape drift c2s=${c2s.toFixed(1)} s2c=${s2c.toFixed(1)}`);
  if (spawnErr > 40) issues.push(`spawn ${spawnErr.toFixed(1)} from stroke start`);
  return { ok: issues.length === 0, issues, n, length: t.length, minVertexClearance: +minV.toFixed(4), minMidClearance: +minM.toFixed(4), wallCrossings: crossings, c2s: +c2s.toFixed(2), s2c: +s2c.toFixed(2), spawnErr: +spawnErr.toFixed(2), bounds: t.bounds, orientation: Math.sign(area(c)) };
}

// ---------- stroke generators (world units) ----------
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function resampleOpen(pts, step) {
  const outp = [pts[0]]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = d(a, b); let pos = step - carry;
    while (pos <= L) { outp.push({ x: a.x + (b.x - a.x) * pos / L, y: a.y + (b.y - a.y) * pos / L }); pos += step; }
    carry = L - (pos - step);
  }
  return outp;
}
/** Ellipse traced from angle a0 for `turns` turns (dir +1 = clockwise on screen, y down). */
function ellipse({ cx = 600, cy = 400, rx = 420, ry = 250, a0 = -Math.PI / 2, dir = 1, turns = 1, extra = 0, offset = 0, ramp = 40, wobble = null } = {}) {
  const dense = [];
  const per = 4000;
  // approximate perimeter for converting extra arc length into angle
  const P = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const totalAngle = turns * 2 * Math.PI + (extra / P) * 2 * Math.PI;
  const steps = Math.ceil(per * totalAngle / (2 * Math.PI));
  for (let i = 0; i <= steps; i++) {
    const t = a0 + dir * totalAngle * i / steps;
    const past = Math.max(0, (dir * (t - a0) - 2 * Math.PI * turns)) / (2 * Math.PI) * P; // arc past start
    // offset along the true outward normal (positive = outward), ramped in over `ramp` units past the start
    const o = past > 0 ? offset * Math.min(1, past / ramp) : 0;
    const w = wobble ? wobble(t) : 0;
    const ex = rx + w, ey = ry + w, nx = ey * Math.cos(t), ny = ex * Math.sin(t), nl = Math.hypot(nx, ny);
    dense.push({ x: cx + ex * Math.cos(t) + o * nx / nl, y: cy + ey * Math.sin(t) + o * ny / nl });
  }
  return dense;
}
/** Convert a world stroke into "hand" samples at CSS scale k (world per CSS px). */
function hand(world, { k = 3.64, spacingPx = 1.5, ampPx = 1, seed = 1, quantize = false } = {}) {
  const r = rng(seed);
  return resampleOpen(world, spacingPx * k).map(p => {
    let x = p.x / k + (r() * 2 - 1) * ampPx, y = p.y / k + (r() * 2 - 1) * ampPx;
    if (quantize) { x = Math.round(x); y = Math.round(y); }
    return { x: x * k, y: y * k };
  });
}
const build = (pts, w = W, impl = buildTrack) => impl(pts, { id: 'probe', width: w });

// ---------- 1. presets: byte identity vs accepted T1 ----------
{
  const rows = [];
  const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('hex');
  for (const { id } of TRACK_PRESETS) {
    const a = createPreset(id), b = basePresets.createPreset(id), a2 = createPreset(id);
    const same = ['centerline', 'cumulativeLengths', 'walls'].every(k => bytes(a[k]) === bytes(b[k]))
      && a.length === b.length && JSON.stringify([a.bounds, a.startLine, a.startForward, a.spawn, a.width, a.id]) === JSON.stringify([b.bounds, b.startLine, b.startForward, b.spawn, b.width, b.id]);
    const fresh = a.centerline !== a2.centerline && bytes(a.walls) === bytes(a2.walls);
    // preset seed points as a stroke for the fidelity check: use the centerline itself
    const chk = checkTrack(a, centerOf(a));
    rows.push({ id, byteIdenticalToBaseline: same, freshArrays: fresh, vertices: a.centerline.length / 2, walls: a.walls.length / 4, length: a.length, valid: chk.ok, issues: chk.issues, minVertexClearance: chk.minVertexClearance });
    if (!same || !fresh || !chk.ok) fail('presets', id, rows.at(-1));
  }
  let unknown = false; try { createPreset('nope'); } catch (e) { unknown = e instanceof RangeError; }
  if (!unknown) fail('presets', 'unknown id', 'no RangeError');
  out.sections.presets = { rows, unknownThrowsRangeError: unknown, defaultLength: createPreset('broad-oval').length };
}

// ---------- 2. overshoot matrix ----------
{
  const rows = [];
  const shapes = [
    { name: 'oval-top', o: { a0: -Math.PI / 2 } },
    { name: 'oval-right', o: { a0: 0 } },
    { name: 'oval-135', o: { a0: 2.35 } },
    { name: 'small-left', o: { cx: 380, cy: 330, rx: 260, ry: 190, a0: Math.PI } },
    { name: 'small-low-right', o: { cx: 820, cy: 500, rx: 280, ry: 200, a0: 1.2 } },
  ];
  for (const s of shapes) for (const dir of [1, -1]) {
    const exact = ellipse({ ...s.o, dir });
    const exactRes = build(resampleOpen(exact, 4));
    for (const extra of [0, 40, 80, 120, 160, 200]) for (const offset of [-15, -8, 0, 8, 15]) {
      if (extra === 0 && offset !== 0) continue;
      const stroke = resampleOpen(ellipse({ ...s.o, dir, extra, offset }), 4);
      const res = build(stroke);
      const row = { shape: s.name, dir: dir > 0 ? 'cw' : 'ccw', extra, offset, ok: res.ok, code: res.ok ? null : res.issues[0].code };
      if (res.ok) {
        const ch = checkTrack(res.track, stroke, { keepFrac: 1 - (extra + 10) / (stroke.length * 4) });
        row.valid = ch.ok; row.issues = ch.issues; row.length = +res.track.length.toFixed(1); row.c2s = ch.c2s; row.spawnErr = ch.spawnErr;
        if (exactRes.ok) { row.lengthVsExact = +(res.track.length / exactRes.track.length).toFixed(4); let h = 0; const ce = centerOf(exactRes.track); for (const p of centerOf(res.track)) h = Math.max(h, polyDist(p, ce, true)); row.hausdorffVsExact = +h.toFixed(2); }
        if (!ch.ok || (row.hausdorffVsExact ?? 0) > 12) fail('overshoot', JSON.stringify(row), ch.issues);
      } else if (extra <= 160) fail('overshoot', JSON.stringify(row), 'rejected');
      // baseline comparison
      row.baselineOk = build(stroke, W, baseGeom.buildTrack).ok;
      rows.push(row);
    }
  }
  const ok160 = rows.filter(r => r.extra <= 160);
  out.sections.overshoot = { accepted: ok160.filter(r => r.ok).length, total: ok160.length, baselineAccepted: ok160.filter(r => r.baselineOk).length,
    extra200: rows.filter(r => r.extra === 200).map(r => `${r.shape}/${r.dir}/${r.offset}:${r.ok ? 'ok' : r.code}`), rows };
}

// ---------- 2b. overshoot with literally coincident retrace (collinear overlap) ----------
{
  const rows = [];
  for (const dir of [1, -1]) {
    const loop = resampleOpen(ellipse({ dir }), 4);
    for (const extraPts of [20, 30, 40, 50, 75]) { // 80..300 world units of exact retrace
      const stroke = [...loop, ...loop.slice(0, extraPts)];
      const r = build(stroke);
      const row = { dir, retraceUnits: extraPts * 4, ok: r.ok, code: r.ok ? null : r.issues[0].code };
      if (r.ok) { const ch = checkTrack(r.track, loop); row.valid = ch.ok; row.issues = ch.issues; if (!ch.ok) fail('retrace', JSON.stringify(row), ch.issues); }
      if (extraPts * 4 <= 160 && !r.ok) fail('retrace', JSON.stringify(row), 'exact retrace within 160 rejected');
      if (extraPts * 4 >= 300 && r.ok) fail('retrace', JSON.stringify(row), 'long retrace accepted');
      rows.push(row);
    }
  }
  out.sections.coincidentRetrace = rows;
}

// ---------- 3. jitter sweeps at device CSS scales ----------
const SCALES = { desktop1440: 1200 / 790, portrait390: 3.64, landscape844: 4.3 }; // replaced by measured values in browser report
function sweep(label, mk, seeds = 40) {
  const res = [];
  for (const [vp, k] of Object.entries(SCALES)) for (const spacingPx of [1, 1.5, 3]) for (const ampPx of [0.5, 1, 1.5]) for (const quantize of [false, true]) {
    let ok = 0, base = 0, invalidGeom = 0; const codes = {};
    for (let s = 1; s <= seeds; s++) {
      const stroke = hand(mk(s), { k, spacingPx, ampPx, seed: s * 7919 + spacingPx * 13 + ampPx * 101, quantize });
      const r = build(stroke);
      if (r.ok) { ok++; const ch = checkTrack(r.track, stroke, { keepFrac: 0.93 }); if (!ch.ok) { invalidGeom++; fail('jitter', `${label}/${vp}/${spacingPx}/${ampPx}/${quantize}/${s}`, ch.issues); } }
      else codes[r.issues[0].code] = (codes[r.issues[0].code] ?? 0) + 1;
      if (build(stroke, W, baseGeom.buildTrack).ok) base++;
    }
    res.push({ vp, k: +k.toFixed(3), spacingPx, ampPx, quantize, accepted: ok, of: seeds, baselineAccepted: base, invalidGeom, codes });
  }
  return res;
}
{
  const t0 = Date.now();
  out.sections.jitter = {
    ovalCw: sweep('oval-cw', () => ellipse({ dir: 1 })),
    ovalCcw: sweep('oval-ccw', () => ellipse({ dir: -1, a0: 0.7 })),
    smallOvalOvershootCw: sweep('small-ov-cw', () => ellipse({ cx: 420, cy: 360, rx: 300, ry: 210, dir: 1, a0: Math.PI, extra: 120, offset: 8 })),
    smallOvalOvershootCcw: sweep('small-ov-ccw', () => ellipse({ cx: 760, cy: 430, rx: 300, ry: 220, dir: -1, a0: -1, extra: 140, offset: -8 })),
    kidneyCw: sweep('kidney', () => ellipse({ dir: 1, a0: 0.3, extra: 80, wobble: t => -70 * Math.exp(-((Math.sin(t) + 1) ** 2) / 0.3) })),
    ms: Date.now() - t0,
  };
  // round-1's ±3 world-unit white noise at 4-unit spacing, 20 seeds
  const rows = [];
  for (let s = 1; s <= 20; s++) {
    const r = rng(s * 31337);
    const stroke = resampleOpen(ellipse({ dir: s % 2 ? 1 : -1 }), 4).map(p => ({ x: p.x + (r() * 2 - 1) * 3, y: p.y + (r() * 2 - 1) * 3 }));
    const a = build(stroke); const ch = a.ok ? checkTrack(a.track, stroke) : null;
    if (ch && !ch.ok) fail('white3', s, ch.issues);
    rows.push({ seed: s, ok: a.ok, code: a.ok ? null : a.issues[0].code, valid: ch?.ok, baselineOk: build(stroke, W, baseGeom.buildTrack).ok });
  }
  out.sections.white3 = { accepted: rows.filter(r => r.ok).length, baselineAccepted: rows.filter(r => r.baselineOk).length, rows };
  // heavier noise to locate the remaining limit
  const heavy = [];
  for (const amp of [4, 5, 6, 8]) {
    let ok = 0, bad = 0;
    for (let s = 1; s <= 20; s++) {
      const r = rng(s * 977 + amp);
      const stroke = resampleOpen(ellipse({ dir: 1 }), 4).map(p => ({ x: p.x + (r() * 2 - 1) * amp, y: p.y + (r() * 2 - 1) * amp }));
      const a = build(stroke); if (a.ok) { ok++; if (!checkTrack(a.track, stroke).ok) bad++; }
    }
    heavy.push({ ampWorld: amp, spacing: 4, accepted: ok, of: 20, invalidGeom: bad });
    if (bad) fail('heavy', amp, bad);
  }
  out.sections.heavyNoise = heavy;
}

// ---------- 4. must-reject set ----------
{
  const lem = (s = 1, cx = 600, cy = 400, ox = 0) => Array.from({ length: 900 }, (_, i) => { const t = -Math.PI / 2 + i * 2 * Math.PI / 900; const den = 1 + Math.sin(t) ** 2; return { x: cx + ox + s * 480 * Math.cos(t) / den, y: cy + s * 480 * Math.sin(t) * Math.cos(t) / den }; });
  const pinch = p => resampleOpen(Array.from({ length: 3001 }, (_, i) => { const t = -Math.PI / 2 + 0.4 + i * 2 * Math.PI / 3000; return { x: 600 + 420 * Math.cos(t), y: 400 + 250 * Math.sin(t) * (1 - p * Math.exp(-(Math.cos(t) ** 2) / 0.02)) }; }), 4);
  const loop = resampleOpen(ellipse({ dir: 1 }), 4);
  const along = (n0, n1) => loop.slice(n0, n1);
  const cases = {
    figureEight: lem(1), figureEightSmall: lem(0.6, 600, 400), figureEightLeft: lem(0.5, 330, 300),
    figureEightNoisy: hand(lem(1), { k: 3.64, spacingPx: 1.5, ampPx: 1, seed: 5 }),
    shallowPinchCross2pct: pinch(1.02), shallowPinchCross8pct: pinch(1.08), pinchTouch: pinch(1.0),
    twoLaps: resampleOpen(ellipse({ turns: 2 }), 4), twoLapsOffset10: resampleOpen(ellipse({ turns: 1, extra: 2130, offset: -10 }), 4),
    lapAndHalf: resampleOpen(ellipse({ turns: 1, extra: 1000, offset: 6 }), 4),
    overshoot400Offset8: resampleOpen(ellipse({ extra: 400, offset: 8 }), 4),
    exactRetrace300: [...loop, ...loop.slice(0, 75)],
    // tail: reach start, retrace 60, then a lobe of radius r inside the 18-unit corridor, then continue 40
    tailLobeR8: (() => { const base = [...loop, ...along(0, 15)]; const c = loop[15], nx = loop[16]; const ang = Math.atan2(nx.y - c.y, nx.x - c.x); const lobe = Array.from({ length: 30 }, (_, i) => { const t = ang - Math.PI / 2 + i * 2 * Math.PI / 29; return { x: c.x + 8 * Math.cos(ang + Math.PI / 2) + 8 * Math.cos(t), y: c.y + 8 * Math.sin(ang + Math.PI / 2) + 8 * Math.sin(t) }; }); return [...base, ...lobe, ...along(16, 26)]; })(),
    tailReversal: [...loop, ...along(0, 25).map(p => ({ x: p.x, y: p.y + 3 })), ...along(5, 24).reverse().map(p => ({ x: p.x, y: p.y + 6 }))],
    tailDepartOutward: (() => { const s = [...loop, ...along(0, 15)]; const e = s.at(-1); return [...s, ...Array.from({ length: 30 }, (_, i) => ({ x: e.x + i * 0.5, y: e.y - i * 4 }))]; })(),
    tailDepartInward: (() => { const s = [...loop, ...along(0, 15)]; const e = s.at(-1); return [...s, ...Array.from({ length: 40 }, (_, i) => ({ x: e.x + i * 1, y: e.y + i * 4 }))]; })(),
    tiny: resampleOpen(ellipse({ rx: 40, ry: 30 }), 2), dot: [{ x: 600, y: 400 }, { x: 600.2, y: 400.1 }],
    line: Array.from({ length: 200 }, (_, i) => ({ x: 200 + i * 4, y: 400 })),
    nan: [...loop.slice(0, 50), { x: NaN, y: 3 }, ...loop.slice(50)], inf: [...loop.slice(0, 50), { x: Infinity, y: 3 }, ...loop.slice(50)],
    nullPoint: [...loop.slice(0, 50), null, ...loop.slice(50)], notArray: 'abc',
    outsideLeft: loop.map(p => ({ x: p.x - 181, y: p.y })), outsideByOne: [...loop.slice(0, 100), { x: 1200.5, y: 400 }, ...loop.slice(100)],
    roadOutside: resampleOpen(ellipse({ cx: 600, cy: 400, rx: 570, ry: 370 }), 4),
    tooManyPoints: Array.from({ length: 20001 }, (_, i) => ({ x: 600 + 300 * Math.cos(i / 20001 * 2 * Math.PI), y: 400 + 200 * Math.sin(i / 20001 * 2 * Math.PI) })),
    longPerimeter: resampleOpen(ellipse({ turns: 10 }), 2),
  };
  const rows = {};
  for (const [name, pts] of Object.entries(cases)) {
    let r; try { r = build(pts); } catch (e) { r = { threw: String(e) }; }
    rows[name] = r.threw ? { threw: r.threw } : { ok: r.ok, code: r.ok ? null : r.issues[0].code, message: r.ok ? null : r.issues[0].message };
    if (r.ok) { const ch = checkTrack(r.track, Array.isArray(pts) ? pts.filter(Boolean) : []); rows[name].acceptedValidity = ch.issues; }
    if (r.threw || r.ok) fail('mustReject', name, rows[name]);
  }
  // bad options
  for (const [name, o] of Object.entries({ width0: { id: 'x', width: 0 }, widthNeg: { id: 'x', width: -5 }, widthNaN: { id: 'x', width: NaN }, widthHuge: { id: 'x', width: 801 }, idEmpty: { id: ' ', width: 92 }, noOpts: undefined })) {
    let r; try { r = buildTrack(loop, o); } catch (e) { r = { threw: String(e) }; }
    rows[name] = r.threw ? { threw: r.threw } : { ok: r.ok, code: r.ok ? null : r.issues[0].code };
    if (r.threw || r.ok) fail('mustReject', name, rows[name]);
  }
  out.sections.mustReject = rows;
  // tiny lobes in the tail and small pigtails in the body: either rejected or a fully valid track
  const lobes = [];
  for (const rad of [2, 3, 4, 5, 6, 8, 12]) for (const where of ['tail', 'body']) {
    const at = where === 'tail' ? loop.length + 12 : 200;
    const seq = where === 'tail' ? [...loop, ...along(0, 30)] : loop;
    const c = seq[at], nx = seq[at + 1]; const ang = Math.atan2(nx.y - c.y, nx.x - c.x);
    const lobe = Array.from({ length: 24 }, (_, i) => { const t = ang - Math.PI / 2 + i * 2 * Math.PI / 23; return { x: c.x + rad * Math.cos(ang + Math.PI / 2) + rad * Math.cos(t), y: c.y + rad * Math.sin(ang + Math.PI / 2) + rad * Math.sin(t) }; });
    const stroke = [...seq.slice(0, at), ...lobe, ...seq.slice(at + 1)];
    const r = build(stroke); const row = { radius: rad, where, ok: r.ok, code: r.ok ? null : r.issues[0].code };
    if (r.ok) { const ch = checkTrack(r.track, loop); row.valid = ch.ok; if (!ch.ok) fail('lobes', JSON.stringify(row), ch.issues); }
    lobes.push(row);
  }
  out.sections.pigtails = lobes;
}

// ---------- 5. early-close proximity must not truncate ----------
{
  const rows = [];
  // Path passes within `gap` of its start at fraction f of travel, then departs and draws more road.
  // Built as: an oval missing its last part, then a detour that brushes the start and continues outward.
  const loop = resampleOpen(ellipse({ dir: 1, rx: 380, ry: 230 }), 4);
  const start = loop[0];
  for (const brushAt of [0.8, 0.9, 0.95]) for (const gapPx of [2, 10]) {
    const n = Math.floor(loop.length * brushAt);
    const body = loop.slice(0, n);
    const e = body.at(-1);
    // go toward a point just below the start, brushing it, then continue down-right (departing tail)
    const target = { x: start.x - 10, y: start.y + gapPx };
    const seg = resampleOpen([e, target, { x: start.x + 60, y: start.y + 60 }, { x: start.x + 120, y: start.y + 160 }], 4);
    const stroke = [...body, ...seg.slice(1)];
    const r = build(stroke);
    const row = { brushAt, gapPx, ok: r.ok, code: r.ok ? null : r.issues[0].code };
    if (r.ok) {
      const ch = checkTrack(r.track, stroke);
      // did the departing part survive? distance from the final stroke point to the centerline
      row.endToCenter = +polyDist(stroke.at(-1), centerOf(r.track), true).toFixed(1);
      row.valid = ch.ok; row.issues = ch.issues;
      if (row.endToCenter > 45) fail('earlyClose', JSON.stringify(row), 'departing segment truncated');
    }
    rows.push(row);
  }
  // A short stroke that returns to its start before 6*width of travel, then continues: must not be closed there.
  const hook = resampleOpen(ellipse({ cx: 600, cy: 300, rx: 70, ry: 50, extra: 0 }), 4);
  const cont = resampleOpen([hook.at(-1), { x: 600, y: 600 }, { x: 900, y: 600 }, { x: 900, y: 300 }], 4);
  const hr = build([...hook, ...cont.slice(1)]);
  rows.push({ case: 'early-hook-then-continue', ok: hr.ok, code: hr.ok ? null : hr.issues[0].code });
  // Incomplete loop (only 70% drawn): must not be accepted as if closed by proximity
  const part = resampleOpen(ellipse({ dir: 1, turns: 0.7 }), 4);
  const pr = build(part);
  rows.push({ case: 'incomplete-70pct', ok: pr.ok, code: pr.ok ? null : pr.issues[0].code, ...(pr.ok ? { c2s: checkTrack(pr.track, part).c2s } : {}) });
  out.sections.earlyClose = rows;
}

// ---------- 6. triangles / sharp corners (L2) ----------
{
  const rows = [];
  const tri = (s, rr = 0) => {
    const v = [0, 1, 2].map(i => { const t = -Math.PI / 2 + i * 2 * Math.PI / 3; return { x: 600 + s * 360 * Math.cos(t), y: 430 + s * 360 * Math.sin(t) }; });
    if (!rr) return resampleOpen([...v, v[0]], 4);
    // rounded corners of radius rr
    const pts = [];
    for (let i = 0; i < 3; i++) {
      const a = v[(i + 2) % 3], b = v[i], c = v[(i + 1) % 3];
      const u1 = { x: (a.x - b.x) / d(a, b), y: (a.y - b.y) / d(a, b) }, u2 = { x: (c.x - b.x) / d(c, b), y: (c.y - b.y) / d(c, b) };
      const cut = rr / Math.tan(Math.PI / 6);
      const p1 = { x: b.x + u1.x * cut, y: b.y + u1.y * cut }, p2 = { x: b.x + u2.x * cut, y: b.y + u2.y * cut };
      for (let k = 0; k <= 12; k++) { const t = k / 12; const q = { x: (1 - t) ** 2 * p1.x + 2 * (1 - t) * t * b.x + t * t * p2.x, y: (1 - t) ** 2 * p1.y + 2 * (1 - t) * t * b.y + t * t * p2.y }; pts.push(q); }
    }
    return resampleOpen([...pts, pts[0]], 4);
  };
  for (const s of [1, 0.8, 0.6]) for (const rr of [0, 40, 80]) {
    const p = tri(s, rr); const r = build(p); const b = build(p, W, baseGeom.buildTrack);
    rows.push({ scale: s, cornerRadius: rr, ok: r.ok, code: r.ok ? null : r.issues[0].code, message: r.ok ? null : r.issues[0].message, baselineOk: b.ok, valid: r.ok ? checkTrack(r.track, p).ok : null });
  }
  out.sections.triangles = rows;
}

// ---------- 7. fuzz: every accepted random stroke must be a valid track ----------
{
  let accepted = 0, rejected = 0, invalidAccepted = 0; const examples = []; const codes = {};
  for (let s = 1; s <= 400; s++) {
    const r = rng(s * 104729);
    const h = [1, 2, 3, 4, 5].map(k => ({ k, a: (r() - 0.5) * 0.35 / k, p: r() * 6.28 }));
    const cx = 450 + r() * 300, cy = 330 + r() * 140, rx = 220 + r() * 220, ry = 160 + r() * 120, dir = r() < 0.5 ? 1 : -1, a0 = r() * 6.28;
    const extra = r() < 0.5 ? r() * 220 : 0, offset = (r() - 0.5) * 36;
    let w = ellipse({ cx, cy, rx, ry, dir, a0, extra, offset, wobble: t => h.reduce((acc, q) => acc + q.a * Math.min(rx, ry) * Math.sin(q.k * t + q.p), 0) });
    // random pigtails / zig-zags
    if (r() < 0.3) { const i = Math.floor(r() * (w.length - 40)); const z = 2 + r() * 10; w = [...w.slice(0, i), ...w.slice(i, i + 40).map((p, j) => ({ x: p.x + (j % 2 ? z : -z), y: p.y + (j % 3 ? z : -z) })), ...w.slice(i + 40)]; }
    const stroke = hand(w, { k: [1.52, 3.64, 4.3][s % 3], spacingPx: [1, 1.5, 3][s % 3], ampPx: r() * 1.5, seed: s, quantize: r() < 0.5 });
    const res = build(stroke);
    if (!res.ok) { rejected++; codes[res.issues[0].code] = (codes[res.issues[0].code] ?? 0) + 1; continue; }
    accepted++;
    const ch = checkTrack(res.track, stroke, { keepFrac: 0.9 });
    if (!ch.ok) { invalidAccepted++; if (examples.length < 8) examples.push({ seed: s, issues: ch.issues }); }
  }
  // Only hard contract failures (walls/clearance/direction/bounds) are defects; drift is reported separately.
  out.sections.fuzz = { accepted, rejected, codes, acceptedWithAnyIssue: invalidAccepted, examples };
  for (const e of examples) if (e.issues.some(i => !i.startsWith('shape drift'))) fail('fuzz', e.seed, e.issues);
}

// ---------- 8. immutability, determinism, timing ----------
{
  const stroke = hand(ellipse({ extra: 120, offset: 8 }), { k: 3.64, ampPx: 1, seed: 3 });
  const frozen = stroke.map(p => Object.freeze({ ...p })); Object.freeze(frozen);
  const before = JSON.stringify(frozen);
  const a = build(frozen), b = build(frozen);
  const hex = x => Buffer.from(x.buffer).toString('hex');
  const det = a.ok && b.ok && hex(a.track.walls) === hex(b.track.walls) && hex(a.track.centerline) === hex(b.track.centerline);
  const timing = {};
  const time = (name, pts, impl = buildTrack) => { const t0 = performance.now(); let r; for (let i = 0; i < 3; i++) r = impl(pts, { id: 'x', width: W }); timing[name] = { ms: +((performance.now() - t0) / 3).toFixed(2), ok: r.ok, code: r.ok ? null : r.issues[0].code }; };
  time('ordinaryOval', resampleOpen(ellipse(), 4));
  time('phoneJitterOvershoot', stroke);
  const dense = resampleOpen(ellipse({ rx: 560, ry: 380 }), 1.0).slice(0, 19999);
  time('dense19999', dense);
  time('dense19999-baseline', dense, baseGeom.buildTrack);
  // narrow vertical zigzag column: worst case for the x-sorted sweep
  const col = []; for (let i = 0; i < 19000; i++) col.push({ x: 600 + (i % 2) * 0.9, y: 20 + (i * 0.02) % 760 + (i % 2) * 0.6 });
  time('verticalColumn', col); time('verticalColumn-baseline', col, baseGeom.buildTrack);
  const tall = resampleOpen(ellipse({ cx: 600, cy: 400, rx: 3, ry: 380, turns: 1 }), 1).slice(0, 19999);
  time('tallThinLoop', tall); time('tallThinLoop-baseline', tall, baseGeom.buildTrack);
  out.sections.misc = { inputUnchanged: JSON.stringify(frozen) === before, deterministic: det, structuredCloneOk: a.ok && structuredClone(a.track).walls.length === a.track.walls.length, timing };
  if (!det || JSON.stringify(frozen) !== before) fail('misc', 'determinism/immutability', out.sections.misc);
}

out.failures = failures;
out.summary = { failures: failures.length };
writeFileSync(path.join(here, 'geometry-probe.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ failures: failures.length, overshoot: [out.sections.overshoot.accepted, out.sections.overshoot.total, out.sections.overshoot.baselineAccepted], extra200: out.sections.overshoot.extra200, white3: [out.sections.white3.accepted, out.sections.white3.baselineAccepted], fuzz: out.sections.fuzz, timing: out.sections.misc.timing }, null, 1));
for (const f of failures.slice(0, 40)) console.log('FAIL', f.section, f.name, JSON.stringify(f.detail).slice(0, 300));
await server.close();
