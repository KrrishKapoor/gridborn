import type { TeachingDemo } from '../../shared/presentation';
import { SENSOR_ANGLES, SENSOR_STRIDE } from '../../shared/simulation';
import { svgNode, text } from '../dom';
import { hasSelected, surface } from './surface';

// A small, explicitly illustrative corridor; independent of track and engine code.
const walls = [[178, 306, 178, 172], [178, 172, 248, 40], [478, 306, 478, 172], [478, 172, 408, 40]] as const;
function distanceToWall(x: number, y: number, angle: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let distance = 220;
  for (const [ax, ay, bx, by] of walls) {
    const sx = bx - ax;
    const sy = by - ay;
    const cross = dx * sy - dy * sx;
    if (Math.abs(cross) < 0.00001) continue;
    const t = ((ax - x) * sy - (ay - y) * sx) / cross;
    const u = ((ax - x) * dy - (ay - y) * dx) / cross;
    if (t >= 0 && u >= 0 && u <= 1) distance = Math.min(distance, t);
  }
  return distance;
}

export function mountSensorDemo(root: HTMLElement): TeachingDemo {
  let x = 328;
  let y = 242;
  let angle = 0;
  let selected = false;
  let follow = true;
  let pointer: number | null = null;
  const distances = new Float32Array(7);
  const ui = surface(root, `
    <div class="diagram-caption"><span data-source>Illustration</span><label class="follow-control"><input type="checkbox" checked disabled> Follow selected car</label></div>
    <svg class="sensor-diagram interactive-diagram" viewBox="0 0 640 330" role="img" aria-label="Seven distance sensors. Drag the car to explore a corridor, or use the position and heading sliders.">
      <g data-walls fill="none" stroke="#a4ad9d" stroke-width="2"><path d="M178 306V172L248 40M478 306V172L408 40"/><path d="M328 306V172L328 40" stroke="#d8ddd3" stroke-dasharray="4 8"/></g>
      <g data-rays></g><g data-car><rect x="-9" y="-16" width="18" height="32" rx="4" fill="#20251f"/><path d="M-5-7H5M-5 8H5" stroke="#f7f7f2" stroke-width="2"/></g>
      <text x="28" y="38" class="svg-note">7 rays.</text><text x="28" y="56" class="svg-note">One local view.</text>
    </svg>
    <div class="sensor-readings" aria-label="Normalized sensor distances"></div>
    <div class="diagram-controls two-controls"><label>Position <input data-position type="range" min="205" max="451" value="328" aria-label="Illustrative car position"></label><label>Heading <input data-heading type="range" min="-60" max="60" value="0" aria-label="Illustrative car heading"></label></div>
    <p class="diagram-note" data-note>Drag the car. A shorter ray means a nearer wall.</p>` , render);
  const svg = ui.get<SVGSVGElement>('svg');
  const car = ui.get<SVGGElement>('[data-car]');
  const source = ui.get('[data-source]');
  const note = ui.get('[data-note]');
  const road = ui.get<SVGGElement>('[data-walls]');
  const position = ui.get<HTMLInputElement>('[data-position]');
  const heading = ui.get<HTMLInputElement>('[data-heading]');
  const checkbox = ui.get<HTMLInputElement>('input[type=checkbox]');
  const rays = SENSOR_ANGLES.map(() => {
    const line = svgNode('line', { stroke: '#246b32', 'stroke-width': 1.6 });
    const dot = svgNode('circle', { r: 3, fill: '#246b32' });
    ui.get('[data-rays]').append(line, dot);
    return { line, dot };
  });
  const readings = SENSOR_ANGLES.map((_, index) => {
    const reading = document.createElement('span');
    reading.innerHTML = `<small>${index + 1}</small><b>—</b><i></i>`;
    ui.get('.sensor-readings').append(reading);
    return { value: reading.querySelector('b')!, bar: reading.querySelector('i')! };
  });
  function render() {
    const live = selected && follow;
    const cx = live ? 328 : x;
    const cy = live ? 242 : y;
    const turn = live ? 0 : angle;
    road.style.display = live ? 'none' : '';
    car.setAttribute('transform', `translate(${cx} ${cy}) rotate(${turn})`);
    text(source, live ? 'Selected car · live distances' : 'Illustration · local perception');
    text(note, live ? 'Distances from the selected car, normalized to its sensor range.' : 'Drag the car. A shorter ray means a nearer wall.');
    checkbox.disabled = !selected;
    position.disabled = heading.disabled = live;
    svg.classList.toggle('is-live', live);
    SENSOR_ANGLES.forEach((relative, index) => {
      const rayAngle = -Math.PI / 2 + turn * Math.PI / 180 + relative;
      const distance = live ? Math.max(0, Math.min(1, distances[index]!)) * 220 : distanceToWall(cx, cy, rayAngle);
      const endX = cx + Math.cos(rayAngle) * distance;
      const endY = cy + Math.sin(rayAngle) * distance;
      const { line, dot } = rays[index]!;
      line.setAttribute('x1', String(cx)); line.setAttribute('y1', String(cy));
      line.setAttribute('x2', String(endX)); line.setAttribute('y2', String(endY));
      dot.setAttribute('cx', String(endX)); dot.setAttribute('cy', String(endY));
      const reading = readings[index]!;
      text(reading.value, (distance / 220).toFixed(2));
      reading.bar.style.setProperty('--reading', String(distance / 220));
    });
  }
  position.addEventListener('input', () => { x = position.valueAsNumber; ui.invalidate(); }, { signal: ui.signal });
  heading.addEventListener('input', () => { angle = heading.valueAsNumber; ui.invalidate(); }, { signal: ui.signal });
  checkbox.addEventListener('change', () => { follow = checkbox.checked; ui.invalidate(); }, { signal: ui.signal });
  function move(event: PointerEvent) {
    const rect = svg.getBoundingClientRect();
    // SVG and its CSS box share the viewBox aspect ratio.
    x = Math.max(205, Math.min(451, (event.clientX - rect.left) / rect.width * 640));
    y = Math.max(220, Math.min(280, (event.clientY - rect.top) / rect.height * 330));
    position.value = String(Math.round(x));
    ui.invalidate();
  }
  svg.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || (selected && follow)) return;
    pointer = event.pointerId;
    svg.setPointerCapture(pointer);
    move(event);
  }, { signal: ui.signal });
  svg.addEventListener('pointermove', (event) => { if (event.pointerId === pointer) move(event); }, { signal: ui.signal });
  const cancelPointer = () => {
    if (pointer !== null && svg.hasPointerCapture(pointer)) svg.releasePointerCapture(pointer);
    pointer = null;
  };
  svg.addEventListener('pointerup', cancelPointer, { signal: ui.signal });
  svg.addEventListener('pointercancel', cancelPointer, { signal: ui.signal });
  svg.addEventListener('lostpointercapture', () => { pointer = null; }, { signal: ui.signal });
  return {
    update(snapshot) {
      selected = hasSelected(snapshot);
      if (hasSelected(snapshot)) for (let i = 0; i < 7; i++) distances[i] = snapshot.storage.sensors[i * SENSOR_STRIDE]!;
      if (selected && follow) cancelPointer();
      ui.invalidate();
    },
    setVisible(visible) { if (!visible) cancelPointer(); ui.setVisible(visible); },
    destroy() { cancelPointer(); ui.destroy(); },
  };
}
