import { query } from '../dom';
import type { SimulationSnapshot } from '../../shared/simulation';

/** Event-driven drawing: no idle frame loop, even when reduced motion is off. */
export function surface(root: HTMLElement, markup: string, render: () => void) {
  const element = document.createElement('div');
  element.className = 'teaching-diagram';
  element.innerHTML = markup;
  root.append(element);
  const events = new AbortController();
  let allowed = true;
  let intersecting = false;
  let destroyed = false;
  let frame = 0;
  let dirty = true;
  function invalidate() {
    dirty = true;
    schedule();
  }
  function schedule() {
    if (destroyed || !dirty || frame || !allowed || !intersecting || document.hidden) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (destroyed || !allowed || !intersecting || document.hidden) return;
      dirty = false;
      render();
    });
  }
  function cancel() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }
  const observer = new IntersectionObserver(([entry]) => {
    intersecting = entry?.isIntersecting ?? false;
    if (intersecting) schedule(); else cancel();
  });
  observer.observe(element);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel(); else schedule();
  }, { signal: events.signal });
  return {
    element,
    signal: events.signal,
    get: <T extends Element = HTMLElement>(selector: string) => query<T>(element, selector),
    invalidate,
    setVisible(visible: boolean) {
      allowed = visible;
      if (visible) schedule(); else cancel();
    },
    destroy() {
      destroyed = true;
      cancel();
      observer.disconnect();
      events.abort();
      element.remove();
    },
  };
}

export function hasSelected(snapshot: SimulationSnapshot | null): snapshot is SimulationSnapshot & { selected: NonNullable<SimulationSnapshot['selected']> } {
  return !!snapshot?.selected && snapshot.selected.runId === snapshot.runId
    && snapshot.selected.generation === snapshot.generation
    && snapshot.selected.index >= 0 && snapshot.selected.index < snapshot.population;
}
