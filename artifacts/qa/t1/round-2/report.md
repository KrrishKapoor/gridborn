# T1 track editor — independent QA, round 2 of 3

**Verdict: PASS.** No high or medium findings. Three low findings and four informational notes follow.

- **Reviewer:** fresh, independent QA (`claude-opus-5-5`, effort high). I did not implement T1 or T1R, and I am not the round-1 reviewer.
- **Subject:** `/Users/krrishai/.t3/worktrees/gridborn/t3-aaf85e2f-de6ced935d21bc76`, branch `t3/track-loop-jitter-cleanup`, HEAD `a4d57b38390e7b7bf2f86a07a084d889d44ae40a`. Tracked files were clean before and after review. All my output is under `artifacts/qa/t1/round-2/`, which is git-ignored.
- **Baseline:** accepted T1 at `0d3dcc5`. Its `src/track/` is identical to the round-1 reviewed SHA `9ce4869`. I extracted it with `git show` into `baseline/` for side-by-side comparison only. I made no checkout.
- **Out of scope:** the T2 engine and full product integration are not in this isolated branch. I did not treat that as a defect.

## Round-1 findings: status

| ID | Round 1 | Status now | Evidence |
| --- | --- | --- | --- |
| M1 | An 80–160 world-unit (wu) overshoot past the start is rejected as self-crossing | **Resolved** | Node: **210/210** overshoot strokes accepted and independently valid; the baseline accepted 36/210. Browser: **54/54** (18 per viewport). |
| L1 | Slow ±1 CSS px jitter at 1.5 px spacing is rejected on phones | **Substantially resolved; low residual (N1)** | Float coordinates: 72/72 in the browser. Integer coordinates: 69/72 (1 failure at 390×844, 2 at 844×390). Node sweeps: 33–40/40 per setting, against a baseline of 0–29/40. |
| L2 | Sharp triangles are rejected as `too-tight` | **Unchanged; honest, documented limitation** | Scales 1, 0.8 and 0.6 are still `too-tight`, with the actionable message "Widen the tight bends…". The same triangles with 80 wu corner radius pass. |
| L3 | Landscape feedback is below the fold | **Resolved** | At 844×390 the feedback sits directly under the stage and stays visible after a rejection (screenshots `844x390-00`, `-03`). |
| L4 | Controls are under 44 px | **Resolved** | Every `button`/`select` measures ≥ 44×44 CSS px at all three viewports. |
| Info | The editor ignores `visibilitychange` | **Resolved (simulated)** | A hidden→visible event with no blur cancels the stroke, the late release does not commit, and a fresh gesture then commits. |

## Commands

| Step | Result | Log |
| --- | --- | --- |
| `npm ci` (Node 26.13.1, npm 11.20.0) | Passed, 0 vulnerabilities | `npm-ci.log` |
| `npm test` | **74/74** passed across 5 files | `npm-test.log` |
| `npm run build` (tsc + vite) | Passed | `npm-build.log` |
| Dev server | `npm run dev -- --port 5293`; stopped afterwards | `dev-server.log` |

## Geometry evidence

`geometry-probe.mjs` loads the subject and the baseline through Vite. It checks every accepted track with my own predicates, never with builder helpers. The predicates check:

- **Boundaries:** both wall loops close, and no two wall segments cross or touch (adjacent segments excluded). The centerline does not self-intersect.
- **Clearance:** every centerline vertex is at least width/2 from every wall (always exactly 46.0); edge midpoints are within 1.5 of that.
- **Direction and orientation:** wall orientation matches the centerline, and centerline winding matches the stroke.
- **Bounds and start:** bounds are exact and inside the world; `startLine`, `startForward` and heading are consistent.
- **Fidelity to the stroke:** two-sided distance between the centerline and the stroke ≤ 45 wu, and spawn ≤ 40 wu from where the stroke began.

The run reports **0 contract failures** (`geometry-probe.json`, `geometry-probe.log`).

- **Presets:** all three are **byte-identical to baseline** (centerline, cumulative lengths, walls, length, bounds, start line, spawn). Default length is 1965.4808349609375. Each call returns fresh arrays, all three pass the independent checks, and an unknown id throws `RangeError`. Drawing with an ordinary clean oval, a small oval, a 7-point sparse stroke, or a 70–90% partial loop gives byte-identical walls to baseline (`baseline-compare.json`).
- **Overshoot (M1):**
  - Coverage: 5 positions (centred, left-small, low-right, starts at top/right/135°) × both windings × 40/80/120/160 wu × offset −15, −8, 0, +8 or +15 along the true normal.
  - All accepted and valid. The Hausdorff distance to the exactly closed loop is ≤ 12 wu, so position, size and direction are preserved.
  - An exactly coincident (collinear) retrace of 80–200 wu is accepted; 300 wu is rejected.
  - At about 200 wu, results depend on position (N2).
