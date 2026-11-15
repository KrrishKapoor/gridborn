# T1R implementation evidence

Implementation worker verification; **not** independent round-2 acceptance. No delegates were used.

- Branch: `t3/track-loop-jitter-cleanup`.
- Base: local `feat/v1` at `0d3dcc54e763ad7ba61b37f2a31125c9969ca006`.
- Worktree: `/Users/krrishai/.t3/worktrees/gridborn/t3-aaf85e2f-de6ced935d21bc76`.
- Scope: `src/track/**`, `qa/t1.html`, `docs/track.md`, and this new evidence directory. Shared contracts, UI, simulation, production main, PM files, and historical QA artifacts are unchanged.

## Changes and decisions

**M1:** The closest late return near the start is a closure candidate only after a full-size prefix. The discarded tail is at most 200 world units and 12% of traveled distance. It must follow the opening stroke inside an 18-unit corridor (smaller for narrow roads), with bounded backtracking. The open tail is independently checked for crossings before it can be discarded. This prevents an additional lobe inside the corridor from being mistaken for redundant closure. The completed prefix still passes the raw, smoothed, full-road, and both-wall checks. No scaling, translation, direction change, or preset regeneration was added.

**L1:** Raw crossing validation remains. Crossings spanning more than 32 units of stroke travel reject before simplification. For local crossings only, bounded Douglas–Peucker cleanup can shortcut at most 32 units of travel with at most 6 units of deviation; budgets decrease with road width. The cleaned loop is checked exactly again, followed by the unchanged smoothing/road/wall validation. This avoids the unsafe alternative of dropping raw validation or allowing a distance-only simplifier to erase long overlaps.

**L2:** Assessed and intentionally retained as a clear rejection: sharp triangle scales 1, 0.8, and 0.6 return `too-tight`, “Widen the tight bends so the road has room to turn.” No global extra smoothing or variable-width compromise was introduced. Generous squares/pentagons/hexagons and all existing presets remain accepted.

**L3/L4:** Harness feedback is immediately after the canvas and stays visible in short landscape layouts; all controls have minimum 44×44 CSS-pixel targets. The page still explicitly says “T1 · Geometry harness” and “No cars or simulation.”

**Lifecycle:** Document `visibilitychange` to `hidden` explicitly cancels an active gesture using the existing cancellation path. The abort signal removes this listener on destroy. CSS resize/scroll/view changes still cancel; DPR-only backing-store changes preserve the gesture; secondary touch and disabled-overlay routing are unchanged.

## Automated checks

- `npm ci`: passed, 0 vulnerabilities. Node 26.13.1 / npm 11.20.0. npm emitted its informational fsevents install-script approval notice; no extra install script was authorized or needed.
- `npm test`: **74/74 passed**, 5 test files. `npm-test.log`.
- `npm run build`: passed TypeScript and Vite; output `dist/`. `npm-build.log`.
- `git diff --check`: passed.
- New regression cases include both windings, 50–160-unit inward/outward/exact overshoot, translated/rotated starts, unfinished loops with early jitter, all 20 reported ±3-world-unit seeds, CSS-scale jitter and combined overshoot+jitter across six seeds, genuine and shallow crossings, repeated laps, reversing/escaping tails, a crossing wholly inside the tail corridor, collinear overlap, and unchanged preset byte fingerprints.
- Accepted regression geometry checks include full road clearance (46 units per side at width 92), centerline and both boundary intersections, bounds, winding, spawn, nonzero edges and cumulative length, repeatability, and input immutability.
- `probe2.json`: all 14 reported overshoot/offset combinations accepted; the original ±3 noise at 4-unit spacing is **0/20 rejected** (formerly 9/20). Width remains 92. Heavier noise is deliberately not universally accepted.
- `css-jitter-probe.json`: **360/360** geometry trials accepted (60 seeds × two windings × three actual harness scales), ±1 CSS pixel at 1.5px spacing.
- `geometry-probe.json`: rerun of the original independently authored geometric probe, 23 accepted cases across widths 60–140; no probe errors, wall crossings, or reversed inner-wall segments. Each road retains width/2 center-to-wall clearance.
- `preset-comparison.json`: all three complete preset objects and packed geometry arrays are identical to the baseline captured before editing. Unit tests pin packed-array fingerprints as a durable regression.

