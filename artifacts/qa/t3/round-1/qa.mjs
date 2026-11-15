// Independent T3 QA (round 1). Isolated playwright-core installed in the QA scratchpad;
// drives system Google Chrome. Usage: node qa.mjs <playwright-core dir> <base url>
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [pwDir, BASE = 'http://127.0.0.1:5197'] = process.argv.slice(2);
const { chromium } = createRequire(join(pwDir, 'package.json'))('playwright-core');
const OUT = dirname(fileURLToPath(import.meta.url));
const URL = `${BASE}/qa/t3.html`;
const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  { name: 'portrait-390x844', width: 390, height: 844, mobile: true },
  { name: 'landscape-844x390', width: 844, height: 390, mobile: true },
];
const results = { url: URL, startedAt: new Date().toISOString(), browser: null, viewports: {}, extra: {} };
const log = [];
const say = (...a) => { const line = a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); log.push(line); console.log(line); };

const initScript = () => {
  window.__raf = { requested: 0, ran: 0 };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { window.__raf.requested++; return raf((t) => { window.__raf.ran++; cb(t); }); };
};

// In-page helpers installed after load.
const helpers = () => {
  const W = window;
  W.qa = {
    frames: (n = 2) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }),
    snapshot(runId, generation, selected, seed = 0) {
      const storage = { cars: new Float32Array(512 * 8), sensors: new Float32Array(21), weights: new Float32Array(90), activations: new Float32Array(18) };
      for (let i = 0; i < 7; i++) storage.sensors[i * 3] = ((0.15 + i * 0.11 + seed) % 1);
      for (let i = 0; i < 90; i++) storage.weights[i] = Math.sin(i * 1.3 + seed * 7) * 1.4;
      for (let i = 0; i < 18; i++) storage.activations[i] = Math.cos(i * 0.9 + seed * 3) * 0.9;
      return { runId, generation, tick: 0, generationTick: 0, population: 512, alive: 400, running: false, rate: 1, selected, storage, computeMs: 0, steps: 0 };
    },
    history(runId, n, base = 10) {
      const entries = [];
      for (let g = 1; g <= n; g++) entries.push({ runId, generation: g, ticks: 1800, bestFitness: base + g * 3 + (g % 3), meanFitness: base / 2 + g, completedLaps: 0, bestLapSeconds: null });
      return { runId, completedGenerations: n, entries };
    },
    best(runId, generation, index, lap, n = 40) {
      const samples = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { const t = i / (n - 1) * Math.PI * 2; samples[i * 4] = 600 + Math.cos(t) * 400; samples[i * 4 + 1] = 400 + Math.sin(t) * 250; samples[i * 4 + 2] = t; samples[i * 4 + 3] = i * 0.5; }
      return { car: { runId, generation, index }, fitness: 1234.5, lapSeconds: lap, samples };
    },
    detach(...arrays) { const bufs = arrays.map((a) => a.buffer); structuredClone(bufs, { transfer: bufs }); return arrays.map((a) => a.length); },
    sensorReadings: () => [...document.querySelectorAll('.sensor-readings b')].map((b) => b.textContent),
    networkEdges: () => [...document.querySelectorAll('.network-diagram [data-edges] line')].map((l) => [l.getAttribute('stroke'), +l.getAttribute('stroke-opacity'), l.getAttribute('stroke-dasharray')]),
    networkNodes: () => [...document.querySelectorAll('.network-diagram [data-nodes] circle')].map((c) => [c.getAttribute('fill'), +c.getAttribute('fill-opacity')]),
    racing: () => { const s = document.querySelector('.racing-diagram'); const p = s.querySelector('[data-path]'); const root = s.closest('.teaching-diagram');
      return { source: root.querySelector('[data-source]').textContent, note: root.querySelector('[data-note]').textContent, d: p.getAttribute('d') || '', pathShown: p.style.display !== 'none' && !!p.getAttribute('d'), emptyShown: s.querySelector('[data-empty]').style.display !== 'none', exampleShown: s.querySelector('[data-example]').style.display !== 'none' && !s.querySelector('[data-example]').hasAttribute('hidden'), historyLabel: root.querySelector('[data-history-label]').textContent, historyD: root.querySelector('[data-history] path:nth-of-type(2)').getAttribute('d') || '' }; },
    expectNetwork(storage) {
      const e = []; for (let k = 0; k < 80; k++) { const idx = k < 64 ? Math.floor(k / 8) * 9 + k % 8 : 72 + Math.floor((k - 64) / 8) * 9 + (k - 64) % 8; const w = storage.weights[idx]; e.push([w >= 0 ? '#246b32' : '#737c6d', 0.09 + Math.min(1, Math.abs(w)) * 0.55, w < 0 ? '3 4' : 'none']); }
      const n = [...storage.activations].map((a) => [a >= 0 ? '#246b32' : '#737c6d', 0.08 + Math.min(1, Math.abs(a)) * 0.92]);
      return { e, n, steer: `${storage.activations[16] >= 0 ? '+' : ''}${storage.activations[16].toFixed(2)}`, throttle: `${Math.round((storage.activations[17] + 1) / 2 * 100)}%`, readings: [0, 1, 2, 3, 4, 5, 6].map((i) => Math.max(0, Math.min(1, storage.sensors[i * 3])).toFixed(2)) };
    },
    compareNetwork(exp) {
      const e = W.qa.networkEdges(); const n = W.qa.networkNodes(); let bad = 0;
      e.forEach((x, i) => { if (x[0] !== exp.e[i][0] || Math.abs(x[1] - exp.e[i][1]) > 1e-4 || x[2] !== exp.e[i][2]) bad++; });
      n.forEach((x, i) => { if (x[0] !== exp.n[i][0] || Math.abs(x[1] - exp.n[i][1]) > 1e-4) bad++; });
      const root = document.querySelector('.network-diagram');
      return { edgeCount: e.length, nodeCount: n.length, mismatches: bad, steer: root.querySelector('[data-steer]').textContent, throttle: root.querySelector('[data-throttle]').textContent, expectSteer: exp.steer, expectThrottle: exp.throttle };
    },
    luminance(rgb) { const c = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; },
    bg(el) { for (let n = el; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; } return 'rgb(255,255,255)'; },
    contrast(el, color) { const a = W.qa.luminance(color || getComputedStyle(el).color); const b = W.qa.luminance(W.qa.bg(el)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); },
  };
};

function check(bucket, name, ok, detail) { bucket.checks.push({ name, ok: !!ok, detail }); say(`${ok ? 'PASS' : 'FAIL'} [${bucket.name}] ${name}`, detail === undefined ? '' : detail); }