- **Jitter (L1):** CSS-scale noise at measured world-per-CSS-px ratios: desktop 1.52, portrait 3.64, landscape 4.30. 40 seeds per cell.
  - ±1 px at 1.5 px spacing, float coordinates: 38–40/40 in every shape, viewport and winding.
  - The same with integer-rounded coordinates: 33–40/40. The baseline managed 0–29/40.
  - Round-1's ±3 wu white noise: 20/20 (baseline 6/20). ±4 wu: 20/20; ±5: 9/20; ±6: 0/20.
  - No accepted jittery stroke failed any contract check.
- **Must reject, all correctly rejected:**
  - Crossings: figure-eights (large, small, offset, noisy) and shallow crossings between distant sections (2% and 8% pinch); a touching pinch is `too-tight`.
  - Repeated travel: two laps, two laps 10 wu apart, 1.5 laps, a 400 wu overshoot, and a 300 wu exact retrace.
  - Bad tails: a 16-wu-diameter lobe inside the closure corridor, a tail that reverses, and tails that depart outward or inward.
  - Degenerate input: tiny, dot, line, NaN, Infinity, null point, non-array.
  - Out of bounds: outside the world, by 0.5 wu, or with the road outside.
  - Limits and options: 20,001 points, perimeter over 20,000, and bad width/id/options.
- **Early closure:** a stroke that brushes within 2 or 10 wu of its start at 80%, 90% or 95% of its travel and then departs is never truncated into a loop; it is rejected. A short hook that returns to its start before 6× width and then continues is rejected. A 70% partial loop closes with a straight chord, as before (unchanged from baseline).
- **Fuzz:** 400 random harmonic loops with random overshoot, offset, zig-zags, CSS-scale jitter and quantisation. 242 were accepted, **all independently valid**; 158 were rejected.
- **Other:** input is never mutated, results are deterministic, and tracks survive `structuredClone`. Build times stay under 1 ms on ordinary and dense inputs.

## Browser evidence

**Method.**
- **Preview tools:** `preview_status` worked and `preview_open` opened my own background tab. `preview_snapshot` failed **twice** with `Preview automation snapshot timed out after 15000ms.` I closed the tab and used the policy fallback.
- **Browser:** isolated playwright-core 1.65.1 (`runner/`) driving system Chrome 157.0.8103.51 headless.
- **Input:** real `page.mouse` events at 1440×900 (DPR 2), and CDP `Input.dispatchTouchEvent` at 390×844 and 844×390 (DPR 3, mobile). That touch is **Chromium emulation, not physical iOS or Android**.
- **Visibility:** tested by overriding `document.visibilityState` and dispatching `visibilitychange`, so it is **simulated**. I also confirmed that no `blur` event fired.

**Results.** `browser.mjs` produced **202/205** checks (`browser-results.json`, `browser-run.log`). A landscape-only rerun with event logging produced 67/69 (`browser-results-844-rerun.json`). Verified at all three viewports:

- **Overshoot:** 80, 120 and 160 wu × inward/exact/outward × both windings: 18/18 committed per viewport. Each passed the independent topology and clearance checks, its winding matched the stroke, and its bbox centre stayed within 15 wu of the drawn centre.
- **Jitter:** ±1 px at 1.5 px spacing, 6 seeds × 4 shapes (two plain ovals, plus overshoot+jitter in both windings at different positions), float and integer coordinates. Desktop 48/48, portrait 47/48, landscape 46/48 (N1). Every commit was independently valid. A desktop CDP-touch overshoot+jitter stroke also commits.
- **Rejections:** 11 rejection strokes (figure-eight, noisy figure-eight, shallow crossing, two laps, 1.5 laps, 360 wu retrace, tail reversal, tail departure, tail lobe, tiny, off-canvas) all gave `invalid`.
  - The **last valid drawn track survived every one**, by id and exact length.
  - The red message and the red draft (pixel-checked) stayed visible inside the viewport.
