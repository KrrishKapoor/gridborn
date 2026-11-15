// Injected before page scripts: protocol-level observer of the real module worker + rAF timing.
// Observes only; copies snapshot data synchronously before the harness recycles the buffers.
(() => {
  const q = window.__qa = { metas: [], gens: [], bests: [], errs: [], readies: [], cmds: [], frames: [], pointer: [],
    snapCount: 0, nonFinite: 0, last: null, order: [], worker: null, keepCars: true };
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(url, opts) {
      super(url, opts); q.worker = this;
      const post = this.postMessage.bind(this);
      this.postMessage = (m, t) => { q.cmds.push({ t: performance.now(), type: m && m.type, runId: m && m.runId }); if (q.cmds.length > 4000) q.cmds.splice(0, 2000); return post(m, t); };
      this.addEventListener('message', ({ data }) => {
        const t = performance.now();
        if (data.type === 'snapshot') {
          const s = data.snapshot, c = s.storage.cars; q.snapCount++;
          for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) { q.nonFinite++; break; }
          let alive = 0, crashed = 0, finished = 0, drawn = 0;
          for (let i = 0; i < s.population; i++) { const st = c[i * 8 + 7]; if (st === 0) alive++; else if (st === 1) crashed++; else finished++; if (st === 0 || 0.4 - c[i * 8 + 6] / 5 > 0) drawn++; }
          const meta = { t, runId: s.runId, gen: s.generation, tick: s.tick, gt: s.generationTick, alive: s.alive, countedAlive: alive, crashed, finished, drawable: drawn, running: s.running, rate: s.rate, sel: s.selected, ms: s.computeMs, steps: s.steps };
          q.metas.push(meta); if (q.metas.length > 30000) q.metas.splice(0, 10000);
          q.order.push(['s', s.runId, s.generation]); if (q.order.length > 60000) q.order.splice(0, 20000);
          q.last = { meta, cars: q.keepCars ? Array.from(c) : null, sensors: Array.from(s.storage.sensors), weights: Array.from(s.storage.weights), activations: Array.from(s.storage.activations) };
        } else if (data.type === 'generation') { q.gens.push({ t, ...data.statistics }); q.order.push(['g', data.statistics.runId, data.statistics.generation]); }
        else if (data.type === 'best') { const b = data.trajectory; q.bests.push({ t, car: b.car, fitness: b.fitness, lapSeconds: b.lapSeconds, samples: Array.from(b.samples) }); }
        else if (data.type === 'error') q.errs.push({ t, ...data });
        else if (data.type === 'ready') q.readies.push({ t, runId: data.runId });
      });
    }
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => { const s = performance.now(); cb(ts); q.frames.push([ts, performance.now() - s, q.snapCount]); if (q.frames.length > 30000) q.frames.splice(0, 10000); });
  addEventListener('pointerdown', (e) => q.pointer.push({ type: e.pointerType, x: e.clientX, y: e.clientY, target: e.target && e.target.id }), true);
})();