async function layoutAudit(page) {
  return page.evaluate(() => {
    const vw = innerWidth; const vh = innerHeight;
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]'); };
    const gridborn = document.querySelector('.gridborn');
    const overflow = [];
    for (const el of gridborn.querySelectorAll('*')) { if (!visible(el) || el.classList.contains('skip-link')) continue; const r = el.getBoundingClientRect(); if (r.right > vw + 0.5 || r.left < -0.5) overflow.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${Math.round(r.left)}..${Math.round(r.right)}`); }
    const clipped = [];
    for (const el of gridborn.querySelectorAll('button, select, label, .telemetry strong, .diagram-caption span, .track-hint span, h1, h2, p')) { if (!visible(el)) continue; if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') clipped.push(el.tagName + ':' + el.textContent.trim().slice(0, 30)); if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1) clipped.push('button-overflow:' + el.textContent.trim().slice(0, 30)); }
    const small = [];
    for (const el of gridborn.querySelectorAll('button, select, a, input[type=range], label.follow-control')) { if (!visible(el)) continue; const r = el.getBoundingClientRect(); if (r.height < 43.5 || r.width < 43.5) small.push(`${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') || el.textContent).trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`); }
    // Smallest rendered text (HTML and scaled SVG text).
    const sizes = {}; const tinyList = [];
    const walker = document.createTreeWalker(gridborn, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { const t = walker.currentNode; if (!t.textContent.trim()) continue; const el = t.parentElement; if (!visible(el)) continue; let px = parseFloat(getComputedStyle(el).fontSize); const svg = el.closest('svg'); if (svg && el instanceof SVGElement) { const vb = svg.viewBox.baseVal; if (vb && vb.width) px *= svg.getBoundingClientRect().width / vb.width; } const k = (Math.round(px * 2) / 2).toFixed(1); sizes[k] = (sizes[k] || 0) + 1; if (px < 10) tinyList.push(`${(Math.round(px * 10) / 10)}px ${el.tagName.toLowerCase()}.${el.getAttribute('class') || ''}: ${t.textContent.trim().slice(0, 28)}`); }
    const hero = document.querySelector('.hero-canvas').getBoundingClientRect();
    const editor = document.querySelector('.editor-canvas').getBoundingClientRect();
    const h1 = document.querySelector('h1').getBoundingClientRect();
    const run = document.querySelector('[data-running]').getBoundingClientRect();
    const telemetry = document.querySelector('.telemetry').getBoundingClientRect();
    const hit = document.elementFromPoint(hero.left + hero.width / 2, hero.top + hero.height / 2);
    const mono = getComputedStyle(document.querySelector('.lesson-index')).fontFamily;
    const telemFont = getComputedStyle(document.querySelector('[data-generation]')).fontFamily;
    const contrastTargets = { eyebrow: '.eyebrow', lessonIndex: '.lesson-index', controlNote: '.control-note', trackHint: '[data-stage-hint]', stageCorner: '.stage-corner', diagramNote: '.diagram-note', lessonCopy: '.lesson-copy p', lessonAside: '.lesson-aside', feedback: '.track-feedback', caption: '.diagram-caption', fieldLabel: '.field-label', footerNote: '.footer-note' };
    const contrast = {}; for (const [k, sel] of Object.entries(contrastTargets)) { const el = document.querySelector(sel); if (el) contrast[k] = +qa.contrast(el).toFixed(2); }
    contrast.svgNote = +qa.contrast(document.querySelector('.svg-note'), getComputedStyle(document.querySelector('.svg-note')).fill).toFixed(2);
    contrast.ratePressedOnSoft = +qa.contrast(document.querySelector('[data-rate][aria-pressed=true]')).toFixed(2);
    return {
      vw, vh, scrollWidth: document.documentElement.scrollWidth, overflow: overflow.slice(0, 20), clipped, small, sizes, tinyList,
      hero: { top: hero.top, bottom: hero.bottom, width: hero.width, height: hero.height }, editorEqual: ['left', 'top', 'width', 'height'].every((k) => Math.abs(hero[k] - editor[k]) < 0.01),
      editorPointerEvents: getComputedStyle(document.querySelector('.editor-canvas')).pointerEvents, centerHit: hit?.className,
      h1: { top: h1.top, bottom: h1.bottom }, run: { top: run.top, bottom: run.bottom }, telemetry: { top: telemetry.top, bottom: telemetry.bottom },
      heroCanvasFullyVisible: hero.top >= 0 && hero.bottom <= vh, heroVisibleFraction: Math.max(0, Math.min(vh, hero.bottom) - Math.max(0, hero.top)) / hero.height,
      runVisible: run.top >= 0 && run.bottom <= vh, mono, telemFont,
      touchAction: { heroCanvas: getComputedStyle(document.querySelector('.hero-canvas')).touchAction, sensorSvg: getComputedStyle(document.querySelector('.sensor-diagram')).touchAction, networkSvg: getComputedStyle(document.querySelector('.network-diagram')).touchAction, lessonText: getComputedStyle(document.querySelector('.lesson-copy p')).touchAction },
      userSelect: { lessonText: getComputedStyle(document.querySelector('.lesson-copy p')).userSelect, heroCanvas: getComputedStyle(document.querySelector('.hero-canvas')).userSelect, sensorSvg: getComputedStyle(document.querySelector('.sensor-diagram')).userSelect, calloutCanvas: getComputedStyle(document.querySelector('.hero-canvas')).webkitTouchCallout },
      contrast,
      semantics: { h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length, h2: [...document.querySelectorAll('.gridborn h2')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()), unlabeledControls: [...document.querySelectorAll('.gridborn button, .gridborn select, .gridborn input')].filter((el) => !(el.getAttribute('aria-label') || el.textContent.trim() || el.closest('label'))).length },
    };
  });
}

async function runViewport(browser, vp) {
  const bucket = { name: vp.name, checks: [], console: [], pageErrors: [], failedRequests: [], audit: null, screenshots: [] };
  results.viewports[vp.name] = bucket;
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 3 : 2, isMobile: vp.mobile, hasTouch: vp.mobile });
  await context.addInitScript(initScript);
  const page = await context.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) bucket.console.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => bucket.pageErrors.push(String(e)));
  page.on('requestfailed', (r) => bucket.failedRequests.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) bucket.failedRequests.push(`${r.status()} ${r.url()}`); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(helpers);
  await page.evaluate(() => document.fonts.ready);
  const shot = async (file, opts = {}) => { const path = join(OUT, `${vp.name}-${file}.png`); await page.screenshot({ path, ...opts }); bucket.screenshots.push(path); };
  const elShot = async (selector, file) => { const path = join(OUT, `${vp.name}-${file}.png`); await page.locator(selector).first().screenshot({ path }); bucket.screenshots.push(path); };

  // ---- Initial empty states and layout ----
  const initial = await page.evaluate(() => ({ generation: document.querySelector('[data-generation]').textContent, alive: document.querySelector('[data-alive]').textContent, lap: document.querySelector('[data-lap]').textContent, lapLabel: document.querySelector('[data-lap]').getAttribute('aria-label'), fitness: document.querySelector('[data-fitness]').getAttribute('aria-label'), fitnessPath: document.querySelector('[data-fitness] path:nth-of-type(2)').getAttribute('d'), racing: qa.racing(), panelHidden: document.querySelector('.inspection-panel').hidden, run: document.querySelector('[data-run-label]').textContent }));
  bucket.initial = initial;
  check(bucket, 'initial empty states: no fabricated generation/lap/history', initial.generation === '—' && initial.lap === '—' && initial.lapLabel === 'No completed lap yet' && !initial.fitnessPath && initial.racing.emptyShown && !initial.racing.pathShown && initial.panelHidden, initial);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await shot('hero');
  const audit = await layoutAudit(page);
  bucket.audit = audit;
  check(bucket, 'no horizontal page overflow', audit.scrollWidth <= audit.vw && audit.overflow.length === 0, { scrollWidth: audit.scrollWidth, overflow: audit.overflow });
  check(bucket, 'no clipped control/heading text', audit.clipped.length === 0, audit.clipped);
  check(bucket, 'visible interactive targets >= 44x44', audit.small.length === 0, audit.small);
  check(bucket, 'h1 visible in first viewport', audit.h1.top >= 0 && audit.h1.bottom <= audit.vh, audit.h1);
  check(bucket, 'hero canvas fully in first viewport', audit.heroCanvasFullyVisible, { hero: audit.hero, fraction: +audit.heroVisibleFraction.toFixed(2) });
  check(bucket, 'Play control in first viewport', audit.runVisible, audit.run);
  check(bucket, 'hero/editor canvases identical CSS boxes', audit.editorEqual, audit.hero);
  check(bucket, 'disabled editor overlay passes center hit to hero canvas', audit.editorPointerEvents === 'none' && audit.centerHit === 'hero-canvas', { pe: audit.editorPointerEvents, hit: audit.centerHit });
  check(bucket, 'mono font token applied to indices and telemetry', /ui-monospace/.test(audit.mono) && /ui-monospace/.test(audit.telemFont), audit.mono);
  check(bucket, 'touch-action/user-select restricted to interactive surfaces', audit.touchAction.heroCanvas === 'none' && audit.touchAction.sensorSvg === 'none' && audit.touchAction.lessonText === 'auto' && audit.touchAction.networkSvg === 'auto' && audit.userSelect.lessonText !== 'none' && audit.userSelect.heroCanvas === 'none', { ...audit.touchAction, ...audit.userSelect });
  const lowContrast = Object.entries(audit.contrast).filter(([, v]) => v < 4.5);
  check(bucket, 'text contrast >= 4.5:1 on sampled text', lowContrast.length === 0, audit.contrast);
  check(bucket, 'semantics: one h1, one main, labeled controls', audit.semantics.h1 === 1 && audit.semantics.main === 1 && audit.semantics.unlabeledControls === 0, audit.semantics);
  const tiny = Object.entries(audit.sizes).filter(([k]) => +k < 10).reduce((n, [, v]) => n + v, 0);
  bucket.textSizes = audit.sizes;
  check(bucket, 'rendered text nodes under 10px (informational, flagged if any)', tiny === 0, { sizes: audit.sizes, tiny: audit.tinyList });

  // Teaching section screenshots (default, illustrative states).
  for (const [demo, file] of [['sensors', 'sensors'], ['network', 'network'], ['genetics', 'genetics'], ['racing-line', 'racing-line']]) {
    await page.locator(`[data-demo="${demo}"]`).scrollIntoViewIfNeeded();
    await page.evaluate(() => qa.frames(3));
    await elShot(`.lesson:has([data-demo="${demo}"])`, file);
  }
  await shot('full', { fullPage: true });

  // ---- Lifecycle: idle has no continuous animation ----
  const idle = await page.evaluate(async () => { const a = window.__raf.requested; await new Promise((r) => setTimeout(r, 1000)); return window.__raf.requested - a; });
  check(bucket, 'no idle animation frames over 1s', idle === 0, { rafRequests: idle });

  // ---- Controls (immediate acknowledgement) ----
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  const ctl = await page.evaluate(async () => {
    const H = window.t3Harness; const out = {}; const n0 = H.intents.length;
    const wait = () => new Promise((r) => setTimeout(r, 30));
    const root = H.page.inspectionRoot; const rootChild = root.firstElementChild;
    const run = document.querySelector('[data-running]');
    run.focus(); run.click(); await wait();
    out.play = { intent: H.intents.at(-1), pressed: run.getAttribute('aria-pressed'), text: run.textContent.trim(), label: document.querySelector('[data-run-label]').textContent, focusKept: document.activeElement === run };
    run.click(); await wait(); out.pause = { intent: H.intents.at(-1), pressed: run.getAttribute('aria-pressed'), text: run.textContent.trim() };
    for (const r of ['4', 'fast', '1']) { const b = document.querySelector(`[data-rate="${r}"]`); b.focus(); b.click(); await wait(); out[`rate${r}`] = { intent: H.intents.at(-1), pressed: [...document.querySelectorAll('[data-rate]')].map((x) => x.getAttribute('aria-pressed')).join(','), note: document.querySelector('[data-rate-note]').textContent, focusKept: document.activeElement === b }; }
    const pop = document.querySelector('[data-population]'); pop.focus(); pop.value = '1000'; pop.dispatchEvent(new Event('change', { bubbles: true })); await wait();
    out.population = { intent: H.intents.at(-1), value: pop.value, alive: document.querySelector('[data-alive]').textContent, focusKept: document.activeElement === pop, options: [...pop.options].map((o) => o.value) };
    const preset = document.querySelector('[data-preset]'); preset.value = 'bend'; preset.dispatchEvent(new Event('change', { bubbles: true })); await wait();
    out.preset = { intent: H.intents.at(-1), value: preset.value };
    const draw = document.querySelector('[data-drawing]'); draw.focus(); draw.click(); await wait();
    out.drawOn = { intent: H.intents.at(-1), pressed: draw.getAttribute('aria-pressed'), text: draw.textContent, editorPE: getComputedStyle(H.page.editorCanvas).pointerEvents, editorHidden: H.page.editorCanvas.getAttribute('aria-hidden'), hint: document.querySelector('[data-stage-hint]').textContent, feedback: document.querySelector('[data-feedback]').textContent, focusKept: document.activeElement === draw };
    const hero = H.page.heroCanvas.getBoundingClientRect(); let heroClicks = 0; H.page.heroCanvas.addEventListener('click', () => heroClicks++);
    document.elementFromPoint(hero.left + hero.width * 0.3, hero.top + hero.height * 0.4).click();
    out.drawOn.heroReceivesClickWhileDrawingOverlayDisabled = heroClicks === 1;
    document.querySelector('[data-clear]').click(); await wait(); out.clear = H.intents.at(-1);
    draw.click(); await wait(); out.drawOff = { intent: H.intents.at(-1), pressed: draw.getAttribute('aria-pressed'), text: draw.textContent };
    document.querySelector('[data-reset]').click(); await wait(); out.reset = { intent: H.intents.at(-1), generation: document.querySelector('[data-generation]').textContent };
    out.stableInspectionRoot = H.page.inspectionRoot === root && root.isConnected && root.firstElementChild === rootChild;
    out.intentCount = H.intents.length - n0;
    return out;
  });
  bucket.controls = ctl;
  check(bucket, 'play/pause emit intents and reflect update', ctl.play.intent.action === 'running' && ctl.play.intent.value === true && ctl.play.pressed === 'true' && ctl.play.text.includes('Pause') && ctl.pause.intent.value === false && ctl.pause.pressed === 'false', { play: ctl.play, pause: ctl.pause });
  check(bucket, 'rate 4x/fast/1x explicit intents + pressed state', ctl.rate4.intent.value === 4 && ctl.rate4.pressed === 'false,true,false' && ctl.ratefast.intent.value === 'fast' && ctl.ratefast.pressed === 'false,false,true' && ctl.rate1.intent.value === 1 && ctl.rate1.pressed === 'true,false,false', [ctl.rate4, ctl.ratefast, ctl.rate1]);
  check(bucket, 'population 1000 intent and accepted value', ctl.population.intent.action === 'population' && ctl.population.intent.value === 1000 && ctl.population.value === '1000', ctl.population);
  check(bucket, 'preset intent and picker returns to placeholder', ctl.preset.intent.action === 'preset' && ctl.preset.intent.value === 'bend' && ctl.preset.value === '', ctl.preset);
  check(bucket, 'draw/clear/stop/reset intents', ctl.drawOn.intent.value === true && ctl.drawOn.pressed === 'true' && /Stop drawing/.test(ctl.drawOn.text) && ctl.clear.action === 'clear drawing' && ctl.drawOff.intent.value === false && ctl.reset.intent.action === 'reset', { drawOn: ctl.drawOn, clear: ctl.clear, drawOff: ctl.drawOff, reset: ctl.reset });
  check(bucket, 'page update never enables editor overlay; hero still receives clicks', ctl.drawOn.editorPE === 'none' && ctl.drawOn.heroReceivesClickWhileDrawingOverlayDisabled, ctl.drawOn);
  check(bucket, 'keyboard focus kept on controls across updates', ctl.play.focusKept && ctl.rate4.focusKept && ctl.population.focusKept && ctl.drawOn.focusKept, { play: ctl.play.focusKept, rate: ctl.rate4.focusKept, pop: ctl.population.focusKept, draw: ctl.drawOn.focusKept });
  check(bucket, 'inspection root and children stable across updates', ctl.stableInspectionRoot);

  // ---- Delayed acknowledgement + rapid clicks ----
  const delayed = await page.evaluate(async () => {
    const H = window.t3Harness; const out = {};
    document.querySelector('[data-fixture-delay]').click();
    const n0 = H.intents.length; const run = document.querySelector('[data-running]');
    for (let i = 0; i < 4; i++) run.click();
    out.rapidPlay = H.intents.slice(n0).map((x) => x.value);
    out.beforeAck = run.getAttribute('aria-pressed');
    await new Promise((r) => setTimeout(r, 450));
    out.afterAck = run.getAttribute('aria-pressed');
    const pop = document.querySelector('[data-population]'); const was = pop.value;
    pop.value = '256'; pop.dispatchEvent(new Event('change', { bubbles: true }));
    out.popPending = { valueDuringPending: pop.value, was };
    await new Promise((r) => setTimeout(r, 450));
    out.popAccepted = pop.value;
    // Rapid alternating rate requests: last ack wins.
    for (const r of ['4', 'fast', '1', '4']) document.querySelector(`[data-rate="${r}"]`).click();
    await new Promise((r) => setTimeout(r, 450));
    out.rateFinal = [...document.querySelectorAll('[data-rate]')].map((x) => x.getAttribute('aria-pressed')).join(',');
    // Pause again for later tests.
    run.click(); await new Promise((r) => setTimeout(r, 450));
    document.querySelector('[data-fixture-delay]').click();
    out.finalRunning = H.state.running;
    return out;
  });
  bucket.delayed = delayed;
  check(bucket, 'rapid Play before ack repeats same intent; reflects only on ack', delayed.rapidPlay.every((v) => v === true) && delayed.rapidPlay.length === 4 && delayed.beforeAck === 'false' && delayed.afterAck === 'true', delayed);
  check(bucket, 'population select restores accepted value while pending, then shows ack', delayed.popPending.valueDuringPending === delayed.popPending.was && delayed.popAccepted === '256', delayed);
  check(bucket, 'rapid rate clicks settle to last acknowledged value', delayed.rateFinal === 'false,true,false', delayed.rateFinal);

  // ---- Network illustration (forward pass responds to controls) ----
  await page.locator('[data-demo="network"]').scrollIntoViewIfNeeded();
  const netIllus = await page.evaluate(async () => {
    await qa.frames(2);
    const root = document.querySelector('.network-diagram'); const read = () => ({ steer: root.querySelector('[data-steer]').textContent, throttle: root.querySelector('[data-throttle]').textContent, node3: root.querySelectorAll('[data-nodes] circle')[3].getAttribute('fill-opacity'), edge74: root.querySelectorAll('[data-edges] line')[64 + 2].getAttribute('stroke-width') });
    const a = read(); const w = document.querySelector('[data-weight]'); w.value = '-2'; w.dispatchEvent(new Event('input', { bubbles: true })); await qa.frames(2); const b = read();
    const c = document.querySelector('[data-clearance]'); c.value = '0'; c.dispatchEvent(new Event('input', { bubbles: true })); await qa.frames(2); const d = read();
    // Independent forward-pass verification of the illustration: recompute in QA code.
    const weights = Array.from({ length: 90 }, (_, i) => Math.fround(Math.sin(i * 1.73 + 0.4) * 0.85)); weights[74] = -2;
    const act = new Array(18).fill(0); for (let i = 0; i < 7; i++) act[i] = Math.fround(0.25 + 0.65 * Math.sin((i + 1) * 0.39)); act[3] = 0; act[7] = Math.fround(0.45);
    for (let o = 0; o < 8; o++) { let s = weights[o * 9 + 8]; for (let i = 0; i < 8; i++) s += act[i] * weights[o * 9 + i]; act[8 + o] = Math.fround(Math.tanh(s)); }
    for (let o = 0; o < 2; o++) { let s = weights[72 + o * 9 + 8]; for (let i = 0; i < 8; i++) s += act[8 + i] * weights[72 + o * 9 + i]; act[16 + o] = Math.fround(Math.tanh(s)); }
    w.value = '0.5'; w.dispatchEvent(new Event('input', { bubbles: true })); c.value = '65'; c.dispatchEvent(new Event('input', { bubbles: true }));
    return { a, b, d, expect: { steer: `${act[16] >= 0 ? '+' : ''}${act[16].toFixed(2)}`, throttle: `${Math.round((act[17] + 1) / 2 * 100)}%` }, source: document.querySelector('.network-diagram').closest('.teaching-diagram').querySelector('[data-source]').textContent };
  });
  bucket.networkIllustration = netIllus;
  check(bucket, 'network illustration: weight/input sliders change outputs; independent recompute matches', netIllus.a.steer !== netIllus.b.steer && netIllus.b.node3 !== netIllus.d.node3 && netIllus.d.steer === netIllus.expect.steer && netIllus.d.throttle === netIllus.expect.throttle && /Illustration/.test(netIllus.source), netIllus);

  // ---- Sensor demo: pointer/touch drag + keyboard ----
  await page.locator('[data-demo="sensors"]').scrollIntoViewIfNeeded();
  await page.evaluate(() => qa.frames(2));
  const svgBox = await page.locator('.sensor-diagram').boundingBox();
  const toPx = (ux, uy) => ({ x: svgBox.x + ux / 640 * svgBox.width, y: svgBox.y + uy / 330 * svgBox.height });
  const before = await page.evaluate(() => ({ r: qa.sensorReadings(), pos: document.querySelector('[data-position]').value }));
  const scrollBefore = await page.evaluate(() => scrollY);
  if (vp.mobile) {
    const cdp = await context.newCDPSession(page);
    const p0 = toPx(328, 242); const p1 = toPx(420, 260); const p2 = toPx(240, 250);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p0.x, y: p0.y }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p0.x + (p1.x - p0.x) * i / 6, y: p0.y + (p1.y - p0.y) * i / 6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.evaluate(() => qa.frames(2));
    const afterDrag = await page.evaluate(() => ({ r: qa.sensorReadings(), pos: document.querySelector('[data-position]').value, scrollY }));
    // touchcancel mid-gesture, then a stray move must not drag.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p1.x, y: p1.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (p1.x + p2.x) / 2, y: p1.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.evaluate(() => qa.frames(2));
    const afterCancel = await page.evaluate(() => document.querySelector('[data-position]').value);
    await page.mouse.move(p2.x, p2.y); // stray pointer move with no button
    await page.evaluate(() => qa.frames(2));
    const afterStray = await page.evaluate(() => document.querySelector('[data-position]').value);
    bucket.sensorTouch = { before, afterDrag, afterCancel, afterStray, scrollBefore };
    check(bucket, 'touch drag moves sensor car and readings; page does not scroll during drag', +afterDrag.pos > +before.pos + 40 && afterDrag.r.join() !== before.r.join() && Math.abs(afterDrag.scrollY - scrollBefore) < 2, bucket.sensorTouch);
    check(bucket, 'touchcancel ends drag (no movement afterwards)', afterStray === afterCancel, { afterCancel, afterStray });
    // Page scroll gestures: outside interactive surface scrolls, on non-interactive diagram scrolls.
    const textBox = await page.locator('.lesson:has([data-demo="sensors"]) .lesson-copy p').boundingBox();
    const scroll = async (x, y) => { const s0 = await page.evaluate(() => scrollY); await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(x), y: Math.round(y), yDistance: -120, gestureSourceType: 'touch', speed: 800 }); await page.waitForTimeout(250); return (await page.evaluate(() => scrollY)) - s0; };
    const onText = await scroll(textBox.x + 20, textBox.y + 10);
    await page.locator('[data-demo="network"]').scrollIntoViewIfNeeded();
    const netBox = await page.locator('.network-diagram').boundingBox();
    const onNetwork = await scroll(netBox.x + netBox.width / 2, netBox.y + netBox.height / 2);
    bucket.touchScroll = { onText, onNetwork };
    check(bucket, 'touch scroll works over article text and non-draggable diagrams', onText > 40 && onNetwork > 40, bucket.touchScroll);
    await cdp.detach();
  } else {
    const p0 = toPx(328, 242); const p1 = toPx(420, 260);
    await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 8 }); await page.mouse.up();
    await page.evaluate(() => qa.frames(2));
    const afterDrag = await page.evaluate(() => ({ r: qa.sensorReadings(), pos: document.querySelector('[data-position]').value }));
    await page.mouse.move(toPx(220, 250).x, p1.y);
    const afterStray = await page.evaluate(() => document.querySelector('[data-position]').value);
    bucket.sensorMouse = { before, afterDrag, afterStray };
    check(bucket, 'mouse drag moves sensor car and readings; no drag after release', +afterDrag.pos > +before.pos + 40 && afterDrag.r.join() !== before.r.join() && afterStray === afterDrag.pos, bucket.sensorMouse);
    // Text outside interactive surfaces is selectable.
    const sel = await page.evaluate(() => { const p = document.querySelector('.lesson-copy p'); const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r); const s = getSelection().toString().length; getSelection().removeAllRanges(); return s; });
    const dragSel = await (async () => { const b = await page.locator('.lesson-copy p').first().boundingBox(); await page.mouse.move(b.x + 2, b.y + 6); await page.mouse.down(); await page.mouse.move(b.x + b.width - 4, b.y + 6, { steps: 6 }); await page.mouse.up(); return page.evaluate(() => { const s = getSelection().toString(); getSelection().removeAllRanges(); return s.length; }); })();
    check(bucket, 'article text selectable by mouse drag', sel > 20 && dragSel > 5, { sel, dragSel });
  }
  await page.locator('[data-demo="sensors"]').scrollIntoViewIfNeeded();
  const kb = await (async () => {
    await page.locator('[data-position]').focus();
    const p0 = await page.evaluate(() => document.querySelector('[data-position]').value);
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
    await page.locator('[data-heading]').focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
    await page.evaluate(() => qa.frames(2));
    return page.evaluate((p0) => ({ p0, p1: document.querySelector('[data-position]').value, heading: document.querySelector('[data-heading]').value, transform: document.querySelector('.sensor-diagram [data-car]').getAttribute('transform'), readings: qa.sensorReadings(), focusOutline: getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineColor }), p0);
  })();
  bucket.sensorKeyboard = kb;
  check(bucket, 'keyboard sliders move/rotate sensor car with visible focus', +kb.p1 === +kb.p0 - 10 && kb.heading === '20' && /rotate\(20\)/.test(kb.transform) && /solid/.test(kb.focusOutline), kb);
  // Independent geometry check of illustrative rays: center car facing forward, ray 1 (left, -90°) hits wall at x=178.
  const geo = await page.evaluate(async () => {
    const pos = document.querySelector('[data-position]'); const hd = document.querySelector('[data-heading]');
    pos.value = '328'; pos.dispatchEvent(new Event('input')); hd.value = '0'; hd.dispatchEvent(new Event('input')); await qa.frames(2);
    const lines = [...document.querySelectorAll('.sensor-diagram [data-rays] line')].map((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => +l.getAttribute(k)));
    return { lines, readings: qa.sensorReadings(), carY: document.querySelector('.sensor-diagram [data-car]').getAttribute('transform') };
  });
  bucket.sensorGeometry = geo;
  const leftRay = geo.lines[0]; const rightRay = geo.lines[6];
  check(bucket, 'illustrative ray-wall intersection geometrically correct (side rays hit x=178/478)', Math.abs(leftRay[2] - 178) < 0.5 && Math.abs(rightRay[2] - 478) < 0.5 && geo.readings[0] === (150 / 220).toFixed(2), { leftRay, rightRay, readings: geo.readings });

  // ---- Genetics interactions ----
  await page.locator('[data-demo="genetics"]').scrollIntoViewIfNeeded();
  const gen = await page.evaluate(async () => {
    const root = document.querySelector('.genetics-diagram').closest('.teaching-diagram'); const rects = () => [...root.querySelectorAll('[data-genes] rect')]; const bars = () => [...root.querySelectorAll('[data-genes] line')].map((l) => l.getAttribute('y2'));
    await qa.frames(2);
    const childFill = () => rects().slice(24).map((r) => r.getAttribute('fill') === '#e5efdf' ? 'A' : 'B').join('');
    const out = { initialChild: childFill(), split0: root.querySelector('[data-split]').getAttribute('d') };
    const x = root.querySelector('[data-crossover]'); x.value = '3'; x.dispatchEvent(new Event('input')); await qa.frames(2);
    out.child3 = childFill(); out.split3 = root.querySelector('[data-split]').getAttribute('d');
    const before = bars().slice(24).join();
    const a = root.querySelector('[data-parent-a]'); a.value = '2'; a.dispatchEvent(new Event('input')); await qa.frames(2);
    out.parentAChangesRowAandChildLeft = bars().slice(0, 12).join() !== '' && bars().slice(24, 27).join() !== before.split(',').slice(0, 3).join() && bars().slice(27).join() === before.split(',').slice(3).join();
    const m = root.querySelector('[data-mutate]'); for (let i = 0; i < 20; i++) m.click(); await qa.frames(2);
    out.after20 = { count: root.querySelector('[data-mutation-count]').textContent, ochre: rects().filter((r) => r.getAttribute('stroke') === '#956018').length, disabled: m.disabled, note: root.querySelector('[data-note]').textContent };
    root.querySelector('[data-reset]').click(); await qa.frames(2);
    m.click(); m.click(); m.click(); await qa.frames(2);
    out.after3 = { count: root.querySelector('[data-mutation-count]').textContent, ochre: rects().filter((r) => r.getAttribute('stroke') === '#956018').length, parentsOnlyUnmutated: rects().slice(0, 24).every((r) => r.getAttribute('stroke') === 'none'), titles: [...root.querySelectorAll('[data-genes] rect title')].slice(24).map((t) => t.textContent).filter((t) => t.includes('mutated')).length };
    root.querySelector('[data-reset]').click(); await qa.frames(2);
    out.reset = { count: root.querySelector('[data-mutation-count]').textContent, a: a.value, crossover: x.value, child: childFill() };
    out.caption = root.querySelector('.diagram-caption span').textContent;
    return out;
  });
  bucket.genetics = gen;
  check(bucket, 'genetics: crossover moves split and child inheritance', gen.initialChild === 'AAAAAABBBBBB' && gen.child3 === 'AAABBBBBBBBB' && gen.split0 !== gen.split3, gen);
  check(bucket, 'genetics: parent change affects A-side of child only', gen.parentAChangesRowAandChildLeft, gen);
  check(bucket, 'genetics: mutate caps at 12 and disables; 3 mutations = 3 ochre child genes; reset restores', gen.after20.count === '12 mutations' && gen.after20.ochre === 12 && gen.after20.disabled && gen.after3.count === '3 mutations' && gen.after3.ochre === 3 && gen.after3.parentsOnlyUnmutated && gen.after3.titles === 3 && gen.reset.count === '0 mutations' && gen.reset.child === 'AAAAAABBBBBB', { after20: gen.after20, after3: gen.after3, reset: gen.reset });
  check(bucket, 'genetics labeled illustrative, no actual lineage', /Illustration/.test(gen.caption) && /no actual lineage/.test(gen.caption), gen.caption);

  // ---- Selection fixture → live sensors/network; snapshot ownership ----
  const sel = await page.evaluate(async () => {
    const H = window.t3Harness; const out = {};
    const runId = H.state.history.runId;
    const s = qa.snapshot(runId, 4, { runId, generation: 4, index: 7 });
    const exp = qa.expectNetwork(s.storage);
    const hist = qa.history(runId, 5);
    H.setState({ selected: { runId, generation: 4, index: 7 } });
    H.supply(s, hist, null);
    // Detach and mutate every borrowed buffer synchronously, before any deferred draw.
    s.storage.weights[0] = 99; out.detachedLengths = qa.detach(s.storage.cars, s.storage.sensors, s.storage.weights, s.storage.activations);
    hist.entries.forEach((e) => { e.bestFitness = -999; }); hist.entries.push({ runId, generation: 99, ticks: 1, bestFitness: 5000, meanFitness: 5000, completedLaps: 0, bestLapSeconds: null });
    await qa.frames(3);
    document.querySelector('.network-diagram').scrollIntoView({ block: 'center', behavior: 'instant' }); await qa.frames(3);
    out.network = qa.compareNetwork(exp);
    document.querySelector('.sensor-diagram').scrollIntoView({ block: 'center', behavior: 'instant' }); await qa.frames(3);
    out.sensor = { readings: qa.sensorReadings(), expected: exp.readings, source: document.querySelector('.sensor-diagram').closest('.teaching-diagram').querySelector('[data-source]').textContent, wallsHidden: document.querySelector('.sensor-diagram [data-walls]').style.display === 'none', slidersDisabled: document.querySelector('[data-position]').disabled, followEnabled: !document.querySelector('.sensor-diagram').closest('.teaching-diagram').querySelector('input[type=checkbox]').disabled, rayLen0: (() => { const l = document.querySelector('.sensor-diagram [data-rays] line'); return Math.hypot(l.getAttribute('x2') - l.getAttribute('x1'), l.getAttribute('y2') - l.getAttribute('y1')); })() };
    out.panel = { hidden: document.querySelector('.inspection-panel').hidden, heading: document.querySelector('[data-selection]').textContent, rootChildren: H.page.inspectionRoot.children.length };
    document.querySelector('.racing-diagram').scrollIntoView({ block: 'center', behavior: 'instant' }); await qa.frames(3);
    const racing = qa.racing(); out.racingHistory = { label: racing.historyLabel, points: (racing.historyD.match(/[ML]/g) || []).length };
    const heroSpark = document.querySelector('[data-fitness] path:nth-of-type(2)').getAttribute('d'); out.heroSparkPoints = (heroSpark.match(/[ML]/g) || []).length;
    out.heroHistoryLabel = document.querySelector('[data-history-label]').textContent;
    return out;
  });
  bucket.selection = sel;
  check(bucket, 'network live mode maps 90 weights/18 activations exactly (destination-major), throttle mapping', sel.network.edgeCount === 80 && sel.network.nodeCount === 18 && sel.network.mismatches === 0 && sel.network.steer === sel.network.expectSteer && sel.network.throttle === sel.network.expectThrottle, sel.network);
  check(bucket, 'sensor live mode shows supplied normalized distances; walls hidden; illustration controls disabled', JSON.stringify(sel.sensor.readings) === JSON.stringify(sel.sensor.expected) && sel.sensor.wallsHidden && sel.sensor.slidersDisabled && sel.sensor.followEnabled && /live/.test(sel.sensor.source) && Math.abs(sel.sensor.rayLen0 - (+sel.sensor.expected[0]) * 220) < 1.2, sel.sensor);
  check(bucket, 'detached/mutated buffers after update: deferred redraw uses owned copies', sel.detachedLengths.every((n) => n === 0) && sel.network.mismatches === 0 && sel.racingHistory.points === 5 && sel.heroSparkPoints === 5, { detached: sel.detachedLengths, racingHistory: sel.racingHistory, heroSparkPoints: sel.heroSparkPoints });
  check(bucket, 'inspection shell shows selected car and keeps root child', !sel.panel.hidden && sel.panel.heading === 'Car 008 · generation 4' && sel.panel.rootChildren === 1, sel.panel);
  // Live-mode screenshots.
  await page.locator('[data-demo="sensors"]').scrollIntoViewIfNeeded(); await page.evaluate(() => qa.frames(2));
  await elShot('.lesson:has([data-demo="sensors"])', 'sensors-live');
  await page.locator('[data-demo="network"]').scrollIntoViewIfNeeded(); await page.evaluate(() => qa.frames(2));
  await elShot('.lesson:has([data-demo="network"])', 'network-live');
  // Inspection panel placement relative to the hero when a car is selected from the top of the page.
  const placement = await page.evaluate(async () => { scrollTo({ top: 0, behavior: 'instant' }); await qa.frames(2); const p = document.querySelector('.inspection-panel').getBoundingClientRect(); const c = document.querySelector('.hero-canvas').getBoundingClientRect(); return { panelTop: Math.round(p.top), panelBottom: Math.round(p.bottom), canvasBottom: Math.round(c.bottom), vh: innerHeight, panelHeadingVisible: p.top + 60 <= innerHeight }; });
  bucket.inspectionPlacement = placement;
  check(bucket, 'inspection heading visible without scrolling after selecting from hero', placement.panelHeadingVisible, placement);
  await shot('hero-selected');

  // Follow toggle → returns to example.
  const follow = await page.evaluate(async () => {
    document.querySelector('.sensor-diagram').scrollIntoView({ block: 'center', behavior: 'instant' }); await qa.frames(2);
    const box = document.querySelector('.sensor-diagram').closest('.teaching-diagram').querySelector('input[type=checkbox]'); box.click(); await qa.frames(2);
    const r = { source: document.querySelector('.sensor-diagram').closest('.teaching-diagram').querySelector('[data-source]').textContent, walls: document.querySelector('.sensor-diagram [data-walls]').style.display };
    box.click(); await qa.frames(2); return r;
  });
  check(bucket, 'unchecking Follow returns sensors to illustration', /Illustration/.test(follow.source) && follow.walls === '', follow);

  // ---- Stale selection, stale best, partial vs lap ----
  const stale = await page.evaluate(async () => {
    const H = window.t3Harness; const out = {}; const runId = H.state.history.runId;
    const src = () => [document.querySelector('.sensor-diagram'), document.querySelector('.network-diagram')].map((s) => s.closest('.teaching-diagram').querySelector('[data-source]').textContent);
    const view = async () => { for (const s of ['.sensor-diagram', '.network-diagram']) { document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }); await qa.frames(2); } };
    H.supply(qa.snapshot(runId, 5, { runId, generation: 4, index: 7 }), H.state.history, null); await view(); out.staleGeneration = src();
    H.supply(qa.snapshot(runId, 5, { runId: runId - 1, generation: 5, index: 7 }), H.state.history, null); await view(); out.staleRun = src();
    H.supply(qa.snapshot(runId, 5, { runId, generation: 5, index: 600 }), H.state.history, null); await view(); out.outOfRange = src();
    H.supply(null, H.state.history, null); await view(); out.nullSnapshot = src();
    const hist = qa.history(runId, 6);
    document.querySelector('.racing-diagram').scrollIntoView({ block: 'center', behavior: 'instant' });
    H.supply(null, hist, qa.best(runId - 1, 3, 2, null)); await qa.frames(3); out.staleBest = qa.racing();
    const partial = qa.best(runId, 3, 2, null, 40); H.supply(null, hist, partial); partial.samples[0] = 99999; qa.detach(partial.samples);
    await qa.frames(3); out.partial = qa.racing(); out.partialPoints = (out.partial.d.match(/[ML]/g) || []).length;
    const lap = qa.best(runId, 6, 11, 41.237, 60); H.supply(null, hist, lap); await qa.frames(3); out.lap = qa.racing(); out.lapPoints = (out.lap.d.match(/[ML]/g) || []).length;
    // Offscreen deferred update: scroll to top, supply a new best, detach it, then scroll back.
    scrollTo({ top: 0, behavior: 'instant' }); await qa.frames(2);
    const deferred = qa.best(runId, 7, 3, 39.5, 24); H.supply(null, hist, deferred); qa.detach(deferred.samples);
    await qa.frames(2);
    document.querySelector('.racing-diagram').scrollIntoView({ block: 'center', behavior: 'instant' }); await qa.frames(4);
    out.deferred = qa.racing(); out.deferredPoints = (out.deferred.d.match(/[ML]/g) || []).length;
    // Explore corner while actual history remains.
    const mode = document.querySelector('[data-mode]'); mode.click(); await qa.frames(2);
    out.explore = { ...qa.racing(), slider: !document.querySelector('[data-corner-controls]').hidden };
    const d0 = document.querySelector('[data-corner]').getAttribute('d'); const sl = document.querySelector('[data-apex-control]'); sl.value = '90'; sl.dispatchEvent(new Event('input')); await qa.frames(2);
    out.cornerChanges = document.querySelector('[data-corner]').getAttribute('d') !== d0;
    for (let i = 0; i < 9; i++) mode.click(); await qa.frames(2); out.afterRapidToggle = { pressed: mode.getAttribute('aria-pressed'), ...qa.racing() };
    return out;
  });
  bucket.stale = stale;
  const allIllus = (arr) => arr.every((s) => /Illustration/.test(s));
  check(bucket, 'stale generation/run/out-of-range/null selection fall back to illustration', allIllus(stale.staleGeneration) && allIllus(stale.staleRun) && allIllus(stale.outOfRange) && allIllus(stale.nullSnapshot), { g: stale.staleGeneration, r: stale.staleRun, o: stale.outOfRange, n: stale.nullSnapshot });
  check(bucket, 'stale-run best ignored (empty state)', stale.staleBest.emptyShown && !stale.staleBest.pathShown, stale.staleBest);
  check(bucket, 'partial attempt labeled partial, all samples drawn, copy survives mutation+detach', /partial attempt/.test(stale.partial.source) && stale.partialPoints === 40 && !/99999/.test(stale.partial.d) && /not completed a timed lap/.test(stale.partial.note), { source: stale.partial.source, note: stale.partial.note, points: stale.partialPoints });
  check(bucket, 'complete lap labeled with supplied time and only supplied samples', /41\.24 s lap/.test(stale.lap.source) && stale.lapPoints === 60 && /Generation 6, car 12/.test(stale.lap.note), { source: stale.lap.source, note: stale.lap.note, points: stale.lapPoints });
  check(bucket, 'offscreen update + detach: deferred racing redraw accurate', /39\.50 s lap/.test(stale.deferred.source) && stale.deferredPoints === 24, { source: stale.deferred.source, points: stale.deferredPoints });
  check(bucket, 'explore corner labeled illustrative, slider changes arc, actual history retained', /Illustration/.test(stale.explore.source) && /not a measured/.test(stale.explore.note) && stale.explore.slider && stale.cornerChanges && /6 completed/.test(stale.explore.historyLabel), stale.explore);
  check(bucket, 'rapid corner-mode toggling ends in consistent state', stale.afterRapidToggle.pressed === 'false' && stale.afterRapidToggle.pathShown && !stale.afterRapidToggle.exampleShown, stale.afterRapidToggle);
  await page.locator('[data-demo="racing-line"]').scrollIntoViewIfNeeded(); await page.evaluate(() => qa.frames(2));
  await elShot('.lesson:has([data-demo="racing-line"])', 'racing-line-lap');
  await page.evaluate(async () => { document.querySelector('[data-mode]').click(); await qa.frames(2); });
  await elShot('.lesson:has([data-demo="racing-line"])', 'racing-line-corner');
  await page.evaluate(async () => { document.querySelector('[data-mode]').click(); await qa.frames(2); });

  // ---- Sparkline uses supplied history only ----
  const spark = await page.evaluate(async () => {
    const H = window.t3Harness; const runId = H.state.history.runId; const p = () => ({ best: document.querySelector('[data-fitness] path:nth-of-type(2)').getAttribute('d'), dot: document.querySelector('[data-fitness] circle').getAttribute('visibility'), label: document.querySelector('[data-fitness]').getAttribute('aria-label') });
    H.supply(null, { runId, completedGenerations: 0, entries: [] }, null); const empty = p();
    H.supply(null, qa.history(runId, 1), null); const one = p();
    const h = qa.history(runId, 3); h.entries[1] = { ...h.entries[1], bestFitness: 100 }; H.supply(null, h, null); const three = p();
    // History beyond window: completedGenerations larger than entries.
    H.supply(null, { runId, completedGenerations: 300, entries: qa.history(runId, 256).entries.map((e, i) => ({ ...e, generation: 45 + i })) }, null); const windowed = { ...p(), heroLabel: document.querySelector('[data-history-label]').textContent };
    H.supply(null, { runId, completedGenerations: 0, entries: [] }, null);
    return { empty, one, three, windowed };
  });
  bucket.sparkline = spark;
  const pts = (d) => (d?.match(/[ML]/g) || []).length;
  check(bucket, 'sparkline: empty→hidden, one entry→single point, N entries→N points, peak follows data', !spark.empty.best && spark.empty.dot === 'hidden' && pts(spark.one.best) === 1 && spark.one.dot === 'visible' && pts(spark.three.best) === 3 && /M4\.00,[\d.]+L100\.00,5\.00L196\.00/.test(spark.three.best) && pts(spark.windowed.best) === 256 && /300 gen/.test(spark.windowed.heroLabel), spark);

  // ---- Close selection with keyboard; focus management ----
  const closeSel = await page.evaluate(async () => {
    const H = window.t3Harness; const runId = H.state.history.runId;
    H.setState({ selected: { runId, generation: 1, index: 2 } });
    const close = document.querySelector('[data-close]'); close.focus();
    return { focusedBefore: document.activeElement === close };
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(60);
  const closeAfter = await page.evaluate(() => ({ intent: window.t3Harness.intents.at(-1), hidden: document.querySelector('.inspection-panel').hidden, active: document.activeElement === document.body ? 'body' : document.activeElement.tagName + '.' + document.activeElement.className, rootStill: window.t3Harness.page.inspectionRoot.isConnected && window.t3Harness.page.inspectionRoot.children.length === 1 }));
  bucket.closeSelection = { ...closeSel, ...closeAfter };
  check(bucket, 'Close inspection emits onSelectionClear and hides panel; root kept', closeAfter.intent.action === 'clear selection' && closeAfter.hidden && closeAfter.rootStill, bucket.closeSelection);
  check(bucket, 'keyboard focus not lost to <body> after closing inspection', closeAfter.active !== 'body', bucket.closeSelection);

  // ---- Track issues ----
  const issues = await page.evaluate(async () => { document.querySelector('[data-fixture-issue]').click(); const f = document.querySelector('.track-feedback'); const a = { text: f.textContent, cls: f.className, live: f.getAttribute('aria-live'), role: f.getAttribute('role') }; window.t3Harness.page.showTrackIssues([]); return { a, cleared: f.textContent, cls: f.className }; });
  check(bucket, 'showTrackIssues shows polite atomic feedback and clears', /crosses itself/.test(issues.a.text) && /has-issues/.test(issues.a.cls) && issues.a.live === 'polite' && !/has-issues/.test(issues.cls), issues);

  // ---- Focus ring visible on Tab navigation ----
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.keyboard.press('Tab');
  const tab = [];
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); tab.push(await page.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a); return `${a.tagName}:${(a.getAttribute('aria-label') || a.textContent).trim().slice(0, 18)}:${s.outlineStyle}/${s.outlineWidth}`; })); }
  bucket.tabOrder = tab;
  check(bucket, 'Tab order reaches controls with visible 2px focus ring', tab.every((t) => /solid\/2px/.test(t)), tab);
  await page.keyboard.press('Tab');
  await shot('keyboard-focus');

  // ---- Visibility lifecycle ----
  const life = await page.evaluate(async () => {
    const H = window.t3Harness; const demos = H.page.demos; const out = {}; const runId = H.state.history.runId;
    document.querySelector('.network-diagram').scrollIntoView({ block: 'center', behavior: 'instant' }); await qa.frames(2);
    const steerEl = document.querySelector('.network-diagram [data-steer]');
    // T4 setVisible(false): update must not paint.
    out.steerBefore = steerEl.textContent; demos[1].setVisible(false);
    const s = qa.snapshot(runId, 2, { runId, generation: 2, index: 1 }, 0.37); const exp = qa.expectNetwork(s.storage);
    const r0 = window.__raf.ran; demos[1].update(s, H.state.history, null); qa.detach(s.storage.weights, s.storage.activations, s.storage.sensors, s.storage.cars);
    await new Promise((r) => setTimeout(r, 120)); out.hiddenSteer = steerEl.textContent; out.hiddenRan = window.__raf.ran - r0;
    demos[1].setVisible(true); await qa.frames(3); out.visibleCompare = qa.compareNetwork(exp);
    // document.hidden simulation (property override + visibilitychange event).
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
    const q0 = window.__raf.requested; const s2 = qa.snapshot(runId, 2, { runId, generation: 2, index: 1 }, 0.71); const exp2 = qa.expectNetwork(s2.storage);
    for (const d of demos) d.update(s2, H.state.history, null); qa.detach(s2.storage.weights, s2.storage.activations, s2.storage.sensors, s2.storage.cars);
    await new Promise((r) => setTimeout(r, 120)); out.docHiddenRequests = window.__raf.requested - q0;
    delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); await qa.frames(3);
    out.restoredCompare = qa.compareNetwork(exp2);
    // Offscreen: at top, updates to all demos must not request frames for demos out of view.
    scrollTo({ top: 0, behavior: 'instant' }); await qa.frames(3);
    const offscreen = [...document.querySelectorAll('.teaching-diagram')].filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).length;
    const q1 = window.__raf.requested; for (const d of demos) d.update(null, H.state.history, null); await new Promise((r) => setTimeout(r, 120)); out.offscreenRequests = window.__raf.requested - q1; out.demosInViewAtTop = offscreen;
    return out;
  });
  bucket.lifecycle = life;
  check(bucket, 'setVisible(false) suspends painting; setVisible(true) paints owned copy', life.hiddenSteer === life.steerBefore && life.visibleCompare.mismatches === 0 && life.visibleCompare.steer === life.visibleCompare.expectSteer, life);
  check(bucket, 'document hidden: no frames; restore paints latest owned data', life.docHiddenRequests === 0 && life.restoredCompare.mismatches === 0, life);
  check(bucket, 'offscreen demos request no frames on update', life.demosInViewAtTop > 0 || life.offscreenRequests === 0, life);

  // ---- Resize ----
  const resize = await (async () => {
    const sizes = [[vp.height, vp.width], [vp.width, vp.height]];
    const out = [];
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(200);
      out.push(await page.evaluate(async () => { await qa.frames(2); const c = document.querySelector('.hero-canvas'); const e = document.querySelector('.editor-canvas'); const r = c.getBoundingClientRect(); return { vw: innerWidth, scrollWidth: document.documentElement.scrollWidth, equal: r.width === e.getBoundingClientRect().width && r.height === e.getBoundingClientRect().height, backing: [c.width, c.height, e.width, e.height], svgWidths: [...document.querySelectorAll('.teaching-diagram > svg')].map((s) => Math.round(s.getBoundingClientRect().width)) }; }));
    }
    return out;
  })();
  bucket.resize = resize;
  check(bucket, 'rotate/resize: no overflow, canvases equal, diagrams fit', resize.every((r) => r.scrollWidth <= r.vw && r.equal && r.svgWidths.every((w) => w <= r.vw)), resize);

  // ---- Destroy / recreate ----
  const dr = await page.evaluate(async () => {
    const H = window.t3Harness; const out = {};
    H.destroy(); out.removed = !document.querySelector('.gridborn');
    const q0 = window.__raf.requested; document.dispatchEvent(new Event('visibilitychange')); scrollTo({ top: 500, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 150)); out.rafAfterDestroy = window.__raf.requested - q0;
    try { H.page.update(H.state); H.page.showTrackIssues([]); for (const d of H.page.demos) { d.update(null, H.state.history, null); d.setVisible(true); } H.page.destroy(); out.postDestroySafe = true; } catch (e) { out.postDestroySafe = String(e); }
    const { mountPage } = await import('/src/ui/page.ts');
    const { DEFAULT_SETTINGS } = await import('/src/shared/simulation.ts');
    const host = document.createElement('div'); document.body.prepend(host);
    const calls = []; const actions = new Proxy({}, { get: (_, k) => (v) => calls.push([k, v]) });
    for (let i = 0; i < 3; i++) {
      const p = mountPage(host, { actions, presets: [{ id: 'a', label: 'A' }], settings: DEFAULT_SETTINGS });
      p.update({ generation: 1, alive: 10, population: 512, running: true, rate: 4, drawing: false, selected: null, bestLapSeconds: 12.345, history: { runId: 1, completedGenerations: 0, entries: [] } });
      out[`mount${i}`] = { demos: p.demos.length, lap: document.querySelector('[data-lap]').textContent, ids: [...new Set([...document.querySelectorAll('[id]')].map((e) => e.id))].length === document.querySelectorAll('[id]').length };
      document.querySelector('[data-running]').click();
      p.destroy();
    }
    out.calls = calls; out.hostEmpty = host.children.length === 0; host.remove();
    return out;
  });
  bucket.destroy = dr;
  check(bucket, 'destroy removes page, stops frames, post-destroy calls safe', dr.removed && dr.rafAfterDestroy === 0 && dr.postDestroySafe === true, dr);
  check(bucket, 'recreate x3: fresh pages mount/emit/destroy cleanly with unique ids', [0, 1, 2].every((i) => dr[`mount${i}`].demos === 4 && dr[`mount${i}`].lap === '12.35 s' && dr[`mount${i}`].ids) && dr.calls.length === 3 && dr.calls.every((c) => c[0] === 'onRunningChange' && c[1] === false) && dr.hostEmpty, dr);

  await page.waitForTimeout(100);
  check(bucket, 'no console errors/warnings, page errors, or failed requests', bucket.console.length === 0 && bucket.pageErrors.length === 0 && bucket.failedRequests.length === 0, { console: bucket.console, pageErrors: bucket.pageErrors, failed: bucket.failedRequests });
  await context.close();
}

