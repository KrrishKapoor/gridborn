# Gridborn T4 — independent production-integration QA, round 1

**Verdict: PASS.** There are no high findings, and the core brief is verified on the production build at all three viewports. There is **1 medium** finding (M1, drawable area) and **6 low** findings.

- **Reviewer:** fresh independent QA, `claude-opus-5-5`, effort high. I did not build this code, used no delegates, and did not use the builder's scripts or runner. My own scripts and runner are under `scripts/` and `runner/`.
- **Subject:** `/Users/krrishai/.t3/worktrees/gridborn/t3-3c108d66-4ceed1d07eb1b5d3`, branch `t3/production-runtime-integration`, HEAD `b1751e73ffb5d9850c6a129eb7d6651e0e8d2d5f`.
  - Tracked files were clean before and after the review. I wrote only under ignored `artifacts/qa/t4/round-1/`.
  - One harness step ran `touch src/runtime/presentation.ts` (mtime only, to provoke a Vite reload). The content is unchanged and `git status` stays clean.
- **T1R** (stroke closure and jitter correction) is intentionally absent from this branch. The T1 round-1 overshoot finding (M1) and jitter finding (L1) are **preserved as pending the T1R merge** and are not counted as new T4 failures. I did not import any T1R work.

## Commands

| Step | Outcome | Log |
| --- | --- | --- |
| `git rev-parse HEAD` / `git status --porcelain` | `b1751e7…`, clean | — |
| `npm ci` (Node 26.13.1, npm 11.20.0) | exit 0, 0 vulnerabilities (fsevents install-script warning only) | `logs/npm-ci.log` |
| `npm test` | **121/121 passed**, 11 files | `logs/npm-test.log` |
| `npm run build` | exit 0 (`tsc --noEmit` + vite) | `logs/npm-build.log` |
| `dist/` inspection | Contains `index.html`, `index-*.js` (59.7 kB), `index-*.css`, `worker-*.js` (23 kB, the real module worker loaded via `new Worker(new URL('/assets/worker-…'))`) and `favicon.svg`. `grep` finds 0 hits for `__gridborn`, `installDiagnostics`, `diagnostics`, `scaffold`, `preview`, `qa/t`. In the browser, `'__gridborn' in window === false` on production and a function on dev. | — |
| Dev server (mine) | `npm run dev -- --port 5294` | `logs/dev-server.log` |
| Preview server (mine) | `npm run preview -- --port 4294`, serving the built `dist/` | `logs/preview-server.log` |
| `node scripts/qa.mjs <url> prod|dev <vp>` | Main public-input suite | `logs/qa-{prod,dev}-*.log`, `raw/qa-*.json` |
| `node scripts/regression.mjs` | Controlled host, real modules via Vite SSR, with the original runtime from git `32a6bf5` as baseline | `raw/regression.json` |
| `node scripts/lifecycle.mjs` | Real-worker M2, history bound, pagehide/HMR, hiding attempt, reduced motion, intermediate widths | `raw/lifecycle.json` |
| `node scripts/perf.mjs` | Production performance, run alone | `raw/perf-prod.json`, `raw/perf-prod-raw.json` |
| `node scripts/determinism.mjs` | Production replay and improvement | `raw/determinism-prod.json` |
| `node scripts/line-analysis.mjs` | Recorded best lap compared with the centerline | `raw/best-line-analysis.json` |
| Focused probes | `probe-*.mjs` (letterbox, keys, follow/stopped, laptop viewports, focus, calibrate, draw) | `raw/*.json` |

## Browser method

- **Preview tool:** `preview_status` reported no tab. I opened my own background tab on dev `/`, which confirmed the app runs (generation 1, 512 cars, ticks advancing), then closed it.
- **Playwright:** the brief requires real Playwright at fixed viewports with CDP touch, so all evidence comes from my own isolated `playwright-core 1.65.1` (`runner/`) driving system **Chrome 157.0.8103.51 headless**.
- **Hardware:** Apple M5, 10 cores, 24 GB, macOS.
- **Viewports:**
  - 1440×900 at DPR 2, mouse.
  - 390×844 at DPR 3, mobile with CDP `Input.dispatchTouchEvent`.
  - 844×390 at DPR 3, mobile with CDP touch.
