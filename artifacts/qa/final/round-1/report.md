# Gridborn final whole-product QA, round 1

**Verdict: PASS.** No high or medium findings. The full mandatory behavior is substantiated on the production build and the dev server at 1440×900, 390×844 and 844×390. Both new fixes are verified independently in a real browser:

- **Drawing guide:** the shaded outer area and the dashed inset guide appear only while drawing, and the corner brackets are hidden meanwhile.
- **Escape cancel:** Escape cancels a stroke mid-gesture, and releasing afterwards does not commit. Focus returns to the hero after drawing ends.

Findings: five low (three are retained, already-accepted limits) and one informational coverage limit.

## Subject and reviewer

- **Reviewer:** fresh independent final QA, `claude-opus-5-5`, effort high, provider claudeAgent. I did not build Gridborn and used no subdelegates. All scripts are my own; I read but did not reuse prior reviewers' scripts.
- **Worktree:** `/Users/krrishai/.t3/worktrees/gridborn/t3-a9798108-d495d41e9c68c5a6`, branch `t3/final-product-qa-review`.
- **HEAD:** `50c48845a1787a64b064c2ca33aa511ad2ea8e12` (= `feat/v1` 50c4884). Verified at start and at end.
- **Tree state:** tracked files clean before and after. I wrote only under ignored `artifacts/qa/final/round-1/`, and edited, committed or pushed nothing.
- **Root checkout:** `/Users/krrishai/Documents/Grok/gridborn` is `## main...origin/main`, clean. I only read its status.
- **Environment:** Apple M5, 10 cores, 24 GB, macOS. Node 26.13.1, npm 11.20.0. System Chrome 157.0.8103.51 driven by isolated `playwright-core 1.65.1` from `_deps/`. Load average was about 1.0–1.6 during the runs. My runs went sequentially, with no other benchmark running.

## Commands

| Step | Result | Log |
| --- | --- | --- |
| `npm ci` | exit 0, 0 vulnerabilities (fsevents install-script warning only) | `logs/npm-ci.log` |
| `npm test` | **144/144 passed**, 12 files | `logs/npm-test.log` |
| `npm run build` | exit 0 | `logs/npm-build.log` |
| `dist/` inspection | see below | — |
| Dev server | `npm run dev -- --port 5394 --strictPort` | `logs/dev-server.log` |
| Preview server (built `dist/`) | `npm run preview -- --port 4394 --strictPort` | `logs/preview-server.log` |

**`dist/` inspection.** `dist/` contains the real article and the module worker:

- `index.html` (title "Gridborn — Learning the long way.")
- `assets/index-zy4M-xBt.js` (62.5 kB)
- `assets/index-Cd1wJ0fS.css`
- `assets/worker-D_lbJ8Lc.js` (23 kB, loaded with `new Worker(new URL('/assets/worker-…'), {type:'module'})`)
- `favicon.svg`

`grep` finds 0 matches for `__gridborn`, `installDiagnostics` or `diagnostics`. The bundle contains the new hint text and the editor's `tabindex="-1"`. In the browser:

- **Production:** `'__gridborn' in window === false`. The intercepted Worker is `type: module`, served from `/assets/worker-D_lbJ8Lc.js`.
- **Dev:** the global is present.

**Scripts** (`scripts/`, run from that directory):
- `node guide.mjs <url> prod|dev`
- `node main.mjs <url> prod|dev [desktop|portrait|landscape]`
- `node learning.mjs <url> prod|dev`
- `node perf.mjs <url> [headed] [desktop|portrait]`
- `node lifecycle.mjs <url>`
- `node probe-hidden-draw.mjs`
- `node probe-diag.mjs` (dev only)
- `node calibrate.mjs`
- `node aggregate.mjs`, which builds `results.json`

