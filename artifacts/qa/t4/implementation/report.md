# T4 production integration — implementation evidence

This is the implementation worker's verification, **not independent Opus acceptance**. Fresh T4 QA and final post-merge whole-product QA remain required.

- Branch: `t3/production-runtime-integration`
- Verified application source: `92ae0648f13addeb494ad4bbe6d95c381dbb8fb8`
- Worktree: `/Users/krrishai/.t3/worktrees/gridborn/t3-3c108d66-4ceed1d07eb1b5d3`
- Author: requested Codex / gpt-6-astra, xhigh; no delegates or new threads.
- Scope respected: no edits to `src/track/**`, `qa/t1.*`, `docs/track.md`, PM state/decisions/questions, or historical T0–T3 evidence. T1R was neither imported nor awaited. No deployment, PR, push, main merge or checkout switch.

## Delivered

The public `/` page is the real article, 512-car worker simulation, Canvas2D renderer, overlay track editor, actual car inspector and four teaching demos. The scaffold is removed; Vite builds the app and module worker into `dist/`. Population up to 1,000, 1×/4×/fast, presets, restart, draft clearing, current/pending/error feedback and event-driven history are wired. The line is always an actual recorded attempt; null lap stays partial.

Runtime separates desired, pending/queued and accepted state, guarantees increasing IDs, preserves the accepted run through rejected resets, bounds history and transport ownership, and clears stale selections. Normal presentation interpolates only received poses with about two display intervals of latency; exact selected snapshots keep car/ray/network values coherent. Hidden/drawing suspension preserves running intent. Resize, DPR-only and tiny sizes are guarded. Disposal removes the page/listeners/observers, cancels animation and terminates the worker.

Inspector selection has an in-hero cue and reveals the actual inspector at every viewport. Close/Escape return focus, and arrows cycle drivers from the field or inspector. It shows stopped cars honestly. Readability corrections include the 601 px case, where the final measured SVG label minimum is 11.54 CSS px. Live diagrams retain an intentionally unchecked Follow preference; the adjusted illustrative weight is gold. The racing-line diagram uses actual road boundaries.

## Verification

| Check | Outcome |
| --- | --- |
| `npm ci` | Passed; 0 vulnerabilities. Optional fsevents script warning only. |
| `npm test` | **121 / 121**, 11 files; physics/rays/network/GA tests retained, with cadence, reset acknowledgement, boundary, ownership, run-state and interpolation regressions. |
| `npm run build` | Passed strict TypeScript and Vite. `dist/index.html`, favicon, app JS/CSS and `assets/worker-D_lbJ8Lc.js`; no scaffold or diagnostics bundle. |
| Public-app smoke | **129 / 129**, 43 at each required viewport; `smoke-results.json`. |
| Additional checks | **10 / 10**; stopped inspection, Follow preference, keyboard cycling, label floors at 601/800/1000, three dispose cycles, pagehide teardown, native article touch scrolling, actual partial attempt remaining untimed. |
| Built `dist/` smoke | **3 / 3 viewports**, real bundled worker, actual mouse/touch drawing, subsequent generations/timed lap and inspector; zero console/page errors. `window.__gridborn` absent. |
| Original defect reproduction | Baseline defects reproduced and current corrections verified with a controlled host and real worker; `regression-results.json`. |

Browser: system Chrome **157.0.8103.51**. Desktop 1440×900 / DPR 2; phone portrait 390×844 and landscape 844×390 / DPR 3 (renderer cap 2), genuine CDP touch events. Browser/contexts are isolated. Preview was tried first; both snapshot attempts failed with **“Preview automation snapshot timed out after 15000ms.”** That tab was closed before the permitted Playwright fallback.

`smoke.mjs` exercises public controls, mouse/touch strokes, default/drawn learning, all presets, invalid preservation, actual rays/independent NN recomputation, live values, pause/rates/headless, rapid preset/population/rate/running intents, rejected runtime reset, DPR-only and orientation changes, a 1 px canvas, reduced motion and controlled hidden/resume. The initial script's preset assertions read the old displayed snapshot immediately after the generation event; they were corrected to wait for generation 9. Final results have no failed assertions. Screenshot review also caught and fixed initial paused-inspector sizing; the final built screenshots show real rays.

## Original defects, reproduced