- **External observation only:** an init script wraps `Worker` (adds a listener and counts terminate), `requestAnimationFrame`, and Canvas2D `translate`/`arc`/`lineTo`/`fillText`. It reads real worker snapshots and real drawn poses without touching app code. Production evidence uses only this.
  - Dev additionally used the documented `window.__gridborn.read/reset` for the internal invalid-reset probes and the history-bound read.
- **Production is the final behavior evidence:**

| Run | Result | Failures |
| --- | --- | --- |
| prod 1440×900 | **66/68** | one harness-timing failure (classified below) and the real L1 Escape defect |
| prod 390×844 | **70/70** | — |
| prod 844×390 | **70/70** | — |
| dev ×3 | see §Dev results | — |

- Console errors and warnings, page errors, failed requests and HTTP ≥400 responses were **0** in every context.
- All mobile results come from Chrome emulation, not physical iOS or Android devices.

### Failed assertions: harness vs real

| Assertion | Class | Explanation |
| --- | --- | --- |
| `arrow keys cycle drivers` (prod/dev desktop, first runs) | **Harness timing** | At that moment only 1/512 cars was alive. The handler cycles only through driving cars, so it correctly re-selected the same car. `probe-keys.mjs` shows Enter → car 6, then → 40 → 45 → 53 → 45, with focus on Close. The later runs wait for an early generation. |
| `Escape mid-stroke never commits` (desktop, prod and dev) | **Real → L1** | See below. |
| Earlier iterations (picker spacing, scroll after selection, frame sampling, drawing into the letterbox) | Harness | Fixed in the script. Drawing into the letterbox led to the real finding M1. |

## Verified core brief (production)

| Brief item | Evidence |
| --- | --- |
| Light, polished static article | `screens/prod-*-01-hero.png`, `*-17-full.png`. Editorial layout with no card soup, emoji or gradients. **Text:** no rendered text below 11 px at 1440, 390, 844, 601, 700, 800, 1000, 1024 or 667 widths (`lifecycle.json` widths). **Touch targets:** all ≥44 px on touch (checkboxes are wrapped in ≥44 px labels). **Overflow:** none, including at 320 px. |
| Automatic hundreds-car evolution | Auto-starts at 1× with 512 cars at about 60 steps/s, and generations advance on their own. |
| Mouse/touch drawing | **Valid loops** commit in both directions with mouse (desktop) and CDP touch (phones), giving a new run, "Current: Your circuit" and generation 01. **Direction:** cars drive the drawn direction (the signed area of the best trajectory matches the stroke). **During drawing** stepping is suspended (`Waiting`) and the Play intent is kept. **Tiny and figure-8 strokes** are rejected with local messages ("…The loop crosses itself…", "Current: Your circuit." prefix). The same run continues afterwards, and the feedback is visible beside the canvas without scrolling at all three sizes. **touchcancel** mid-stroke never commits. |
| Default and drawn tracks learn; all presets learn | See the table below. |
| Actual glowing best path | The best line is drawn from recorded samples with glow, and partial attempts are not closed. The 8.31 s best lap is 12% shorter than the centerline, with median \|offset\| 39.4 of the 46 half-width, so it hugs the inside line inside the road (`best-line-analysis.json`). It is not a centerline controller. |
| Generation, lap and fitness history | Telemetry lap equals the minimum of the worker's generation `bestLapSeconds` exactly. The sparkline label reads "N gen · best / mean". |
| Play/pause/1×/4×/fast | **Pause:** tick frozen and labelled "Paused"; Play resumes. **1×:** 60 steps/s with 60 snapshots/s. **4×:** about 240 steps/s with 60 snapshots/s. **Fast:** about 3,000 steps/s with about 9 snapshots/s, **zero cars drawn**, and "Learning ahead. Cars hidden · choose 1× or 4× to watch". |
| Click/tap a car → useful inspection | A real click or tap on a chosen moving car opens exactly that car (index match) at all sizes. **Visibility:** the panel heading is scrolled into view, and the hero cue reads "Inspecting car N · details below". **Coherence:** the inspector's 80 edge weights, 10 biases and 18 activations, the hero's 7 ray endpoints, selection ring and car pose, and the inspector-canvas rays **all equal one exact worker snapshot**, both running and paused. **Math:** activations equal my own tanh forward pass from those weights and inputs (error ≤2.5e-8). Inputs 0–6 equal the ray distances. **Live:** values change between samples while running. |
| Keyboard | Enter selects a car and moves focus to Close. Arrows cycle driving cars. Escape closes and returns focus to the hero canvas. Close returns focus to the hero canvas, never `<body>`. A mouse click shows no focus ring; keyboard focus shows a 2 px ring. |
| Stopped-car semantics | Tapping a just-crashed car (paused) shows "Crashed · stopped · speed 0 · seven live distances". The selected crashed car stays drawn and inspectable past the 2 s fade. |
| Stale run/generation/reset | A generation boundary and a reset both clear the selection. Rapid presets, resets, population changes and play toggles coalesce: IDs are monotonic (18 skipped) and the final state is the last intent, with no stuck "Applying". |
| Pending/accepted | Population 1000 shows "Applying Club circuit · 1000 cars…" and is then accepted ("/ 1000"). |
| Population 1000 | Steps at 60/s at 1× (see Performance). |
| Teaching demos | **Sensors:** drag and range inputs change readings; follows the selected car ("Selected car · live distances"). **Network:** sliders change Steer; follows the selection ("Selected car · live network"); the adjusted edge is highlighted. **Genetics:** 3 mutations and the crossover slider respond; labelled "Illustration · 12 weights, no actual lineage". **Racing line:** shows the **actual recorded lap inside the actual road outline** ("Recorded best · 8.56 s lap", "Generation 15, car 287. A complete timed lap, recorded from the simulation."). "Explore a corner" is labelled "Illustration · corner geometry". **Follow=off** is preserved across a new selection, per demo. |
| Resize/DPR/tiny | **Rotation:** no overflow, and backing store = CSS × min(DPR, 2). **DPR-only change (3→1):** rebuilds the backing store. **320×568:** no overflow. **120×200:** no errors, and the run recovers. |
| Reduced motion | `scroll-behavior: auto`, still runs, no errors. |
| Buffers | One worker, 0 detached incoming buffers (about 5,000 recycles per run), and structured cloning of the displayed snapshot succeeds. |