**Tooling:** `instrument.js` is an init script that observes from outside only. It wraps `Worker`/`postMessage` (copying snapshots before the app's listener runs), `requestAnimationFrame`, and hero-canvas `translate`. It adds no app hook, and I added no diagnostics to the source.

## Browser method

- **Preview tool:**
  - `preview_status` showed no tab.
  - I opened my own tab (`reuseExistingTab:false`) on dev `/`. `preview_evaluate` confirmed the live app: generation 1, 512 cars, tick 241, running.
  - Two `preview_snapshot` calls then failed, each with **`Preview automation snapshot timed out after 15000ms.`**
  - I closed that tab and used the permitted fallback, isolated Playwright with system Chrome.
- **Viewports:**
  - 1440×900 at DPR 2 with a real mouse.
  - 390×844 and 844×390 at DPR 3, `isMobile`, with **CDP-emulated touch** (`Input.dispatchTouchEvent`).
  - Emulated touch is not physical hardware. I tested no physical iOS or Android device and no Safari.
- **Rendering:** headless for most suites. Headed Chrome for a performance comparison and the genuine-hiding attempt.

## Results summary (final runs)

| Suite | Production | Dev |
| --- | --- | --- |
| Guide / Escape / focus (`guide.mjs`) | 36/36 · 35/35 · 35/35 | 36/36 · 35/35 · 35/35 |
| Main public-input suite (`main.mjs`) | 63/63 · 63/63 · 63/63 | 63/63 · 63/63 · 63/63 |
| Learning / determinism (`learning.mjs`, 1440) | 12/12 | 13/13 (adds the diagnostics cross-check) |
| Lifecycle / sizes / reduced motion (`lifecycle.mjs`) | 12/12 | — |
| Controlled hide mid-stroke + throttle (`probe-hidden-draw.mjs`) | 7/7 | — |
| Diagnostics vs intercepted worker (`probe-diag.mjs`) | — | PASS |

Viewport order in each cell is 1440×900 · 390×844 · 844×390. Final total: **634/634**.

Console errors and warnings, page errors, failed requests and HTTP ≥400 responses were zero in every app context. The only warnings were Chrome `willReadFrequently` notices caused by my own `getImageData` probes; they are recorded separately as `qaReadbackWarnings`.

### Superseded iterations (failed assertions are kept, not erased)

| Iteration | Failed assertions | Cause | Rerun |
| --- | --- | --- | --- |
| `raw/guide-prod-desktop.json` | 33/36: "guide and shading removed" (after commit), "Stop drawing removes guide", and console warnings | **Harness artifact.** The guide-line pixel probe counted the opaque fill of the newly drawn road, which lies under the same x, as guide pixels. Shading alpha was already 0. The warnings were the QA readback ones. | Probe now matches the guide stroke colour; 36/36 |
| First `main` desktop run (log overwritten) | "inspection updates live while running" | **Harness assumption.** The clicked car crashed about 0.6 s after resume, so its activations were legitimately constant, and the panel honestly read "Crashed · stopped · speed 0". | Accepts the honest stopped state, plus an added live check on a keyboard-selected *driving* car (activations change); 63/63 |
| First dev `learning` run (log overwritten) | "DEV diagnostics history equals intercepted worker generation events" | **My script bug.** It read `accepted.runId` (the field is `.id`) and compared while fast mode was still running. | Paused cross-check passes (`raw/probe-diag-dev.json`); 13/13 |

## Required items

### 1. Running hero, drawing, presets, clear/reset, rejects

**Hero:**
- Autostarts at 1× with 512 cars and about 60 ticks/s.
- Fully above the fold at all three sizes.
- Screenshots: `screens/*-01-hero.png`.

**Real mouse and touch drawing at every viewport:**
- **Shapes:**
  - clockwise and counter-clockwise ellipses
  - clockwise overshoot of 6% (about 120 world units)
  - counter-clockwise overshoot of 7.5% (about 150 units)
  - three ±1 CSS-px jittered strokes, including a jittered overshoot
- **Outcome:** **all accepted** at every viewport.
- **Direction:** the signed area of the committed centerline matches the stroke.
- **T1R:** the overshoot closure and phone-jitter tolerance work in the integrated app.

**Learning on a drawn circuit:** after each commit the new run starts at generation 01. On a drawn "bean" circuit:
- generation-1 laps → 9.62 s, and best → **8.70 s** (8.74 s in landscape) within 18 generations
- 9–10 record laps
- completed laps rose from 17 to 311–321
- the best trajectory drives the drawn direction
- the telemetry lap equals the worker's minimum

**Rejected with clear local feedback, previous run kept** (no reset sent, same runId):

| Stroke | Feedback |
| --- | --- |
| tiny | "Draw a larger loop with room for a full-width road." |
| figure-eight | "The loop crosses itself…" |
| full loop with a crossing lobe tail | "The loop crosses itself…" |
| near-double-lap retrace | "The loop crosses itself…" |
| out-of-world | "Keep the whole loop inside the drawing area…" |
| open line | "The loop crosses itself…" |

True crossing safety holds: neither the crossing lobe nor the long retrace was silently trimmed into a valid track.

**Presets and controls:**
- Broad oval, Riverbend and Club circuit each load and run, with the correct "Current:" label.
- Clear drawing erases only the draft. Reset learning restarts the same circuit.
- Rapid preset/reset/play/rate input converges to the last intent with monotonic IDs and no stuck "Applying".

### 2. Genuine, deterministic learning

All runs here are production, public Reset learning, seed 1, 512 cars (`raw/learning-prod.json`).

**Default oval:**
- **Laps:** generation 1 = **9.2835 s** with 16 finishers. Generation 60 = **8.3122 s** with 341 finishers.
- **Mean fitness:** 0.154 → 1.849.
- **Records:** 26 record laps.
- **Replay:** run A and replay B are **bit-identical for 60 generations**, including statistics and every best-path record.
- **Rate independence:** 4× matches fast for generations 1–3, and 1× matches generation 1. The renderer, rate and interpolation do not affect physics.
- These figures independently match the earlier T4 numbers (9.28 → 8.31).

**Drawn counter-clockwise circuit:**
- The same real stroke drawn twice gives byte-identical geometry and identical 25-generation histories.
- Lap 10.10 → 9.29 s across 14 records.

**Recorded paths are real, not canned:**
- Every record is a distinct sampled trajectory (26/26 unique).
- Samples are at about 10 Hz and end at the lap time.
- Fitness equals `2 + (1 − t/30)` exactly.
- The generation-60 best path is 1,725.8 world units against a 1,965.5-unit centerline. Its median offset from the centerline is 39.6 and its maximum is 41.1, inside the 46 half-width. So it is an evolved inside line, not the centerline.

**Dev:** `window.__gridborn.read()` history, best and tick equal the intercepted worker events exactly while paused.

### 3. Inspection, controls, lifecycle

**Click/tap inspection** (paused, on a drawn car found from the actual hero translations, all viewports):
- Selects exactly that car index (179).
- The panel opens with "Car 179 · generation 1", and the hero cue reads "Inspecting car 179 · details below".

**Inspection correctness:**
- **Network:** activations equal my independent tanh forward pass of the snapshot's 90 weights (error 2.5e-8). Inputs 0–6 equal the ray distances exactly.
- **Rays:** all 7 endpoints equal the pose + heading + angle × distance × 180 (error ≤2.3e-5).
- **Inspector display:** the 80 SVG edge titles show the actual weights. Steer and Throttle match the output activations.

**Keyboard:**
- Enter selects a driving car and moves focus to Close.
- ArrowRight cycles to another car, and a driving car's activations change live.
- Escape closes and returns focus to the hero with a visible 2 px ring. Close does the same.

**Transport:**
- **Pause:** ticks frozen, label "Paused". Play resumes.
- **1×:** about 60 steps/s.
- **4×:** 239.5 steps/s at 60 snapshots/s.
- **Fast:** 3,438 steps/s, no car draws, and "Headless learning…".
- **Population 1000:** accepted ("/ 1000").

**Resize, rotation, small screens:**
- A DPR-only change rebuilds the backing store.
- Rotation and 320×568 produce no overflow and no errors.

**Touch:**
- `touchcancel` mid-stroke never commits.
- A second finger during a stroke is ignored, and the primary finger still commits.

**Visibility and lifecycle (controlled tests):**
- Overriding `document.hidden` stops worker ticks and the rAF loop. Restoring resumes the running intent without a catch-up burst.
- A controlled hide mid-stroke cancels the stroke without committing, ends drawing, removes the guide and moves focus to the hero.
- `pagehide` with `persisted:true` keeps the app. With `persisted:false` it terminates the worker, empties `#app` and stops rAF.
- Reduced motion: `scroll-behavior: auto`, the anchor jumps instantly, and the simulation keeps running.

**Genuine OS hiding (attempted, headed Chrome):**
- Minimizing via CDP and bringing another tab to the front both left `document.hidden === false`. Ticks kept advancing, 90 per 1.5 s.
- **Real OS hiding was not induced,** so only the controlled path is verified. Physical iOS/Safari remains untested.

### 4. Performance (production, measured externally)

**Method:**
- 1 s warmup, then a 5 s sample. Rows are grouped per rAF timestamp.
- "Fresh" = a new worker state arrived since the previous frame.
- "Changing" = the hero car-translation checksum differs from the previous drawn frame. This catches repeated identical frames.
- Callback ms = all main-thread rAF callbacks combined, including the demos.

**Headless, 1440×900 at DPR 2** (`raw/perf-headless-1440x900.json`):

| Sample | rAF fps | Max interval (ms) | Callback avg / p95 (ms) | Snapshots/s | Changing-pose share | Identical drawn frames | Cars drawn | Steps/s | Worker ms/step | Worker busy |
|---|---|---|---|---|---|---|---|---|---|---|
| 512 early 1× | 59.9 | 16.8 | 0.72 / 1.3 | 60.1 | 1.00 | 0 | 284 | 60 | 0.45 | 3% |
| 512 early 4× | 60.0 | 16.8 | 0.36 / 0.7 | 60.0 | 0.99 | 4 | 140 | 240 | 0.23 | 6% |
| 512 early fast | 60.0 | 16.8 | 0.02 / 0.1 | 9.4 | — (headless) | — | 0 | 2,704 | 0.16 | 44% |
| 512 evolved (generation 60) 1× | 60.0 | 16.8 | 1.06 / 1.4 | 60.2 | 1.00 | 0 | 367 | 60 | 1.09 | 7% |
| 512 evolved 4× | 59.9 | 16.8 | 0.93 / 1.5 | 60.0 | 0.99 | 4 | 410 | 240 | 1.19 | 29% |
| 512 evolved fast | 60.0 | 16.8 | 0.01 / 0.1 | 9.0 | — | — | 0 | 2,028 | 0.28 | 57% |
| 1000 early 1× | 59.9 | 16.8 | 1.24 / 2.6 | 60.2 | 1.00 | 0 | 556 | 60 | 0.66 | 4% |
| 1000 early 4× | 60.0 | 16.8 | 0.55 / 1.2 | 60.0 | 0.99 | 2 | 255 | 240 | 0.36 | 9% |
| 1000 early fast | 60.0 | 16.8 | 0.02 / 0.1 | 9.4 | — | — | 0 | 2,354 | 0.19 | 45% |
| 1000 evolved (generation 40) 1× | 60.0 | 16.8 | 1.47 / 2.4 | 60.2 | 1.00 | 0 | 813 | 60 | 1.62 | 10% |
| 1000 evolved 4× | 60.0 | 16.8 | 0.81 / 1.1 | 60.0 | 0.99 | 3 | 827 | 240 | 1.15 | 27% |
| 1000 evolved fast | 60.0 | 16.8 | 0.01 / 0.1 | 9.0 | — | — | 0 | 1,071 | 0.53 | 57% |

**Other runs and observations:**
- **Headed Chrome, 1440** (`raw/perf-headed-1440x900.json`, real compositor):
  - Same pattern: 59.95–60.15 fps, frame-interval p99 18.2–18.7 ms, 0 frames over 20 ms.
  - Callbacks are within 0.1 ms of headless.
  - 1000 evolved 1×: 728 cars drawn, changing share 1.00.
- **390×844 headless:** equivalent, at 1000 evolved 1× 693 cars drawn.
- **Long tasks:** none in any sample.
- **Input responsiveness:** pointerdown → Play `aria-pressed` takes 0.1–0.6 ms at 1000 cars and 4×.
- **Motion:** at 1× and 4×, 99–100% of drawn frames show changed car poses, fed by about 60 fresh worker states per second. The 60 fps is not repeated identical frames: at most 4 identical drawn frames in 300.
- **Fast mode:** draws 0 cars and is pure throughput.
- **4× CPU throttle sample:** taken early at 1000 cars with only about 31 alive, so it says little about a fully populated weak device. It recorded 60 fps and 0.52 ms callbacks.
- **Limits:**
  - These are desktop M5/Chrome figures, not a physical-phone guarantee.
  - Headless rAF excludes compositor and raster cost.
  - Interpolation bounds were verified by T4 and were not re-derived here. Replay identity across rates shows presentation never changes physics.

### 5. Errors, overflow, polish, demos

- **Errors and overflow:** zero errors (see Results summary). No horizontal overflow at all three sizes, rotated, or at 320 px.
- **Text and targets:** smallest rendered text is 11 px, including scaled SVG labels. Touch targets are ≥44 px; the only smaller ones are the two 16 px checkboxes inside ≥44 px labels.
- **Canvases:** `user-select:none`, `touch-action:none` and no callout on both canvases.
- **Demos (all four respond):**
  - **Sensors** and **Network:** range input changes the readouts.
  - **Genetics:** "Mutate a weight" works, labelled "Illustration · 12 weights, no actual lineage".
  - **Racing line:** shows "Recorded best · 8.76 s lap … Generation 2, car 360. A complete timed lap, recorded from the simulation" inside the actual road outline. This equals the hero's best lap.
- **Visual polish:** I reviewed the screenshots at all sizes. The light editorial layout has generous whitespace, readable labels and real road context, with no card soup, emoji or gradients.

### 6. New fixes (guide and Escape): VERIFIED

These come from `guide.mjs` at all three viewports, production and dev, plus the probes in `lifecycle.mjs` and `probe-hidden-draw.mjs`. Pixel-level checks read the actual hero canvas.

**Before drawing:**
- Letterbox and band alpha are 0, with no guide pixels.
- The corner brackets show (`::before`/`::after` `display:block`).

**While drawing:**
- **Shading:** about 0.10 shading (alpha 26) on both the letterbox outside the world and the road-clearance band inside the world. The interior inside the guide is unshaded.
- **Guide line:** the dashed `#246b32` line is present.
- **Brackets:** hidden.
- **Hint:** "Draw inside the dashed guide. Escape cancels the stroke."
- **Overlay:** owns input (`pointer-events:auto`), and the run label reads "Waiting".
- **Car taps:** tapping a car while drawing sends no select command, so the overlay owns the click.

**Accuracy of the guide:**
- Loops drawn right inside the guide are **accepted** (ellipse 530×330 and superellipse 525×325 against the guide's 546×346 half-extents).
- A stroke crossing into the shaded band is **rejected**: "Move the loop away from the edge to leave room for the road." The red draft stays visible.
- A stroke into the letterbox is **rejected**: "Keep the whole loop inside the drawing area…".
- In both rejections the previous run is preserved. The guide and the validation therefore agree in both directions.

**Narrow-height landscape:**
- At 667×375, 740×360, 844×390 and 915×412, the guide is fully visible on screen when drawing starts, and the hint is visible.
- An inside-guide jittered touch stroke is accepted at each. The guide measures 190–254 × 121–161 CSS px (see L1).

**Escape:**
- pointerdown focuses `.editor-canvas`. For mouse or touch it shows no `:focus-visible` ring.
- A draft of over 8,000 pixels is visible mid-stroke, and Escape erases it to 0 pixels.
- Continuing to move and then **releasing does not commit**: no reset is sent, the runId is unchanged, and drawing stays on.
- This holds at all three viewports. On phones, Escape came from CDP keyboard events.

**After a commit:**
- Drawing ends and the overlay becomes inert.
- **Focus moves to the hero canvas** without a ring for pointer users.
- The guide and shading are removed (alpha 0, no guide pixels), and the brackets return.

**Other exits from drawing:**
- **Stop drawing:** removes the guide, and focus stays on the button (it is not stolen).
- **Preset while drawing:** ends drawing and removes the guide.
- **Clear drawing:** erases the draft and keeps the guide.
- **Reset learning while drawing:** keeps the guide and drawing mode.
- **Resize mid-stroke:** cancels without commit, and the guide refits to the new view.
- **Controlled hide mid-stroke:** cancels, ends drawing, removes the guide and restores hero focus.

**Keyboard:**
- Enter on the Draw button keeps focus there with a visible ring.
- Escape with no stroke is harmless.
- Tab reaches the hero with a 2 px solid outline (`screens/focus-hero-keyboard-1440.png`).

**Accessibility:** the editor's `aria-hidden` toggles to false while drawing, so the focused element is exposed.

The prior T4 M1 (drawable area) and L1 (Escape) findings are **resolved**.

## Findings

No high or medium findings.

### L1 — Low · The drawable guide is small in short landscape
- **What happens:** the stage keeps its letterbox, so the guide measures about 209×132 CSS px at 667×375 and 190×121 at 740×360.
- **Impact:** the area is clearly marked and works. Accepted strokes passed in my tests. But fingertip drawing is cramped.
- **Status:** this is the deliberate trade-off chosen in the M1 fix, which marks the area rather than resizing the stage.
- **Repro:** `lifecycle.mjs`, `screens/size-667x375-drawing-guide.png`.

### L2 — Low · Touch-only visitors see a keyboard-only hint
- **What happens:** the drawing hint reads "Escape cancels the stroke" on phones without a keyboard (`screens/prod-390x844-guide-01-drawing-guide.png`).
- **Impact:** harmless; lifting the finger outside or using Clear still works. A touch variant ("Lift to finish · Clear to redo") would read better.

### L3 — Low (retained) · Some laptop heights need scrolling

| Viewport | Hero visible | Note |
| --- | --- | --- |
| 1280×720 | 93% | drawing hint below the fold |
| 1366×768 | 94% | drawing hint below the fold |
| 1000×700 | 67% | guide not fully on screen when drawing starts |

- Evidence: `raw/lifecycle.json`, `screens/size-*.png`.
- The required three viewports are fully visible.

### L4 — Low (retained, accepted)
- Selecting a car scrolls to the inspector, which has its own live ray view.
- The selection clears at each generation.
- Re-observed with no higher consequence.

### L5 — Low (retained, accepted)
- In fast mode the worker is busy only 44–58% of the time. This affects efficiency only.

### INFO — coverage limits (not claimed)
- I could not induce genuine OS or tab hiding. No physical iOS/Safari or Android was used; touch is CDP emulation.
- I did not inject a worker crash.
- These match the previously accepted limits.

**Accepted low T1R limits:** integer-quantized noisy strokes, sharp triangles, and 200+ unit closure tails were not contradicted. All seven jitter and overshoot strokes I tried were accepted. Every rejection preserved the previous circuit, and true crossings were never trimmed into validity.

## Screenshot inventory (`screens/`, 149 PNGs)

**Per-viewport sets** (`{prod,dev}-{1440x900,390x844,844x390}-…`):
- `01-hero`
- `02-drawn-cw-gen1`
- `03-invalid-figure8`
- `04-drawn-evolved-best-line`
- `05-preset-last`
- `06-fast-headless`
- `07-pop1000`
- `08-inspection`, `08b-selected-in-hero`
- `09-keyboard-inspection` (desktop)
- `10-rotated`
- `11-demo-{sensors,network,genetics,racing-line}`
- `12-full`

**Guide sets:**
- `guide-01-drawing-guide`, `guide-01b-stage-crop`
- `guide-02-mid-stroke` (desktop)
- `guide-03-after-commit-learning`
- `guide-04-reject-band`
- `guide-05-reject-letterbox`
- `guide-06-after-resize-guide`
- `guide-07-keyboard-draw-focus` (desktop)

**Other:**
- `{prod,dev}-1440x900-learning-drawn-ccw-evolved`
- `size-{667x375,740x360,844x390,915x412,1024x600,1280x720,1366x768,1000x700}-drawing-guide`
- `perf-{headless,headed}-…-{512,1000}-evolved-1x`
- `focus-hero-keyboard-1440`

## Evidence layout

`artifacts/qa/final/round-1/`:
- `report.md`, `results.json`
- `scripts/` — reproducible suites
- `logs/` — npm, servers, every final run
- `raw/` — JSON results, histories, performance raw frames and deliveries
- `screens/`
- `_deps/` — **separate**: the isolated `playwright-core` runner (`node_modules`). PM may drop it.

The build output `dist/` and the repo `node_modules/` from `npm ci`/`npm run build` are the standard git-ignored paths at the worktree root. They are not evidence.

## Teardown

- **Preview tab:** closed (`tab_h_7c7c5a5f…`).
- **Browsers:** every Playwright context and browser was closed in `finally`. No headless Chrome or QA node processes remain.
- **Servers:** stopped my dev server (port 5394) and preview server (port 4394). Both ports are free.
- **Worktree:** HEAD still `50c48845a1787a64b064c2ca33aa511ad2ea8e12`, `git status --short` empty.
- **Root checkout:** clean `main...origin/main`.
- Nothing was edited, committed, pushed, merged or deployed.
