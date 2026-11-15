// Final QA init script. Observes the real app from outside: Worker messages/commands,
// rAF callbacks and hero-canvas Canvas2D car translations. Adds no app hook and
// never mutates app data (it copies before the app's own listener runs).
(() => {
  const Q = (window.__qa = {
    workers: 0, terminated: 0, commands: [], resets: [], events: { ready: [], error: [], generation: [], best: [] },
    snapshots: 0, last: null, lastSelected: null, sampling: false, frames: [], deliveries: [], rafCount: 0,
    errors: [],
  });
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, opts) {
      super(url, opts);
      Q.workers++; Q.workerUrl = String(url); Q.workerType = opts && opts.type;
      this.addEventListener('message', (e) => {
        const d = e.data; if (!d || !d.type) return;
        if (d.type === 'snapshot') {
          const s = d.snapshot; Q.snapshots++; Q.freshSinceFrame = true;
          const copy = { runId: s.runId, generation: s.generation, tick: s.tick, generationTick: s.generationTick, population: s.population,
            alive: s.alive, running: s.running, rate: s.rate, selected: s.selected, computeMs: s.computeMs, steps: s.steps,
            cars: Array.from(s.storage.cars), t: performance.now() };
          if (s.selected) { copy.sensors = Array.from(s.storage.sensors); copy.weights = Array.from(s.storage.weights); copy.activations = Array.from(s.storage.activations); Q.lastSelected = copy; }
          Q.last = copy;
          if (Q.sampling) Q.deliveries.push([performance.now(), s.tick, s.steps, s.computeMs, s.alive, s.generation, s.runId]);
        } else if (d.type === 'generation') Q.events.generation.push({ ...d.statistics, t: performance.now() });
        else if (d.type === 'best') Q.events.best.push({ car: d.trajectory.car, fitness: d.trajectory.fitness, lapSeconds: d.trajectory.lapSeconds,
          n: d.trajectory.samples.length / 4, samples: Array.from(d.trajectory.samples), t: performance.now() });
        else if (d.type === 'ready') Q.events.ready.push({ runId: d.runId, t: performance.now() });
        else if (d.type === 'error') Q.events.error.push({ runId: d.runId, message: d.message, t: performance.now() });
      });
    }
    postMessage(msg, transfer) {
      if (msg && msg.type && msg.type !== 'recycle') {
        Q.commands.push({ type: msg.type, runId: msg.runId, running: msg.running, rate: msg.rate, car: msg.car, t: performance.now() });
        if (msg.type === 'reset') Q.resets.push({ runId: msg.runId, trackId: msg.track.id, settings: msg.settings, width: msg.track.width,
          length: msg.track.length, bounds: msg.track.bounds, centerline: Array.from(msg.track.centerline || []).slice(0, 4000), t: performance.now() });
      }
      return super.postMessage(msg, transfer);
    }
    terminate() { Q.terminated++; return super.terminate(); }
  };
  // Car translations on the hero canvas, per rAF frame.
  const proto = CanvasRenderingContext2D.prototype, nativeTranslate = proto.translate;
  let frameTranslates = 0, frameSum = 0; Q.lastFrameCars = [];
  let collect = [];
  proto.translate = function (x, y) {
    if (this.canvas && this.canvas.classList && this.canvas.classList.contains('hero-canvas')) {
      frameTranslates++; frameSum += x * 1.37 + y * 0.71; if (collect.length < 4000) collect.push(x, y);
    }
    return nativeTranslate.call(this, x, y);
  };
  const nativeRaf = window.requestAnimationFrame.bind(window);
  let prevSum = NaN;
  window.requestAnimationFrame = (cb) => nativeRaf((t) => {
    frameTranslates = 0; frameSum = 0; collect = []; const fresh = Q.freshSinceFrame; Q.freshSinceFrame = false;
    const start = performance.now();
    try { cb(t); } finally {
      const dur = performance.now() - start; Q.rafCount++;
      if (frameTranslates > 0) { Q.lastFrameCars = collect; Q.lastFrameAt = t; }
      if (Q.sampling) { Q.frames.push([t, dur, fresh ? 1 : 0, frameTranslates, frameTranslates ? frameSum : NaN, frameTranslates ? (frameSum !== prevSum ? 1 : 0) : 0]); }
      if (frameTranslates) prevSum = frameSum;
    }
  });
  window.addEventListener('error', (e) => Q.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => Q.errors.push('rejection ' + String(e.reason)));
})();
