// Follow-up probe: jitter tolerance, triangles, overshoot thresholds. Usage: node probe2.mjs
import { chromium } from './runner/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5291/qa/t1.html');
const r = await page.evaluate(async () => {
  const T = await import('/src/track/index.ts');
  const P = (x, y) => ({ x, y });
  let s = 1; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const out = {};
  // jitter: dense samples at spacing sp (world), white noise amplitude a (world). Mimic editor dedupe (>=2 units).
  for (const sp of [4, 8, 12]) for (const a of [1, 2, 3, 4, 6]) {
    let fails = 0, codes = {};
    for (let trial = 0; trial < 20; trial++) {
      s = trial * 7919 + 1;
      const n = Math.round(1900 / sp);
      const pts = []; for (let i = 0; i < n; i++) { const t = -Math.PI / 2 + i * 2 * Math.PI / n; const p = P(600 + 380 * Math.cos(t) + (rnd() - .5) * 2 * a, 400 + 230 * Math.sin(t) + (rnd() - .5) * 2 * a); const q = pts[pts.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y) >= 2) pts.push(p); }
      const res = T.buildTrack(pts, { id: 'j', width: 92 }); if (!res.ok) { fails++; codes[res.issues[0].code] = (codes[res.issues[0].code] || 0) + 1; }
    }
    out[`jitter sp=${sp} amp=±${a}`] = `${fails}/20 rejected ${JSON.stringify(codes)}`;
  }
  // low-frequency wobble (more hand-like): amplitude a, wavelength ~ 60-120 units
  for (const a of [5, 10, 20]) {
    const n = 400; const pts = Array.from({ length: n }, (_, i) => { const t = -Math.PI / 2 + i * 2 * Math.PI / n; const w = a * Math.sin(i * 0.9) ; return P(600 + (380 + w) * Math.cos(t), 400 + (230 + w) * Math.sin(t)); });
    const res = T.buildTrack(pts, { id: 'w', width: 92 }); out[`wobble ±${a}`] = res.ok ? 'ok' : res.issues[0].code;
  }
  // dense hand triangle (equilateral-ish) at different sizes
  const poly = (vs, per = 4) => { const pts = []; for (let i = 0; i < vs.length; i++) { const a = vs[i], b = vs[(i + 1) % vs.length]; const L = Math.hypot(b.x - a.x, b.y - a.y); const k = Math.ceil(L / per); for (let j = 0; j < k; j++) pts.push(P(a.x + (b.x - a.x) * j / k, a.y + (b.y - a.y) * j / k)); } return pts; };
  for (const sc of [1, 0.8, 0.6]) { const cx = 600, cy = 430; const vs = [P(cx, cy - 330 * sc), P(cx + 420 * sc, cy + 300 * sc), P(cx - 420 * sc, cy + 300 * sc)]; const res = T.buildTrack(poly(vs), { id: 't', width: 92 }); out[`triangle dense scale ${sc}`] = res.ok ? 'ok' : res.issues[0].code + ': ' + res.issues[0].message; }
  // L-shape / hexagon / star-ish concave
  out['L-shape'] = (r => r.ok ? 'ok' : r.issues[0].code)(T.buildTrack(poly([P(200,150),P(700,150),P(700,400),P(1000,400),P(1000,650),P(200,650)]), { id: 'l', width: 92 }));
  out['hexagon'] = (r => r.ok ? 'ok' : r.issues[0].code)(T.buildTrack(poly(Array.from({length:6},(_,i)=>P(600+400*Math.cos(i*Math.PI/3),400+300*Math.sin(i*Math.PI/3)))), { id: 'h', width: 92 }));
  out['pentagon-120'] = (r => r.ok ? 'ok' : r.issues[0].code)(T.buildTrack(poly(Array.from({length:5},(_,i)=>P(600+330*Math.cos(-Math.PI/2+i*2*Math.PI/5),420+330*Math.sin(-Math.PI/2+i*2*Math.PI/5)))), { id: 'p', width: 92 }));
  // overshoot thresholds with lateral offset 3% inward
  for (const over of [50, 60, 70, 80, 90, 120, 160]) {
    const n = 480; const base = Array.from({ length: n }, (_, i) => { const t = -Math.PI / 2 + i * 2 * Math.PI / n; return P(600 + 380 * Math.cos(t), 400 + 230 * Math.sin(t)); });
    const per = 2 * Math.PI / n; const extra = Math.round(over / (380 * per));
    for (const off of [0.98, 1.02]) {
      const tail = Array.from({ length: extra }, (_, i) => { const t = -Math.PI / 2 + (i + 1) * per; return P(600 + 380 * off * Math.cos(t), 400 + 230 * off * Math.sin(t)); });
      const res = T.buildTrack(base.concat(tail), { id: 'o', width: 92 }); out[`overshoot ${over} off ${off}`] = res.ok ? 'ok' : res.issues[0].code;
    }
  }
  return out;
});
await browser.close();
writeFileSync(new URL('./probe2.json', import.meta.url), JSON.stringify(r, null, 2));
console.log(r);
