// QA-only external observer injected with addInitScript before the app loads.
// It never calls application code; it wraps browser primitives (Worker, rAF, Canvas2D)
// so dev and production can be observed identically.
(() => {
  const Q = (window.__qa = {
    workers: 0, terminated: 0, sent: [], ready: [], errors: [], gens: [], bests: [],
    snapCount: 0, snapMeta: [], latestCars: null, latestMeta: null, sel: [],
    frames: [], record: false, heavy: true, frameT: -1, cur: null, last: null,
    freshSinceFrame: 0, rafTotal: 0, detachedSeen: 0,
  });
  const NativeWorker = window.Worker;
  window.Worker = class QAWorker extends NativeWorker {
    constructor(...args) {
      super(...args);
      Q.workers++; Q.worker = this;
      this.addEventListener('message', (e) => Q.onMsg(e.data));
    }
    terminate() { Q.terminated++; return super.terminate(); }
    postMessage(m, t) {
      if (m && m.type !== 'recycle') { Q.sent.push({ t: performance.now(), type: m.type, runId: m.runId, rate: m.rate, running: m.running, pop: m.settings?.population, seed: m.settings?.seed, car: m.car ?? undefined }); if (Q.sent.length > 3000) Q.sent.splice(0, 1000); }
      else if (m) { Q.recycles = (Q.recycles || 0) + 1; }
      return super.postMessage(m, t);
    }
  };
  Q.onMsg = (d) => {
    if (!d) return;
    if (d.type === 'snapshot') {
      const s = d.snapshot; Q.snapCount++; Q.freshSinceFrame++;
      if (s.storage.cars.byteLength === 0) Q.detachedSeen++;
      const meta = { t: performance.now(), runId: s.runId, gen: s.generation, tick: s.tick, gtick: s.generationTick, steps: s.steps, ms: s.computeMs, alive: s.alive, running: s.running, rate: s.rate, pop: s.population, sel: s.selected ? s.selected.index : -1, selGen: s.selected ? s.selected.generation : -1 };
      Q.latestMeta = meta; Q.snapMeta.push(meta); if (Q.snapMeta.length > 6000) Q.snapMeta.splice(0, 2000);
      if (Q.heavy) { Q.latestCars = s.storage.cars.slice(); (Q.ring ||= []).push({ tick: s.tick, gen: s.generation, cars: Q.latestCars }); if (Q.ring.length > 6) Q.ring.shift(); }
      if (s.selected) {
        const i = s.selected.index * 8;
        Q.sel.push({ tick: s.tick, runId: s.runId, gen: s.generation, index: s.selected.index, weights: Array.from(s.storage.weights), activations: Array.from(s.storage.activations), sensors: Array.from(s.storage.sensors), car: Array.from(s.storage.cars.slice(i, i + 8)) });
        if (Q.sel.length > 40) Q.sel.shift();
      }
    } else if (d.type === 'ready') Q.ready.push({ t: performance.now(), runId: d.runId });
    else if (d.type === 'error') Q.errors.push({ t: performance.now(), runId: d.runId, message: d.message });
    else if (d.type === 'generation') { Q.gens.push({ ...d.statistics, t: performance.now() }); if (Q.gens.length > 4000) Q.gens.splice(0, 1000); }
    else if (d.type === 'best') {
      const tr = d.trajectory;
      Q.bests.push({ t: performance.now(), runId: tr.car.runId, gen: tr.car.generation, index: tr.car.index, fitness: tr.fitness, lap: tr.lapSeconds, n: tr.samples.length / 4 });
      if (Q.bests.length > 2000) Q.bests.splice(0, 500);
      Q.lastBestSamples = Array.from(tr.samples);
    }
  };
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const finish = () => {
    const f = Q.cur; if (!f) return;
    Q.last = f;
    if (Q.record) { Q.frames.push({ t: f.t, cost: f.cost, fresh: f.fresh, cars: f.n, sum: f.sum, headless: f.headless }); }
  };
  window.requestAnimationFrame = (cb) => nativeRaf((t) => {
    if (t !== Q.frameT) { finish(); Q.frameT = t; Q.rafTotal++; Q.cur = { t, cost: 0, fresh: Q.freshSinceFrame, n: 0, sum: 0, pos: Q.heavy ? [] : null, arcs: Q.heavy ? [] : null, headless: false }; Q.freshSinceFrame = 0; }
    const s = performance.now();
    try { cb(t); } finally { if (Q.cur) Q.cur.cost += performance.now() - s; }
  });
  const P = CanvasRenderingContext2D.prototype;
  const translate = P.translate, arc = P.arc, fillText = P.fillText, lineTo = P.lineTo;
  const isHero = (c) => c.canvas && c.canvas.classList && c.canvas.classList.contains('hero-canvas');
  P.translate = function (x, y) {
    translate.call(this, x, y);
    if (Q.cur && isHero(this)) { Q.drawn = Q.cur; Q.cur.n++; Q.cur.sum += x * (Q.cur.n) + y * (Q.cur.n + 1); if (Q.cur.pos) Q.cur.pos.push(x, y); }
  };
  P.arc = function (x, y, r, a, b) {
    arc.call(this, x, y, r, a, b);
    if (Q.cur && Q.cur.arcs && isHero(this)) Q.cur.arcs.push(x, y, r);
  };
  P.fillText = function (t, x, y, m) {
    if (Q.cur && isHero(this)) Q.cur.headless = Q.cur.headless || /Learning ahead/.test(t);
    return m === undefined ? fillText.call(this, t, x, y) : fillText.call(this, t, x, y, m);
  };
  Q.inspectorLines = [];
  P.lineTo = function (x, y) {
    lineTo.call(this, x, y);
    if (this.canvas && this.canvas.closest && this.canvas.closest('.inspection-sight')) { Q.inspectorLines.push(x, y); if (Q.inspectorLines.length > 400) Q.inspectorLines.splice(0, 200); }
  };
  // CSS-space view, replicating fitView with the renderer's padding rule.
  Q.view = () => {
    const c = document.querySelector('.hero-canvas'); const r = c.getBoundingClientRect();
    const w = r.width, h = r.height, pad = Math.min(16, w / 20, h / 20);
    const scale = Math.min((w - 2 * pad) / 1200, (h - 2 * pad) / 800);
    return { scale, ox: (w - 1200 * scale) / 2, oy: (h - 800 * scale) / 2, left: r.left, top: r.top, w, h };
  };
  let hidden = null;
  Q.setHidden = (value) => {
    hidden = value;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
})();
