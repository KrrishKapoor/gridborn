# T1 track editor — independent QA, round 1

**Verdict: PASS.** There are no high-severity findings. One medium and four low findings are listed below.

- Reviewer: fresh independent QA, `claude-opus-5-5`, effort high. I did not implement T1.
- Reviewed: `/Users/krrishai/.t3/worktrees/gridborn/t3-12bf203f-400c3e2549c13447`, branch `t3/implement-track-editor`, HEAD `9ce4869861d8a76c77008927f49a9bcad331bdeb`. Tracked files were clean before and after review.
- Scope: T1 geometry, presets, validation and the pointer editor, exercised through `/qa/t1.html`. Engine, evolution and integration are deferred. I did not treat their absence as a defect.

## Commands

| Step | Result | Log |
| --- | --- | --- |
| `npm ci` (Node 26.13.1, npm 11.20.0) | Passed, 0 vulnerabilities | `npm-ci.log` |
| `npm test` | Passed: **51/51 tests**, 4 files | `npm-test.log` |
| `npm run build` (tsc + vite) | Passed | `npm-build.log` |
| Dev server | `npm run dev -- --port 5291` on 127.0.0.1 | `dev-server.log` |

## Browser method

- **Preview tools.** `preview_status` worked and `preview_open` opened my own background tab. `preview_snapshot` failed twice with `Preview automation snapshot timed out after 15000ms.` I closed that tab and followed the policy fallback.
- **Fallback setup.** I used isolated Playwright 1.65.1, installed by me in `round-1/runner/`, not the implementation worker's runner. It drives system Chrome 157.0.8103.51 in a separate headless instance.
- **Real input.**
  - Mouse: Playwright `page.mouse` down, move and up, producing real pointer events.
  - Touch: CDP `Input.dispatchTouchEvent`, which produces real `pointerType: touch` events including multi-touch and `touchCancel`.
- **Viewports:** 1440×900 at DPR 2, 390×844 at DPR 3 (mobile, touch), and 844×390 at DPR 3 (mobile, touch).
- **Results:** 104 browser checks; **102 passed**. Both failures are finding L1 (the noisy-stroke check at the two phone viewports). The full suite was rerun after filtering out a `willReadFrequently` console warning, which came from my own `getImageData` pixel checks, not from the app.

### Verified working, at all three viewports
- **Drawing:**
  - A loose clockwise oval drawn with the mouse commits.
  - Committed world bounds match the drawn position within tolerance, so CSS-to-world mapping is correct with no DPR multiplication.
  - The draft is visible while drawing (green, dashed closing line, start dot) and cleared after commit.
- **Touch drawing:**
  - A concave kidney loop drawn counter-clockwise with touch commits.
  - The centerline keeps counter-clockwise order, so forward direction follows the stroke.
  - Touch strokes on the canvas do not scroll the page.
- **Sparse and nearly closed strokes:** a 7-sample sparse mouse stroke smooths into a valid circuit, and a loop with a 7% gap auto-closes.
- **Rejected input:**
  - Each case is rejected with the right code: tiny → `too-short`, figure-eight → `self-intersection`, a stroke dragged past the canvas edge → `out-of-bounds`.
  - Each shows a red draft and a red actionable message ending "Current circuit kept".
  - The **last valid drawn track survives** every invalid input.
- **Clear and reset:**
  - Clear drawing after an invalid draft erases it and keeps the circuit.
  - Reset returns to Broad oval, and the select and readout agree.
  - Each preset gives the same length when selected again; the three presets differ.
- **Cancel paths:** each of these cancels the gesture with no commit when the finger or mouse is released: Clear clicked mid-stroke, `touchCancel`/`pointercancel`, Escape, window blur (synthetic hidden + blur), a viewport resize, and a page scroll (seen at 844×390). A normal stroke works afterwards.
- **Multi-touch:**
  - A second finger wandering during a stroke is ignored; the commit has the primary finger's shape.
  - With two fingers put down together, the primary path drives the stroke.
