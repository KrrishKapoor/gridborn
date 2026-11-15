# T1 track handoff

`src/track/index.ts` exports exactly `buildTrack`, `TRACK_PRESETS`, `createPreset`, and `createTrackEditor`, with the signatures in `docs/architecture.md`. There are no feature, simulation, framework, or runtime dependencies; imports are limited to shared geometry/view contracts and T1 internals. `src/main.ts` and the disposable scaffold are untouched.

## Geometry

- `buildTrack(points, { id, width })` returns the shared validation union and never mutates its input. Width is explicit in this API. Presets use 92; the editor inherits the current track's width.
- The default `broad-oval` is a broad, clockwise elliptical circuit, beginning at its top and pointing right. Its smoothed centerline is **1965.4808349609375 world units**, with **123 vertices / 246 collision walls**, at width **92**. `riverbend` adds an asymmetric sweep; `club-circuit` has broad outer turns and a concave return bend. Presets are deterministic fresh objects/arrays, and unknown IDs throw `RangeError`.
- Input is deduplicated, closed, resampled by distance, circularly Gaussian-smoothed, and resampled to approximately 16-world-unit edges. Smoothing is proportional to road width, independent of sample timing. It rounds off hand jitter and generous square corners. A closing tail within 12 world units of the first point is trimmed. Sparse strokes close with a straight connection before smoothing; the last point need not exactly meet the first.
- The centerline is rounded to Float32 before wall construction and validation. Offset/miter walls form two complete closed boundaries, packed side by side. Cumulative distances include the implicit closing edge; `length` equals the final Float32 cumulative entry exactly. Spawn and the start line use vertex zero, with a unit forward tangent and its `atan2` heading.
- Validation covers nonfinite/malformed samples and options, tiny/degenerate traces, raw and smoothed self-intersections (including nonadjacent touches/collinear overlap), insufficient turn radius, each wall's self-intersections, intersections between wall loops, and road bounds outside 1200 × 800. Messages explain how to fix the stroke. Raw samples outside the world are rejected, even if smoothing could pull them inward.
- Limits of 20,000 input points / 20,000 world units of raw perimeter bound pathological input. Ordinary presets have hundreds of walls, not thousands. Construction allocates once per edit; there is no per-frame geometry work.

## Editor integration

```ts
const editor = createTrackEditor({
  canvas: editorCanvas,
  initialTrack: createPreset(TRACK_PRESETS[0]!.id),
  getView: () => currentView,
  onChange(change) {
    // Only `commit` carries a replacement track. T4 owns renderer/worker reset.
  },
});
editor.setEnabled(true); // Starts disabled, with pointer-events: none.
```

T4 sizes both canvas backing stores and keeps `getView()` current. The transparent editor has no CSS border, padding, or rotation. Pointer coordinates subtract the canvas CSS rect and use the shared world transform; they are never multiplied by DPR. The editor draws only the draft, with a dashed closing connection and a visible starting point. The existing circuit remains underneath. Invalid drafts remain visible in red until the next stroke, clear, disable, or preset action.

The editor owns inline `pointer-events` toggling, touch-action, selection/callout suppression, primary pointer capture, and its listeners/observers. Mouse, touch, and pen use the same pointer path; secondary pointers and non-primary buttons are ignored. Coalesced input is consumed when available. It schedules a draft redraw only when needed.

- `commit`: sole geometry replacement; clears the draft and retains the validated track internally. IDs are deterministic editor-local `drawn-N` labels, not globally unique run identifiers; T4 must keep using monotonic `runId` for simulation resets.
- `invalid`: retains the current valid track. The host displays the supplied issues without resetting simulation.
- `clear()`: cancels capture, clears the draft, emits `clear`, and retains the circuit. Label this “Clear drawing.”
- `setTrack(track)`: silently retains the supplied valid track and clears/cancels any draft; emits no callback or recursive commit. Use for presets/reset and restoring a previously accepted track after an integration error.
- `setEnabled(false)`: disables overlay pointer events and cancels an existing draft, emitting `clear` only if there was one. An old pointerup cannot commit after re-enabling.
- `pointercancel`, lost capture, Escape, or window blur cancel a gesture. A **CSS size, position, or world-transform change during a gesture cancels it** and emits `clear`; points are never remapped into a different world. This also handles scrolling/orientation changes. ResizeObserver, window resize/scroll, and per-event checks cover the boundary. A DPR-only backing-store change keeps the gesture and redraws at the new resolution; T4 still owns DPR detection and backing-store sizing.
- `destroy()` is idempotent: aborts listeners, disconnects observers, releases capture, clears the overlay, cancels pending animation work, restores interaction styles, and leaves pointer-events disabled. No callback is emitted; later methods are no-ops.

Draft arrays are callback-scoped and reused. Copy them if retaining them. Callbacks should remain synchronous and lightweight.

## Harness and verification

Run `npm ci`, `npm run dev -- --port 5174`, then visit `/qa/t1.html`. The harness explicitly enables drawing, renders the committed boundaries/start line, and provides presets, reset, clear, mode switching, and detach/attach controls. Its exported `harness` object is QA-only inspection. The production entry remains the T0 scaffold; a successful harness/build does **not** claim integrated simulation or evolutionary behavior.

Run `npm test` for geometry and editor tests, and `npm run build` for strict type checking plus the existing static `dist/` build. Vite serves the independent harness directly in development; it is intentionally not added to the production build's inputs.

Implementation browser evidence and the reproducible Playwright script are under `artifacts/qa/t1/implementation/` (ignored, not committed). The preview tab opened, but two snapshot calls timed out with `Preview automation snapshot timed out after 15000ms.` The permitted Playwright fallback uses a separate Chrome instance. Checks cover native mouse/touch at 1440×900, 390×844, and 844×390, including loose ovals, a concave circuit, invalid-input preservation, presets/reset/clear, pointer routing, rapid mode changes, resize, native touch cancellation, destroy/recreate, DPR changes, and console errors. Screenshots are full-page captures at those viewport sizes.

Usability tradeoffs: smoothing intentionally softens sharp features; close parallel sections may be rejected because a 92-unit road will not fit. On a narrow display, turning the phone sideways makes large loops easier, although the portrait harness accepts touch loops. The landscape harness can scroll vertically to feedback/footer. Touch evidence is Chromium emulation, not physical iOS verification. Engine learnability/performance, full-site integration, and independent Opus acceptance remain outside T1.
