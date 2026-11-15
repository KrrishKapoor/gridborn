# Gridborn T0 QA — round 1

- **Reviewer:** fresh independent QA (claude-opus-5-5, effort high). I did not build this code. No application code was edited or committed.
- **Worktree:** `/Users/krrishai/.t3/worktrees/gridborn/t3-150b05a4-79e5d2376bda99d9`
- **Branch / SHA:** `t3/scaffold-simulation-contracts` @ `a327136b0579b8fca9e5827be967a66bb3e85781`. Tracked tree was clean before and after the review.
- **Root checkout:** `/Users/krrishai/Documents/Grok/gridborn` is on `main` and clean. I did not touch it.
- **Scope:** T0 only: scaffold, shared contracts, tokens, and the disposable canvas shell. This does **not** satisfy the final full-product QA gate.

## Verdict

**PASS (T0 scope).** There are no high-severity findings: 1 medium and 7 low.

## Commands (run in the task worktree)

| Command | Exit | Result |
| --- | --- | --- |
| `npm ci` | 0 | Installed from the lockfile with 0 vulnerabilities. npm warns about the unapproved `fsevents` install script, which the README documents. |
| `npm test` | 0 | 2 files, **12/12 tests passed** (Vitest 5.1.0). |
| `npm run build` | 0 | `tsc --noEmit` is clean. Vite 8.3.8 emitted `dist/index.html` 0.59 kB, CSS 3.74 kB, JS 5.81 kB. |
| `npm run dev -- --port 5291` | — | Served the browser checks, then stopped. |
| `node qa.mjs …` (Playwright) | 0 | **75/79 checks passed.** The 4 failures are the real findings L2 (×3) and L3. |

**Environment:** Node v26.13.1, npm 11.20.0, Playwright 1.65.1 with Chromium headless shell 159.0.8154.6, installed in an isolated scratchpad.

**Browser tooling:** I followed the T3 preview tools first. `preview_status` reported `available:false`. `preview_open` succeeded, but `preview_snapshot` failed twice with `Preview automation snapshot timed out after 15000ms`. The preview tools also have no touch, DPR or visibility emulation. I closed my preview tab and switched to Playwright.

## Viewport coverage

| Viewport | DPR | Input | Checks | Screenshots |
| --- | --- | --- | --- | --- |
| Desktop 1440×900 | 2 | mouse + keyboard | 18/19 (L2) | `desktop-1440x900-{initial,full,canvas-in-view,after-drag,keyboard-focus,final}.png` |
| Portrait 390×844 | 3 | real CDP touch + keyboard | 29/30 (L2) | `portrait-390x844-*.png` |
| Landscape 844×390 | 3 | real CDP touch + keyboard | 28/30 (L2, L3) | `landscape-844x390-*.png` |

### What passed

**At every viewport:**
- No horizontal overflow.
- The backing store equals round(CSS size × min(DPR, 2)).
- The canvas has `touch-action: none`, `user-select: none` and `-webkit-touch-callout: none`, while page text stays selectable.
- Buttons are at least 44 px tall.
- On first paint the marker sits at world (600, 400); I checked the drawn accent pixel.
- **Mouse and touch drags** map to the expected `fitView` world coordinates, with the pixel drawn at the mapped spot.
- Dragging on the canvas does not scroll the page.
- Pointer capture clamps a drag that leaves the canvas to (0, 0).
- **25 rapid clicks or taps** settle on the last position.

**Keyboard:**
- Tab order is skip link → canvas → Center button.
- Home centers the marker. Arrow keys move 10 units, Shift+arrow 50, clamped at the world edge.
- Arrow keys do not scroll the page.
- The live status text is correct.
- The visible focus ring has 6.1:1 contrast.
- Enter on the Center button resets the marker.

**Resize and recovery:**
- Viewport resizes keep the world position, redraw the marker and cause no overflow.
- After a background/foreground cycle the canvas still responds.

**Touch-specific checks:**
- The events are genuine `pointerType: touch`.
- `touchcancel` fires `pointercancel` and `lostpointercapture`, and the next tap works.
- A second finger is ignored, so only the primary pointer counts.
- A long-press makes no text selection.
- A touch-scroll on the text area scrolls the page normally.

**Errors:** I observed **no console errors or warnings, page errors or failed requests from the app.** My own `getImageData` sampling triggers a `willReadFrequently` warning; I filtered it and logged it under `harnessNotes`.

### Screenshot review

- **Desktop and portrait:** clean editorial composition with good whitespace, warm paper and green accent, and an honest "Development preview" label.
- **Landscape:** the canvas starts below the fold, and most of its width is letterbox (L3).
- **All viewports:** after any pointer use the canvas shows a heavy blue focus ring (L1), and the mono readout renders in Courier (L4).

## Contract assessment

The shared contracts are **internally consistent** and sufficient for isolated T1, T2 and T3 work and for later T4 integration:

- **Network sizes:** `WEIGHT_COUNT` 90 = 9·8 + 9·2. `ACTIVATION_COUNT` is 18. Inputs are 7 rays plus speed, and the tests assert all of this.
- **Snapshot buffers:** separate full `ArrayBuffer`s, a three-slot pool, and transfer/recycle detach semantics. A structuredClone test covers the detach behaviour.
- **Run and car identity:** `CarId` is scoped to run and generation, and main filters out stale `runId` events. Reset, rate and selection semantics are clear.
- **History and best lap:** `bestLapSeconds: null` means no lap yet, never 0. `BestTrajectory` must be a measured path.
- **Geometry:** `TrackGeometry` is enough for rays and collisions without T1 internals.
- **Coordinates:** the CSS↔world rules match what the shell does.
- **Tokens:** text contrast passes, with accent 6.06:1 on paper and 6.51:1 on white, and muted text 5.70:1.

