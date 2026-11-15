import type { TrackGeometry } from '../shared/geometry';
import { CAR, CAR_STRIDE } from '../shared/simulation';
import type { SimulationSnapshot } from '../shared/simulation';
import { svgNode, text } from '../ui/dom';
import { boundaryPath } from './renderer';

/** Always actual: unlike a teaching demo this inspector has no illustrative mode. */
export function createInspector(root: HTMLElement) {
  root.innerHTML = `<div class="actual-inspector"><div class="inspection-sight"><canvas aria-label="Actual selected car and its seven rays against the road"></canvas><p class="diagram-note" data-driver-state></p></div><div class="inspection-brain"><svg viewBox="0 0 640 330" role="img" aria-label="Actual 8 input, 8 hidden, 2 output neural network. Green is positive; dashed gray is negative."><text x="78" y="25" class="svg-heading">INPUTS</text><text x="286" y="25" class="svg-heading">HIDDEN</text><text x="500" y="25" class="svg-heading">OUTPUTS</text><g data-edges></g><g data-nodes></g><text x="518" y="124" class="svg-note">Steer</text><text x="518" y="151" class="svg-value" data-steer></text><text x="518" y="215" class="svg-note">Throttle</text><text x="518" y="242" class="svg-value" data-throttle></text></svg><p class="diagram-note">Actual weights & activations · green positive, dashed gray negative. Node intensity shows the signal.</p></div></div>`;
  const graph = root.querySelector('svg')!;
  const edges: { element: SVGLineElement; index: number }[] = [];
  const nodes: SVGCircleElement[] = [];
  const steer = root.querySelector('[data-steer]')!, throttle = root.querySelector('[data-throttle]')!, state = root.querySelector('[data-driver-state]')!;
  const sight = root.querySelector('canvas')!, ctx = sight.getContext('2d')!;
  let road = new Path2D(), identity = '';
  const y = (i: number) => 54 + i * 34;
  for (let destination = 0; destination < 10; destination++) {
    for (let input = 0; input < 8; input++) {
      const output = destination >= 8;
      const line = svgNode('line', { x1: output ? 320 : 112, y1: y(input), x2: output ? 500 : 320, y2: output ? 139 + (destination - 8) * 91 : y(destination) });
      const title = svgNode('title', {}); line.append(title); graph.querySelector('[data-edges]')!.append(line);
      edges.push({ element: line, index: output ? 72 + (destination - 8) * 9 + input : destination * 9 + input });
    }
  }
  for (let i = 0; i < 18; i++) {
    const node = svgNode('circle', { cx: i < 8 ? 112 : i < 16 ? 320 : 500, cy: i < 16 ? y(i % 8) : 139 + (i - 16) * 91, r: i < 16 ? 8 : 11, stroke: '#246b32', 'stroke-width': 1.5 });
    node.append(svgNode('title', {})); graph.querySelector('[data-nodes]')!.append(node); nodes.push(node);
    if (i < 8) { const label = svgNode('text', { x: 78, y: y(i) + 5, class: 'svg-note', 'text-anchor': 'end' }); label.textContent = i === 7 ? 'speed' : `ray ${i + 1}`; graph.append(label); }
  }
  return {
    setTrack(track: TrackGeometry) { road = boundaryPath(track); },
    update(snapshot: SimulationSnapshot) {
      if (!snapshot.selected) return;
      const { selected, storage } = snapshot, key = `${selected.runId}/${selected.generation}/${selected.index}`;
      if (key !== identity) {
        identity = key;
        for (const { element, index } of edges) {
          const weight = storage.weights[index]!;
          element.setAttribute('stroke', weight >= 0 ? '#246b32' : '#737c6d');
          element.setAttribute('stroke-opacity', String(0.12 + Math.min(1, Math.abs(weight)) * 0.6));
          element.setAttribute('stroke-width', String(0.5 + Math.min(2, Math.abs(weight)) * 1.2));
          element.setAttribute('stroke-dasharray', weight < 0 ? '3 4' : 'none');
          text(element.firstElementChild!, `Weight ${weight.toFixed(3)}`);
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        const a = storage.activations[i]!, node = nodes[i]!;
        node.setAttribute('fill', a >= 0 ? '#246b32' : '#737c6d'); node.setAttribute('fill-opacity', String(0.08 + Math.min(1, Math.abs(a)) * 0.92));
        text(node.firstElementChild!, `Activation ${a.toFixed(3)}${i >= 8 ? `, bias ${storage.weights[i < 16 ? (i - 8) * 9 + 8 : 80 + (i - 16) * 9]!.toFixed(3)}` : ''}`);
      }
      text(steer, `${storage.activations[16]! >= 0 ? '+' : ''}${storage.activations[16]!.toFixed(2)}`);
      text(throttle, `${Math.round((storage.activations[17]! + 1) * 50)}%`);
      const at = selected.index * CAR_STRIDE, x = storage.cars[at]!, yy = storage.cars[at + 1]!, status = storage.cars[at + CAR.status]!;
      text(state, `${status === 0 ? 'Driving' : status === 1 ? 'Crashed · stopped' : 'Lap complete · stopped'} · speed ${storage.cars[at + CAR.speed]!.toFixed(0)} · seven live distances`);
      const rect = sight.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
      if (sight.width !== width || sight.height !== height) { sight.width = width; sight.height = height; }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
      const scale = Math.min(width, height) / 420;
      ctx.setTransform(scale, 0, 0, scale, width / 2 - x * scale, height / 2 - yy * scale);
      ctx.fillStyle = '#e1e5da'; ctx.fill(road, 'evenodd'); ctx.strokeStyle = '#a6b29d'; ctx.lineWidth = 1 / scale; ctx.stroke(road);
      for (let i = 0; i < 21; i += 3) {
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(storage.sensors[i + 1]!, storage.sensors[i + 2]!); ctx.strokeStyle = '#246b32'; ctx.stroke();
        ctx.beginPath(); ctx.arc(storage.sensors[i + 1]!, storage.sensors[i + 2]!, 2 / scale, 0, Math.PI * 2); ctx.fillStyle = '#246b32'; ctx.fill();
      }
      ctx.translate(x, yy); ctx.rotate(storage.cars[at + CAR.heading]!); ctx.fillStyle = '#246b32'; ctx.fillRect(-9, -4, 17, 8);
    },
    destroy() { root.replaceChildren(); },
  };
}