- **Early closure:** a stroke that brushed its start and then departed was not truncated.
- **Mid-stroke actions:** none of these led to a commit on the late release: Clear drawing, Reset, a preset change, 5 rapid mode toggles (`aria-pressed` matched the overlay afterwards), rapid reset+clear+preset+reset (ending on Broad oval), Escape, CSS resize, and Detach.
- **Presets in the UI:** all three are independently valid.
- **Visibility:** hidden then visible with no blur, then the old pointer is released: no commit. A fresh gesture then commits.
- **Touch handling:**
  - A second finger is ignored and the primary finger's shape commits.
  - `touchCancel` does not commit.
  - A touch stroke does not scroll the page.
- **Rotation and DPR:**
  - After rotating to the swapped viewport, a stroke commits at the correct world position with no overflow.
  - Changing **DPR only** mid-stroke keeps the gesture: it commits and the backing store is rebuilt.
- **Detach:**
  - The overlay is cleared, `pointer-events` is `none`, the controls are disabled, and drags emit nothing.
  - After 7 rapid detach/attach clicks, one stroke gives exactly one commit at 1440×900 and 390×844.
  - At 844×390 this check failed in both runs, explained below.
- **Errors and layout:** no page errors and no horizontal overflow. The only console entry is Chrome's `willReadFrequently` hint, caused by my own `getImageData` pixel checks.

**The 844×390 detach/attach failure is a test-sequencing artifact.**
- **What happened:** in both runs, two scroll events fired during the stroke (scrollY 78→77), so the editor cancelled it. The contract says a scroll during a gesture cancels it.
- **Repro attempts:**
  - Isolated runs (`detach-repro.json`, `detach-repro2.json`, `detach-repro3.json`) commit normally.
  - A sweep of 44 strokes over every landscape and portrait scroll offset (`scroll-sweep.json`) produced 0 cancellations.
- **Conclusion:** the cause is touch momentum left over from my preceding drag on the *detached* overlay. That drag legitimately pans the page, because the overlay is inert while detached. See I2.

## Findings (most severe first)

### N1 — Low: residual jitter rejections at coarse phone scales with integer coordinates
- **What happens:** with ±1 CSS px noise at 1.5 px spacing and integer-rounded coordinates, 1 of 24 strokes is rejected at 390×844 and 2 of 24 at 844×390. Float coordinates gave 24/24. Node sweeps of the same setting at landscape scale accept 33–37 of 40 (baseline 15–17). With denser or larger noise it gets worse: 1 px spacing, or ±1.5 px, gives 0–39 of 40, mostly at landscape scale.
- **Diagnosis** (`stage-debug.json`, `stage-debug2.mjs`):
  - **Fixed world-unit tolerances:** the cleanup limits (6 wu deviation, 32 wu travel) are fixed in world units. Landscape has 4.3 wu per CSS px, so ±1 px of noise is about ±4.3 wu, close to the 6 wu deviation limit.
  - **Travel inflated by noise:** jitter inflates raw stroke travel by up to about 1.5×. Crossings near the closure seam that are geometrically local (≤ 20 wu apart) can then exceed the 32 wu travel limit and are rejected as nonlocal.
- **Impact:** an occasional "The loop crosses itself" on a clean-looking loop drawn slowly on a phone. That is much rarer than in round 1. The last valid track is kept. Physical-device frequency is not verified.
- **Suggestion (optional):** measure the travel limits on a lightly resampled or decimated path, or scale the tolerances by CSS-px size. Do not loosen the nonlocal-crossing gate.

### L2 — Low: sharp triangles are rejected as `too-tight` (unchanged, documented)
- Scales 1, 0.8 and 0.6, with sharp corners or a 40 wu corner radius, are rejected; an 80 wu corner radius passes. The baseline behaves identically.
- The message is actionable, and `docs/track.md` records this under "Usability limits". It is honest and acceptable for T1. A product decision on adaptive corner rounding can wait for integrated QA.

### N2 — Low: overshoot beyond about 200 wu is still rejected as "crosses itself"
- **What happens:** an overshoot of about 200 wu is accepted at some starting positions and rejected at others. At 300–400 wu it is always rejected.
- **Scale:** 200 wu is about 55 CSS px on a phone and about 130 px on desktop.
- **Assessment:** this is the intended, documented bound (`min(200, 12%)`), and it protects the repeated-lap rejection. The message does not tell the user to stop at the start.

