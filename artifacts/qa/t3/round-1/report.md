# T3 independent QA — round 1

**Verdict: PASS (conditional).** I found no high-severity defects. Three medium issues must be fixed or explicitly assigned to T4 before final whole-product QA. Seven low issues are listed below.

- Reviewer: fresh independent QA (Claude Opus 5.5, effort high). I did not build this code and used no delegates.
- Worktree: `/Users/krrishai/.t3/worktrees/gridborn/t3-adadbb65-081373c4c81d91a5`
- Branch `t3/editorial-page-demos`, HEAD `763681cb2de55edb97ffc2392b117004ea78a60e`. Tracked files were clean before and after the review. I made no application, config or PM changes and no commits.
- Root checkout `/Users/krrishai/Documents/Grok/gridborn` is still on `main` and clean.
- Scope: `src/ui/**`, `src/styles/**`, and `qa/t3.{html,ts}`.
  - I tested the harness at `/qa/t3.html`. Its circuit and selection fixtures are illustrative.
  - The real engine, editor, cars, FPS and lap improvement belong to T4, so none of this is evidence for them.

## Commands and outcomes

| Step | Result |
| --- | --- |
| `node -v` / `npm -v` | v26.13.1 / 11.20.0 |
| `npm ci` | OK, 0 vulnerabilities. One npm warning about fsevents install scripts. |
| `npm test` | **12 / 12 passed** (2 files, Vitest 5.1.0) |
| `npm run build` | **OK**. `tsc --noEmit` is clean. `dist/` holds only the T0 scaffold (index.html plus 1 JS and 1 CSS file). The T3 page and `qa/` are not in the production build, which is expected because T4 owns `main.ts`. |
| Browser | `qa.mjs` uses an isolated `playwright-core` installed in the session scratchpad and drives system Google Chrome 157.0.8103.51 headless. Dev server: `npm run dev -- --port 5197`, started and stopped by me. |
| Playwright checks | **171 pass / 13 fail** across 4 contexts. Every failure is listed below; there are no unexplained failures. |
| Console / page errors / failed requests | **0 / 0 / 0** in every context |

Browser policy:
- `preview_status` reported no tab. I opened my own preview tab, confirmed the harness mounts (4 diagrams, mono font token resolved), then closed that tab.
- I switched to Playwright because the preview tools cannot emulate a touch device (`isMobile` / `hasTouch`, CDP touch events), cannot set the reduced-motion media feature, and cannot capture console output from page load at fixed viewports.
- Mobile runs are Chrome emulation, not physical iOS or Safari.

Earlier runs had false negatives caused by my script, not the app. The page sets `html { scroll-behavior: smooth }`, so my `scrollIntoView` calls were still animating when I read the diagrams, which correctly defer drawing while offscreen. I fixed the script to use `behavior: 'instant'` and re-ran. The numbers above come from the final run.

## Findings (most severe first)

### Medium

**M1. The inspection panel opens below the fold, and nothing in the hero says it opened.**
- Repro: at the top of the page, select a car (harness "Inspect fixture", or `t3Harness.setState({selected})`), then measure `.inspection-panel`.
- Panel top:
  - Desktop 1440×900: 905 px
  - Portrait 390×844: 882 px
  - Landscape 844×390: 461 px
- The harness banner adds 27–41 px. Without it, the heading still falls at or below the fold at every size.
- The stage hint still reads "Pick a car to look inside its brain."
- Impact: the brief's core step ("click a car to see its sensor rays and network") gives no visible response at the moment of selection.
- Fix: either give the inspector space in or next to the hero, or show an in-hero cue/link and document that T4 must scroll the panel into view on selection.
- Note: the global `scroll-behavior: smooth` will animate any T4 `scrollIntoView`, except under reduced motion.
- Evidence: `*-hero-selected.png`, and `inspectionPlacement` in results.json.

**M2. Closing the inspection drops keyboard focus to `<body>`.**
- Repro: focus "Close inspection" and press Enter. `onSelectionClear` fires, the update hides the panel, and `document.activeElement === document.body`. This happens at all three sizes.
- Impact: keyboard and screen-reader users lose their place (WCAG 2.4.3).
- The contract says the page never *moves* focus during an update. Hiding the focused element has the same effect.
- Fix: before hiding the panel, move focus to a stable target if focus was inside it, for example the hero canvas, which is focusable and labeled. Consider Escape to close.

