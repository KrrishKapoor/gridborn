# Production integration

`src/main.ts` mounts `runtime/app.ts`. The disposable scaffold is removed. The page, T1 editor/presets, and T2 module worker are composed only here; `dist/` contains the actual article and worker. No deployment or PR is part of this task.

## State and ownership

- `Session` keeps visitor intentions, one pending reset, the latest queued reset, and the accepted run separately. Every request consumes a fresh increasing ID. Ready accepts the exact pending candidate; an error keeps the last accepted track, history and worker. Rapid inputs coalesce queued resets without reusing IDs. Rate/pause intentions survive acceptance and hidden/drawing suspension.
- Superseded incoming and stale snapshots are recycled immediately. The displayed snapshot is retained until replacement. Demos synchronously copy borrowed sensor/weight/history/path data. No view retains a transferred array. Completed history is capped at 256 and sparkline updates are event-driven.
- `Presentation` owns four reusable car-pose arrays. The normal render clock trails by two display intervals and interpolates only between received positions and shortest-angle headings, bounded to those endpoints. It resets at run/generation/rate boundaries and after a suspension. No physics or lap scoring uses these positions. Exact selected snapshots bypass interpolation so rays, car pose and activations agree. Fast is headless with ~10 Hz observation.
- Track rendering uses the actual two boundaries. The glowing path uses only recorded samples and is never artificially closed. Null lap time stays partial. Car hit testing uses the visible poses in CSS coordinates, never DPR coordinates.
- Drawing enables only the editor overlay and suspends stepping without changing the visitor's running preference. Clear removes the draft. Valid commits request a reset; invalid strokes preserve the current run. Window/document lifecycle and HMR teardown remove listeners/observers, cancel frames, destroy the editor/demos and terminate the worker.

## Narrow presentation extensions

Optional `PageState.circuitLabel`, `pendingLabel`, `pendingPopulation`, and `suspended` expose concrete runtime state. Optional `TeachingDemo.setTrack(track)` supplies immutable main-owned geometry to the racing-line diagram; it draws the recorded line in the same transform as the actual walls. Follow-selected checkboxes retain the visitor's choice. The main inspector has no illustrative mode.

Explicit selection reveals the inspector and adds a hero cue. Closing or Escape restores focus when it was inside; pointer selection does not force keyboard focus styling. SVG labels compensate for scaling down to phone and intermediate widths. Landscape feedback sits beside the visible canvas, and current/pending/error text remains local.

## Regressions

Run `npm ci`, `npm test`, `npm run build`.

- `sim/runtime.test.ts`: controlled-host 1×/4× delivery cadence; original eight malformed commands followed by invalid reset 11; old run continues and valid reset 12 works; bounded pool, pause and determinism tests remain.
- `runtime/track-validation.test.ts`: all three T1 presets, T2 fixture and reasonable drawn loop accepted; original outer-boundary + 2×2 fake inner loop and inconsistent declared width rejected. Reset validation checks nested boundaries and centerline-to-boundary distance, outside the hot loop.
- `runtime/session.test.ts`: pending/accepted separation, rapid reset coalescing, failed-request ID consumption, stale data rejection, 256-entry history, transferable ownership and suspension preferences.
- `runtime/presentation.test.ts`: actual endpoint interpolation, bounded output, shortest-angle rotation, copied ownership and exact inspection/pause/headless behavior.

## Browser reproduction

Use `npm run dev -- --port 5194`, then the public `/` application. Implementation scripts and results are in `artifacts/qa/t4/implementation/`; no harness is the product. Install isolated browser tooling with `npm install --prefix artifacts/qa/t4/implementation/runner playwright`. The scripts use installed system Chrome via `channel: 'chrome'` and close their own contexts/browser in `finally`.

```sh
node artifacts/qa/t4/implementation/smoke.mjs
node artifacts/qa/t4/implementation/additional.mjs
node artifacts/qa/t4/implementation/regression-browser.mjs
node artifacts/qa/t4/implementation/perf.mjs
# In another terminal: npm run preview -- --port 4194
node artifacts/qa/t4/implementation/production.mjs
node artifacts/qa/t4/implementation/production-perf.mjs
```

Run the scripts from the repository root, with each required server already running. `regression-browser.mjs` recreates the original defects from the exact local base commit and compares the corrected runtime. `visibility.mjs` is a separate headed attempt to induce real browser hiding; its retained result is inconclusive, as explained below. The [implementation report](../artifacts/qa/t4/implementation/report.md) records measured outcomes and limitations.

Smoke uses genuine mouse input and CDP touch at 1440×900 / DPR 2, 390×844 / DPR 3, and 844×390 / DPR 3. It covers draw→learn→improve, public controls, actual inspection, presets, invalid preservation, rapid inputs, DPR-only/tiny/rotated sizes, reduced motion and visibility handling. Read `smoke-results.json` and the viewport screenshots. Synthetic visibility coverage is identified separately from a headed OS-window/tab visibility probe.

Performance uses 512 and 1,000, 1×/4×/fast, early and evolved populations; one-second warmup and five-second samples at 1440×900 / DPR 2. Run it alone: another browser/engine benchmark competes for CPU. `performance.json` and `performance-raw.json` separate rAF cadence, fresh-state share, interpolated motion, main callback cost, worker compute/step, steps/second and alive/drawn mix. Headless rAF excludes compositor/physical-device guarantees. Fast rows render no cars. “Early fast” can evolve during its warmup; start/end generations are recorded honestly.

## Development-only diagnostics

Vite DEV dynamically imports `runtime/diagnostics.ts` and installs `window.__gridborn`. It is absent from the production build (no diagnostic chunk or global).

- `read()` returns a structured clone of accepted/pending/queued candidates, desired state, drawing/hidden/error, latest displayed snapshot, last worker delivery metadata, history, best, CSS view and capped DPR. It never lends live buffers.
- `reset(partialSettings?, track?)` uses the normal transactional request path, for invalid-reset probes and fixture comparisons only. Public input tests use the actual controls/editor.
- `begin()` / `end()` collect bounded-duration QA samples on demand. Frame rows: `[rAF time, callback ms, received new snapshot, cars drawn (-1 if no draw), actual snapshot tick, presentation tick, checksum of rendered car positions]`. Delivery rows: `[arrival time, tick, steps, compute ms, alive, generation]`. No sample arrays grow unless a caller starts a measurement.

These are implementation checks. Independent Opus T4 round 1 subsequently passed the production app; see `artifacts/qa/t4/round-1/`. The feature branch now also includes independently accepted T1R closure/jitter corrections and a visible drawing guide with Escape cancellation. Fresh final Opus QA verified their combined behavior on `50c48845a1787a64b064c2ca33aa511ad2ea8e12`: PASS, no high or medium findings, 144 unit tests and 634 final browser assertions. See `artifacts/qa/final/round-1/report.md`; subsequent delivery changes are documentation/evidence only.

The built-app performance script observes Worker messages, rAF callbacks and actual hero Canvas2D translations externally; it adds no application hook. Its raw frame rows are `[rAF time, combined callback ms, received tick, car translations drawn, rendered-position checksum]`. The production performance results are the primary handoff; development samples remain separate. Real OS hiding could not be induced in the tested Chrome setup (minimize and tab switching kept `document.hidden === false`); see the retained visibility result and report rather than treating that attempt as a pass.
