# Presentation handoff (T3)

`mountPage(root, options)` in `src/ui/page.ts` imports the token and page styles, appends its own page, and returns the exact `GridbornPage` contract. It does not import the track editor, engine, renderer, scaffold, or main entry point. All four documented demo entry points are independently mountable.

## Connecting T4

- Supply the accepted settings and preset metadata through `PageOptions`. Feed accepted `PageState` through `update`. Null lap/history values stay empty; the sparkline uses only supplied completed generations, with green best fitness and gray mean fitness. A single generation is a point.
- Every control emits intent. Play and drawing toggles derive their intent from the latest accepted state, so repeated clicks before an acknowledgement repeat the same request. Rate buttons send explicit values. The population select restores its accepted value while reset is pending. A synchronous owner update is also supported.
- The preset selector is an action picker and returns to “Load preset” after an intent. The contract has no accepted preset id, so the UI does not claim that a requested preset has been accepted. Keep the old accepted run until `ready`, as required by the shared protocol.
- `heroCanvas` and `editorCanvas` always have identical CSS boxes, with no border or padding. T4 owns both backing stores, fit transforms, DPR detection, and rendering. The editor overlay initially has `pointer-events: none`; only T1's `setEnabled` changes input routing. Page state updates deliberately do not overwrite this style. “Stop drawing” sends disable intent; it does not imply a commit.
- T4 owns car hit testing on the hero canvas and accessible keyboard inspection behavior. The page supplies focus styling and a canvas description. The inspection shell shows the selected car number/generation and hides when selection clears. `inspectionRoot` and its children remain stable across updates, including closing. Populate it with the actual inspector; the page's close control calls `onSelectionClear`. The page never moves keyboard focus during a state update.
- `showTrackIssues(issues)` presents plain-text, polite, atomic live feedback. `showTrackIssues([])` clears it. Owner code should clear old validation feedback when a new valid circuit is accepted.

## Diagram data and lifecycle

Call each `page.demos[i].update(snapshot, history, best)` before recycling snapshot buffers. Sensor distances, weights, and activations are copied synchronously into owned typed arrays. Racing-line history is copied into bounded records; recorded path samples are copied when the best record changes. No snapshot or incoming history array is retained for deferred drawing.

1. **Sensors:** A draggable, keyboard-adjustable illustrative corridor computes ray/segment intersections locally. With a valid selected car, a normalized ray fan displays its actual distances; illustrative walls are removed. Uncheck “Follow selected car” to return to the example. This normalized fan does not claim to show the live track geometry.
2. **Network:** The example performs an explicit 8 → 8 → 2 tanh calculation with fixed illustrative weights and adjustable front input/steering weight. Selected mode displays the supplied 90 weights and 18 activations directly. Green connections are positive, dashed gray connections negative; node intensity represents activation magnitude. Throttle uses `(output + 1) / 2`.
3. **Genetics:** User-selected example parents, a crossover point, and small deterministic mutations illustrate 12 weights. It is always labeled illustrative and never implies actual lineage. Its `update` intentionally has no effect.
4. **Racing line:** The default view is empty until an actual best attempt is supplied. Partial attempts and complete timed laps have distinct labels; stale-run records are ignored. Only supplied samples are drawn. An explicit corner-exploration mode is labeled illustrative and makes no lap-time claim. Its history remains the supplied actual history even while exploring the example.

Each diagram uses one coalesced animation-frame request only when invalidated, visible, and the document is visible. There is no continuous animation or timer. An internal IntersectionObserver prevents offscreen rendering, and T4's `setVisible(false)` independently suspends it. Deferred data remains in owned storage. `setVisible(true)` paints pending changes only when intersecting. Reduced-motion users receive the same event-driven diagrams and no smooth anchor scrolling.

`destroy()` disconnects observers, cancels frames and active sensor pointer capture, aborts listeners, and removes only the mounted elements. T4 should destroy its renderer/editor/inspector and terminate its worker separately.

## Harness and verification scope

Run `npm ci`, then `npm run dev -- --port 5193`, and open `/qa/t3.html`. The harness supplies three illustrative circuit choices and authoritative UI state callbacks. It can delay acknowledgement by 300 ms, inject invalid-track feedback, and show a clearly labeled selection fixture. The canvas is a static illustrative circuit, with no cars, evolving counters, lap times, or fabricated history. It is not a track-editor or engine test.

The default production `npm run build` still builds T0's scaffold because T3 does not own `src/main.ts`. Typechecking covers the new page and harness. T4 must import the page and remove the scaffold for production integration.

Implementation browser evidence and repeatable scripts are under `artifacts/qa/t3/implementation/` (ignored, not committed). Browser checks use a fresh local Chrome context through Playwright after two preview snapshot timeouts. Independent task QA and full integrated racing/performance QA remain separate acceptance steps.