async function reducedMotion(browser) {
  const bucket = { name: 'reduced-motion-390x844', checks: [], console: [], pageErrors: [], failedRequests: [], screenshots: [] };
  results.viewports[bucket.name] = bucket;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(initScript);
  const page = await context.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) bucket.console.push(m.text()); });
  page.on('pageerror', (e) => bucket.pageErrors.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(helpers);
  const r = await page.evaluate(async () => { const sb = getComputedStyle(document.documentElement).scrollBehavior; document.querySelector('.sensor-diagram').scrollIntoView({ behavior: 'instant' }); await qa.frames(3); const a = window.__raf.requested; await new Promise((x) => setTimeout(x, 600)); return { scrollBehavior: sb, readings: qa.sensorReadings(), idle: window.__raf.requested - a }; });
  bucket.result = r;
  check(bucket, 'reduced motion: no smooth scrolling, diagrams still render, no idle frames', r.scrollBehavior === 'auto' && r.readings.every((x) => x !== '—') && r.idle === 0, r);
  check(bucket, 'no console/page errors', bucket.console.length === 0 && bucket.pageErrors.length === 0, { console: bucket.console, pageErrors: bucket.pageErrors });
  await context.close();
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
results.browser = `Google Chrome ${browser.version()} (headless, playwright-core)`;
say('Browser', results.browser);
try {
  for (const vp of VIEWPORTS) { say(`=== ${vp.name}`); try { await runViewport(browser, vp); } catch (e) { say('ERROR', vp.name, String(e.stack || e)); results.viewports[vp.name].fatal = String(e.stack || e); } }
  await reducedMotion(browser);
} finally {
  await browser.close();
}
let pass = 0; let fail = 0;
for (const b of Object.values(results.viewports)) for (const c of b.checks) c.ok ? pass++ : fail++;
results.summary = { pass, fail, finishedAt: new Date().toISOString() };
say('SUMMARY', results.summary);
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
writeFileSync(join(OUT, 'browser.log'), log.join('\n') + '\n');