**Learning per viewport (production, public controls, fast-forward bursts).** Each cell is generations observed, then first lap → best lap (number of record improvements):

| | Default | Drawn CW | Drawn CCW | Broad oval | Riverbend | Club circuit |
| --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | 30 g, 9.28→8.34 s (18) | 23 g, 10.27→9.32 (15) | 21 g, 10.21→9.37 (11) | 21 g, 9.28→8.37 | 20 g, 9.39→8.50 | 17 g, 10.22→9.54 |
| 390×844 | 31 g, 9.28→8.34 (18) | 21 g, 10.27→9.32 (15) | 22 g, 10.21→9.34 (12) | 24 g, →8.35 | 22 g, →8.50 | 20 g, →9.46 |
| 844×390 | 30 g, 9.28→8.34 (18) | 21 g, 10.27→9.32 (15) | 21 g, 10.21→9.37 (11) | 21 g, →8.37 | 20 g, →8.50 | 17 g, →9.54 |

Identical first-lap values across viewports reflect the deterministic seed. The drawn loops are world-relative, so they are the same shape at each size.

**Genuine improvement and deterministic replay (production, public Reset learning, seed 1):**
- **Replay:** runs A and B are identical for **60 of 60 generations**. Fast and 4× are identical for the first 8 generations, and fast and 1× for the first 2.
  - This shows that rate and presentation (interpolation) never alter physics or lap metrics.
- **Improvement:** the lap drops from 9.28 s (generation 1) to **8.31 s by generation 60**, with 20+ record steps.
  - Mean fitness and completed laps rise. Full histories are in `raw/determinism-prod.json`.

## Original T2 M1/M2 and validation rechecks

My controlled host runs in virtual time, with a modelled rAF main thread (displayed and incoming slots), a step cost of 0.02 ms and 0.1 ms message latency, over 20 s per row (`regression.json`).

| Runtime | 1× jitter 0 | 1× jitter 1.5 ms | 4× jitter 0 | 4× jitter 1.5 ms |
| --- | --- | --- | --- | --- |
| **Baseline `32a6bf5`** | 40.0/s, steps {1: 396, 2: 401}, fresh frames 0.67 | 38.4/s, 0.64 | 53.5/s, {4, 5}, 0.89 | 52.8/s, 0.88 |
| **Current** | **60.1/s, all 1-step, fresh 1.0** | 60.1/s, 1.0, p90 17.5 ms | **60.1/s, all 4-step, 1.0** | 60.1/s, 1.0 |

