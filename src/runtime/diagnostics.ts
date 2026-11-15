import type { SimulationEvent, SimulationSettings } from '../shared/simulation';
import type { TrackGeometry } from '../shared/geometry';
import type { Session } from './session';
import type { Renderer } from './renderer';

export interface Diagnostics { event(event: SimulationEvent): void; frame(time: number, cost: number, fresh: boolean, drawn: number, presentationTick: number): void; destroy(): void }
/** Loaded only by Vite DEV. No hook or diagnostic bundle exists in dist/. */
export function installDiagnostics(session: Session, renderer: Renderer): Diagnostics {
  let sampling = false;
  let lastDelivery: { runId: number; tick: number; running: boolean } | null = null;
  let frames: number[][] = [], deliveries: number[][] = [];
  const api = {
    read() {
      const s = session.snapshot;
      return structuredClone({ accepted: session.accepted, pending: session.pending, queued: session.queued,
        desiredRunning: session.desiredRunning, desiredRate: session.desiredRate, drawing: session.drawing, hidden: session.hidden,
        error: session.error, lastDelivery, snapshot: s, history: session.history, best: session.best,
        view: renderer.view, width: renderer.width, height: renderer.height, dpr: renderer.dpr });
    },
    reset(settings: Partial<SimulationSettings> = {}, track: TrackGeometry = session.intention!.track) {
      session.reset(track, { ...session.intention!.settings, ...settings });
    },
    begin() { frames = []; deliveries = []; sampling = true; },
    end() { sampling = false; return { frames, deliveries }; },
  };
  Object.assign(window, { __gridborn: api });
  return {
    event(event) {
      if (event.type === 'snapshot') { const s = event.snapshot; lastDelivery = { runId: s.runId, tick: s.tick, running: s.running }; }
      if (sampling && event.type === 'snapshot') { const s = event.snapshot; deliveries.push([performance.now(), s.tick, s.steps, s.computeMs, s.alive, s.generation]); }
    },
    frame(time, cost, fresh, drawn, presentationTick) {
      if (!sampling) return;
      let motion = 0;
      const poses = renderer.poses;
      if (poses) for (let i = 0; i < poses.length; i += 8) motion += poses[i]! * (i + 1) + poses[i + 1]! * (i + 2);
      frames.push([time, cost, fresh ? 1 : 0, drawn, session.snapshot?.tick ?? 0, presentationTick, motion]);
    },
    destroy() { delete (window as Window & { __gridborn?: unknown }).__gridborn; },
  };
}