The browser regression script reads the exact base runtime/validator from `32a6bf520754bf7444d978353e2c69537dcc0179` into this T4 artifact directory; it never changes the old evidence or another checkout.

| Repro | Base | Current |
| --- | --- | --- |
| Zero-jitter 1×, 10 seconds | 30.3 snapshots/s, ~1.98 steps/delivery | 60.0 snapshots/s, 1 step/delivery |
| Zero-jitter 4×, 10 seconds | 48.0 snapshots/s, 5 steps/delivery | 60.0 snapshots/s, 4 steps/delivery |
| Eight malformed commands, then invalid reset 11 | No acknowledgement; old run valid | Error for 11, old run valid and advancing; valid 12 works |
| Outer boundary + 2×2 fake inner loop | Accepted | Rejected for inconsistent road width |

The real module worker also acknowledged reset 11 after the exhausted budget, advanced old run 10 to tick 8, then accepted 12 and reproduced the documented T2 fixture's 30 generations exactly. All three T1 presets and a sensible drawn loop pass the stronger road validator.

## Genuine learning

512 cars, seed 1, otherwise default settings. First and generation-30 records:

| Circuit | First timed record | Best after 30 generations | Improvement |
| --- | ---: | ---: | ---: |
| Real default T1 Broad oval | 9.283548 s | 8.339065 s | 10.17% |
| Pointer/touch-drawn oval | 8.734022 s | 7.791695 s | 10.79% |
| Documented independent T2 fixture | 9.495348 s | 8.551252 s | 9.94% |

Different circuits have different lengths; absolute times are not a difficulty comparison. Tiny Float32 differences from CSS touch coordinates are retained in each viewport's learning JSON. Complete histories and actual recorded samples are stored in `*-learning.json` and `regression-results.json`. Broad oval, Riverbend and Club circuit all reached generation 9 without errors and had real lap records (8.5760, 8.8332 and 9.9265 s respectively). A separate real short-deadline run remains labeled “partial attempt,” with a null lap, a dash and “no lap yet.” No illustrative data enters the hero or records.

## Built-app performance

**Apple M5, 24 GB, macOS 27.2; headless system Chrome 157; 1440×900; DPR 2; 1 s warmup + 5 s sample per row.** The final `dist/` was served on 4194. The test installs external observers before navigation: real Worker message metadata, rAF callback timings, and the hero canvas's actual car translations. It does not inject simulation data or expose the app's development diagnostics. Each scenario resets through public controls; evolved cases fast-forward to generation 16. Fast “early” warmup itself evolves several generations; the observed ranges are included.

| Cars | Phase · generations | Mode | rAF fps | Fresh state frames | Changing poses | Snapshots/s | Callback p95 ms |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 512 | early · 1–1 | 1× | 60.00 | 100.0% | 100.0% | 60.4 | 1.30 |
| 512 | early · 1–3 | 4× | 60.00 | 97.0% | 99.7% | 60.2 | 1.10 |
| 512 | early · 4–19 | fast | 60.00 | 15.7% | 0.0% | 9.4 | 0.20 |
| 512 | evolved · 16–16 | 1× | 60.00 | 80.9% | 100.0% | 60.2 | 1.20 |
| 512 | evolved · 16–18 | 4× | 60.00 | 100.0% | 99.0% | 60.4 | 1.40 |
| 512 | evolved · 19–37 | fast | 60.00 | 15.1% | 0.0% | 9.0 | 0.10 |
| 1000 | early · 1–1 | 1× | 60.00 | 100.0% | 100.0% | 60.4 | 2.40 |
| 1000 | early · 1–2 | 4× | 60.00 | 99.7% | 99.3% | 60.0 | 1.10 |
| 1000 | early · 4–13 | fast | 60.00 | 15.7% | 0.0% | 9.4 | 0.10 |
| 1000 | evolved · 16–16 | 1× | 60.00 | 88.3% | 100.0% | 60.2 | 1.70 |
| 1000 | evolved · 16–17 | 4× | 60.00 | 100.0% | 99.3% | 60.4 | 1.30 |
| 1000 | evolved · 17–25 | fast | 60.00 | 15.1% | 0.0% | 9.2 | 0.10 |

