import '../styles/tokens.css';
import '../styles/page.css';
import type { GridbornPage, PageOptions, PageState } from '../shared/presentation';
import type { SimulationRate } from '../shared/simulation';
import { query, text } from './dom';
import { createSparkline } from './sparkline';
import { mountSensorDemo } from './demos/sensors';
import { mountNetworkDemo } from './demos/network';
import { mountGeneticsDemo } from './demos/genetics';
import { mountRacingLineDemo } from './demos/racing-line';

let pageNumber = 0;

export function mountPage(root: HTMLElement, options: PageOptions): GridbornPage {
  const id = `gridborn-${++pageNumber}`;
  const page = document.createElement('div');
  page.className = 'gridborn';
  page.innerHTML = `
    <a class="skip-link" href="#${id}-controls">Skip to simulation controls</a>
    <header class="masthead"><a class="wordmark" href="#${id}-top" aria-label="Gridborn, back to top"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Gridborn</a><span class="edition">An experiment in neuroevolution</span><a href="#${id}-sensors" class="read-link">How it learns <span aria-hidden="true">↓</span></a></header>
    <main id="${id}-top">
      <section class="hero" aria-labelledby="${id}-title">
        <div class="hero-heading"><div><p class="eyebrow">Small brains. Open road.</p><h1 id="${id}-title">Learning the long way.</h1></div><p class="hero-deck">No map. No driving lessons.<br>  Just a thousand possible ways forward.</p></div>
        <div class="lab">
          <div class="track-column">
            <div class="telemetry" aria-label="Simulation statistics"><div><span>Generation</span><strong data-generation>—</strong></div><div><span>Alive</span><strong data-alive>—</strong></div><div><span>Best lap</span><strong data-lap aria-label="No completed lap yet"><span data-lap-value>—</span><small data-no-lap>no lap yet</small></strong></div><div class="fitness"><div><span>Fitness</span><small data-history-label>No history yet</small></div><svg data-fitness role="img" aria-label="No completed generations yet"></svg></div></div>
            <div class="track-stage"><canvas class="hero-canvas" tabindex="0" role="button" aria-label="Inspect a racing car. Enter selects a driver; arrow keys cycle drivers; Escape closes inspection" aria-describedby="${id}-hint"></canvas><canvas class="editor-canvas" tabindex="-1" aria-label="Draw a closed circuit. Escape cancels the stroke" aria-describedby="${id}-hint" aria-hidden="true"></canvas></div>
            <p class="track-hint" id="${id}-hint"><span class="status-dot" aria-hidden="true"></span><span data-stage-hint>Pick a car to look inside its brain.</span><span data-run-label>Ready</span></p>
            <div class="track-feedback" role="status" aria-live="polite" aria-atomic="true"><span data-feedback></span></div>
          </div>
          <div class="control-rail" id="${id}-controls" aria-label="Simulation controls" role="group">
            <div class="transport"><button type="button" class="run-button" data-running aria-pressed="false"><span data-run-icon aria-hidden="true">▶</span><span data-run-text>Play</span></button><div class="rate-controls" role="group" aria-label="Simulation speed"><button type="button" data-rate="1" aria-pressed="true">1×</button><button type="button" data-rate="4" aria-pressed="false">4×</button><button type="button" data-rate="fast" aria-pressed="false" aria-label="Fast headless mode">Fast</button></div><p class="control-note" data-rate-note>Real-time simulation</p></div>
            <label class="field-label">Population<select data-population aria-label="Population"></select></label>
            <label class="field-label">Circuit<select data-preset aria-label="Circuit preset"><option value="" selected disabled>Load preset</option></select></label>
            <div class="drawing-controls"><button type="button" data-drawing aria-pressed="false"><span data-draw-text>Draw a circuit</span> <span data-draw-arrow aria-hidden="true">↗</span></button><button type="button" data-clear class="quiet-button">Clear drawing</button></div>
            <button type="button" data-reset class="reset-button">Reset learning <span aria-hidden="true">↺</span></button>
            <p class="control-note">New circuit, new population,<br> new beginning.</p>
          </div>
        </div>
        <aside class="inspection-panel" hidden aria-label="Selected car inspection"><div class="inspection-heading"><div><span class="eyebrow">Inside one driver</span><h2 data-selection>Selected car</h2></div><button type="button" class="quiet-button" data-close>Close inspection <span aria-hidden="true">×</span></button></div><div class="inspection-root"></div></aside>
      </section>
      <div class="article-divider"><span>From a wall to a racing line</span><span>Four small ideas <span aria-hidden="true">↓</span></span></div>
      <section class="lesson" id="${id}-sensors" aria-labelledby="${id}-sense"><div class="lesson-copy"><span class="lesson-index">01 / PERCEPTION</span><h2 id="${id}-sense">A little sight.<br> Enough to start.</h2><p>Seven rays measure the distance to nearby walls. The car sees these distances and its speed; it never sees the whole circuit.</p><span class="lesson-aside">Distance becomes an input.</span></div><div data-demo="sensors"></div></section>
      <section class="lesson" aria-labelledby="${id}-network"><div class="lesson-copy"><span class="lesson-index">02 / DECISION</span><h2 id="${id}-network">A small brain.<br> A moving car.</h2><p>Eight inputs pass through eight hidden neurons to become steering and throttle. A weight changes how much one signal matters.</p><span class="lesson-aside">8 inputs → 8 hidden → 2 outputs</span></div><div data-demo="network"></div></section>
      <section class="lesson" aria-labelledby="${id}-genetics"><div class="lesson-copy"><span class="lesson-index">03 / EVOLUTION</span><h2 id="${id}-genetics">Keep what works.<br> Try a small change.</h2><p>Better drivers are more likely to pass on their weights. Crossover combines parents; mutation makes room for something new.</p><span class="lesson-aside">Selection is the teacher.</span></div><div data-demo="genetics"></div></section>
      <section class="lesson" aria-labelledby="${id}-line"><div class="lesson-copy"><span class="lesson-index">04 / EMERGENCE</span><h2 id="${id}-line">The line is<br> the consequence.</h2><p>Reward progress, then quicker completed laps. Across generations, useful steering habits can become a racing line.</p><span class="lesson-aside">An outcome, never a prescribed path.</span></div><div data-demo="racing-line"></div></section>
      <footer class="page-footer"><a class="wordmark" href="#${id}-top">Gridborn <span aria-hidden="true">↑</span></a><p>Many small decisions.<br> One way around.</p><span class="footer-note">An interactive study of neuroevolution.<br> Runs entirely in your browser.</span></footer>
    </main>`;
  root.append(page);
  const events = new AbortController();
  const get = <T extends Element = HTMLElement>(selector: string) => query<T>(page, selector);
  const heroCanvas = get<HTMLCanvasElement>('.hero-canvas');
  const editorCanvas = get<HTMLCanvasElement>('.editor-canvas');
  const inspectionRoot = get<HTMLElement>('.inspection-root');
  const runButton = get<HTMLButtonElement>('[data-running]');
  const drawingButton = get<HTMLButtonElement>('[data-drawing]');
  const population = get<HTMLSelectElement>('[data-population]');
  const presets = get<HTMLSelectElement>('[data-preset]');
  const feedback = get('[data-feedback]');
  let hasIssues = false;
  let destroyed = false;
  let state: PageState = { generation: 0, alive: 0, population: options.settings.population, running: false, rate: 1, drawing: false, selected: null, bestLapSeconds: null, history: { runId: 0, completedGenerations: 0, entries: [] } };
  for (const size of [...new Set([128, 256, 512, 1000, options.settings.population])].sort((a, b) => a - b)) {
    const option = document.createElement('option'); option.value = String(size); option.textContent = `${size.toLocaleString('en-US')} cars`; population.append(option);
  }
  for (const preset of options.presets) {
    const option = document.createElement('option'); option.value = preset.id; option.textContent = preset.label; presets.append(option);
  }
  population.value = String(options.settings.population);
  const drawSparkline = createSparkline(get<SVGSVGElement>('[data-fitness]'));
  const demos = [mountSensorDemo(get('[data-demo=sensors]')), mountNetworkDemo(get('[data-demo=network]')), mountGeneticsDemo(get('[data-demo=genetics]')), mountRacingLineDemo(get('[data-demo=racing-line]'))];
  function on(selector: string, action: () => void) { get(selector).addEventListener('click', action, { signal: events.signal }); }
  on('[data-running]', () => options.actions.onRunningChange(!state.running));
  on('[data-drawing]', () => options.actions.onDrawingChange(!state.drawing));
  on('[data-clear]', options.actions.onClear);
  on('[data-reset]', options.actions.onReset);
  on('[data-close]', options.actions.onSelectionClear);
  const rateButtons = [...page.querySelectorAll<HTMLButtonElement>('[data-rate]')];
  for (const button of rateButtons) button.addEventListener('click', () => options.actions.onRateChange(button.dataset.rate === 'fast' ? 'fast' : Number(button.dataset.rate) as SimulationRate), { signal: events.signal });
  population.addEventListener('change', () => {
    const desired = Number(population.value);
    // A select changes itself before the callback. Restore the latest accepted state,
    // including a synchronous update from the owner, while an async reset is pending.
    options.actions.onPopulationChange(desired);
    population.value = String(state.pendingPopulation ?? state.population);
  }, { signal: events.signal });
  presets.addEventListener('change', () => {
    const requested = presets.value;
    presets.value = ''; // PageState deliberately has no accepted preset id.
    options.actions.onPreset(requested);
  }, { signal: events.signal });
  function hint() {
    const current = state.circuitLabel ? `Current: ${state.circuitLabel}. ` : '';
    return current + (state.pendingLabel ? `Applying ${state.pendingLabel}…` : state.drawing ? 'Learning waits while you draw. Close a generous loop.' : 'Draw a loop to make it yours.');
  }
  let lastHistoryRun = -1, lastHistoryCount = -1;
  const panel = get<HTMLElement>('.inspection-panel');
  page.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selected) { event.preventDefault(); options.actions.onSelectionClear(); }
  }, { signal: events.signal });
  return {
    heroCanvas, editorCanvas, inspectionRoot, demos,
    update(next) {
      if (destroyed) return;
      // Retain scalar state only. The incoming history is read synchronously below.
      state = { ...next, selected: next.selected ? { ...next.selected } : null, history: { runId: next.history.runId, completedGenerations: next.history.completedGenerations, entries: [] } };
      text(get('[data-generation]'), next.generation > 0 ? String(next.generation).padStart(2, '0') : '—');
      text(get('[data-alive]'), `${next.alive} / ${next.population}`);
      const lap = get('[data-lap]');
      text(get('[data-lap-value]'), next.bestLapSeconds === null ? '—' : `${next.bestLapSeconds.toFixed(2)} s`);
      get<HTMLElement>('[data-no-lap]').hidden = next.bestLapSeconds !== null;
      lap.setAttribute('aria-label', next.bestLapSeconds === null ? 'No completed lap yet' : `Best lap ${next.bestLapSeconds.toFixed(2)} seconds`);
      text(get('[data-history-label]'), next.history.completedGenerations ? `${next.history.completedGenerations} gen · best / mean` : 'No history yet');
      if (next.history.runId !== lastHistoryRun || next.history.completedGenerations !== lastHistoryCount) {
        drawSparkline(next.history); lastHistoryRun = next.history.runId; lastHistoryCount = next.history.completedGenerations;
      }
      runButton.setAttribute('aria-pressed', String(next.running));
      text(get('[data-run-text]'), next.running ? 'Pause' : 'Play');
      text(get('[data-run-icon]'), next.running ? 'Ⅱ' : '▶');
      for (const button of rateButtons) button.setAttribute('aria-pressed', String(button.dataset.rate === String(next.rate)));
      text(get('[data-rate-note]'), next.rate === 'fast' ? 'Headless · throughput mode' : next.rate === 4 ? 'Four simulated seconds per second' : 'Real-time simulation');
      if (![...population.options].some((option) => option.value === String(next.population))) {
        const option = document.createElement('option'); option.value = String(next.population); option.textContent = `${next.population} cars`; population.append(option);
      }
      population.value = String(next.pendingPopulation ?? next.population);
      drawingButton.setAttribute('aria-pressed', String(next.drawing));
      text(get('[data-draw-text]'), next.drawing ? 'Stop drawing' : 'Draw a circuit');
      get<HTMLElement>('[data-draw-arrow]').hidden = next.drawing;
      text(get('[data-stage-hint]'), next.drawing ? 'Draw inside the dashed guide. Escape cancels the stroke.' : next.selected ? `Inspecting car ${next.selected.index + 1} · details below` : next.rate === 'fast' ? 'Headless learning. Choose 1× to inspect.' : 'Pick a car, or focus the field and press Enter.');
      text(get('[data-run-label]'), next.suspended ? 'Waiting' : next.running ? next.rate === 'fast' ? 'Headless' : 'Running' : 'Paused');
      page.classList.toggle('is-running', next.running);
      page.classList.toggle('is-drawing', next.drawing);
      // T1 alone enables overlay input and maintains its pointer capture.
      editorCanvas.setAttribute('aria-hidden', String(!next.drawing));
      if (!next.selected && panel.contains(document.activeElement)) heroCanvas.focus({ preventScroll: true });
      panel.hidden = next.selected === null;
      if (next.selected) text(get('[data-selection]'), `Car ${String(next.selected.index + 1).padStart(3, '0')} · generation ${next.selected.generation}`);
      if (!hasIssues) text(feedback, hint());
    },
    showTrackIssues(issues) {
      if (destroyed) return;
      hasIssues = issues.length > 0;
      feedback.parentElement!.classList.toggle('has-issues', hasIssues);
      text(feedback, hasIssues ? `${state.circuitLabel ? `Current: ${state.circuitLabel}. ` : ''}${issues.map((issue) => issue.message).join(' ')}` : hint());
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      events.abort();
      for (const demo of demos) demo.destroy();
      page.remove();
    },
  };
}
