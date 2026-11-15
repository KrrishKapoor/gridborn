import type { GenerationHistory } from '../shared/simulation';
import { svgNode } from './dom';

/** Completed generations only; a single result is a point, never an invented trend. */
export function createSparkline(svg: SVGSVGElement) {
  const mean = svgNode('path', { fill: 'none', stroke: '#929b8b', 'stroke-width': 1.5 });
  const best = svgNode('path', { fill: 'none', stroke: '#246b32', 'stroke-width': 2 });
  const dot = svgNode('circle', { r: 2.5, fill: '#246b32', visibility: 'hidden' });
  svg.append(mean, best, dot);
  svg.setAttribute('viewBox', '0 0 200 48');
  return (history: GenerationHistory) => {
    const entries = history.entries;
    if (!entries.length) {
      mean.setAttribute('d', '');
      best.setAttribute('d', '');
      dot.setAttribute('visibility', 'hidden');
      svg.setAttribute('aria-label', 'Fitness history: no completed generations yet');
      return;
    }
    let low = Infinity;
    let high = -Infinity;
    for (const entry of entries) {
      low = Math.min(low, entry.meanFitness, entry.bestFitness);
      high = Math.max(high, entry.meanFitness, entry.bestFitness);
    }
    const first = entries[0]!;
    const last = entries[entries.length - 1]!;
    const span = last.generation - first.generation;
    let bestPath = '';
    let meanPath = '';
    let lastX = 0;
    let lastY = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const x = span ? 4 + (entry.generation - first.generation) / span * 192 : 100;
      const bestY = high === low ? 24 : 43 - (entry.bestFitness - low) / (high - low) * 38;
      const meanY = high === low ? 24 : 43 - (entry.meanFitness - low) / (high - low) * 38;
      bestPath += `${i ? 'L' : 'M'}${x.toFixed(2)},${bestY.toFixed(2)}`;
      meanPath += `${i ? 'L' : 'M'}${x.toFixed(2)},${meanY.toFixed(2)}`;
      lastX = x;
      lastY = bestY;
    }
    best.setAttribute('d', bestPath);
    mean.setAttribute('d', meanPath);
    dot.setAttribute('cx', String(lastX));
    dot.setAttribute('cy', String(lastY));
    dot.setAttribute('visibility', 'visible');
    svg.setAttribute('aria-label', `Fitness over generations ${first.generation} to ${last.generation}. Latest best ${last.bestFitness.toFixed(2)}, mean ${last.meanFitness.toFixed(2)}. Green is best; gray is mean.`);
  };
}