**M3. Diagram and caption text is too small, especially in landscape.**
- Measured rendered text sizes, with SVG text scaled by its viewBox:
  - Landscape 844×390: SENSE/COMBINE/ACT at **7.2 px**; ray labels, Steer/Throttle, A/B/Child, "Select → combine → vary" and the empty-state subline at **8.6 px**. The ≤1000 px rules shrink the SVG without increasing SVG font sizes, unlike the ≤600 px rule.
  - Portrait 390×844: about 22 HTML text nodes at **9 px** (captions, "Follow selected car", eyebrow, divider, run label) and SVG labels at 9.8 px.
  - Desktop: 9 px for the sensor-reading indices, "No history yet" and FIELD / 01.
- Impact: this fails the "readable diagrams" bar on phones. Contrast passes (5.7:1), but size hurts legibility.
- Fix: set a floor of about 11 px for captions and labels, and add SVG text bumps for the 601–1000 px and short-height ranges.

### Low

- **L1. Landscape 844×390 pushes hero telemetry just below the fold.**
  - The hero canvas bottom is at 393 px (99% visible). The fitness sparkline (393–421), stage hint (393–423) and track feedback (423–461) all start below the 390 px viewport.
  - The control rail leaves 79 px empty below "Reset learning", room the sparkline could use.
  - Without the 27 px harness banner, the sparkline would sit at about 366–394, so it is still partly cut.
- **L2. Stage-corner contrast.** "FIELD / 01" is 9 px `#69765e` on `#f0f2ea`, giving **4.27:1** (below 4.5). It is `aria-hidden` and decorative, so the impact is small.
- **L3. Two labels lose content after updates.**
  - After the first Draw→Stop toggle, the drawing button's text is replaced with plain `Draw a circuit ↗`, so the `aria-hidden` arrow span is gone and screen readers announce the arrow.
  - The best-lap `<small>no lap yet</small>` disappears on the first `update`, leaving a bare "—". The `aria-label` is still correct.
- **L4. The racing-line path has no track context.**
  - The path is fitted to its own bounds and drawn alone. This is honest, since only supplied samples are drawn, but a viewer cannot see the line *relative to the track*, which is the point of "why the racing line emerges".
  - The `TeachingDemo.update` contract supplies no track geometry, so this is a contract-level gap. Consider adding track geometry or a shared world transform in T4.
  - Related: the sensor live mode is a normalized fan with no walls (disclosed in its note).
- **L5. Pending and accepted feedback is minimal.**
  - With 300 ms acknowledgement, the population select snaps back to the accepted value with no pending indicator.
  - The preset picker never shows which circuit is current (the contract has no accepted preset id).
  - Both behave as documented, but the UX feels unresponsive.
- **L6. The network "Steering weight" slider changes `weights[74]` (hidden neuron 3 → steer) without highlighting that edge.** Users cannot see which connection they are changing. The math is correct (independently recomputed).
- **L7. An unchecked "Follow selected car" stays unchecked across selection changes.** A later selection then shows the illustration. This is defensible, but worth a decision.

## What passed (independently verified)

- **Layout:**
  - No horizontal overflow and no clipped control or heading text at any size or after rotating.
  - All visible buttons, selects, links, sliders and follow labels are at least 44×44.
  - The h1 and Play control are in the first viewport at all sizes.
  - The hero canvas is fully visible on desktop and portrait, and 99% visible in landscape.
  - The editorial composition reads as a clean article (rules, mono indices, asymmetric lesson grid), not card soup.
- **Fonts:** the mono token resolves to `ui-monospace, "SF Mono", Menlo…` for indices and telemetry.
- **Contrast:** all sampled text is at least 4.5:1 except L2. Body and muted text measure 5.7:1, green asides 6.06:1, the pressed rate button 5.5:1.
- **Semantics:** one h1, one main, all controls labeled, polite and atomic live feedback, Tab order with a solid 2 px focus ring.
- **Touch and selection scoping:**
  - `touch-action:none` and `user-select:none` apply only to the hero/editor canvases and the draggable sensor SVG.
  - The network SVG and article text keep `auto`.
  - A touch scroll gesture over article text and over the network diagram scrolls the page (in portrait and landscape).
  - Mouse-drag text selection works on desktop.
- **Controls:**
  - Play/Pause, 1×/4×/Fast, population 1000, preset (the picker returns to "Load preset"), Draw/Stop, Clear, Reset and Close all emit the correct intents.
  - The UI changes only after the authoritative update.
  - Four rapid Play clicks before a delayed acknowledgement emit four identical `true` intents.
  - The population select restores the accepted value while a change is pending, then shows the acknowledged value.
  - Rapid rate clicks settle to the last acknowledged value.
  - Focus stays on Play, the rate buttons, the population select and the Draw button across updates.
  - `inspectionRoot` and its child are the same nodes before and after updates and after closing.