## Browser method and results

Preview policy was followed: `preview_status`, then `preview_open`. The initial blank-tab attempt using `about:blank` was rejected as an unsupported URL; opening the actual harness URL succeeded. Two consecutive snapshots then failed with `Preview automation snapshot timed out after 15000ms.` The owned preview tab was closed before fallback.

Fallback uses an isolated Playwright 1.65.1 install under `runner/`, system Chrome 157.0.8103.51, and separate browser contexts. Mouse input is native Playwright `page.mouse`; touch input is CDP `Input.dispatchTouchEvent`, producing real pointer events. Desktop is 1440×900/DPR 2; phone portrait 390×844/DPR 3; phone landscape 844×390/DPR 3. No synthetic pointer commits are used. Inspection reads the harness's QA-only object.

Final browser suites: **182/182 checks passed**, with no app console/page errors.

- `browser-results.json`: **104/104** original-suite checks, including real mouse/touch drawings, noisy strokes, invalid preservation, multi-touch, disable/clear/reset/preset changes, Escape, pointercancel, CSS resize, orientation, DPR-only preservation, detach/attach, and no overflow/errors.
- `t1r-browser-results.json`: **78/78** added checks, including 80/120/160-unit overshoot in both directions, six ±1px jitter seeds in both directions per viewport, combined overshoot+jitter, true crossings retaining identical last-valid wall arrays, visible inline errors, 44px controls, and hidden visibility cancellation without blur followed by a new successful touch stroke.
- Screenshots reviewed: `screens-t1r/` contains overshoot160, jitter, and visible crossing rejection at each requested viewport. Representative captures are committed; additional original-suite captures remain local under `screens/`.
- New physical input produces the correct direction and world bounds. All three preset objects remain identical to the pre-edit baseline.

Exploratory browser runs interrupted by source live reload or deliberate termination are excluded. Final JSON files come from uninterrupted runs against the settled source. The generic suite's headless tab-switch probe is observational, not proof of actual backgrounding; the new suite separately asserts hidden visibility cancellation **without blur**, then a successful fresh real touch gesture.

## Reproduction

From the worktree root:

```sh
npm ci
npm test
npm run build
npm run dev -- --port 5293
```

In a second terminal, install the isolated browser runner (system Chrome required), then run the checks:

```sh
npm install --prefix artifacts/qa/t1r/implementation/runner --no-package-lock --no-audit --no-fund playwright@1.65.1
node artifacts/qa/t1r/implementation/qa.mjs
node artifacts/qa/t1r/implementation/t1r-browser.mjs
node artifacts/qa/t1r/implementation/probe2.mjs
node artifacts/qa/t1r/implementation/css-jitter-probe.mjs
node artifacts/qa/t1r/implementation/geometry-probe.mjs
```

`qa.mjs`, `probe2.mjs`, and `geometry-probe.mjs` are reruns/adaptations of committed round-1 scripts, with the server/output location changed. `t1r-browser.mjs` reuses the round-1 input/inspection helpers and adds normative closure/jitter/layout/visibility assertions. These are implementation evidence, not the requested fresh Opus review.

## Limitations and teardown

- Physical iOS/Android and real OS background/foreground lifecycle are unverified. Visibility-only tests override `visibilityState` and dispatch `visibilitychange`; real pointer input still surrounds that lifecycle event.
- Long repeated laps, departing tails, high-amplitude/high-frequency noise, narrow roads, and sharp triangles may reject with actionable messages. Cleanup is intentionally bounded.
- No integrated cars/evolution, engine learnability, production rendering, or deployment is claimed. Production main remains the scaffold. Independent NEW Opus round 2 follows this commit.
- Teardown: the owned preview tab was closed; every final Playwright context/browser closed in its `finally` block; no QA runner or Playwright Chrome processes remain. The task-owned Vite server on 5293 was stopped. Dependencies, build output, and extra local captures remain ignored in this worktree for reproduction. No push, PR, merge, checkout switch, or deployment.
