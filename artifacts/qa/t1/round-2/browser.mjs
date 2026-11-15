// Independent T1 round-2 browser QA (reviewer-authored). Real Playwright mouse + CDP touch on /qa/t1.html.
// Usage: dev server on 127.0.0.1:5293, then `node artifacts/qa/t1/round-2/browser.mjs` from repo root.
import { chromium } from './runner/node_modules/playwright-core/index.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTrack, ellipse, resampleOpen, rng, d } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const URL = 'http://127.0.0.1:5293/qa/t1.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900, dpr: 2, touch: false },
  { name: '390x844', width: 390, height: 844, dpr: 3, touch: true },
  { name: '844x390', width: 844, height: 390, dpr: 3, touch: true },
];
const results = { url: URL, started: new Date().toISOString(), viewports: {} };
let total = 0, passed = 0;
const failures = [];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
results.browserVersion = browser.version();

const ONLY = process.env.VP; const OUT = process.env.OUT ?? 'browser-results.json';
for (const vp of VIEWPORTS.filter(v => !ONLY || v.name === ONLY)) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, isMobile: vp.touch, hasTouch: vp.touch });
  const page = await ctx.newPage();
  const consoleMsgs = [], pageErrors = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleMsgs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const m = await import('/qa/t1.ts');
    window.__h = m.harness;
    window.__blurs = 0; window.addEventListener('blur', () => window.__blurs++);
  });
  const R = results.viewports[vp.name] = { checks: [], drawings: {} };
  const check = (name, ok, detail) => { total++; if (ok) passed++; else failures.push({ vp: vp.name, name, detail }); R.checks.push({ name, ok: !!ok, detail }); };

  const state = () => page.evaluate(() => {
    const h = window.__h, t = h.track, r = document.querySelector('#editor').getBoundingClientRect(), fb = document.querySelector('#feedback');
    const fr = fb.getBoundingClientRect();
    return { id: t.id, length: t.length, width: t.width, counts: { ...h.counts }, view: { ...h.view }, rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      feedback: fb.textContent, kind: fb.dataset.kind ?? null, feedbackRect: { top: fr.top, bottom: fr.bottom }, innerHeight, scrollY,
      preset: document.querySelector('#preset').value, pe: getComputedStyle(document.querySelector('#editor')).pointerEvents };
  });
  const trackData = () => page.evaluate(() => { const t = window.__h.track; return { id: t.id, length: t.length, width: t.width, centerline: [...t.centerline], cumulativeLengths: [...t.cumulativeLengths], walls: [...t.walls], bounds: t.bounds, startLine: t.startLine, startForward: t.startForward, spawn: t.spawn }; });
  const asTrack = o => ({ ...o, centerline: Float32Array.from(o.centerline), cumulativeLengths: Float32Array.from(o.cumulativeLengths), walls: Float32Array.from(o.walls) });
  const toCss = (s, p) => ({ x: s.rect.left + p.x * s.view.scale + s.view.offsetX, y: s.rect.top + p.y * s.view.scale + s.view.offsetY });
  const toWorld = (s, c) => ({ x: (c.x - s.rect.left - s.view.offsetX) / s.view.scale, y: (c.y - s.rect.top - s.view.offsetY) / s.view.scale });

  async function scrollStageIntoView() {
    await page.evaluate(() => document.querySelector('.stage').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(60);
  }
  // CSS stroke from a world stroke, with seeded ±amp CSS px noise at `spacing` CSS px
  async function cssStroke(world, { spacing = 3, amp = 0, seed = 1, round = false } = {}) {
    const s = await state(); const r = rng(seed);
    const css = resampleOpen(world.map(p => toCss(s, p)), spacing).map(p => {
      let x = p.x + (r() * 2 - 1) * amp, y = p.y + (r() * 2 - 1) * amp; if (round) { x = Math.round(x); y = Math.round(y); } return { x, y };
    });
    return { css, s };
  }
  const touchPt = (p, id = 0) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 });
  async function drawTouch(css, { mid = null, end = 'touchEnd' } = {}) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPt(css[0])] });
    for (let i = 1; i < css.length; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPt(css[i])] });
      if (mid && i === Math.floor(css.length / 2)) await mid(css[i]);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] });
  }
  async function drawMouse(css, { mid = null } = {}) {
    await page.mouse.move(css[0].x, css[0].y); await page.mouse.down();
    for (let i = 1; i < css.length; i++) { await page.mouse.move(css[i].x, css[i].y); if (mid && i === Math.floor(css.length / 2)) await mid(css[i]); }
    await page.mouse.up();
  }
  const draw = (css, o) => (vp.touch ? drawTouch(css, o) : drawMouse(css, o));
  async function drawWorld(world, opts = {}, how = {}) {
    await scrollStageIntoView();
    const { css, s } = await cssStroke(world, opts);
    const before = await state();
    await draw(css, how);
    await page.waitForTimeout(40);
    const after = await state();
    const worldPts = css.map(c => toWorld(s, c));
    return { before, after, worldPts, committed: after.counts.commit - before.counts.commit, invalid: after.counts.invalid - before.counts.invalid };
  }
  async function shot(name) { await page.screenshot({ path: path.join(here, 'screens', `${vp.name}-${name}.png`) }); }

  // ---- initial layout ----
  {
    const s = await state();
    const layout = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, select')].map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent.trim(), w: r.width, h: r.height }; });
      return { overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, targets: els, road: document.querySelector('#road').getBoundingClientRect().toJSON(), backing: [document.querySelector('#road').width, document.querySelector('#editor').width] };
    });
    check('initial broad-oval', s.id === 'broad-oval' && Math.abs(s.length - 1965.4808349609375) < 1e-9, s.id + ' ' + s.length);
    check('no horizontal overflow', layout.overflowX <= 0, layout.overflowX);
    check('controls >= 44x44', layout.targets.every(t => t.w >= 44 && t.h >= 44), layout.targets);
    check('overlay rect == road rect', Math.abs(layout.road.width - s.rect.width) < 0.01 && Math.abs(layout.road.top - s.rect.top) < 0.01, [layout.road, s.rect]);
    check('backing store = css*min(dpr,2)', layout.backing[0] === Math.round(s.rect.width * Math.min(vp.dpr, 2)) && layout.backing[1] === layout.backing[0], layout.backing);
    R.layout = { ...layout, view: s.view, worldPerCssPx: 1 / s.view.scale };
    await shot('00-initial');
  }

  // ---- overshoot matrix: 80/120/160 × inward/exact/outward × both windings ----
  const overs = [];
  for (const dir of [1, -1]) for (const extra of [80, 120, 160]) for (const offset of [-10, 0, 10]) {
    const world = ellipse({ cx: 600, cy: 400, rx: 400, ry: 250, a0: dir > 0 ? -Math.PI / 2 : 0.6, dir, extra, offset });
    const res = await drawWorld(world, { spacing: 3 });
    const row = { dir: dir > 0 ? 'cw' : 'ccw', extra, offset, committed: res.committed, invalid: res.invalid, feedback: res.after.feedback };
    if (res.committed === 1) {
      const t = asTrack(await trackData());
      const ch = checkTrack(t, res.worldPts, { keepFrac: 1 - ((extra + 15) / (3 / res.after.view.scale)) / res.worldPts.length });
      row.valid = ch.ok; row.issues = ch.issues; row.c2s = ch.c2s; row.spawnErr = ch.spawnErr; row.length = t.length; row.orientation = ch.orientation;
      row.boundsCenter = [(t.bounds.minX + t.bounds.maxX) / 2, (t.bounds.minY + t.bounds.maxY) / 2];
    }
    overs.push(row);
    if (extra === 160 && offset === 10 && dir === 1) await shot('01-overshoot160-cw-outward');
    if (extra === 120 && offset === -10 && dir === -1) await shot('01-overshoot120-ccw-inward');
  }
  R.drawings.overshoot = overs;
  check('overshoot 80/120/160 all commit (18 strokes)', overs.every(o => o.committed === 1), overs.filter(o => o.committed !== 1));
  check('overshoot tracks pass independent topology/clearance/direction', overs.every(o => o.valid), overs.filter(o => !o.valid).map(o => [o.dir, o.extra, o.offset, o.issues]));
  check('overshoot direction follows stroke', overs.every(o => o.orientation === (o.dir === 'cw' ? 1 : -1)), overs.map(o => o.orientation));
  check('overshoot position preserved (bbox centre within 15 of 600,400)', overs.every(o => o.boundsCenter && Math.hypot(o.boundsCenter[0] - 600, o.boundsCenter[1] - 400) < 15), overs.map(o => o.boundsCenter));

  // ---- jitter: ±1 CSS px at 1.5 px spacing, multiple seeds, both windings, plus overshoot+jitter ----
  const jit = [];
  const jshapes = [
    { name: 'oval-cw', w: () => ellipse({ cx: 600, cy: 400, rx: 400, ry: 250, dir: 1 }) },
    { name: 'oval-ccw', w: () => ellipse({ cx: 600, cy: 400, rx: 400, ry: 250, dir: -1, a0: 0.7 }) },
    { name: 'left-cw-overshoot120+jitter', w: () => ellipse({ cx: 420, cy: 360, rx: 300, ry: 210, dir: 1, a0: Math.PI, extra: 120, offset: 8 }) },
    { name: 'right-ccw-overshoot140+jitter', w: () => ellipse({ cx: 760, cy: 430, rx: 300, ry: 220, dir: -1, a0: -1, extra: 140, offset: -8 }) },
  ];
  for (const sh of jshapes) for (const round of [false, true]) for (let seed = 1; seed <= 6; seed++) {
    const res = await drawWorld(sh.w(), { spacing: 1.5, amp: 1, seed: seed * 101 + (round ? 7 : 0), round });
    const row = { shape: sh.name, round, seed, committed: res.committed, invalid: res.invalid, kind: res.after.kind };
    if (res.committed === 1) { const ch = checkTrack(asTrack(await trackData()), res.worldPts, { keepFrac: 0.9 }); row.valid = ch.ok; row.issues = ch.issues; }
    else row.feedback = res.after.feedback;
    jit.push(row);
    if (sh.name.includes('overshoot120') && seed === 1 && !round) { await shot(res.committed ? '02-jitter-overshoot-ok' : '02-jitter-overshoot-REJECTED'); }
    if (sh.name === 'oval-ccw' && seed === 2 && round) await shot(res.committed ? '02-jitter-ccw-ok' : '02-jitter-ccw-REJECTED');
  }
  R.drawings.jitter = jit;
  const jsum = {}; for (const r of jit) { const k = `${r.shape}${r.round ? '/int' : '/float'}`; jsum[k] = jsum[k] ?? [0, 0]; jsum[k][0] += r.committed; jsum[k][1]++; }
  R.jitterSummary = jsum;
  check('jitter commits pass independent topology/clearance', jit.filter(j => j.committed).every(j => j.valid), jit.filter(j => j.committed && !j.valid));
  check('jitter ±1px@1.5px float coords all commit', jit.filter(j => !j.round).every(j => j.committed === 1), jit.filter(j => !j.round && !j.committed).map(j => [j.shape, j.seed]));
  check('jitter ±1px@1.5px integer coords all commit', jit.filter(j => j.round).every(j => j.committed === 1), jit.filter(j => j.round && !j.committed).map(j => [j.shape, j.seed]));

  // ---- establish a known last-valid drawn track, then rejections must keep it ----
  const baseDraw = await drawWorld(ellipse({ cx: 600, cy: 420, rx: 380, ry: 240, dir: 1 }), { spacing: 3 });
  check('reference drawn track commits', baseDraw.committed === 1, baseDraw.after.feedback);
  const ref = await state();
  const lem = (s = 1) => Array.from({ length: 900 }, (_, i) => { const t = -Math.PI / 2 + i * 2 * Math.PI / 900; const den = 1 + Math.sin(t) ** 2; return { x: 600 + s * 470 * Math.cos(t) / den, y: 400 + s * 470 * Math.sin(t) * Math.cos(t) / den }; });
  const pinch = p => Array.from({ length: 3001 }, (_, i) => { const t = -Math.PI / 2 + 0.4 + i * 2 * Math.PI / 3000; return { x: 600 + 400 * Math.cos(t), y: 400 + 250 * Math.sin(t) * (1 - p * Math.exp(-(Math.cos(t) ** 2) / 0.02)) }; });
  const loop = resampleOpen(ellipse({ cx: 600, cy: 400, rx: 400, ry: 250, dir: 1 }), 4);
  const rejects = {
    figureEight: { w: lem(1) },
    figureEightJitter: { w: lem(0.9), o: { spacing: 1.5, amp: 1, seed: 9 } },
    shallowPinchCrossing: { w: pinch(1.04) },
    twoLaps: { w: ellipse({ cx: 600, cy: 400, rx: 400, ry: 250, turns: 2 }) },
    lapAndHalfOffset: { w: ellipse({ cx: 600, cy: 400, rx: 400, ry: 250, extra: 900, offset: -8 }) },
    longRetrace360: { w: ellipse({ cx: 600, cy: 400, rx: 400, ry: 250, extra: 360, offset: 0 }) },
    tailReversal: { w: [...loop, ...loop.slice(0, 25).map(p => ({ x: p.x, y: p.y + 3 })), ...loop.slice(5, 24).reverse().map(p => ({ x: p.x, y: p.y + 6 }))] },
    tailDeparture: { w: (() => { const s = [...loop, ...loop.slice(0, 15)]; const e = s.at(-1); return [...s, ...Array.from({ length: 30 }, (_, i) => ({ x: e.x + i * 0.5, y: e.y + i * 4 }))]; })() },
    tailLobeR9: { w: (() => { const c = loop[15], nx = loop[16]; const a = Math.atan2(nx.y - c.y, nx.x - c.x); const lobe = Array.from({ length: 30 }, (_, i) => { const t = a - Math.PI / 2 + i * 2 * Math.PI / 29; return { x: c.x + 9 * Math.cos(a + Math.PI / 2) + 9 * Math.cos(t), y: c.y + 9 * Math.sin(a + Math.PI / 2) + 9 * Math.sin(t) }; }); return [...loop, ...loop.slice(0, 15), ...lobe, ...loop.slice(16, 26)]; })() },
    tiny: { w: ellipse({ cx: 600, cy: 400, rx: 40, ry: 30 }) },
    offCanvas: { w: ellipse({ cx: 600, cy: 400, rx: 640, ry: 250 }) },
  };
  const rej = {};
  for (const [name, { w, o }] of Object.entries(rejects)) {
    const res = await drawWorld(w, o ?? { spacing: 3 });
    const s = res.after;
    rej[name] = { committed: res.committed, invalid: res.invalid, kind: s.kind, feedback: s.feedback, keptId: s.id, keptLength: s.length };
    check(`reject ${name}`, res.committed === 0 && res.invalid === 1 && s.kind === 'invalid', rej[name]);
    check(`last valid kept after ${name}`, s.id === ref.id && s.length === ref.length, [s.id, s.length, ref.id, ref.length]);
    if (name === 'figureEight') {
      const fb = s.feedbackRect;
      check('rejection feedback visible in viewport with stage', fb.top >= 0 && fb.bottom <= s.innerHeight, fb);
      const red = await page.evaluate(() => getComputedStyle(document.querySelector('#feedback')).color);
      check('rejection feedback red', red === 'rgb(163, 52, 40)', red);
      const px = await page.evaluate(() => { const c = document.querySelector('#editor'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && d[i] > 120 && d[i + 1] < 90) red++; return red; });
      check('invalid draft remains visible in red', px > 200, px);
      await shot('03-rejected-figure-eight');
    }
    if (name === 'shallowPinchCrossing') await shot('03-rejected-shallow-crossing');
    if (name === 'tailReversal') await shot('03-rejected-tail-reversal');
  }
  R.drawings.rejections = rej;

  // ---- early-close proximity must not truncate an incomplete loop ----
  {
    const body = loop.slice(0, Math.floor(loop.length * 0.9)); const st = loop[0];
    const w = [...body, { x: st.x - 10, y: st.y + 4 }, { x: st.x + 60, y: st.y + 60 }, { x: st.x + 120, y: st.y + 170 }];
    const res = await drawWorld(resampleOpen(w, 4), { spacing: 3 });
    let truncated = false;
    if (res.committed) { const t = asTrack(await trackData()); const c = []; for (let i = 0; i < t.centerline.length; i += 2) c.push({ x: t.centerline[i], y: t.centerline[i + 1] }); let m = Infinity; const end = res.worldPts.at(-1); for (const p of c) m = Math.min(m, d(p, end)); truncated = m > 50; }
    R.drawings.earlyClose = { committed: res.committed, invalid: res.invalid, feedback: res.after.feedback };
    check('early-close brush + departure not truncated into a loop', !truncated, R.drawings.earlyClose);
  }

  // ---- control actions mid-stroke ----
  const strokeWorld = ellipse({ cx: 600, cy: 400, rx: 380, ry: 240, dir: 1, extra: 100 });
  async function midAction(label, act, expectClearCount = true) {
    const s0 = await state();
    await scrollStageIntoView();
    const { css } = await cssStroke(strokeWorld, { spacing: 4 });
    await draw(css, { mid: act });
    await page.waitForTimeout(50);
    const s1 = await state();
    const ok = s1.counts.commit === s0.counts.commit;
    check(`${label} mid-stroke: no commit on late release`, ok, { before: s0.counts, after: s1.counts, feedback: s1.feedback });
    return s1;
  }
  await midAction('Clear drawing', async () => { await page.evaluate(() => document.querySelector('#clear').click()); });
  await midAction('Reset circuit', async () => { await page.evaluate(() => document.querySelector('#reset').click()); });
  let s = await state(); check('reset restores broad-oval', s.id === 'broad-oval' && s.preset === 'broad-oval', [s.id, s.preset]);
  await midAction('Preset change', async () => { await page.evaluate(() => { const p = document.querySelector('#preset'); p.value = 'riverbend'; p.dispatchEvent(new Event('change')); }); });
  s = await state(); check('preset change applied', s.id === 'riverbend', s.id);
  await midAction('Rapid mode toggles (5)', async () => { await page.evaluate(() => { for (let i = 0; i < 5; i++) document.querySelector('#drawing').click(); }); });
  s = await state();
  const aria = await page.evaluate(() => document.querySelector('#drawing').getAttribute('aria-pressed'));
  check('aria-pressed matches overlay after odd toggles', (aria === 'true') === (s.pe === 'auto'), [aria, s.pe]);
  if (aria !== 'true') await page.evaluate(() => document.querySelector('#drawing').click());
  await midAction('Rapid reset/clear/preset', async () => { await page.evaluate(() => { document.querySelector('#reset').click(); document.querySelector('#clear').click(); const p = document.querySelector('#preset'); p.value = 'club-circuit'; p.dispatchEvent(new Event('change')); document.querySelector('#reset').click(); }); });
  s = await state(); check('ends on broad-oval after rapid actions', s.id === 'broad-oval', s.id);
  await midAction('Escape key', async () => { await page.keyboard.press('Escape'); });

  // all three presets valid via the UI and byte-stable on reselect
  for (const id of ['broad-oval', 'riverbend', 'club-circuit']) {
    await page.evaluate(id => { const p = document.querySelector('#preset'); p.value = id; p.dispatchEvent(new Event('change')); }, id);
    const t1 = asTrack(await trackData());
    const ch = checkTrack(t1, (() => { const c = []; for (let i = 0; i < t1.centerline.length; i += 2) c.push({ x: t1.centerline[i], y: t1.centerline[i + 1] }); return c; })());
    check(`preset ${id} independently valid`, ch.ok && t1.id === id, ch.issues);
  }
  await page.evaluate(() => document.querySelector('#reset').click());

  // ---- visibility hidden WITHOUT blur (simulated: overridden visibilityState + visibilitychange) ----
  {
    const blurs0 = await page.evaluate(() => window.__blurs);
    await midAction('visibilitychange hidden (no blur)', async () => {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    });
    const blurs1 = await page.evaluate(() => window.__blurs);
    check('no blur fired during visibility test', blurs1 === blurs0, [blurs0, blurs1]);
    await page.evaluate(() => { delete document.visibilityState; });
    const fresh = await drawWorld(ellipse({ cx: 600, cy: 400, rx: 380, ry: 240, dir: -1 }), { spacing: 3 });
    check('fresh gesture after visibility cancel commits', fresh.committed === 1, fresh.after.feedback);
  }

  // ---- touch-only: multitouch and touchCancel ----
  if (vp.touch) {
    await scrollStageIntoView();
    const { css } = await cssStroke(ellipse({ cx: 600, cy: 400, rx: 380, ry: 240, dir: 1 }), { spacing: 4 });
    const c0 = (await state()).counts.commit;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPt(css[0], 0)] });
    for (let i = 1; i < css.length; i++) {
      const pts = [touchPt(css[i], 0)];
      if (i > 20 && i < 60) pts.push(touchPt({ x: css[0].x + 30 + i, y: css[0].y + 40 }, 1));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(40);
    const s1 = await state();
    let ok = s1.counts.commit === c0 + 1;
    if (ok) { const t = asTrack(await trackData()); ok = Math.abs((t.bounds.minX + t.bounds.maxX) / 2 - 600) < 15; }
    check('second finger ignored; primary shape commits', ok, s1.feedback);
    // touchCancel
    const c1 = (await state()).counts.commit;
    await drawTouch(css, { end: 'touchCancel' });
    await page.waitForTimeout(40);
    check('touchCancel: no commit', (await state()).counts.commit === c1, (await state()).feedback);
    const scrolled = await page.evaluate(() => scrollY);
    await drawTouch(css);
    check('touch stroke does not scroll page', (await page.evaluate(() => scrollY)) === scrolled, scrolled);
  } else {
    // desktop: one CDP touch stroke too
    await scrollStageIntoView();
    const { css } = await cssStroke(ellipse({ cx: 600, cy: 400, rx: 380, ry: 240, dir: -1, extra: 120, offset: 8 }), { spacing: 2, amp: 1, seed: 4 });
    const c0 = (await state()).counts.commit;
    await drawTouch(css);
    await page.waitForTimeout(40);
    check('desktop CDP touch overshoot+jitter stroke commits', (await state()).counts.commit === c0 + 1, (await state()).feedback);
  }

  // ---- CSS resize mid-stroke cancels; DPR-only change keeps the gesture ----
  {
    await midAction('CSS viewport resize', async () => { await page.setViewportSize({ width: vp.width - 37, height: vp.height }); await page.waitForTimeout(80); });
    await page.setViewportSize({ width: vp.width, height: vp.height }); await page.waitForTimeout(100);
    // rotation (swap) then stroke commits at correct world position
    await page.setViewportSize({ width: vp.height, height: vp.width }); await page.waitForTimeout(120);
    const rot = await drawWorld(ellipse({ cx: 600, cy: 400, rx: 380, ry: 240, dir: 1, extra: 90 }), { spacing: 3 });
    let rotOk = rot.committed === 1;
    if (rotOk) { const t = asTrack(await trackData()); rotOk = Math.hypot((t.bounds.minX + t.bounds.maxX) / 2 - 600, (t.bounds.minY + t.bounds.maxY) / 2 - 400) < 15 && checkTrack(t, rot.worldPts, { keepFrac: 0.95 }).ok; }
    const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('rotated viewport stroke commits at correct world position', rotOk, rot.after.feedback);
    check('rotated viewport no horizontal overflow', ovf <= 0, ovf);
    await shot('04-rotated');
    await page.setViewportSize({ width: vp.width, height: vp.height }); await page.waitForTimeout(120);
    // DPR-only
    const s0 = await state();
    await scrollStageIntoView();
    const { css } = await cssStroke(ellipse({ cx: 600, cy: 400, rx: 380, ry: 240, dir: 1, extra: 100 }), { spacing: 4 });
    const newDpr = vp.dpr === 2 ? 1 : 1;
    await draw(css, { mid: async () => { await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: newDpr, mobile: vp.touch }); await page.waitForTimeout(150); } });
    await page.waitForTimeout(80);
    const s1 = await state();
    const backing = await page.evaluate(() => document.querySelector('#editor').width);
    check('DPR-only change mid-stroke keeps gesture and commits', s1.counts.commit === s0.counts.commit + 1, s1.feedback);
    check('backing store rebuilt for new DPR', backing === Math.round(s1.rect.width * newDpr), [backing, s1.rect.width]);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.touch });
    await page.waitForTimeout(150);
  }

  // ---- detach/reattach ----
  {
    const s0 = await state();
    await midAction('Detach editor', async () => { await page.evaluate(() => document.querySelector('#lifecycle').click()); });
    const det = await page.evaluate(() => { const c = document.querySelector('#editor'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return { px: n, pe: getComputedStyle(c).pointerEvents, disabled: document.querySelector('#drawing').disabled && document.querySelector('#clear').disabled }; });
    check('detached: overlay cleared, pointer-events none, controls disabled', det.px === 0 && det.pe === 'none' && det.disabled, det);
    const c0 = (await state()).counts;
    const { css } = await cssStroke(strokeWorld, { spacing: 5 });
    await draw(css);
    check('detached: drags emit nothing', JSON.stringify((await state()).counts) === JSON.stringify(c0), (await state()).counts);
    await page.evaluate(() => { for (let i = 0; i < 7; i++) document.querySelector('#lifecycle').click(); }); // ends attached
    const attached = await page.evaluate(() => document.querySelector('#lifecycle').textContent);
    await page.evaluate(() => { window.__ev = []; for (const t of ['scroll', 'resize']) window.addEventListener(t, () => window.__ev.push([t, scrollY]), true); });
    const c1 = (await state()).counts.commit;
    await draw((await cssStroke(ellipse({ cx: 600, cy: 400, rx: 380, ry: 240, dir: 1 }), { spacing: 3 })).css);
    await page.waitForTimeout(40);
    const evs = await page.evaluate(() => window.__ev);
    check('after 7 rapid detach/attach, one stroke = exactly one commit', attached === 'Detach editor' && (await state()).counts.commit === c1 + 1, [attached, (await state()).counts, 'surface events during stroke:', evs]);
  }

  // ---- final screenshots of successful overshoot+jitter and rejected crossing at this viewport ----
  {
    await drawWorld(ellipse({ cx: 600, cy: 400, rx: 390, ry: 245, dir: -1, a0: 0.4, extra: 150, offset: -8 }), { spacing: 1.5, amp: 1, seed: 77 });
    await shot('05-final-overshoot150-jitter');
    const f = await state();
    R.finalOvershootJitter = { feedback: f.feedback, id: f.id };
    await drawWorld(pinch(1.04), { spacing: 3 });
    await shot('05-final-rejected-crossing');
  }
  const errs = consoleMsgs.filter(m => !m.includes('willReadFrequently'));
  check('no page errors', pageErrors.length === 0, pageErrors);
  check('no console errors/warnings (excluding my getImageData perf hint)', errs.length === 0, errs);
  R.console = consoleMsgs; R.pageErrors = pageErrors;
  await ctx.close();
}
await browser.close();
results.total = total; results.passed = passed; results.failures = failures; results.finished = new Date().toISOString();
writeFileSync(path.join(here, OUT), JSON.stringify(results, null, 1));
console.log(`checks ${passed}/${total}`);
for (const [k, v] of Object.entries(results.viewports)) console.log(k, 'jitter', JSON.stringify(v.jitterSummary), 'worldPerPx', v.layout.worldPerCssPx.toFixed(3));
for (const f of failures) console.log('FAIL', f.vp, f.name, JSON.stringify(f.detail).slice(0, 400));
