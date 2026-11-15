// T1R implementation rerun of committed round-1 QA (not independent acceptance). Real Playwright mouse + CDP touch input against /qa/t1.html.
// Usage: node qa.mjs [baseUrl]   (dev server must already be running)
import { chromium } from './runner/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'screens-t1r');
mkdirSync(shots, { recursive: true });
const base = process.argv[2] ?? 'http://127.0.0.1:5293';
const URL_ = `${base}/qa/t1.html`;
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900, dsf: 2, mobile: false },
  { name: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
  { name: '844x390', width: 844, height: 390, dsf: 3, mobile: true },
];
const results = [];
const log = (...a) => console.log(...a);

// World-space shapes (1200x800 world)
const P = (x, y) => ({ x, y });
const ellipse = (cx, cy, rx, ry, n = 90, dir = 1, start = -Math.PI / 2, wob = () => 0) =>
  Array.from({ length: n + 1 }, (_, i) => { const t = start + dir * i * 2 * Math.PI / n; const r = 1 + wob(t, i); return P(cx + rx * r * Math.cos(t), cy + ry * r * Math.sin(t)); });
const SHAPES = {
  looseOvalCW: ellipse(600, 400, 380, 230, 90, 1, -Math.PI / 2, t => 0.04 * Math.sin(3 * t + 1)),
  kidneyCCW: ellipse(600, 400, 400, 250, 110, -1, Math.PI, t => -0.3 * Math.exp(-((((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI / 2) ** 2) * 3)),
  sparse: [P(250, 190), P(950, 190), P(1000, 420), P(900, 620), P(300, 620), P(200, 400), P(250, 200)],
  tiny: ellipse(600, 400, 40, 25, 30),
  figureEight: Array.from({ length: 101 }, (_, i) => { const t = i * 2 * Math.PI / 100; return P(600 + 420 * Math.sin(t), 400 + 230 * Math.sin(2 * t)); }),
  outOfBounds: ellipse(600, 400, 680, 230, 90), // leaves the world/canvas horizontally (pointer capture keeps tracking)
  nearlyClosed: ellipse(600, 400, 380, 230, 100).slice(0, 93),
  overshoot120: ellipse(600, 400, 380, 230, 100).concat(ellipse(600, 400, 372, 225, 100).slice(1, 6)),
  triangle: [P(600, 110), P(1010, 680), P(190, 680), P(600, 112)],
};
function densify(pts, step = 14) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step)); for (let j = 1; j <= k; j++) out.push(P(a.x + (b.x - a.x) * j / k, a.y + (b.y - a.y) * j / k)); }
  return out;
}

