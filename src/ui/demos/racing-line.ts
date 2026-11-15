import type { TeachingDemo } from '../../shared/presentation';
import { HISTORY_LIMIT, TRAJECTORY_STRIDE } from '../../shared/simulation';
import type { GenerationHistory, GenerationStatistics } from '../../shared/simulation';
import { fitView } from '../../shared/view';
import { text } from '../dom';
import { createSparkline } from '../sparkline';
import { surface } from './surface';

export function mountRacingLineDemo(root: HTMLElement): TeachingDemo {
  let sampleCount = 0;
  let samples = new Float32Array(0);
  let lap: number | null = null;
  let bestRun = -1;
  let bestGeneration = -1;
  let bestIndex = -1;
  let bestFitness = NaN;
  let hasPath = false;
  let illustrate = false;
  // Reuse these small records when copying incoming history for a deferred draw.
  const records: GenerationStatistics[] = Array.from({ length: HISTORY_LIMIT }, () => ({ runId: 0, generation: 0, ticks: 0, bestFitness: 0, meanFitness: 0, completedLaps: 0, bestLapSeconds: null }));
  const entries: GenerationStatistics[] = [];
  let history: GenerationHistory = { runId: 0, completedGenerations: 0, entries };
  const ui = surface(root, `
    <div class="diagram-caption"><span data-source>Waiting for a recorded attempt</span><button type="button" class="text-button" data-mode aria-pressed="false">Explore a corner</button></div>
    <svg class="racing-diagram" viewBox="0 0 640 330" role="img" aria-label="Recorded best path. No attempt has been supplied yet.">
      <g data-example hidden><path d="M120 300V210Q120 70 260 70H570" fill="none" stroke="#e6e9e0" stroke-width="100"/><path d="M70 300V210Q70 20 260 20H570M170 300V210Q170 120 260 120H570" fill="none" stroke="#a4ad9d" stroke-width="1.5"/><path data-corner fill="none" stroke="#246b32" stroke-width="3"/><circle data-apex r="5" fill="#246b32"/></g>
      <g data-empty><path d="M28 28v18m0-18h18M612 28h-18m18 0v18M28 302v-18m0 18h18M612 302h-18m18 0v-18" stroke="#b7c0ae" fill="none"/><text x="320" y="157" text-anchor="middle" class="svg-empty">A line has to be earned.</text><text x="320" y="183" text-anchor="middle" class="svg-note">Your best recorded attempt will appear here.</text></g>
      <path data-path fill="none" stroke="#246b32" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle data-start r="4" fill="#246b32" hidden/>
    </svg>
    <div class="diagram-controls" data-corner-controls hidden><label>Corner position <input data-apex-control type="range" min="0" max="100" value="50" aria-label="Illustrative corner position"></label></div>
    <div class="recorded-history"><div><span class="eyebrow">Completed generations</span><p data-history-label>No history yet</p></div><svg data-history role="img" aria-label="No fitness history yet"></svg></div>
    <p class="diagram-note" data-note>No timed lap yet. Partial attempts are labeled as partial.</p>`, render);
  const sparkline = createSparkline(ui.get<SVGSVGElement>('[data-history]'));
  const slider = ui.get<HTMLInputElement>('[data-apex-control]');
  const graph = ui.get<SVGSVGElement>('.racing-diagram');
  function render() {
    const path = ui.get<SVGPathElement>('[data-path]');
    const empty = ui.get<SVGGElement>('[data-empty]');
    const example = ui.get<SVGGElement>('[data-example]');
    const start = ui.get<SVGCircleElement>('[data-start]');
    empty.style.display = !illustrate && !hasPath ? '' : 'none';
    example.style.display = illustrate ? '' : 'none';
    example.removeAttribute('hidden');
    ui.get<HTMLElement>('[data-corner-controls]').hidden = !illustrate;
    path.style.display = !illustrate && hasPath ? '' : 'none';
    start.style.display = !illustrate && hasPath ? '' : 'none';
    start.removeAttribute('hidden');
    ui.get('[data-mode]').setAttribute('aria-pressed', String(illustrate));
    text(ui.get('[data-mode]'), illustrate ? 'Show recorded attempt' : 'Explore a corner');
    if (illustrate) {
      const spread = slider.valueAsNumber / 100;
      const x = 90 + spread * 60;
      const endY = 40 + spread * 60;
      ui.get('[data-corner]').setAttribute('d', `M${x} 296V220C${x} 110 180 ${endY} 285 ${endY}H568`);
      ui.get('[data-apex]').setAttribute('cx', String(x));
      ui.get('[data-apex]').setAttribute('cy', '220');
      text(ui.get('[data-source]'), 'Illustration · corner geometry');
      text(ui.get('[data-note]'), 'Explore wider and tighter arcs. This is geometry, not a measured racing result.');
      graph.setAttribute('aria-label', 'Illustrative corner. Move the slider to compare wider and tighter arcs; no measured time is shown.');
    } else if (hasPath) {
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (let i = 0; i < sampleCount; i += TRAJECTORY_STRIDE) {
        minX = Math.min(minX, samples[i]!); minY = Math.min(minY, samples[i + 1]!);
        maxX = Math.max(maxX, samples[i]!); maxY = Math.max(maxY, samples[i + 1]!);
      }
      const view = fitView({ minX: minX - 20, minY: minY - 20, maxX: maxX + 20, maxY: maxY + 20 }, 640, 330, 24);
      let d = '';
      for (let i = 0; i < sampleCount; i += TRAJECTORY_STRIDE) d += `${i ? 'L' : 'M'}${(samples[i]! * view.scale + view.offsetX).toFixed(2)},${(samples[i + 1]! * view.scale + view.offsetY).toFixed(2)}`;
      path.setAttribute('d', d);
      start.setAttribute('cx', String(samples[0]! * view.scale + view.offsetX));
      start.setAttribute('cy', String(samples[1]! * view.scale + view.offsetY));
      const label = lap === null ? 'Recorded best · partial attempt' : `Recorded best · ${lap.toFixed(2)} s lap`;
      text(ui.get('[data-source]'), label);
      text(ui.get('[data-note]'), `Generation ${bestGeneration}, car ${bestIndex + 1}. ${lap === null ? 'This car has not completed a timed lap.' : 'A complete timed lap, recorded from the simulation.'}`);
      graph.setAttribute('aria-label', label);
    } else {
      text(ui.get('[data-source]'), 'Waiting for a recorded attempt');
      text(ui.get('[data-note]'), 'No timed lap yet. Partial attempts are labeled as partial.');
      graph.setAttribute('aria-label', 'Recorded best path. No attempt has been supplied yet.');
    }
    sparkline(history);
    text(ui.get('[data-history-label]'), history.completedGenerations ? `${history.completedGenerations} completed · best / mean fitness` : 'No history yet');
  }
  ui.get('[data-mode]').addEventListener('click', () => { illustrate = !illustrate; ui.invalidate(); }, { signal: ui.signal });
  slider.addEventListener('input', ui.invalidate, { signal: ui.signal });
  return {
    update(_snapshot, incomingHistory, best) {
      entries.length = 0;
      const offset = Math.max(0, incomingHistory.entries.length - HISTORY_LIMIT);
      for (let i = offset; i < incomingHistory.entries.length; i++) {
        const copy = records[i - offset]!;
        Object.assign(copy, incomingHistory.entries[i]);
        entries.push(copy);
      }
      history = { runId: incomingHistory.runId, completedGenerations: incomingHistory.completedGenerations, entries };
      hasPath = !!best && best.car.runId === history.runId && best.samples.length >= TRAJECTORY_STRIDE;
      if (best && hasPath) {
        if (best.car.runId !== bestRun || best.car.generation !== bestGeneration || best.car.index !== bestIndex || best.fitness !== bestFitness || best.lapSeconds !== lap || best.samples.length !== sampleCount) {
          sampleCount = best.samples.length;
          if (samples.length < sampleCount) samples = new Float32Array(sampleCount);
          samples.set(best.samples);
          bestRun = best.car.runId; bestGeneration = best.car.generation; bestIndex = best.car.index;
          bestFitness = best.fitness; lap = best.lapSeconds;
        }
      } else {
        sampleCount = 0; bestRun = -1; bestFitness = NaN; lap = null;
      }
      ui.invalidate();
    },
    setVisible: ui.setVisible,
    destroy: ui.destroy,
  };
}
