import type { TeachingDemo } from '../../shared/presentation';
import { ACTIVATION_COUNT, WEIGHT_COUNT } from '../../shared/simulation';
import { svgNode, text } from '../dom';
import { hasSelected, surface } from './surface';

export function mountNetworkDemo(root: HTMLElement): TeachingDemo {
  const weights = new Float32Array(WEIGHT_COUNT);
  const activations = new Float32Array(ACTIVATION_COUNT);
  const liveWeights = new Float32Array(WEIGHT_COUNT);
  const liveActivations = new Float32Array(ACTIVATION_COUNT);
  for (let i = 0; i < weights.length; i++) weights[i] = Math.sin(i * 1.73 + 0.4) * 0.85;
  let selected = false;
  let follow = true;
  const ui = surface(root, `
    <div class="diagram-caption"><span data-source>Illustrative network</span><label class="follow-control"><input type="checkbox" checked disabled> Follow selected car</label></div>
    <svg class="network-diagram" viewBox="0 0 640 330" role="img" aria-label="Eight inputs connect to eight hidden neurons, then to steering and throttle. Green connections have positive weights; dashed gray connections have negative weights.">
      <text x="80" y="25" class="svg-heading">SENSE</text><text x="292" y="25" class="svg-heading">COMBINE</text><text x="516" y="25" class="svg-heading">ACT</text>
      <g data-edges></g><g data-nodes></g>
      <text x="522" y="127" class="svg-note">Steer</text><text x="522" y="151" class="svg-value" data-steer></text>
      <text x="522" y="218" class="svg-note">Throttle</text><text x="522" y="242" class="svg-value" data-throttle></text>
    </svg>
    <div class="diagram-controls two-controls"><label>Front clearance <input data-clearance type="range" min="0" max="100" value="65" aria-label="Illustrative front clearance"></label><label>Steering weight <input data-weight type="range" min="-2" max="2" step="0.05" value="0.5" aria-label="Illustrative steering weight"></label></div>
    <p class="diagram-note" data-note>Change an input or a weight. Watch the outputs respond.</p>`, render);
  const clearance = ui.get<HTMLInputElement>('[data-clearance]');
  const weight = ui.get<HTMLInputElement>('[data-weight]');
  const checkbox = ui.get<HTMLInputElement>('input[type=checkbox]');
  const edges: { line: SVGLineElement; index: number }[] = [];
  const nodes: SVGCircleElement[] = [];
  const inputY = (i: number) => 54 + i * 34;
  for (let destination = 0; destination < 8; destination++) {
    for (let input = 0; input < 8; input++) {
      const line = svgNode('line', { x1: 112, y1: inputY(input), x2: 320, y2: inputY(destination) });
      ui.get('[data-edges]').append(line);
      edges.push({ line, index: destination * 9 + input });
    }
  }
  for (let destination = 0; destination < 2; destination++) {
    for (let input = 0; input < 8; input++) {
      const line = svgNode('line', { x1: 320, y1: inputY(input), x2: 500, y2: 139 + destination * 91 });
      ui.get('[data-edges]').append(line);
      edges.push({ line, index: 72 + destination * 9 + input });
    }
  }
  for (let i = 0; i < 18; i++) {
    const node = svgNode('circle', { cx: i < 8 ? 112 : i < 16 ? 320 : 500, cy: i < 16 ? inputY(i % 8) : 139 + (i - 16) * 91, r: i < 16 ? 8 : 11, stroke: '#246b32', 'stroke-width': 1.5 });
    const title = svgNode('title', {});
    node.append(title);
    ui.get('[data-nodes]').append(node);
    nodes.push(node);
    if (i < 8) {
      const label = svgNode('text', { x: 77, y: inputY(i) + 4, class: 'svg-note', 'text-anchor': 'end' });
      label.textContent = i === 7 ? 'speed' : `ray ${i + 1}`;
      ui.get('[data-nodes]').append(label);
    }
  }
  function inferIllustration() {
    for (let i = 0; i < 7; i++) activations[i] = 0.25 + 0.65 * Math.sin((i + 1) * 0.39);
    activations[3] = clearance.valueAsNumber / 100;
    activations[7] = 0.45;
    weights[74] = weight.valueAsNumber;
    for (let output = 0; output < 8; output++) {
      let sum = weights[output * 9 + 8]!;
      for (let input = 0; input < 8; input++) sum += activations[input]! * weights[output * 9 + input]!;
      activations[8 + output] = Math.tanh(sum);
    }
    for (let output = 0; output < 2; output++) {
      let sum = weights[72 + output * 9 + 8]!;
      for (let input = 0; input < 8; input++) sum += activations[8 + input]! * weights[72 + output * 9 + input]!;
      activations[16 + output] = Math.tanh(sum);
    }
  }
  function render() {
    const live = selected && follow;
    if (!live) inferIllustration();
    const w = live ? liveWeights : weights;
    const a = live ? liveActivations : activations;
    text(ui.get('[data-source]'), live ? 'Selected car · live network' : 'Illustration · 8 → 8 → 2');
    text(ui.get('[data-note]'), live ? 'Actual weights and activations. Green is positive; dashed gray is negative.' : 'Change an input or a weight. Watch the outputs respond.');
    clearance.disabled = weight.disabled = live;
    checkbox.disabled = !selected;
    for (const { line, index } of edges) {
      const value = w[index]!;
      line.setAttribute('stroke', value >= 0 ? '#246b32' : '#737c6d');
      line.setAttribute('stroke-opacity', String(0.09 + Math.min(1, Math.abs(value)) * 0.55));
      line.setAttribute('stroke-width', String(0.5 + Math.min(2, Math.abs(value)) * 1.1));
      line.setAttribute('stroke-dasharray', value < 0 ? '3 4' : 'none');
    }
    nodes.forEach((node, index) => {
      const value = a[index]!;
      node.setAttribute('fill', value >= 0 ? '#246b32' : '#737c6d');
      node.setAttribute('fill-opacity', String(0.08 + Math.min(1, Math.abs(value)) * 0.92));
      text(node.firstElementChild!, `Activation ${value.toFixed(3)}`);
    });
    text(ui.get('[data-steer]'), `${a[16]! >= 0 ? '+' : ''}${a[16]!.toFixed(2)}`);
    text(ui.get('[data-throttle]'), `${Math.round((a[17]! + 1) / 2 * 100)}%`);
  }
  for (const input of [clearance, weight]) input.addEventListener('input', ui.invalidate, { signal: ui.signal });
  checkbox.addEventListener('change', () => { follow = checkbox.checked; ui.invalidate(); }, { signal: ui.signal });
  return {
    update(snapshot) {
      selected = hasSelected(snapshot);
      if (selected && snapshot) {
        liveWeights.set(snapshot.storage.weights);
        liveActivations.set(snapshot.storage.activations);
      }
      ui.invalidate();
    },
    setVisible: ui.setVisible,
    destroy: ui.destroy,
  };
}