- **Mode changes:**
  - Turning Drawing off mid-stroke cancels it, and the late finger lift cannot commit.
  - Five rapid toggles mid-stroke: no commit, and `aria-pressed` matches the overlay state.
  - Reset, Clear and a preset change clicked rapidly mid-stroke: no commit, and the page ends on Broad oval.
- **Disabled overlay:** a hit-test reaches `#road`, and mouse and touch drags emit no events.
- **Orientation and DPR:**
  - Swapping 390×844 to 844×390 and back rebuilds the backing store, and touch strokes commit at the correct world position with no overflow.
  - Changing DPR from 3 to 1 mid-stroke rebuilds the backing store, and the gesture survives and commits, as the contract requires.
- **Detach and reattach:**
  - Detach mid-stroke: no commit, overlay pixels cleared, `pointer-events: none`, controls disabled, and later drags emit nothing.
  - Seven rapid detach/attach clicks, then one stroke, give exactly one commit, so listeners are not duplicated.
- **Errors and layout:**
  - No page errors and no app console errors or warnings.
  - No horizontal overflow at any viewport.
  - The overlay rect equals the road rect, backing store equals CSS size × min(DPR, 2), and the Tab focus outline is visible.

## Geometry contract for a future sensor/physics worker

`geometry-probe.mjs` and `probe2.mjs` load the real modules through Vite and check them with assertions I wrote myself.

- **Presets** (broad-oval 123 vertices, riverbend 124, club-circuit 139):
  - Deterministic down to the byte, and each call returns fresh arrays.
  - An unknown id throws `RangeError`.
  - Everything structured-clones intact.
- **Every accepted track**, presets plus about 20 drawn shapes in either winding, sparse, concave, nearly closed and widths 60 to 140:
  - All values are finite.
  - `cumulativeLengths` starts at 0, increases strictly and ends exactly at `length`.
  - **Every centerline vertex is exactly width/2 from the nearest wall** (min = max = 46.0 at width 92).
  - **Zero wall-segment crossings**, by my own predicate.
  - **No reversed or inverted inner-wall segments.**
  - Shortest wall segment ≥ 2.5 units; centerline edges about 16 units.
  - Rays cast from spawn hit the walls at exactly width/2 on both sides, with a clear path ahead.
  - Start line is width long, perpendicular to a unit `startForward`, and centred on the spawn.
  - Spawn lies within 3 to 35 units of where the stroke began.
  - Forward direction matches the drawing direction (clockwise drawings give clockwise order, counter-clockwise give counter-clockwise).
- **Input handling:** input is never mutated, and drawn output is deterministic. A 20,000-point input is rejected in under 1 ms.
- Conclusion: the geometry is well suited to ray sensors, wall collision and progress along the centerline.

## Findings (most severe first)

### M1 — Medium: overshooting the start point is rejected as "The loop crosses itself"
- **What happens:** if the user carries the stroke past the start point by about 80 world units or more, it is rejected as a self-crossing. That is about 22 CSS px at 390×844 and about 53 px at 1440×900, and it is a very common way to close a loop. Overshoots of 70 units or less are accepted.
- **Reproduce:**
  - Draw a full oval and continue about 120 world units past the start (`SHAPES.overshoot120` in `qa.mjs`). It is rejected at all three viewports. See `screens/390x844-09-probe-overshoot120.png` and `screens/1440x900-09-probe-overshoot120.png`.
  - Thresholds are in `probe2.json` (`overshoot 50–70 ok, 80+ self-intersection`, with inward or outward hand offset).
- **Impact:** a clean-looking loop is refused, with a message saying it crosses itself when the user only closed it generously. Users must learn to stop short. The last valid track is kept, so nothing is lost.
- **Cause:** only tail points within 12 units of the first point are trimmed. A longer overlapping tail creates a hairpin, which then fails the raw or smoothed intersection check.
- **Suggested fix:** before validating, trim the tail back to its closest approach to the start (or to the first crossing near the closure).

