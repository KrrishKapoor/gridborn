import { WorkerRuntime } from './runtime';
import type { SimulationEvent } from '../shared/simulation';

// DOM and worker libs conflict in the shared TS configuration. Keep this narrow, explicit
// worker-global interface instead of changing shared configuration or loading DOM code.
const scope = globalThis as unknown as {
  postMessage(event: SimulationEvent, transfer?: ArrayBuffer[]): void;
  onmessage: ((message: MessageEvent<unknown>) => void) | null;
};
const runtime = new WorkerRuntime({
  now: () => performance.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  send: (event, transfer) => scope.postMessage(event, transfer),
});
scope.onmessage = (event) => runtime.receive(event.data);
