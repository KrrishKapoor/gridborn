import type { TeachingDemo } from '../../shared/presentation';
import { svgNode, text } from '../dom';
import { surface } from './surface';

export function mountGeneticsDemo(root: HTMLElement): TeachingDemo {
  let mutations = 0;
  const ui = surface(root, `
    <div class="diagram-caption"><span>Illustration · 12 weights, no actual lineage</span><span data-mutation-count>0 mutations</span></div>
    <div class="diagram-controls parent-controls">
      <label>Parent A <select data-parent-a aria-label="Illustrative parent A"><option value="0">Candidate 1</option><option value="1">Candidate 2</option><option value="2">Candidate 3</option><option value="3">Candidate 4</option></select></label>
      <label>Parent B <select data-parent-b aria-label="Illustrative parent B"><option value="0">Candidate 1</option><option value="1" selected>Candidate 2</option><option value="2">Candidate 3</option><option value="3">Candidate 4</option></select></label>
    </div>
    <svg class="genetics-diagram" viewBox="0 0 640 280" role="img" aria-label="Two illustrative parent genomes combine at a crossover point into a child. Ochre outlines mark mutated weights.">
      <text x="16" y="63" class="svg-note">A</text><text x="16" y="125" class="svg-note">B</text><text x="16" y="233" class="svg-note">Child</text>
      <g data-genes></g><path data-split fill="none" stroke="#246b32" stroke-width="1" stroke-dasharray="3 4"/>
      <text x="78" y="178" class="svg-note">Select → combine → vary</text>
    </svg>
    <div class="diagram-controls genetics-controls"><label>Crossover <input data-crossover type="range" min="1" max="11" value="6" aria-label="Illustrative crossover point"></label><button type="button" data-mutate>Mutate a weight</button><button type="button" class="quiet-button" data-reset>Start again</button></div>
    <p class="diagram-note" data-note>A child inherits the left side from A and the right side from B.</p>`, render);
  const a = ui.get<HTMLSelectElement>('[data-parent-a]');
  const b = ui.get<HTMLSelectElement>('[data-parent-b]');
  const crossover = ui.get<HTMLInputElement>('[data-crossover]');
  const cells: { rect: SVGRectElement; bar: SVGLineElement; title: SVGTitleElement }[] = [];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 12; i++) {
    const y = row === 2 ? 205 : 38 + row * 62;
    const rect = svgNode('rect', { x: 78 + i * 43, y, width: 34, height: 40, rx: 2 });
    const bar = svgNode('line', { x1: 95 + i * 43, x2: 95 + i * 43, 'stroke-width': 3 });
    const title = svgNode('title', {});
    rect.append(title);
    ui.get('[data-genes]').append(rect, bar);
    cells.push({ rect, bar, title });
  }
  function value(parent: number, gene: number) { return Math.sin((parent + 1) * 2.3 + gene * 1.8) * 0.9; }
  function render() {
    const split = crossover.valueAsNumber;
    for (let row = 0; row < 3; row++) for (let i = 0; i < 12; i++) {
      const fromA = row === 0 || (row === 2 && i < split);
      const changed = row === 2 && ((i * 5 + 3) % 12) < mutations;
      const v = Math.max(-1, Math.min(1, value(Number(fromA ? a.value : b.value), i) + (changed ? (i % 2 ? -0.45 : 0.45) : 0)));
      const { rect, bar, title } = cells[row * 12 + i]!;
      const centerY = (row === 2 ? 205 : 38 + row * 62) + 20;
      rect.setAttribute('fill', fromA ? '#e5efdf' : '#e6e7e1');
      rect.setAttribute('stroke', changed ? '#956018' : 'none');
      rect.setAttribute('stroke-width', '2');
      bar.setAttribute('stroke', changed ? '#956018' : fromA ? '#246b32' : '#5c645a');
      bar.setAttribute('y1', String(centerY));
      bar.setAttribute('y2', String(centerY - v * 17));
      text(title, `${row === 2 ? 'Child' : fromA ? 'Parent A' : 'Parent B'}, weight ${i + 1}: ${v.toFixed(2)}${changed ? ', mutated' : ''}`);
    }
    const x = 73 + split * 43;
    ui.get('[data-split]').setAttribute('d', `M${x} 28V146M${x} 196V258`);
    text(ui.get('[data-mutation-count]'), `${mutations} ${mutations === 1 ? 'mutation' : 'mutations'}`);
    text(ui.get('[data-note]'), mutations ? 'Ochre marks small weight changes. Useful variations can survive selection.' : 'A child inherits the left side from A and the right side from B.');
    ui.get<HTMLButtonElement>('[data-mutate]').disabled = mutations === 12;
  }
  for (const input of [a, b, crossover]) input.addEventListener('input', ui.invalidate, { signal: ui.signal });
  ui.get('[data-mutate]').addEventListener('click', () => { mutations = Math.min(12, mutations + 1); ui.invalidate(); }, { signal: ui.signal });
  ui.get('[data-reset]').addEventListener('click', () => { mutations = 0; a.value = '0'; b.value = '1'; crossover.value = '6'; ui.invalidate(); }, { signal: ui.signal });
  return {
    // This operator illustration deliberately makes no claim about live ancestry.
    update() {},
    setVisible: ui.setVisible,
    destroy: ui.destroy,
  };
}