### L1 — Low: slow, jittery strokes are sometimes rejected as self-crossing
- **What happens:** the raw stroke is checked for intersections before smoothing, so tiny back-and-forth zigzags count as crossings even though smoothing would remove them.
- **Reproduce:**
  - `qa.mjs` "slow noisy stroke" (±1 CSS px jitter at about 1.5 px spacing, seeded) fails at 390×844 and 844×390 and passes at 1440×900. See `screens/390x844-07-noisy-invalid.png`: the oval looks clean but the message says it crosses itself.
  - `jitter-sweep.json` (real CDP touch, 6 trials per setting): failures are intermittent, 1 in 6 at ±1 px with 1.5 px spacing on 390×844, and 0 in 6 otherwise.
  - Pure geometry: ±3 world-unit white noise at 4-unit spacing fails 9 of 20 strokes (`probe2.json`).
- **Impact:** an occasional confusing rejection on phones when drawing slowly. How often this happens on a physical device is not verified.
- **Suggested fix:** pre-smooth lightly or ignore crossings that enclose negligible area before running the raw-crossing check.

### L2 — Low: sharp-cornered shapes are always rejected
- **What happens:** a triangle drawn at full canvas size is rejected as `too-tight` ("Widen the tight bends…"). See `screens/1440x900-09-probe-triangle.png` and `probe2.json`, where dense triangles fail at scales 1, 0.8 and 0.6.
- Squares, L-shapes, hexagons and pentagons are accepted.
- **Impact:** the message is actionable, but the brief promises "auto-smoothed". Smoothing is fixed in proportion to road width and does not adapt to corners that need more rounding.

### L3 — Low: validation message below the fold in landscape (harness only)
- **What happens:** at 844×390 on first load, the stage ends at y=361 but the feedback text ends at y=453. With the stage in view, a rejection message may be off-screen; the red draft is still visible.
- **Owner:** the final page layout belongs to T3/T4. Note for them that inline validation needs to sit near the canvas in landscape.

### L4 — Low: harness controls smaller than the touch guideline (harness only)
- **What happens:** buttons are 40 px tall (34 px at 844×390), below the 44 px guideline in `architecture.md`. This does not affect `src/track/**`.

### Informational
- Strokes with up to about 20% of the loop missing are closed with a straight chord and accepted; a 40% gap is rejected as `too-tight`. This matches the documented behaviour.
- The harness loads `./t1.ts` instead of `/qa/t1.ts` as the convention says. It resolves to the same file.
- The editor does not listen for `visibilitychange`. It relies on blur and pointercancel to end a gesture when the page is hidden.

## Not verified
- Physical iOS or Android touch. All touch evidence is Chromium CDP emulation.
- A real tab hide and resume mid-stroke. A headless tab switch left `visibilityState` as `visible`, and the stroke committed normally. Only a synthetic hidden + blur event was verified, and it cancelled correctly.
- How the engine consumes the geometry (T2/T4 do not exist yet). The contract was verified geometrically only.
- Quality of screen-reader announcements.

## Evidence (absolute paths)
Root: `/Users/krrishai/.t3/worktrees/gridborn/t3-12bf203f-400c3e2549c13447/artifacts/qa/t1/round-1/`
- `report.md` (this file), `results.json` (verdict, commands, findings, probe data)
- `qa.mjs`: reproducible browser script. With the dev server on 5291, run `node qa.mjs`. Output goes to `browser-results.json` and `browser-run.log`.
- `geometry-probe.mjs` → `geometry-probe.json`; `probe2.mjs` → `probe2.json`; `jitter-sweep.mjs` → `jitter-sweep.json`
- `screens/`: 45 PNGs, including initial, draft, drawn (mouse, touch, sparse), invalid (figure-eight, tiny, noisy), probes (overshoot, triangle), presets, rotated and final, for every viewport.
- `npm-ci.log`, `npm-test.log`, `npm-build.log`, `dev-server.log`
- `runner/`: my isolated Playwright install. It is ignored and can be deleted.
