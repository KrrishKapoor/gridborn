// Independent validation of a recorded BestTrajectory against the oval fixture.
// Uses only the published fixture parameters + polygon, not engine internals.
export function makeValidator(track, { maxSpeed = 240, carRadius = 5 } = {}) {
  const c = track.centerline, n = c.length / 2;
  const half = track.width / 2;
  function distToCenter(x, y) {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = c[i * 2], ay = c[i * 2 + 1], bx = c[j * 2], by = c[j * 2 + 1];
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
    }
    return best;
  }
  function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const c1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), c2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const c3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), c4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return c1 * c2 < 0 && c3 * c4 < 0;
  }
  return function validate(samples, lapSeconds) {
    const issues = [], k = samples.length / 4;
    const S = (i) => ({ x: samples[i * 4], y: samples[i * 4 + 1], h: samples[i * 4 + 2], t: samples[i * 4 + 3] });
    if (k < 2) return { ok: false, issues: ['too few samples'] };
    const s0 = S(0), last = S(k - 1);
    if (Math.abs(s0.x - track.spawn.x) > 1e-3 || Math.abs(s0.y - track.spawn.y) > 1e-3 || s0.t !== 0) issues.push('does not start at spawn/t0');
    let pathLength = 0, winding = 0, maxStepSpeed = 0, maxOffCenter = 0, maxDt = 0, chordWallHits = 0, maxHeadingErr = 0, earlyForwardCrossings = 0;
    let prevAng = Math.atan2(s0.y - 400, s0.x - 600);
    for (let i = 1; i < k; i++) {
      const a = S(i - 1), b = S(i), dt = b.t - a.t, d = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(dt > 0)) issues.push(`non-increasing time at ${i}`);
      maxDt = Math.max(maxDt, dt);
      pathLength += d; if (dt >= 1 / 60 - 1e-4) maxStepSpeed = Math.max(maxStepSpeed, d / dt); else if (d > maxSpeed * dt + 1e-3) issues.push(`sub-tick segment ${i} too long`);
      const ang = Math.atan2(b.y - 400, b.x - 600); let da = ang - prevAng;
      if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; winding += da; prevAng = ang;
      maxOffCenter = Math.max(maxOffCenter, distToCenter(b.x, b.y));
      if (d > 1) { // heading at sample a vs motion direction (bicycle heading within turn of chord)
        const mh = Math.atan2(b.y - a.y, b.x - a.x); let e = Math.abs(mh - a.h); if (e > Math.PI) e = 2 * Math.PI - e; maxHeadingErr = Math.max(maxHeadingErr, e);
      }
      for (let w = 0; w < track.walls.length; w += 4) if (segIntersect(a.x, a.y, b.x, b.y, track.walls[w], track.walls[w + 1], track.walls[w + 2], track.walls[w + 3])) chordWallHits++;
      // forward crossing of finite start line before the final sample
      if (i < k - 1 && a.x < track.spawn.x && b.x >= track.spawn.x && Math.min(a.y, b.y) < 230 && a.t > 0.5) earlyForwardCrossings++;
    }
    const roadLimit = half - carRadius + 1e-3;
    if (maxOffCenter > roadLimit) issues.push(`sample outside drivable band: ${maxOffCenter.toFixed(3)} > ${roadLimit}`);
    if (maxStepSpeed > maxSpeed * 1.001) issues.push(`implied speed ${maxStepSpeed} exceeds max`);
    if (lapSeconds !== null) {
      if (Math.abs(last.t - lapSeconds) > 1e-4) issues.push(`final sample time ${last.t} != lap ${lapSeconds}`);
      if (Math.abs(last.x - track.spawn.x) > 0.05) issues.push(`final pose not on start line x=${last.x}`);
      const ya = Math.min(track.startLine.a.y, track.startLine.b.y), yb = Math.max(track.startLine.a.y, track.startLine.b.y);
      if (last.y < ya || last.y > yb) issues.push('final crossing outside finite start line');
      if (Math.abs(winding - 2 * Math.PI) > 0.05) issues.push(`winding ${winding} != +2pi (one clockwise loop)`);
      if (earlyForwardCrossings) issues.push(`${earlyForwardCrossings} earlier start crossings`);
      if (pathLength > maxSpeed * lapSeconds * 1.001) issues.push('path longer than possible');
    }
    if (chordWallHits) issues.push(`${chordWallHits} 10Hz chords cross a wall (display approximation)`);
    return { ok: issues.filter((s) => !s.includes('display approximation')).length === 0, issues, samples: k, pathLength, winding, maxStepSpeed, maxOffCenter, maxDt, maxHeadingErr, avgSpeed: lapSeconds ? pathLength / lapSeconds : null, finalPose: last };
  };
}