- The real browser agrees: production delivers 59.8–60.5 snapshots/s at 1× and 4×, with fresh-state frame share 0.90–1.0 (Performance).
- **M1 is resolved.**

**M2.** In both the controlled host and the real worker, reset 10 runs, then 8 malformed commands exhaust the error budget, then reset 11 asks for population 5000.

- **Baseline:** no reply at all. The pending reset would hang forever.
- **Current:** replies `error:11 "Population must be 2–1000."`. The later invalid resets 12 and 13 also reply. The old engine keeps running, and valid reset 14 is accepted.

Through the actual dev app's real worker (`lifecycle.json`):

- 8 malformed messages were posted directly to the app's worker.
- Then an invalid reset: `pending: null`, the old run kept ticking, and the feedback read "Current: Broad oval. Population must be 2–1000. The current circuit and learning are kept."
- Then an invalid reset immediately followed by a valid queued one: both resolved, and the queued 256-car run was accepted.

Session ⇄ real `WorkerRuntime` in-process gives the same result. **M2 is resolved;** new reset errors always resolve pending requests.

**Validation:**

| Input | Current | Baseline |
| --- | --- | --- |
| Original fake inner wall (outer boundary plus a 2×2 loop) | **Rejected** | accepted |
| Inconsistent declared width | **Rejected** | accepted |
| All 3 presets | accepted | accepted |
| 28 drawn loops (both windings, widths 70/92/120, beans and ovals) | all accepted | — |

Validation costs about 1 ms per reset, outside the hot loop.

## Performance (production, measured externally)

**Conditions:**
- Production `dist/` via my preview server, 1440×900 at DPR 2, headless Chrome 157, Apple M5.
- **Warmup and samples:** 1 s warmup, then 5 s samples. For "early" samples, a fresh public reset precedes each rate. For "evolved" samples, fast runs for 20 s (512) or 30 s (1000) first.
- **Run alone:** the other session's T1R QA browser had exited. Load average was 1.6 at start and 2.3 at end; an unrelated Vite process used about 7% CPU.
- **Headless limits:** rAF here excludes the GPU compositor and physical displays, so this is not a physical-device guarantee.
- **Callback cost:** "callback" is the total main-thread time in rAF callbacks, including the demos.

| Sample | Generations | rAF fps | p99 / max (ms) | Callback avg / p95 (ms) | Snapshots/s | Fresh-frame share | Changing-pose share | Cars drawn | Steps/s | Worker ms/step | Worker busy | Alive |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 512 early 1× | 1 | 59.9 | 16.8/16.8 | 0.72/1.4 | 59.9 | 1.00 | 1.00 | 292 | 60 | 0.40 | 2% | 18–511 |
| 512 early 4× | 1–3 | 60.0 | 16.8/16.8 | 0.40/1.3 | 59.8 | 0.997 | 0.99 | 135 | 239 | 0.26 | 6% | 1–512 |
| 512 early fast | 4–19 | 60.0 | 16.8/16.8 | 0.03/0.1 | 9.4 | 0.16 | **0 (headless)** | 0 | 2,805 | 0.16 | 44% | — |
| 512 evolved 1× | 97 | 60.0 | 16.8/16.8 | 0.91/1.4 | 60.0 | 1.00 | 1.00 | 391 | 60 | 1.25 | 8% | 316–372 |
| 512 evolved 4× | 98–100 | 59.9 | 16.8/16.8 | 0.96/1.5 | 59.9 | 0.90 | 0.99 | 417 | 240 | 1.27 | 31% | 2–512 |
| 512 evolved fast | 104–124 | 60.0 | 16.8/16.8 | 0.01/0.1 | 9.0 | 0.15 | 0 | 0 | 2,000 | 0.28 | 57% | — |
| 1000 early 1× | 1 | 60.0 | 16.8/16.8 | 1.10/2.3 | 60.0 | 0.997 | 1.00 | 578 | 60 | 0.57 | 3% | 32–999 |
| 1000 early 4× | 1–2 | 60.0 | 16.8/16.8 | 0.55/1.4 | 60.2 | 0.96 | 0.99 | 254 | 240 | 0.38 | 9% | 1–1000 |
| 1000 early fast | 3–13 | 60.0 | 16.8/16.8 | 0.02/0.1 | 9.4 | 0.15 | 0 | 0 | 2,373 | 0.19 | 46% | — |
| 1000 evolved 1× | 69–70 | 60.0 | 16.8/16.8 | 1.42/2.1 | 60.0 | 1.00 | 0.99 | 750 | 60 | 1.66 | 10% | 1–1000 |
| 1000 evolved 4× | 70–72 | 60.0 | 16.8/16.8 | 0.83/1.2 | 60.0 | 0.99 | 0.99 | 814 | 240 | 1.24 | 30% | 1–1000 |
| 1000 evolved fast | 75–85 | 60.0 | 16.8/16.8 | 0.02/0.1 | 9.0 | 0.15 | 0 | 0 | 1,083 | 0.54 | 58% | — |

