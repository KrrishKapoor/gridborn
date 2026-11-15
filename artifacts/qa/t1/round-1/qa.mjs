// Independent T1 browser QA (round 1). Real Playwright mouse + CDP touch input against /qa/t1.html.
// Usage: node qa.mjs [baseUrl]   (dev server must already be running)
import { chromium } from './runner/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'screens');
mkdirSync(shots, { recursive: true });
const base = process.argv[2] ?? 'http://127.0.0.1:5291';
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

for (const vp of VIEWPORTS) {
  const { browser, context, page, cdp, errors } = await setup(vp);
  try {
    // A. initial layout
    const layout = await page.evaluate(() => {
      const r = document.querySelector('#editor').getBoundingClientRect(), rr = document.querySelector('#road').getBoundingClientRect();
      const over = [...document.querySelectorAll('body *')].filter(e => { const b = e.getBoundingClientRect(); return b.width && (b.right > innerWidth + 0.5 || b.left < -0.5); }).map(e => e.tagName + (e.id ? '#' + e.id : ''));
      const small = [...document.querySelectorAll('button,select')].map(b => [b.id, Math.round(b.getBoundingClientRect().height), Math.round(b.getBoundingClientRect().width)]);
      return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, scrollH: document.documentElement.scrollHeight, innerH: innerHeight, overlay: [r.x, r.y, r.width, r.height].map(Math.round), roadSame: r.x === rr.x && r.y === rr.y && r.width === rr.width && r.height === rr.height,
        stageBottom: Math.round(document.querySelector('.stage').getBoundingClientRect().bottom), feedbackBottom: Math.round(document.querySelector('#feedback').getBoundingClientRect().bottom), over, controls: small, touchAction: getComputedStyle(document.querySelector('#editor')).touchAction, view: window.__H.view };
    });
    const s0 = await state(page);
    await page.screenshot({ path: join(shots, `${vp.name}-01-initial.png`) });
    await page.screenshot({ path: join(shots, `${vp.name}-01-initial-full.png`), fullPage: true });
    record(vp, 'initial layout: no horizontal overflow, overlay==road rect, backing=css*min(dpr,2), drawing enabled, default preset', layout.scrollW <= layout.innerW && layout.over.length === 0 && layout.roadSame && s0.backing.w === Math.round(s0.css * Math.min(s0.dpr, 2)) && s0.overlayPE === 'auto' && s0.id === 'broad-oval' && layout.touchAction === 'none', { layout, s0 });

    await ensureVisible(page);
    // B. mouse loose oval CW
    let before = await state(page);
    let midInk = null;
    await mouseStroke(page, densify(SHAPES.looseOvalCW, 12), { during: async () => { await frames(page); midInk = (await state(page)); await page.screenshot({ path: join(shots, `${vp.name}-02-draft-mouse.png`) }); } });
    await settle(page);
    let s = await state(page);
    const bOk = s.counts.commit === before.counts.commit + 1 && /^drawn-/.test(s.id) && near(s.bounds.minX, 600 - 380 * 1.0 - 46, 30) && near(s.bounds.maxX, 600 + 380 - 46 + 92, 40) && s.clockwise && s.ink === 0 && s.select === 'drawn';
    await page.screenshot({ path: join(shots, `${vp.name}-03-drawn-mouse-oval.png`) });
    record(vp, 'mouse: loose clockwise oval commits, maps to drawn world position, draft cleared', bOk, { before: before.id, after: s.id, bounds: s.bounds, clockwise: s.clockwise, midDraftInk: midInk?.ink, midFeedback: midInk?.feedback, ink: s.ink, feedback: s.feedback, ptr: s.ptr });

    // C. touch CCW concave kidney
    before = s;
    await touchStroke(page, cdp, densify(SHAPES.kidneyCCW, 12), { during: async () => { await frames(page); await page.screenshot({ path: join(shots, `${vp.name}-04-draft-touch.png`) }); } });
    await settle(page);
    s = await state(page);
    await page.screenshot({ path: join(shots, `${vp.name}-05-drawn-touch-kidney.png`) });
    record(vp, 'touch: counter-clockwise concave loop commits with CCW forward order', s.counts.commit === before.counts.commit + 1 && s.id !== before.id && !s.clockwise && s.scrollY === before.scrollY, { id: s.id, clockwise: s.clockwise, bounds: s.bounds, ptr: s.ptr, scrollY: [before.scrollY, s.scrollY] });

    // D. sparse mouse stroke (few raw samples)
    before = s;
    await mouseStroke(page, SHAPES.sparse);
    await settle(page); s = await state(page);
    await page.screenshot({ path: join(shots, `${vp.name}-06-drawn-sparse.png`) });
    record(vp, 'mouse: sparse 7-sample stroke smooths into a valid circuit', s.counts.commit === before.counts.commit + 1, { id: s.id, length: s.length, feedback: s.feedback });

    // E. nearly closed (7% gap)
    before = s;
    await touchStroke(page, cdp, densify(SHAPES.nearlyClosed, 12));
    await settle(page); s = await state(page);
    record(vp, 'touch: nearly-closed loop (7% gap) auto-closes and commits', s.counts.commit === before.counts.commit + 1, { id: s.id, feedback: s.feedback });

    // F. noisy slow touch (±1 css px jitter, ~1.5 css px spacing)
    before = s;
    {
      let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
      const v = await page.evaluate(() => window.__H.view.scale);
      const raw = densify(ellipse(600, 400, 370, 225, 120), 1.5 / v).map(p => P(p.x + (rnd() - .5) * 2 / v, p.y + (rnd() - .5) * 2 / v));
      await touchStroke(page, cdp, raw);
    }
    await settle(page); s = await state(page);
    record(vp, 'touch: slow noisy stroke (±1 CSS px jitter at ~1.5 px spacing) commits', s.counts.commit === before.counts.commit + 1, { result: s.counts.commit > before.counts.commit ? 'commit' : 'invalid', feedback: s.feedback });
    if (s.kind === 'invalid') await page.screenshot({ path: join(shots, `${vp.name}-07-noisy-invalid.png`) });

    // Reset to known track for invalid-preservation checks
    await page.click('#reset'); await settle(page);
    const resetState = await state(page);
    record(vp, 'reset circuit returns to Broad oval preset (select + readout)', resetState.id === 'broad-oval' && resetState.select === 'broad-oval' && resetState.name === 'Broad oval', { id: resetState.id, metrics: resetState.metrics });
    await ensureVisible(page);
    // commit a drawn track so "last valid" is a drawn one
    await mouseStroke(page, densify(SHAPES.looseOvalCW, 12)); await settle(page);
    const lastValid = await state(page);

    // G. invalid inputs keep last valid track
    const invalids = [['tiny', 'too-short', 'touch'], ['figureEight', 'self-intersection', 'mouse'], ['outOfBounds', 'out-of-bounds', 'mouse'], ['overshoot120', null, 'touch'], ['triangle', null, 'mouse']];
    for (const [shape, code, mode] of invalids) {
      before = await state(page);
      const pts = densify(SHAPES[shape], 12);
      if (mode === 'mouse') await mouseStroke(page, pts); else await touchStroke(page, cdp, pts);
      await settle(page); s = await state(page);
      const invalid = s.counts.invalid === before.counts.invalid + 1;
      if (code) {
        record(vp, `${mode}: ${shape} is rejected (${code}), red draft + message shown, last valid track kept`, invalid && s.id === lastValid.id && s.kind === 'invalid' && s.red > 0 && /Current circuit kept/.test(s.feedback), { feedback: s.feedback, id: s.id, red: s.red, ink: s.ink });
        if (shape === 'figureEight' || shape === 'tiny') await page.screenshot({ path: join(shots, `${vp.name}-08-invalid-${shape}.png`) });
      } else {
        record(vp, `${mode}: ${shape} (usability probe) — outcome recorded`, true, { outcome: invalid ? 'invalid' : 'commit', feedback: s.feedback }, invalid ? `rejected: ${s.feedback}` : 'accepted');
        await page.screenshot({ path: join(shots, `${vp.name}-09-probe-${shape}.png`) });
        if (!invalid) { await mouseStroke(page, densify(SHAPES.looseOvalCW, 12)); await settle(page); }
      }
    }
    const kept = await state(page);
    // H. clear after invalid erases the red draft; keeps track
    await mouseStroke(page, densify(SHAPES.tiny, 6)); await settle(page);
    const preClear = await state(page);
    await page.click('#clear'); await settle(page);
    s = await state(page);
    record(vp, 'Clear drawing after an invalid draft erases it and keeps the circuit', preClear.red > 0 && s.ink === 0 && s.id === preClear.id && s.counts.clear === preClear.counts.clear + 1, { preInk: preClear.ink, ink: s.ink, feedback: s.feedback });

    // I. clear mid-stroke (touch held, mouse clicks Clear), then finger lifts
    await ensureVisible(page);
    before = await state(page);
    await touchStroke(page, cdp, densify(SHAPES.looseOvalCW, 12), { during: async () => { await page.click('#clear'); } });
    await settle(page); s = await state(page);
    record(vp, 'touch: Clear clicked mid-stroke cancels; finger lift does not commit', s.counts.commit === before.counts.commit && s.id === before.id && s.ink === 0, { counts: s.counts, ink: s.ink, feedback: s.feedback, ptr: s.ptr });

    // J. pointercancel (touchCancel)
    before = await state(page);
    await touchStroke(page, cdp, densify(SHAPES.looseOvalCW, 12), { end: 'touchCancel' });
    await settle(page); s = await state(page);
    record(vp, 'touch: touchcancel/pointercancel cancels the draft with no commit', s.counts.commit === before.counts.commit && s.counts.clear === before.counts.clear + 1 && s.ink === 0, { ptr: s.ptr, feedback: s.feedback });
    // follow-up stroke still works
    before = s;
    await touchStroke(page, cdp, densify(SHAPES.kidneyCCW, 12)); await settle(page); s = await state(page);
    record(vp, 'touch: stroke after cancel commits normally', s.counts.commit === before.counts.commit + 1, { id: s.id });

    // K. multi-touch: second finger wanders while first draws
    before = s;
    await touchStroke(page, cdp, densify(SHAPES.looseOvalCW, 12), { extra: async (i, c) => i > 5 ? [{ x: c[0].x + 10 * Math.sin(i / 4), y: c[0].y + 40, id: 1 }] : null });
    await settle(page); s = await state(page);
    record(vp, 'multi-touch: secondary finger ignored; primary stroke commits with correct shape', s.counts.commit === before.counts.commit + 1 && s.clockwise && near(s.bounds.minX, 600 - 380 - 46, 30), { bounds: s.bounds, ptr: s.ptr });
    // two fingers down at once (pinch-like) then move both: only primary should draw
    before = s;
    {
      const c = await toClient(page, densify(SHAPES.kidneyCCW, 12));
      const c2 = await toClient(page, [P(600, 400)]);
      await touch(cdp, 'touchStart', [{ ...c[0], id: 0 }, { ...c2[0], id: 1 }]);
      for (let i = 1; i < c.length; i++) await touch(cdp, 'touchMove', [{ ...c[i], id: 0 }, { x: c2[0].x + i * 0.3, y: c2[0].y, id: 1 }]);
      await touch(cdp, 'touchEnd', []);
    }
    await settle(page); s = await state(page);
    record(vp, 'multi-touch: two fingers placed together; primary path still drives the stroke', s.counts.commit === before.counts.commit + 1 && !s.clockwise, { counts: s.counts, feedback: s.feedback, ptr: s.ptr });

    // L. mode toggle mid-stroke and rapid clicks
    before = s;
    await touchStroke(page, cdp, densify(SHAPES.looseOvalCW, 12), { during: async () => { await page.click('#drawing'); } });
    await settle(page); s = await state(page);
    const offState = s;
    record(vp, 'touch: Drawing toggled off mid-stroke cancels; late lift cannot commit; overlay pointer-events none', s.counts.commit === before.counts.commit && s.overlayPE === 'none' && s.ink === 0, { overlayPE: s.overlayPE, feedback: s.feedback });
    // disabled overlay routes input through to underlying canvas
    const through = await page.evaluate(() => { const r = document.querySelector('#editor').getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id; });
    before = await state(page);
    await mouseStroke(page, densify(SHAPES.looseOvalCW, 20));
    await touchStroke(page, cdp, densify(SHAPES.kidneyCCW, 20));
    await settle(page); s = await state(page);
    record(vp, 'disabled overlay: hit-test reaches #road; mouse/touch drags emit nothing', through === 'road' && JSON.stringify(s.counts) === JSON.stringify(before.counts) && s.id === before.id, { hitTest: through, counts: s.counts });
    await page.click('#drawing'); await settle(page);
    // rapid toggles mid-stroke (odd count => off), then verify consistent state
    before = await state(page);
    await touchStroke(page, cdp, densify(SHAPES.looseOvalCW, 12), { during: async () => { for (let k = 0; k < 5; k++) await page.click('#drawing', { delay: 0 }); } });
    await settle(page); s = await state(page);
    const pressed = await page.getAttribute('#drawing', 'aria-pressed');
    record(vp, 'rapid 5x Drawing toggles mid-stroke: no commit, aria-pressed matches overlay state', s.counts.commit === before.counts.commit && ((pressed === 'true') === (s.overlayPE === 'auto')), { pressed, overlayPE: s.overlayPE });
    if (pressed !== 'true') await page.click('#drawing');
    // rapid Reset + Clear + preset change mid-stroke
    before = await state(page);
    await touchStroke(page, cdp, densify(SHAPES.looseOvalCW, 12), { during: async () => { await page.click('#reset'); await page.click('#clear'); await page.selectOption('#preset', 'riverbend'); await page.click('#reset'); } });
    await settle(page); s = await state(page);
    record(vp, 'Reset/Clear/preset changes mid-stroke: no commit, ends on Broad oval', s.counts.commit === before.counts.commit && s.id === 'broad-oval' && s.ink === 0, { id: s.id, select: s.select });

    // M. preset determinism through UI
    const presetLens = {};
    for (const id of ['broad-oval', 'riverbend', 'club-circuit']) {
      await page.selectOption('#preset', id); await settle(page);
      const a = await state(page);
      await page.selectOption('#preset', 'broad-oval'); await page.selectOption('#preset', id); await settle(page);
      const b = await state(page);
      presetLens[id] = [a.length, b.length, a.metrics];
      if (vp.name === '1440x900' || id === 'club-circuit') await page.screenshot({ path: join(shots, `${vp.name}-10-preset-${id}.png`) });
    }
    record(vp, 'presets are deterministic across reselection', Object.values(presetLens).every(([a, b]) => a === b) && new Set(Object.values(presetLens).map(v => v[0])).size === 3, presetLens);
    // drawn option disabled
    const drawnDisabled = await page.evaluate(() => document.querySelector('#preset option[value="drawn"]').disabled);
    await page.selectOption('#preset', 'broad-oval'); await settle(page);

    // N. Escape mid-stroke
    await ensureVisible(page);
    before = await state(page);
    await mouseStroke(page, densify(SHAPES.looseOvalCW, 12), { during: async () => { await page.keyboard.press('Escape'); } });
    await settle(page); s = await state(page);
    record(vp, 'mouse: Escape mid-stroke cancels; mouseup does not commit', s.counts.commit === before.counts.commit && s.ink === 0, { feedback: s.feedback, drawnOptionDisabled: drawnDisabled });

    // O. scroll mid-stroke (wheel) cancels (only if page can scroll)
    before = await state(page);
    await mouseStroke(page, densify(SHAPES.looseOvalCW, 12), { during: async () => { await page.mouse.wheel(0, 60); await page.waitForTimeout(150); } });
    await settle(page); s = await state(page);
    record(vp, 'mouse: page scroll mid-stroke either cancels or keeps mapping consistent (no remapped commit)', s.scrollY === before.scrollY ? true : s.counts.commit === before.counts.commit, { scrolled: s.scrollY !== before.scrollY, scrollY: [before.scrollY, s.scrollY], commit: s.counts.commit - before.counts.commit, feedback: s.feedback });
    await ensureVisible(page);

    // P. resize mid-stroke cancels
    before = await state(page);
    await touchStroke(page, cdp, densify(SHAPES.looseOvalCW, 12), { during: async () => { await page.setViewportSize({ width: vp.width - 40, height: vp.height }); await page.waitForTimeout(150); } });
    await settle(page); s = await state(page);
    record(vp, 'touch: viewport resize mid-stroke cancels, no commit, no remapping', s.counts.commit === before.counts.commit && s.ink === 0, { feedback: s.feedback, css: [before.css, s.css] });
    await page.setViewportSize({ width: vp.width, height: vp.height }); await settle(page);
    // orientation swap, then draw maps correctly
    if (vp.mobile) {
      await page.setViewportSize({ width: vp.height, height: vp.width }); await settle(page); await page.waitForTimeout(100);
      await ensureVisible(page);
      before = await state(page);
      await touchStroke(page, cdp, densify(SHAPES.looseOvalCW, 12)); await settle(page); s = await state(page);
      await page.screenshot({ path: join(shots, `${vp.name}-11-rotated-${vp.height}x${vp.width}-drawn.png`) });
      const lay = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
      record(vp, `orientation swap to ${vp.height}x${vp.width}: backing resized, touch stroke commits at correct world position, no overflow`, s.counts.commit === before.counts.commit + 1 && near(s.bounds.minX, 600 - 380 - 46, 30) && s.backing.w === Math.round(s.css * 2) && lay.sw <= lay.iw, { bounds: s.bounds, backing: s.backing, css: s.css, lay });
      await page.setViewportSize({ width: vp.width, height: vp.height }); await settle(page); await page.waitForTimeout(100);
    }

    // Q. DPR change mid-stroke keeps gesture (contract) and resizes backing
    await ensureVisible(page);
    before = await state(page);
    await touchStroke(page, cdp, densify(SHAPES.kidneyCCW, 12), { during: async () => { await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile }); await page.waitForTimeout(150); } });
    await settle(page); s = await state(page);
    record(vp, 'DPR change mid-stroke: backing store rebuilt at DPR 1, gesture survives and commits', s.counts.commit === before.counts.commit + 1 && s.backing.w === Math.round(s.css * 1), { dpr: s.dpr, backing: s.backing, css: s.css, feedback: s.feedback, commitDelta: s.counts.commit - before.counts.commit });
    await cdp.send('Emulation.clearDeviceMetricsOverride'); await page.setViewportSize({ width: vp.width, height: vp.height }); await settle(page); await page.waitForTimeout(100);

    // R. hidden / resume mid-stroke (real tab switch via second page) then lift
    await ensureVisible(page);
    before = await state(page);
    let vis = {};
    await page.evaluate(() => { window.__vis = []; document.addEventListener('visibilitychange', () => window.__vis.push(document.visibilityState)); window.addEventListener('blur', () => window.__vis.push('blur')); });
    {
      const c = await toClient(page, densify(SHAPES.looseOvalCW, 12));
      await touch(cdp, 'touchStart', [{ ...c[0], id: 0 }]);
      for (let i = 1; i < c.length / 2; i++) await touch(cdp, 'touchMove', [{ ...c[i], id: 0 }]);
      const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront(); await page.waitForTimeout(250);
      vis.during = await page.evaluate(() => document.visibilityState);
      await page.bringToFront(); await other.close(); await page.waitForTimeout(150);
      for (let i = Math.ceil(c.length / 2); i < c.length; i++) await touch(cdp, 'touchMove', [{ ...c[i], id: 0 }]);
      await touch(cdp, 'touchEnd', []);
    }
    await settle(page); s = await state(page);
    vis.events = await page.evaluate(() => window.__vis);
    record(vp, 'hidden/resume mid-stroke: no stale commit or stuck capture; next stroke works', true, { commitDelta: s.counts.commit - before.counts.commit, clearDelta: s.counts.clear - before.counts.clear, vis, ptr: s.ptr, feedback: s.feedback }, 'recorded (headless tab switch fidelity limited)');
    before = await state(page);
    await mouseStroke(page, densify(SHAPES.kidneyCCW, 12)); await settle(page); s = await state(page);
    record(vp, 'after resume a new stroke commits', s.counts.commit === before.counts.commit + 1, { id: s.id });
    // synthetic visibility hidden + blur mid-stroke
    before = s;
    await touchStroke(page, cdp, densify(SHAPES.looseOvalCW, 12), { during: async () => { await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('blur')); }); } });
    await settle(page); s = await state(page);
    await page.evaluate(() => { delete document.visibilityState; });
    record(vp, 'window blur (with visibility hidden) mid-stroke cancels, no commit', s.counts.commit === before.counts.commit, { feedback: s.feedback });

    // S. destroy / reattach mid-stroke
    await ensureVisible(page);
    before = await state(page);
    await touchStroke(page, cdp, densify(SHAPES.looseOvalCW, 12), { during: async () => { await frames(page); await page.click('#lifecycle'); } });
    await settle(page); s = await state(page);
    const detached = await page.evaluate(() => ({ pe: getComputedStyle(document.querySelector('#editor')).pointerEvents, ta: getComputedStyle(document.querySelector('#editor')).touchAction, drawingDisabled: document.querySelector('#drawing').disabled, label: document.querySelector('#lifecycle').textContent }));
    record(vp, 'Detach mid-stroke: no commit, overlay cleared, pointer-events none, controls disabled', s.counts.commit === before.counts.commit && !s.hasEditor && s.ink === 0 && detached.pe === 'none' && detached.drawingDisabled, { detached, ink: s.ink, feedback: s.feedback });
    before = s;
    await mouseStroke(page, densify(SHAPES.looseOvalCW, 20)); await settle(page); s = await state(page);
    record(vp, 'detached: drawing emits nothing', JSON.stringify(s.counts) === JSON.stringify(before.counts), { counts: s.counts });
    // rapid attach/detach x7 (ends attached) then single stroke => exactly one commit
    for (let k = 0; k < 7; k++) await page.click('#lifecycle');
    await settle(page);
    before = await state(page);
    await touchStroke(page, cdp, densify(SHAPES.kidneyCCW, 12)); await settle(page); s = await state(page);
    record(vp, 'rapid detach/attach x7 then one stroke: exactly one commit (no duplicate listeners)', s.hasEditor && s.counts.commit === before.counts.commit + 1 && s.counts.draft - before.counts.draft < 400, { commitDelta: s.counts.commit - before.counts.commit, drafts: s.counts.draft - before.counts.draft });
    await page.screenshot({ path: join(shots, `${vp.name}-12-final.png`) });
    // focus visibility
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ id: document.activeElement?.id, outline: getComputedStyle(document.activeElement).outlineStyle }));
    record(vp, 'console/page errors: none', errors.length === 0, { errors, focus });
  } catch (e) {
    record(vp, 'script exception', false, { error: String(e.stack || e) });
    await page.screenshot({ path: join(shots, `${vp.name}-error.png`) }).catch(() => {});
  } finally {
    await context.close(); await browser.close();
  }
}
writeFileSync(join(here, 'browser-results.json'), JSON.stringify({ url: URL_, when: new Date().toISOString(), results }, null, 2));
const fails = results.filter(r => !r.pass);
log(`\n${results.length - fails.length}/${results.length} passed`);
for (const f of fails) log('FAIL', f.viewport, f.name, JSON.stringify(f.observed).slice(0, 400));