### Informational
- **I1:** a tiny pigtail loop of radius ≤ 5 wu (about 1.4 phone px), in the body or in the tail, is simplified away and the track is valid. Radius ≥ 6 is rejected. This is safe, since the final track always passes full validation.
- **I2:** a page scroll still in motion when a stroke starts cancels that stroke and emits `clear`. This follows the documented contract. T4 should keep the editor stage from scrolling during interaction on real pages.
- **I3:** `startLine` joins the miter points `left[0]` and `right[0]`, so it can be up to about 1–2% longer than `width`. This is pre-existing and byte-identical in the presets (for example club-circuit at 92.098). The round-1 statement "start line is width long" was approximate.
- **I4:** the new `cleanup.test.ts` `contract()` uses the implementation's own `loopIntersects` and `segmentsIntersect` as its oracle. My independent predicates found no disagreement.

## Safety and diff review

- **Diff scope** (`git diff 0d3dcc5..HEAD`):
  - production code: `src/track/cleanup.ts` (+78), `geometry.ts` (+58/−8), `editor.ts` (+3)
  - tests: `src/track/cleanup.test.ts` (+208), `editor.test.ts` (+9)
  - harness: `qa/t1.html` (+11/−10)
  - docs: `docs/track.md`
  - The public API is unchanged and no shared contracts are touched. The code is simple and small, with no new abstractions or dependencies.
- **Safety:** cleanup runs only on strokes whose raw loop self-intersects, so clean strokes and presets are byte-identical to baseline. Any crossing that spans more than 32 wu of travel is rejected *before* simplification. The exact crossing check runs again after simplification. The centerline and both walls are always fully validated afterwards.
- The discarded closure tail must stay within the 18 wu corridor, move forward along the stroke, and contain no nonlocal self-crossing. Adversarial tails (a lobe, a reversal, a departure, a second lap) are all rejected. Fuzzing found no accepted invalid track.
- No new regression was found.

## Not verified
- Physical iOS and Android touch: all touch here is CDP emulation.
- Real OS background and foreground: the visibility test is simulated.
- Screen-reader output.
- Engine use of the geometry and full integration: these are not on this branch. **Final integrated QA is still required.**

## Evidence (absolute paths)
Root: `/Users/krrishai/.t3/worktrees/gridborn/t3-aaf85e2f-de6ced935d21bc76/artifacts/qa/t1/round-2/`
- `report.md` (this file), `results.json`
- **Geometry:** `geometry-probe.mjs` → `geometry-probe.json` / `.log`; `lib.mjs` (shared predicates and generators); `baseline-compare.mjs` → `.json`; `stage-debug.mjs` → `.json`; `stage-debug2.mjs`; `baseline/src/**` (accepted-T1 sources, extracted read-only)
- **Browser:** `browser.mjs` → `browser-results.json`, `browser-run.log`; `browser-results-844-rerun.json`, `browser-run-844-rerun.log`; `detach-repro.mjs` → `.json`; `detach-repro2.mjs` → `.json`; `detach-repro3.mjs` → `.json`; `scroll-sweep.mjs` → `.json`
- `screens/`: 33 PNGs, 11 per viewport — `{1440x900,390x844,844x390}-00-initial`, `-01-overshoot160-cw-outward`, `-01-overshoot120-ccw-inward`, `-02-jitter-overshoot-ok`, `-02-jitter-ccw-ok`, `-03-rejected-figure-eight`, `-03-rejected-shallow-crossing`, `-03-rejected-tail-reversal`, `-04-rotated`, `-05-final-overshoot150-jitter`, `-05-final-rejected-crossing`. I inspected representative screenshots: the overshoot and jitter loops are clean ovals with the start line at the stroke start, the rejected crossings show the red draft with a visible red message, and landscape feedback is visible.
- Logs: `npm-ci.log`, `npm-test.log`, `npm-build.log`, `dev-server.log`, `runner-install.log`
- To reproduce, from the repo root: `node artifacts/qa/t1/round-2/geometry-probe.mjs`. For the browser checks, start `npm run dev -- --port 5293`, then run `node artifacts/qa/t1/round-2/browser.mjs`; `VP=844x390` limits it to one viewport.

## Teardown
- The dev server on 5293 is stopped and the port is free.
- All Playwright browsers and contexts are closed. One orphaned headless Chrome left by my scroll sweep was found and killed.
- My preview tab is closed.
- There were no commits, branch changes, pushes or merges, and the tracked tree is clean at `a4d57b3`.
- `runner/` (ignored) can be deleted.