- **Frame cadence:** no frame interval exceeded 20 ms in any sample.
- **Real motion, not repeated frames:** at 1× and 4×, 0.99–1.0 of frames show changed car positions, fed by about 60 fresh worker states per second. So the motion at 60 fps is genuinely changing, not static frames repeated.
- **Fast is headless:** it draws 0 cars and repaints only the status text at about 9 Hz.
- **Bounded interpolation:** every drawn pose lies on the segment between two received worker poses of the same car. The worst deviation is 0.056 world units in the first sampled frame and ≤0.001 afterwards (`raw/perf-prod-raw.json` `*-interpolation-bound`). Selected cars bypass interpolation (pose check above), and the replay identity shows lap metrics are unaffected.
- **Responsiveness:** under 4× at 512 and 1000, pointerdown → Play/Pause `aria-pressed` change takes 0.2–0.3 ms. Event-timing entries are at the 16 ms floor with input delay ≤0.7 ms.

## Lifecycle, cleanup and hiding

- **pagehide:**
  - `persisted:true` (bfcache): nothing is disposed.
  - `persisted:false`: the worker is terminated (1), `#app` is emptied, rAF stops (0 further callbacks), the diagnostics global is removed, and there are no errors.
- **HMR:** touching `src/runtime/presentation.ts` triggers a full Vite reload (`main.ts` registers `hot.dispose` but does not accept updates). After the reload there is exactly 1 worker, 1 app, running, with no errors. The in-place `hot.dispose` path was not separately observable.
- **History bound (dev, 128 cars, fast):**
  - After 301 generations the history held 256 entries (46–301), and the label read "301 gen".
  - JS heap was 5.5 MB before and 4.8 MB after.
  - Sparkline updates are event-driven.
- **Hidden state (synthetic):** I overrode `document.hidden`/`visibilityState` and dispatched `visibilitychange`.
  - The worker stops (tick frozen), rAF stops, and drawing and selection are cancelled.
  - On restore, the Play intent resumes and paused intent stays paused.
- **Real OS/tab hiding could not be induced:** bringing a second tab to front and a CDP freeze/active cycle both left `document.hidden === false`. Only the synthetic path is verified, and **no physical device or OS-level hiding evidence is claimed.**
- **Worker `error` event (crash) path:** not exercised.

## Findings (most severe first)

### M1 — Medium · The drawable area is a hidden letterbox; loops drawn inside the visible field are rejected
- **What happens:** the hero canvas (the field with corner brackets) is wider than the 1200×800 world, but strokes are validated against the world only. Nothing marks the drawable region, in drawing mode or otherwise.

| Viewport | Field (CSS px) | Drawable world (CSS px) | Unusable |
| --- | --- | --- | --- |
| 1440×900 | 1064×540 | 762×508 | **151 px on each side** |
| 844×390 | 476×185 | 250×167 | **113 px on each side (47% of the width)** |
| 390×844 | 350×269 | — | 27 px top and bottom |

- **Repro:** `scripts/probe-letterbox.mjs`. Click Draw a circuit, then draw an ellipse spanning 84%×72% of the visible field.
  - The stroke is rejected at all three viewports: "Keep the whole loop inside the drawing area, with room for the road." (or "Move the loop away from the edge…" on portrait).
  - Evidence: `screens/letterbox-844x390-rejected.png`, `letterbox-1440x900-*.png`, `raw/letterbox.json`.
