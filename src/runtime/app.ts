import { mountPage } from '../ui/page';
import { TRACK_PRESETS, createPreset, createTrackEditor } from '../track';
import { CAR, CAR_STRIDE, DEFAULT_SETTINGS } from '../shared/simulation';
import type { CarId, SimulationEvent } from '../shared/simulation';
import type { TrackGeometry } from '../shared/geometry';
import { Session } from './session';
import { Renderer } from './renderer';
import { Presentation } from './presentation';
import { createInspector } from './inspector';
import type { Diagnostics } from './diagnostics';

export function mountApp(root: HTMLElement): () => void {
  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  const events = new AbortController();
  const initial = createPreset(TRACK_PRESETS[0]!.id);
  let dirty = true, demosDirty = true, disposed = false, frame = 0, lastUi = -Infinity;
  let selectionToReveal: CarId | null = null, keyboardSelection = false;
  let diagnostics: Diagnostics | null = null;
  let lastSelected = '', lastBest = null as Session['best'];
  const page = mountPage(root, { settings: DEFAULT_SETTINGS, presets: TRACK_PRESETS, actions: {
    onRunningChange(value) { session.running(value); },
    onRateChange(value) { session.rate(value); if (value === 'fast') clearSelection(); },
    onPopulationChange(population) { const intent = session.intention!; session.reset(intent.track, { ...intent.settings, population }); },
    onReset() { const intent = session.intention!; session.reset(intent.track, intent.settings); },
    onDrawingChange: setDrawing,
    onClear() { editor.clear(); },
    onPreset(id) { setDrawing(false); session.reset(createPreset(id)); },
    onSelectionClear: clearSelection,
  } });
  const presentation = new Presentation();
  const renderer = new Renderer(page.heroCanvas, page.editorCanvas);
  const inspector = createInspector(page.inspectionRoot);
  const session = new Session((command, transfer) => worker.postMessage(command, transfer ?? []), (trackChanged) => {
    dirty = demosDirty = true;
    if (trackChanged && session.accepted) {
      const track = session.accepted.track;
      editor.setTrack(track); renderer.setTrack(track); inspector.setTrack(track);
      for (const demo of page.demos) demo.setTrack?.(track);
      presentation.clear(); selectionToReveal = null; lastSelected = ''; page.showTrackIssues([]);
    }
    if (session.error) {
      page.showTrackIssues([{ code: 'invalid-input', message: `${session.error} The current circuit and learning are kept.` }]);
      if (session.accepted) editor.setTrack(session.accepted.track);
    }
    if (!session.error && session.pending) page.showTrackIssues([]);
    updatePage();
  });
  const editor = createTrackEditor({ canvas: page.editorCanvas, initialTrack: initial, getView: () => renderer.view, onChange(change) {
    if (disposed) return;
    if (change.type === 'commit') {
      page.showTrackIssues([]); setDrawing(false); session.reset(change.track);
    } else if (change.type === 'invalid') page.showTrackIssues(change.issues);
    else if (change.type === 'clear' || change.type === 'draft') page.showTrackIssues([]);
  } });
  function label(track: TrackGeometry | undefined): string { return TRACK_PRESETS.find((p) => p.id === track?.id)?.label ?? (track ? 'Your circuit' : 'Starting'); }
  function updatePage() {
    const s = session.snapshot, pending = session.queued ?? session.pending;
    page.update({ generation: s?.generation ?? (session.accepted ? 1 : 0), alive: s?.alive ?? 0,
      population: session.accepted?.settings.population ?? DEFAULT_SETTINGS.population,
      running: session.desiredRunning, rate: session.desiredRate, drawing: session.drawing,
      selected: session.drawing || session.desiredRate === 'fast' ? null : s?.selected ?? null,
      bestLapSeconds: session.best?.lapSeconds ?? null, history: session.history,
      circuitLabel: label(session.accepted?.track), pendingLabel: pending ? `${label(pending.track)} · ${pending.settings.population} cars` : '',
      pendingPopulation: pending?.settings.population ?? session.accepted?.settings.population ?? DEFAULT_SETTINGS.population,
      suspended: session.drawing || session.hidden,
    });
  }
  function clearSelection() {
    const restoreFocus = page.inspectionRoot.parentElement!.contains(document.activeElement);
    selectionToReveal = null; session.select(null);
    // Do not leave a hidden close button focused while its worker reply is in flight.
    if (restoreFocus) {
      page.heroCanvas.focus({ preventScroll: true }); page.heroCanvas.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }
  function setDrawing(enabled: boolean) {
    session.drawing = enabled;
    if (enabled) clearSelection();
    renderer.setDrawing(enabled);
    editor.setEnabled(enabled && renderer.width > 2 && renderer.height > 2);
    if (!enabled && document.activeElement === page.editorCanvas) page.heroCanvas.focus({ preventScroll: true });
    session.syncRunning(); dirty = true; updatePage();
  }
  function select(index: number, keyboard: boolean) {
    const s = session.snapshot;
    if (!s || session.drawing || session.desiredRate === 'fast') return;
    const car = { runId: s.runId, generation: s.generation, index };
    selectionToReveal = car; keyboardSelection = keyboard; session.select(car);
  }
  page.heroCanvas.addEventListener('pointerup', (event) => {
    if (!event.isPrimary || event.button !== 0 || session.drawing || session.desiredRate === 'fast' || !session.snapshot) return;
    const rect = page.heroCanvas.getBoundingClientRect();
    const index = renderer.hit(session.snapshot, event.clientX - rect.left, event.clientY - rect.top);
    if (index !== null) select(index, false);
  }, { signal: events.signal });
  function keyboardInspect(event: KeyboardEvent) {
    if (!['Enter', ' ', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key) || session.drawing || session.desiredRate === 'fast') return;
    event.preventDefault();
    const s = session.snapshot; if (!s) return;
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const start = s.selected?.index ?? (direction > 0 ? -1 : 0);
    for (let j = 1; j <= s.population; j++) {
      const index = (start + direction * j + s.population) % s.population;
      if (s.storage.cars[index * CAR_STRIDE + CAR.status] === 0) { select(index, true); return; }
    }
    select((start + direction + s.population) % s.population, true);
  }
  page.heroCanvas.addEventListener('keydown', keyboardInspect, { signal: events.signal });
  page.inspectionRoot.parentElement!.addEventListener('keydown', (event) => {
    if (event.key.startsWith('Arrow')) keyboardInspect(event);
  }, { signal: events.signal });
  worker.addEventListener('message', (event: MessageEvent<SimulationEvent>) => {
    diagnostics?.event(event.data); session.receive(event.data);
  }, { signal: events.signal });
  worker.addEventListener('error', () => {
    session.desiredRunning = false; page.showTrackIssues([{ code: 'invalid-input', message: 'The simulation could not continue. Reload the page to try again.' }]); updatePage();
  }, { signal: events.signal });
  const observer = new ResizeObserver(() => { dirty = true; }); observer.observe(page.heroCanvas);
  function visibility() {
    session.hidden = document.hidden;
    if (document.hidden) { presentation.clear(); setDrawing(false); clearSelection(); cancelAnimationFrame(frame); frame = 0; }
    session.syncRunning();
    for (const demo of page.demos) demo.setVisible(!document.hidden);
    dirty = demosDirty = true;
    if (!document.hidden && !frame) frame = requestAnimationFrame(render);
  }
  document.addEventListener('visibilitychange', visibility, { signal: events.signal });
  window.addEventListener('focus', () => { dirty = true; }, { signal: events.signal });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.addEventListener('change', () => { dirty = demosDirty = true; }, { signal: events.signal });
  function render(now: number) {
    frame = 0; if (disposed || document.hidden) return;
    const start = performance.now(), resized = renderer.resize();
    if (resized) editor.setEnabled(session.drawing && renderer.width > 2 && renderer.height > 2);
    const fresh = session.takeSnapshot(), snapshot = session.snapshot;
    if (fresh && snapshot) presentation.push(snapshot, now);
    if (session.best !== lastBest) { lastBest = session.best; renderer.setBest(lastBest); dirty = true; }
    let drawn = -1;
    if (fresh || dirty || resized || (snapshot?.running && session.desiredRate !== 'fast')) {
      drawn = renderer.draw(snapshot, session.desiredRate === 'fast', snapshot ? presentation.sample(snapshot, now) : undefined);
      const selected = snapshot?.selected, selectedKey = selected ? `${selected.runId}/${selected.generation}/${selected.index}` : '';
      if (dirty || selectedKey !== lastSelected || now - lastUi >= 150) { updatePage(); lastUi = now; lastSelected = selectedKey; }
      if (snapshot?.selected && !session.drawing && session.desiredRate !== 'fast') inspector.update(snapshot);
      if (selected && selectionToReveal && selected.runId === selectionToReveal.runId && selected.generation === selectionToReveal.generation && selected.index === selectionToReveal.index) {
        selectionToReveal = null;
        const panel = page.inspectionRoot.parentElement!;
        panel.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        if (keyboardSelection) panel.querySelector<HTMLButtonElement>('button')!.focus({ preventScroll: true });
      }
      // Demos synchronously copy their borrowed arrays before the slot is returned.
      if (demosDirty) for (const demo of page.demos) demo.update(snapshot, session.history, session.best);
      else if (fresh) { page.demos[0]!.update(snapshot, session.history, session.best); page.demos[1]!.update(snapshot, session.history, session.best); }
      dirty = demosDirty = false;
    }
    diagnostics?.frame(now, performance.now() - start, fresh, drawn, presentation.tick);
    frame = requestAnimationFrame(render);
  }
  renderer.resize(); renderer.setTrack(initial); inspector.setTrack(initial);
  session.hidden = document.hidden; session.reset(initial, DEFAULT_SETTINGS);
  if (!document.hidden) frame = requestAnimationFrame(render);
  if (import.meta.env.DEV) void import('./diagnostics').then(({ installDiagnostics }) => {
    if (!disposed) diagnostics = installDiagnostics(session, renderer);
  });
  const dispose = () => {
    if (disposed) return; disposed = true;
    cancelAnimationFrame(frame); events.abort(); observer.disconnect();
    editor.destroy(); inspector.destroy(); session.dispose(); worker.terminate(); page.destroy(); diagnostics?.destroy();
  };
  window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, { signal: events.signal });
  window.addEventListener('beforeunload', dispose, { signal: events.signal });
  return dispose;
}