- **Canvases:**
  - Hero and editor CSS boxes are identical, including after resize.
  - The editor overlay keeps `pointer-events:none` even while `drawing=true` (T1 owns enabling it).
  - `elementFromPoint` at the hero center returns the hero canvas, and hero clicks are delivered.
- **Sensors:**
  - Mouse drag and touch drag move the car and change the readings, and the page does not scroll during the drag.
  - `touchcancel` ends the gesture, with no movement on stray moves afterwards.
  - The keyboard sliders move and rotate the car.
  - Illustrative ray–wall geometry is correct: side rays hit x=178 and x=478, reading 0.68.
  - In live mode, the 7 readings and ray lengths exactly match the supplied normalized distances, the walls are hidden, and the illustration controls are disabled.
- **Network:**
  - In live mode, all 80 edges and 18 nodes exactly match the supplied 90 weights and 18 activations under destination-major indexing (zero mismatches).
  - Steer shows the raw output; throttle shows `(o+1)/2`.
  - The illustration's forward pass matches my own recomputation after slider changes.
- **Genetics:**
  - The crossover split and child inheritance are correct (AAAAAABBBBBB, then AAABBBBBBBBB).
  - Changing a parent affects only the matching side of the child.
  - Mutation caps at 12 and the button disables; 3 mutations give exactly 3 ochre child genes and the parents are untouched; reset restores everything.
  - It is labeled "Illustration · 12 weights, no actual lineage".
- **Racing line:**
  - The empty state is honest.
  - A stale-run best is ignored.
  - A partial attempt is labeled partial, a full lap shows the supplied time, and exactly the supplied N samples are drawn.
  - "Explore a corner" is labeled as illustrative geometry and keeps the actual history; rapid toggling ends in a consistent state.
- **Sparkline:** empty shows nothing; 1 entry shows a single dot; N entries give N points, and the peak follows the data; with 256 entries and 300 total it shows "300 gen". No invented data.
- **Buffer ownership:**
  - I detached (transferred) and mutated every borrowed snapshot buffer, the history entries and the best samples immediately after `update`, before any deferred draw.
  - Later redraws (on scroll into view, `setVisible(true)`, and document visibility restore) rendered the owned copies exactly.
- **Stale data:** stale generation, stale run, out-of-range index and a null snapshot all fall back to the illustration.
- **Lifecycle:**
  - No `requestAnimationFrame` calls during 1 s of idle.
  - `setVisible(false)` suppresses painting.
  - Simulated `document.hidden` requests no frames, then repaints the latest data on restore.
  - Offscreen demos request no frames on update.
  - Under reduced motion, `scroll-behavior` is `auto`, the diagrams still render, and there are no idle frames.
  - `destroy()` removes the page, stops frames, and makes post-destroy calls safe.
  - Three mount/update/emit/destroy cycles left no leftover nodes and kept ids unique.

## Limits

- The harness only illustrates; it has no engine, editor or cars. FPS, actual evolution, lap improvement and real car hit-testing and inspection are T4's to prove.
- Document visibility was simulated by overriding `document.hidden` and dispatching `visibilitychange`, not by actually backgrounding the tab.
- Touch came from CDP `Input.dispatchTouchEvent` and `synthesizeScrollGesture` in emulated Chrome, not physical iOS or Safari (no iOS callout or selection check on a device).
- Dark mode was not in scope; the page is light only.
- Contrast was sampled on one element per class, not every element.

## Artifacts (all under `/Users/krrishai/.t3/worktrees/gridborn/t3-adadbb65-081373c4c81d91a5/artifacts/qa/t3/round-1/`)

- `report.md`, `results.json` (every check with details), `browser.log`, `qa.mjs` (the browser script), `probe.mjs` + `probe-results.json` (layout probe for L1/L3), `dev-server.log`
- Screenshots for each viewport `{desktop-1440x900, portrait-390x844, landscape-844x390}`:
  - Default state: `-hero`, `-sensors`, `-network`, `-genetics`, `-racing-line`, `-full`
  - Fixture states: `-hero-selected`, `-sensors-live`, `-network-live`, `-racing-line-lap`, `-racing-line-corner`, `-keyboard-focus`

## Teardown

- Closed my preview tab.
- Closed every Playwright browser and context (the script closes the browser in `finally`).
- Stopped my dev server on port 5197; the port is free (exit 143 = my SIGTERM).
- One remaining headless Chrome (PID 6044) belongs to another session's `node jitter-sweep.mjs` (started 06:05, before my runs). I left it alone.
- The worktree's tracked files are clean at `763681c`.
- The root checkout is on `main` and clean.
- Final whole-product QA is still required after T4 integration.