- **Impact:**
  - Natural "fill the field" loops fail, with a message that contradicts what the user sees: the loop *is* inside the drawing area shown.
  - In landscape, accepted circuits are confined to the centre half of the stage and look small.
  - Moderate loops work and the current run is always preserved, so this is not High.
- **Suggestion:** size or aspect-fit the stage to the world, or visibly shade or outline the drawable world rectangle (at least while drawing), and word the error relative to that outline.

### L1 — Low · Escape does not cancel an in-progress stroke in the integrated page (regression from the T1 harness)
- **Cause:** T1's editor focuses its canvas on pointerdown and cancels on `keydown` Escape, but the production `.editor-canvas` (`src/ui/page.ts:27`) has no `tabindex`. The T1 harness canvas had `tabindex="0"`.
  - So `canvas.focus()` is a no-op: focus stays on the Draw button (`probe-keys.mjs`: `editorTabIndex -1`, active `BUTTON`).
  - Escape is ignored, and releasing the mouse commits the stroke.
- **Repro:** desktop, Draw → mouse down → move along a loop → Escape → finish → release. A new run is accepted (`qa-prod-desktop` "Escape mid-stroke never commits", run 3→4).
- **Impact:** the documented keyboard cancel is lost. Clear, touchcancel, toggling Draw and invalid-input preservation still work.

### L2 — Low · Selecting a car scrolls the clicked car out of view
- **What happens:** to reveal the inspector, the page scrolls the panel into view. The hero canvas ends up at:

| Viewport | Hero canvas after selection |
| --- | --- |
| 1440×900 | top −329 px, 211 px left visible |
| 390×844 | bottom at 44 px |
| 844×390 | **entirely off-screen** (bottom −50 px) |

- **Impact:** the clicked car, its hero rays and ring disappear at the moment of selection. The inspector's own sight canvas shows the actual rays, so the brief is met, but the click target vanishes.
- **Evidence:** `screens/prod-*-03-inspection.png`.
- **Suggestion:** on desktop place the inspector beside the stage, or scroll only until the heading peeks in.

### L3 — Low · Inspection closes on its own at every generation boundary, with no explanation
- **What happens:** the selection is per-generation by design. Evolved generations last about 8.7 s at 1× and about 2.2 s at 4×, so the panel closes after a few seconds.
- **Impact:** the hero cue silently reverts to "Pick a car…" with no "generation ended" message, which can feel like a glitch.
- **Suggestion:** keep the panel open with a "Generation ended — pick a new driver" state, or auto-follow the elite.

### L4 — Low · The hero is not fully visible on common laptop viewports

| Viewport | Hero visible | Note |
| --- | --- | --- |
| 1280×720 | 93% | world bottom at 737 > 720 |
| 1366×768 | 94% | — |
| 1000×700 | **67%** | track cut off (`screens/width-1000x700.png`) |

- Evidence: `raw/laptop-viewports.json`.
- The required 1440×900 and phone sizes are fully visible.

### L5 — Low (carried from T2 L2, unchanged) · Fast mode leaves the worker idle 42–56% of the time
- Worker busy share is 0.44–0.58 in fast mode at 512 and 1000. This is efficiency only; responsiveness is unaffected.

### L6 — Low · An offscreen racing-line demo keeps stale labels until scrolled into view
- **Observed:** after more than 300 generations the racing-line demo's history label still read "No history yet" while it was offscreen (`lifecycle.json` `history.racingLabel`). Similarly, the network demo kept "Selected car" text after the selection was cleared offscreen.
- When scrolled into view, they redraw correctly (the main suite reads "15 completed…" and the correct sources).
- **Impact:** invisible to users in practice; noted only for screen-reader or offscreen consumers.

### Pending T1R (not new T4 failures)
- T1 round-1 M1 (overshooting the start is rejected as self-crossing) and L1 (slow jittery strokes sometimes rejected) still apply on this branch by design.
- The final whole-product QA must recheck them after the T1R merge.

## Previous mandatory medium findings