async function setup(vp) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf, isMobile: vp.mobile, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // The willReadFrequently warning is caused by this script's own getImageData pixel checks, not by the app.
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/willReadFrequently/.test(m.text())) errors.push(`console.${m.type()}: ${m.text()}`); });
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    window.__H = (await import('/qa/t1.ts')).harness;
    window.__ptr = [];
    const ov = document.querySelector('#editor');
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) ov.addEventListener(t, e => window.__ptr.push(`${t}:${e.pointerType}:${e.pointerId}:${e.isPrimary}`));
  });
  const cdp = await context.newCDPSession(page);
  return { browser, context, page, cdp, errors };
}
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
async function state(page) {
  return page.evaluate(() => {
    const H = window.__H, ov = document.querySelector('#editor');
    let ink = 0, red = 0;
    if (ov.width && ov.height) { const d = ov.getContext('2d').getImageData(0, 0, ov.width, ov.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { ink++; if (d[i - 3] > 130 && d[i - 2] < 90) red++; } }
    const t = H.track; const n = t.centerline.length / 2;
    let area = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += t.centerline[i * 2] * t.centerline[j * 2 + 1] - t.centerline[j * 2] * t.centerline[i * 2 + 1]; }
    return { id: t.id, length: +t.length.toFixed(2), bounds: Object.fromEntries(Object.entries(t.bounds).map(([k, v]) => [k, +v.toFixed(1)])), clockwise: area > 0,
      counts: { ...H.counts }, feedback: document.querySelector('#feedback').textContent, kind: document.querySelector('#feedback').dataset.kind ?? null,
      select: document.querySelector('#preset').value, name: document.querySelector('#circuit-name').textContent, metrics: document.querySelector('#metrics').textContent,
      overlayPE: getComputedStyle(ov).pointerEvents, inlinePE: ov.style.pointerEvents, ink, red, hasEditor: !!H.editor, scrollY: window.scrollY,
      backing: { w: ov.width, h: ov.height, rw: document.querySelector('#road').width }, css: ov.getBoundingClientRect().width, dpr: devicePixelRatio, ptr: window.__ptr.slice(-6) };
  });
}
async function toClient(page, pts) {
  return page.evaluate(pts => { const v = window.__H.view, r = document.querySelector('#editor').getBoundingClientRect(); return pts.map(p => ({ x: r.left + p.x * v.scale + v.offsetX, y: r.top + p.y * v.scale + v.offsetY })); }, pts);
}
async function ensureVisible(page) { await page.evaluate(() => document.querySelector('.stage').scrollIntoView({ block: 'center' })); await frames(page); }
async function mouseStroke(page, pts, { up = true, during } = {}) {
  const c = await toClient(page, pts);
  await page.mouse.move(c[0].x, c[0].y); await page.mouse.down();
  for (let i = 1; i < c.length; i++) { await page.mouse.move(c[i].x, c[i].y); if (during && i === Math.floor(c.length / 2)) await during(); }
  if (up) await page.mouse.up();
}
async function touch(cdp, type, points) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 4, radiusY: 4, force: 1 })) }); }
async function touchStroke(page, cdp, pts, { end = 'touchEnd', during, extra } = {}) {
  const c = await toClient(page, pts);
  await touch(cdp, 'touchStart', [{ ...c[0], id: 0 }]);
  for (let i = 1; i < c.length; i++) {
    const pts2 = [{ ...c[i], id: 0 }];
    if (extra) { const e = await extra(i, c); if (e) pts2.push(...e); }
    await touch(cdp, 'touchMove', pts2);
    if (during && i === Math.floor(c.length / 2)) await during();
  }
  if (end) await touch(cdp, end, []);
}
async function settle(page) { await frames(page); await page.waitForTimeout(30); }
function record(vp, name, pass, observed, note = '') { results.push({ viewport: vp.name, name, pass, observed, note }); log(`${pass ? 'PASS' : 'FAIL'} [${vp.name}] ${name}${note ? ' — ' + note : ''}`); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// New implementation-specific assertions supplement the original lifecycle suite.
for (const vp of VIEWPORTS) {
  const { browser, context, page, cdp, errors } = await setup(vp);
  try {
    await ensureVisible(page);
    const controls = await page.locator('button, select').evaluateAll(es => es.map(e => ({ id: e.id, width:e.getBoundingClientRect().width, height:e.getBoundingClientRect().height })));
    record(vp,'all harness controls meet 44px targets',controls.every(e=>e.width>=44&&e.height>=44),controls);
    for (const direction of [1,-1]) for (const [over, offset, mode] of [[80,.98,'mouse'],[120,.98,'touch'],[160,1.02,'touch']]) {
      const n=100, extra=Math.round(over/(380*2*Math.PI/n));
      const pts=ellipse(600,400,380,230,n,direction).concat(ellipse(600,400,380*offset,230*offset,n,direction).slice(1,extra+1));
      const before=await state(page);
      if(mode==='mouse') await mouseStroke(page,pts); else await touchStroke(page,cdp,pts);
      await settle(page); const s=await state(page);
      record(vp,`${mode}: ${over}-unit overshoot offset ${offset} direction ${direction} commits`,s.counts.commit===before.counts.commit+1 && s.clockwise===(direction===1) && near(s.bounds.minX,180,15) && near(s.bounds.maxY,666,15),{feedback:s.feedback,bounds:s.bounds,clockwise:s.clockwise});
      if (over===160&&direction===-1) await page.screenshot({path:join(shots,`${vp.name}-overshoot160.png`)});
    }
    // Match round-1 jitter sweep seeds; add landscape and opposite winding.
    for (const direction of [1,-1]) for(let trial=0;trial<6;trial++) {
      const pts=await page.evaluate(({trial,direction})=>{
        let seed=1000+trial*31;const rnd=()=>((seed=(seed*1103515245+12345)>>>0)/2**32);
        const v=window.__H.view.scale,n=Math.round(2*Math.PI*Math.sqrt((370*370+225*225)/2)*v/1.5);
        return Array.from({length:n+1},(_,i)=>{const t=-Math.PI/2+direction*i*2*Math.PI/n;return {x:600+370*Math.cos(t)+(rnd()-.5)*2/v,y:400+225*Math.sin(t)+(rnd()-.5)*2/v};});
      },{trial,direction});
      const before=await state(page);
      if(trial===0) await mouseStroke(page,pts); else await touchStroke(page,cdp,pts);
      await settle(page); const s=await state(page);
      record(vp,`${trial===0?'mouse':'touch'}: ±1px jitter/1.5px spacing seed ${1000+trial*31} direction ${direction}`,s.counts.commit===before.counts.commit+1&&s.clockwise===(direction===1),{feedback:s.feedback,counts:s.counts,clockwise:s.clockwise});
      if(trial===5&&direction===-1) await page.screenshot({path:join(shots,`${vp.name}-jitter.png`)});
    }
    for (const direction of [1, -1]) {
      const pts = await page.evaluate(direction => {
        const scale = window.__H.view.scale, n = Math.round(1900 * scale / 1.5);
        let seed = 1031; const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
        const count = n + Math.round(120 / (380 * 2 * Math.PI / n));
        return Array.from({length:count}, (_,i) => {
          const t = -Math.PI / 2 + direction * i * 2 * Math.PI / n;
          return {x:600+380*Math.cos(t)+(random()-.5)*2/scale,y:400+230*Math.sin(t)+(random()-.5)*2/scale};
        });
      }, direction);
      const before = await state(page);
      await touchStroke(page, cdp, pts); await settle(page); const s = await state(page);
      record(vp, `touch: combined 120-unit overshoot and ±1px jitter direction ${direction}`, s.counts.commit === before.counts.commit+1 && s.clockwise === (direction===1), {feedback:s.feedback,bounds:s.bounds});
    }
    // Crossing after a valid drawn track, in both windings; last usable arrays persist.
    for (const direction of [1,-1]) {
      const before=await state(page), saved=await page.evaluate(()=>[...window.__H.track.walls]);
      const pts=direction===1?SHAPES.figureEight:[...SHAPES.figureEight].reverse();
      await touchStroke(page,cdp,pts);await settle(page);const s=await state(page);
      const feedback=await page.locator('#feedback').evaluate(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,visible:r.top>=0&&r.bottom<=innerHeight};});
      const retained=await page.evaluate(saved=>JSON.stringify([...window.__H.track.walls])===JSON.stringify(saved),saved);
      record(vp,`true crossing direction ${direction} rejected; current road retained and inline error visible`,s.counts.invalid===before.counts.invalid+1&&s.id===before.id&&retained&&/crosses itself/.test(s.feedback)&&feedback.visible,{feedback:s.feedback,rect:feedback,retained});
      await page.screenshot({path:join(shots,`${vp.name}-crossing-${direction}.png`)});
    }
    // Isolate visibilitychange from blur, and prove late release cannot commit.
    await page.click('#clear');await ensureVisible(page);
    const before=await state(page);
    await touchStroke(page,cdp,SHAPES.looseOvalCW,{during:async()=>{
      await page.evaluate(()=>{
        Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }});
    await settle(page);let s=await state(page);
    record(vp,'visibilitychange hidden without blur cancels active gesture; return + late lift cannot commit',s.counts.commit===before.counts.commit&&s.counts.clear===before.counts.clear+1&&s.ink===0,{before:before.counts,after:s.counts,ptr:s.ptr});
    const again=s;await touchStroke(page,cdp,SHAPES.looseOvalCW);await settle(page);s=await state(page);
    record(vp,'new real touch gesture succeeds after visibility cancellation',s.counts.commit===again.counts.commit+1,{counts:s.counts});
    record(vp,'no console or page errors',errors.length===0,{errors});
  }catch(e){record(vp,'script exception',false,{error:String(e.stack||e)});}
  finally {await context.close();await browser.close();}
}
writeFileSync(join(here,'t1r-browser-results.json'),JSON.stringify({url:URL_,when:new Date().toISOString(),results},null,2));
const fails=results.filter(r=>!r.pass);
log(`${results.length-fails.length}/${results.length} passed`);
for(const f of fails)log('FAIL',f.viewport,f.name,JSON.stringify(f.observed));
if(fails.length)process.exitCode=1;
