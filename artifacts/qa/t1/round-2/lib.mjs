// Round-2 reviewer: predicates/generators extracted verbatim from geometry-probe.mjs for the browser run.
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
export { d, segHit, segDist, polyDist, area, loopSimple, centerOf, checkTrack, rng, resampleOpen, ellipse, hand };