| Source | Finding | Status (verified here) |
| --- | --- | --- |
| T2 M1 | 1×/4× snapshot cadence 30–38 Hz | **Resolved:** 60.1/s in the controlled host and about 60/s in production; fresh-frame share 0.90–1.0 |
| T2 M2 | Exhausted error budget silences an invalid reset | **Resolved:** controlled host, in-process Session, and the real app worker |
| T3 M1 | Inspector below the fold with no hero cue | **Resolved:** panel heading scrolled into view, plus "Inspecting car N · details below". Side effect is L2. |
| T3 M2 | Closing drops focus to body | **Resolved:** focus goes to the hero canvas (Close and Escape) |
| T3 M3 | Text below 11 px | **Resolved:** 0 instances at 9 widths/orientations, including 601–1000 and landscape |
| T0 M1 | Overlay vs hero hit-test ownership | **Resolved:** overlay `pointer-events` toggles with drawing; hit tests use visible CSS poses |

**Earlier lows rechecked:**
- **Resolved:**
  - T2 L1 (fake wall).
  - T2 L3: the Session uses monotonic IDs.
  - T0 L1/L2/L6/L7: no mouse focus ring, DPR-only rebuild, no tiny-canvas errors, `role=button`.
  - T3 L1: landscape telemetry and feedback are visible.
  - T3 L3: draw arrow and "no lap yet" are kept.
  - T3 L4: racing-line road context.
  - T3 L5: pending label.
  - T3 L6: highlighted edge.
  - T3 L7: Follow preserved.
  - T1 L3: landscape feedback beside the canvas.
- **Still present:** T2 L2 (= L5 above).

## Dev results

These come from the same suite against `npm run dev` at `/`, with the final harness. Production remains the final behavior evidence.

| Viewport | Result | Failures |
| --- | --- | --- |
| dev 1440×900 | **67/68** | only the real L1 Escape defect |
| dev 390×844 | **70/70** | — |
| dev 844×390 | **70/70** | — |

Earlier dev iterations failed on the harness issues listed above. Their logs were superseded by the final rerun.

## Artifacts

All under `/Users/krrishai/.t3/worktrees/gridborn/t3-3c108d66-4ceed1d07eb1b5d3/artifacts/qa/t4/round-1/`:
- `report.md`, `results.json`
- `scripts/`: `instrument.js`, `lib.mjs`, `qa.mjs`, `regression.mjs`, `baseline-runtime.ts` and `baseline-validation.ts` (copied from git `32a6bf5`), `lifecycle.mjs`, `perf.mjs`, `determinism.mjs`, `line-analysis.mjs`, `aggregate.mjs`, `probe-*.mjs`
- `logs/`: npm, servers and every run
- `raw/`:
  - main suites: `qa-{prod,dev}-*.json`
  - regression and lifecycle: `regression.json`, `lifecycle.json`
  - performance: `perf-prod.json`, `perf-prod-raw.json` (frame rows `[t, callback ms, fresh, cars drawn, pose checksum]`, snapshot rows `[t, tick, steps, compute ms, alive, gen]`, interpolation bounds)
  - learning histories: `determinism-prod.json` (A/B/4×/1× histories plus best-lap samples)
  - probes: `best-line-analysis.json`, `letterbox.json`, `laptop-viewports.json`, `probe-follow-portrait.json`
- `screens/`:
  - `prod-{1440x900,390x844,844x390}-*`: hero, fast-headless, inspection, sensors/network live, follow-off, keyboard inspection, stopped car, default evolved, drawn CW/CCW, invalid, club circuit, pop1000, four demos, corner explorer, full page
  - the same set for `dev-*`
  - `letterbox-*`, `width-*`, `laptop-*`, `follow-390x844-preserved.png`, `stopped-390x844.png`, `dev-1440x900-error-recovery.png`

## Teardown

- I closed my one preview tab (`tab_g_7c7c5a5f…`) right after the sanity check.
- Every Playwright browser and context was closed in `finally`, and no headless Chrome or QA node processes of mine remain.
- I stopped my dev server (port 5294, PID 17287) and preview server (port 4294, PID 20482). Both ports are free.
- **Subject worktree:** `t3/production-runtime-integration` at `b1751e73ffb5d9850c6a129eb7d6651e0e8d2d5f`, tracked files clean, with nothing committed or pushed.
- **Root checkout:** `/Users/krrishai/Documents/Grok/gridborn` is still on `main...origin/main` and clean.
- **Next:** a separate fresh whole-product QA is mandatory after the T1R and T4 merges.
