# T1 track handoff

`src/track/index.ts` exports exactly `buildTrack`, `TRACK_PRESETS`, `createPreset`, and `createTrackEditor`, with the signatures in `docs/architecture.md`. There are no feature, simulation, framework, or runtime dependencies; imports are limited to shared geometry/view contracts and T1 internals. `src/main.ts` and the disposable scaffold are untouched.

## Geometry

- `buildTrack(points, { id, width })` returns the shared validation union and never mutates its input. Width is explicit in this API. Presets use 92; the editor inherits the current track's width.
- The default `broad-oval` is a broad, clockwise elliptical circuit, beginning at its top and pointing right. Its smoothed centerline is **1965.4808349609375 world units**, with **123 vertices / 246 collision walls**, at width **92**. `riverbend` adds an asymmetric sweep; `club-circuit` has broad outer turns and a concave return bend. Presets are deterministic fresh objects/arrays, and unknown IDs throw `RangeError`.
- Input is deduplicated, conservatively cleaned, closed, resampled by distance, circularly Gaussian-smoothed, and resampled to approximately 16-world-unit edges. Smoothing is proportional to road width, independent of sample timing. Sparse strokes close with a straight connection before smoothing; the last point need not exactly meet the first.
- Natural closure: search the last `min(200, 12% of open stroke length)` world units for the segment point closest to the start. The completed prefix must already cover at least `max(240, width × 6)` units. A removable tail must stay within `min(18, width × 0.2)` units of the opening stroke, progressing forward (up to 12 units of local backtracking tolerated). The discarded open tail is independently checked for nonlocal self-intersections, so a new lobe inside the corridor cannot be erased. Otherwise the whole stroke goes to validation. This handles the reported 80–160-unit oval overshoots, with inward/outward offsets, without treating early samples near the start as a completed circuit. The existing <12-unit duplicate-closure cleanup remains. No shape recognition, recentering, rescaling, or winding reversal occurs.
- Jitter: only a self-intersecting raw loop enters cleanup. First reject any crossing whose enclosed stroke travel exceeds `min(32, width × 0.4)` units, including shallow crossings between distant sections. Collinear contacts use a conservative whole-edge travel bound. For remaining local crossings, bounded Douglas–Peucker simplification allows at most `min(6, width × 0.07)` units of deviation and `min(32, width × 0.4)` units of travel per shortcut. Then run the exact crossing check again. Long retraces/overlaps cannot disappear under a distance-only shortcut. Ordinary non-crossing input retains its original smoothing path; all three preset geometry arrays remain byte-for-byte identical to accepted T1.
- The centerline is rounded to Float32 before wall construction and validation. Offset/miter walls form two complete closed boundaries, packed side by side. Cumulative distances include the implicit closing edge; `length` equals the final Float32 cumulative entry exactly. Spawn and the start line use vertex zero, with a unit forward tangent and its `atan2` heading.
- Validation covers nonfinite/malformed samples and options, tiny/degenerate traces, nonlocal raw, cleaned and smoothed self-intersections (including nonadjacent touches/collinear overlap), insufficient turn radius, each wall's self-intersections, intersections between wall loops, and road bounds outside 1200 × 800. Messages explain how to fix the stroke. Raw samples outside the world are rejected, even if smoothing could pull them inward.
- Limits of 20,000 input points / 20,000 world units of deduplicated raw perimeter, checked before tail trimming, bound pathological input. Ordinary presets have hundreds of walls, not thousands. Construction allocates once per edit; there is no per-frame geometry work.

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
- `pointercancel`, lost capture, Escape, window blur, or document `visibilitychange` to `hidden` cancel a gesture. Visibility cancellation does not rely on blur; returning to visible and releasing the old pointer cannot commit. A **CSS size, position, or world-transform change during a gesture cancels it** and emits `clear`; points are never remapped into a different world. This also handles scrolling/orientation changes. ResizeObserver, window resize/scroll, and per-event checks cover the boundary. A DPR-only backing-store change keeps the gesture and redraws at the new resolution; T4 still owns DPR detection and backing-store sizing.
- `destroy()` is idempotent: aborts listeners, disconnects observers, releases capture, clears the overlay, cancels pending animation work, restores interaction styles, and leaves pointer-events disabled. No callback is emitted; later methods are no-ops.

Draft arrays are callback-scoped and reused. Copy them if retaining them. Callbacks should remain synchronous and lightweight.

## Harness and verification

Run `npm ci`, `npm run dev -- --port 5174`, then visit `/qa/t1.html`. The harness explicitly enables drawing, renders the committed boundaries/start line, and provides presets, reset, clear, mode switching, and detach/attach controls. Its exported `harness` object is QA-only inspection. Controls have at least 44 × 44 CSS-pixel targets. Feedback sits directly after the canvas and remains visible at the viewport bottom in short landscape layouts. The production entry remains the T0 scaffold; a successful harness/build does **not** claim integrated simulation or evolutionary behavior.

Run `npm test` for geometry and editor tests, and `npm run build` for strict type checking plus the existing static `dist/` build. Vite serves the independent harness directly in development; it is intentionally not added to the production build's inputs.

T1R implementation evidence and reproducible Playwright scripts are under `artifacts/qa/t1r/implementation/`; `report.md` records results, reproduction commands, and teardown. The preview tab opened, but two snapshot calls failed with `Preview automation snapshot timed out after 15000ms.` The permitted fallback uses separate Playwright-driven Chrome instances. Checks exercise native mouse and CDP touch at 1440×900, 390×844, and 844×390: overshoot and ±1 CSS-pixel jitter in both directions; error preservation; presets; resize/cancel; DPR-only preservation; multi-touch; disabled overlay routing; detach/attach; and visibility cancellation without blur. Geometry regressions additionally check all 20 reported ±3-world-unit seeds, fixed road clearance, both wall loops, determinism, position, direction, and unchanged preset bytes.

Usability limits: closure cleanup intentionally covers only a short forward retrace near the beginning; longer repeated laps, departing tails, large crossings, and close parallel sections remain rejected. Heavier high-frequency noise can still fail the conservative raw gate. Sharp triangles at scales 1, 0.8, and 0.6 still return `too-tight` with “Widen the tight bends so the road has room to turn.” T1R retains the fixed width and existing smoothing rather than increasing global rounding and distorting other shapes. Generous squares, pentagons, hexagons, and the concave presets continue to pass.

Touch evidence uses Chromium CDP emulation, not physical iOS/Android. Visibility-only cancellation is verified by overriding `visibilityState` and dispatching `visibilitychange`; real OS background/foreground behavior is not claimed. The harness remains vertically scrollable for secondary readouts/footer in landscape. Engine learnability/performance, full-site integration, and independent Opus acceptance remain outside T1R; production main still renders the scaffold.
