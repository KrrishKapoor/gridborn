import { WORLD_HEIGHT, WORLD_WIDTH } from '../shared/geometry';
import { cssToWorld, fitView } from '../shared/view';
import './preview.css';

/** Temporary T0 smoke surface. T4 replaces this import; this is not a teaching demo. */
export function mountPreview(root: HTMLElement): () => void {
  root.innerHTML = `
    <a class="skip-link" href="#main">Skip to preview</a>
    <div class="preview">
      <header class="preview-header">
        <span class="wordmark">Gridborn</span>
        <span class="preview-label">Development preview</span>
      </header>
      <main id="main">
        <section class="preview-intro" aria-labelledby="preview-title">
          <p class="eyebrow">An exploration of learning to race</p>
          <h1 id="preview-title">A starting point.</h1>
          <p>A small canvas, ready for what comes next. Move the marker to try the shared coordinate system.</p>
        </section>
        <figure class="smoke-figure" aria-labelledby="canvas-title">
          <div class="smoke-bar">
            <h2 id="canvas-title">One world. Any screen.</h2>
            <output id="position" aria-label="Marker world position" aria-live="off"></output>
          </div>
          <canvas class="smoke-canvas" tabindex="0" role="img"
            aria-label="Interactive position marker in a 1200 by 800 world"
            aria-describedby="canvas-help" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home">
            Use a browser with Canvas2D support to move the position marker.
          </canvas>
          <figcaption class="smoke-caption">
            <p id="canvas-help">Tap or drag to place the marker. With the canvas focused, use the arrow keys to move and Home to center.</p>
            <button class="reset-button" type="button">Center marker</button>
          </figcaption>
        </figure>
        <p class="sr-only" id="announcement" role="status" aria-atomic="true"></p>
      </main>
      <footer class="preview-footer">Canvas interaction check only. The racing simulation is not connected yet.</footer>
    </div>`;

  const canvas = root.querySelector('canvas');
  const output = root.querySelector('output');
  const reset = root.querySelector('button');
  const announcement = root.querySelector('#announcement');
  if (!canvas || !output || !reset || !announcement) throw new Error('Preview markup is incomplete.');
  const context = canvas.getContext('2d');
  if (!context) {
    announcement.textContent = 'Canvas2D is unavailable in this browser.';
    reset.disabled = true;
    return () => { root.replaceChildren(); };
  }

  const abort = new AbortController();
  const options = { signal: abort.signal };
  const bounds = { minX: 0, minY: 0, maxX: WORLD_WIDTH, maxY: WORLD_HEIGHT };
  const point = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  const colors = getComputedStyle(root);
  const ink = colors.getPropertyValue('--color-accent').trim();
  const rule = colors.getPropertyValue('--color-rule').trim();
  const soft = colors.getPropertyValue('--color-accent-soft').trim();
  let view = fitView(bounds, 1, 1);
  let cssWidth = 0;
  let cssHeight = 0;
  let frame = 0;
  let pointer: number | null = null;

  function announce(): void {
    announcement!.textContent = `Marker at ${Math.round(point.x)}, ${Math.round(point.y)} world units.`;
  }

  function draw(): void {
    frame = 0;
    const rect = canvas!.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    cssWidth = rect.width;
    cssHeight = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);
    if (canvas!.width !== width || canvas!.height !== height) {
      canvas!.width = width;
      canvas!.height = height;
    }
    view = fitView(bounds, cssWidth, cssHeight, 24);
    context!.setTransform(width / cssWidth, 0, 0, height / cssHeight, 0, 0);
    context!.clearRect(0, 0, cssWidth, cssHeight);
    context!.strokeStyle = rule;
    context!.lineWidth = 1;
    context!.beginPath();
    for (let x = 0; x <= WORLD_WIDTH; x += 100) {
      for (let y = 0; y <= WORLD_HEIGHT; y += 100) {
        const screenX = x * view.scale + view.offsetX;
        const screenY = y * view.scale + view.offsetY;
        context!.moveTo(screenX - 1, screenY);
        context!.lineTo(screenX + 1, screenY);
      }
    }
    context!.stroke();
    const x = point.x * view.scale + view.offsetX;
    const y = point.y * view.scale + view.offsetY;
    context!.beginPath();
    context!.moveTo(view.offsetX, y);
    context!.lineTo(view.offsetX + WORLD_WIDTH * view.scale, y);
    context!.moveTo(x, view.offsetY);
    context!.lineTo(x, view.offsetY + WORLD_HEIGHT * view.scale);
    context!.stroke();
    context!.fillStyle = soft;
    context!.beginPath();
    context!.arc(x, y, 18, 0, Math.PI * 2);
    context!.fill();
    context!.fillStyle = ink;
    context!.beginPath();
    context!.arc(x, y, 6, 0, Math.PI * 2);
    context!.fill();
    output!.textContent = `x ${Math.round(point.x).toString().padStart(4, '0')} / y ${Math.round(point.y).toString().padStart(4, '0')}`;
  }

  function requestDraw(): void { if (!frame) frame = requestAnimationFrame(draw); }
  function clampPoint(): void {
    point.x = Math.max(0, Math.min(WORLD_WIDTH, point.x));
    point.y = Math.max(0, Math.min(WORLD_HEIGHT, point.y));
  }
  function place(event: PointerEvent): void {
    const rect = canvas!.getBoundingClientRect();
    if (rect.width <= 48 || rect.height <= 48) return;
    view = fitView(bounds, rect.width, rect.height, 24);
    cssToWorld(event.clientX - rect.left, event.clientY - rect.top, view, point);
    clampPoint();
    requestDraw();
  }
  function center(): void {
    point.x = WORLD_WIDTH / 2;
    point.y = WORLD_HEIGHT / 2;
    requestDraw();
    announce();
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || pointer !== null) return;
    pointer = event.pointerId;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(pointer);
    place(event);
  }, options);
  canvas.addEventListener('pointermove', (event) => { if (event.pointerId === pointer) place(event); }, options);
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointer) return;
    place(event);
    pointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    announce();
  }, options);
  canvas.addEventListener('pointercancel', () => { pointer = null; }, options);
  canvas.addEventListener('lostpointercapture', () => { pointer = null; }, options);
  canvas.addEventListener('keydown', (event) => {
    const distance = event.shiftKey ? 50 : 10;
    switch (event.key) {
      case 'ArrowLeft': point.x -= distance; break;
      case 'ArrowRight': point.x += distance; break;
      case 'ArrowUp': point.y -= distance; break;
      case 'ArrowDown': point.y += distance; break;
      case 'Home': center(); break;
      default: return;
    }
    event.preventDefault();
    clampPoint();
    requestDraw();
    announce();
  }, options);
  reset.addEventListener('click', center, options);
  window.addEventListener('resize', requestDraw, options);
  const observer = new ResizeObserver(requestDraw);
  observer.observe(canvas);
  requestDraw();

  return () => {
    abort.abort();
    observer.disconnect();
    cancelAnimationFrame(frame);
    root.replaceChildren();
  };
}