## Findings

### Medium

**M1. Ownership of the editor overlay versus hero hit-testing is unspecified.** This is a contract gap in `docs/architecture.md` (T1/T3/T4 sections) and in `GridbornPage.editorCanvas`.
- **What happens:** the editor canvas is a transparent, same-size overlay on top of the hero canvas. T1 attaches its listeners to the overlay, and T4 owns car hit-testing and inspection. Nothing says who sets `pointer-events`/`touch-action` on the overlay when drawing is disabled, or which canvas T4 listens on.
- **Impact:** a likely integration bug. Either clicks and taps on cars are swallowed by the overlay, so inspection does nothing, or drawing and selection fire at the same time.
- **Fix:** add one sentence to the contract. For example: "a disabled editor sets the overlay to `pointer-events: none`", or "T4 hit-tests on the overlay when not drawing".

### Low

- **L1. Pointer and touch input show the keyboard focus ring.**
  - **Where:** `src/scaffold/preview.ts:139` calls `canvas.focus()` in `pointerdown`.
  - **Repro:** after a click or tap the canvas matches `:focus-visible`; a control element does not (`focus-font-probe.json`, `*-after-drag.png`).
  - **Impact:** visual noise in the shell. T1/T4 should not copy the pattern.

- **L2. DPR-only changes are not detected.**
  - **Where:** `preview.ts:169-171` listens only for window resize and ResizeObserver.
  - **Repro:** changing `deviceScaleFactor` through CDP at the same CSS size leaves `canvas.width` stale (e.g. 2144 at DPR 1) until a real resize; the world position is kept.
  - **Impact:** a blurry or oversized backing store after moving the window between displays. The contract should name a detection method: a `matchMedia` resolution listener or `devicePixelContentBoxSize`.
  - **Limit:** verified only under emulation.

- **L3. In landscape 844×390 the canvas starts at y = 388.**
  - **Repro:** the canvas is below the fold of a 390 px viewport. Once scrolled into view, the world uses only about 288 of its 760 px width.
  - **Impact:** the shell is disposable, but the final hero must plan explicitly for landscape phones.

- **L4. `--font-mono` falls back to Courier in Chromium on macOS.**
  - **Where:** `src/styles/tokens.css:13`. CDP platform fonts report Courier.
  - **Impact:** the token persists into the product.
  - **Fix:** put `ui-monospace, "SF Mono", Menlo` before `Consolas`.

- **L5. A failed reset leaves `runId` ownership ambiguous.**
  - **Repro:** the worker rejects reset N+1 and keeps run N, but main now ignores run N's events, so the hero stalls.
  - **Fix:** the contract should say whether main reverts to N or the worker halts.

- **L6. A canvas of 48 CSS px or less throws an uncaught `RangeError` inside requestAnimationFrame.**
  - **Where:** `preview.ts:73/83`; the 48 px guard exists only in `place()`, not in `draw()`.
  - **Repro:** an 80 px viewport gives a 40 px canvas and a page error (`narrow-probe.json`).
  - **Impact:** the size is unrealistic, but T4 should not copy the pattern.

- **L7. The focusable, interactive canvas uses `role="img"`.**
  - **Impact:** acceptable for a throwaway check. Revisit for the editor and inspection surfaces.

### Info (not defects)

- The policy for a drawn track's width and id is not part of `TrackEditorOptions`.
- The worker protocol carries no lineage data from the genetic algorithm, so T3's genetics demo must be labelled illustrative.
- Dark mode is deferred, per `pm/decisions.md`.

## Deferred, not T0 defects

- The racing engine, physics, rays, neural net, genetic algorithm and worker (T2).
- The track editor, presets and validation (T1).
- The final article, controls and the four teaching demos (T3).
- Integration, rendering, car inspection, hidden-tab pausing, and FPS / 1,000-car performance (T4/T5).
- The final browser gate: draw a track, see cars evolve, best lap improving, inspection, FPS.

## Verification limits

- **Chromium only, no WebKit or iOS Safari.** The iOS callout and selection behaviour was not exercised; I only checked the computed CSS.
- **Emulated touch, not a physical device.** Touch input was CDP touch in emulated mobile Chromium.
- **Hidden tab:** this was a background/foreground cycle with a second page. Headless `visibilityState` stayed `visible`, so true rAF suspension was not exercised. The shell has no animation loop.
- **DPR:** changes were tested only through CDP emulation.

## Artifacts (this folder)

- **Report and results:** `report.md`, `results.json` (machine-readable), `browser-results.json` (per-check detail).
- **Logs:** `browser-run.log`, `npm-ci.log`, `npm-test.log`, `npm-build.log`, `dev-server.log`.
- **Scripts:** `qa.mjs`, `dpr-probe.mjs`, `focus-probe.mjs`, `narrow-probe.mjs`.
- **Probe output:** `focus-font-probe.json`, `narrow-probe.json`, `contrast.json`.
- **Screenshots:** 18 PNGs, 6 per viewport.

## Teardown

- Dev server on port 5291: stopped.
- Playwright browsers: all closed.
- Preview tab: closed.
- Tracked git changes: none.