Fresh-state share is distinct from rAF FPS. A ~60 Hz stream can arrive unevenly relative to display frames (80.9% fresh in one evolved case). The renderer's bounded interpolation produced changing actual car poses on 99–100% of normal frames, rather than counting repeated drawings as smooth motion. Inspection deliberately uses exact received car/ray/activation state. Fast mode draws no cars, so its rAF number is **not** a car-rendering claim.

| Cars | Phase | Mode | Fixed steps/s | Worker ms/step | Worker busy | Mean alive / drawn | Pause acknowledgement ms |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 512 | early | 1× | 60.4 | 0.452 | 2.7% | 104 / 307 | 1.2 |
| 512 | early | 4× | 240.8 | 0.242 | 5.8% | 73 / 132 | 1.8 |
| 512 | early | fast | 2779.2 | 0.160 | 44.6% | 262 / 0 | 1.5 |
| 512 | evolved | 1× | 60.2 | 1.108 | 6.7% | 210 / 295 | 2.1 |
| 512 | evolved | 4× | 241.4 | 0.801 | 19.3% | 250 / 349 | 2.2 |
| 512 | evolved | fast | 2196.0 | 0.243 | 53.3% | 324 / 0 | 4.9 |
| 1000 | early | 1× | 60.4 | 0.602 | 3.6% | 198 / 591 | 2.0 |
| 1000 | early | 4× | 240.0 | 0.372 | 8.9% | 141 / 258 | 1.6 |
| 1000 | early | fast | 2401.7 | 0.191 | 45.9% | 442 / 0 | 1.6 |
| 1000 | evolved | 1× | 60.2 | 1.945 | 11.7% | 603 / 717 | 2.1 |
| 1000 | evolved | 4× | 241.4 | 0.807 | 19.5% | 435 / 556 | 1.8 |
| 1000 | evolved | fast | 1524.2 | 0.345 | 52.6% | 675 / 0 | 7.6 |

The population includes active, stopped and fading cars. Alive/drawn means disclose the workload; these are not sustained all-active worst-case measurements. Callback costs include observation overhead, exclude GPU/compositor and worker time, and are not total process CPU. Pause timings run from the public button's click to the worker's paused acknowledgement. Fast's timer yields still leave it around half busy; that optional efficiency optimization was intentionally deferred.

`production-performance.json` and `production-performance-raw.json` preserve all final values. `performance.json` / `performance-raw.json` retain the separate dev-hook run (including its 59.2 fps early-512/4× sample); it is not silently replaced with the better built timing. Neither run establishes physical-device or universal 60 fps performance.

## Evidence and reproduction

See `docs/integration.md` for the exact development-only `window.__gridborn` interface (`read`, transactional `reset`, `begin`, `end`), buffer semantics and repeatable commands. It is removed from `dist/`.

- Scripts: `smoke.mjs`, `additional.mjs`, `regression-browser.mjs`, `perf.mjs`, `production.mjs`, `production-perf.mjs`, `visibility.mjs`.
- Current built screenshots: `production-{1440x900,390x844,844x390}.png`, matching `-inspection.png` and `-drawn.png` files.
- Article, invalid stroke and learning evidence: `{1440x900,390x844,844x390}-*.png`; `labels-601.png`, `labels-800.png`, `labels-1000.png`, `stopped-inspection.png`, `real-partial-attempt.png`.
- Results: `smoke-results.json`, `additional-results.json`, `production-results.json`, `regression-results.json`, learning histories and both performance runs. Test/build logs are included.

## Limits and teardown

- **True OS-hidden visibility remains unverified on this browser setup.** Minimize and real tab switching in headed Chrome did not change `document.hidden`, even after disabling focus emulation/background-scheduling flags. `visibility-results.json` retains this failed attempt to induce the condition; it is not represented as a passing hidden-tab test. Controlled `visibilitychange` checks verify the application pauses its worker, preserves preference, cancels drawing/selection, stops display work and resumes without catch-up.
- Touch/DPR evidence is Chromium emulation, not physical iOS Safari. SVG and interactive-canvas semantics/CSS are checked; assistive-technology narration and physical device performance remain final-QA limits.
- T1R natural closure/jitter changes are deliberately absent. Final post-merge QA must test its geometry with this runtime.
- Independent fresh Opus T4 QA and post-merge whole-product QA are still pending.
- All owned Playwright contexts/browsers are closed; the T3 preview tab is closed. Dev server 5194 and production-preview server 4194 were terminated. No deployment, PR, push or main merge was performed.
