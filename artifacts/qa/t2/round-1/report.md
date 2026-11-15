# Gridborn T2 independent QA — round 1

**Subject:** `/Users/krrishai/.t3/worktrees/gridborn/t3-6d03a193-9765defd83188cc6`, branch `t3/evolution-simulation-worker`, SHA `02ddfb14977c87f51bd96f9e5fa81dd7b3eb1bf6`. Tracked tree clean before and after QA. The only files written are under ignored `artifacts/qa/t2/round-1/`.
**Scope:** T2 engine, module worker and `/qa/t2.html` harness. T1 editor and the T3/T4 article are outside this scope, so missing integration is not counted as a defect.
**Reviewer:** fresh Claude Opus 5.5, high effort. I did not build this, and I relied on no builder tests or tooling (I installed my own Playwright in `round-1/tools`).

## Verdict: **PASS** (no high findings). 2 medium and 4 low findings.

The simulation is genuine:
- Cars drive purely from wall-ray sensor networks.
- Laps are real and pass strict independent path checks.
- Evolution improves lap times, and runs are bit-for-bit reproducible.
- Snapshots match an independent Node replay exactly.

**M1 should be fixed before T4 is accepted.** At 1× the worker refreshes car state at only about 33 Hz, so moving cars judder even though rendering holds 60 fps.

## Environment
- Apple M5, macOS 27.2, Node v26.13.1.
- Chrome for Testing 158.0.8127.18, headless, via Playwright 1.65.1.
- The T3 preview tool failed twice on one step (`Preview automation snapshot timed out after 15000ms.`). Per policy I closed my preview tab and switched to isolated Playwright.

## Commands
| Check | Result |
| --- | --- |
| `npm test` | **66 passed / 6 files** ([logs/npm-test.log](logs/npm-test.log)) |
| `npm run build` | Typecheck and build OK. Production `dist/` is still the T0 scaffold, as expected. |
| Harness bundle (QA-only config `scripts/vite.harness.config.mjs`, no tracked config changed) | OK: `harness-dist/qa/t2.html`, `assets/worker-*.js` (22 kB) and `t2-*.js`. Served statically and loaded in Chromium, the bundled harness evolved 5 generations identical to the Node engine, with 0 errors. |
| Node bundle of the real `src/sim` (`scripts/vite.node.config.mjs`) | Used for replay, adversarial tests and the controlled-host runtime tests |

## Neural driving, laps and improvement (independently verified)
- **Driving is not a centerline controller.**
  - I replaced the centerline with a different valid polyline (157 vertices with a wobble) while keeping the walls. Every car's x, y, heading, speed and status stayed bit-identical for all 569 ticks up to the first finish. The centerline only affects scoring.
  - Source review agrees: `sense()` reads only `walls.ray`, speed and the genome. Projection feeds only `distances`, gates and fitness.
- **Initialisation contains no track policy.** It uses uniform ±1 hidden weights, ±0.35 output weights and a throttle bias of 0.8±0.3, and the genome never reads geometry.
  - A zero-hidden "straight" genome crashed at tick 123. Its pose was retained 5.40 units from the wall, speed was 0, status was crashed, and `inactiveSeconds` kept growing.
  - A zero-throttle genome never moved and earned no progress or lap.
- **Builder's claim reproduced exactly**, in Node and in the real browser worker:
  - Generation 1: best **9.495347595214843 s** with 15 finishers.
  - Generation 30: record **8.551251983642578 s** with 339 finishers, a 9.94% improvement.
- **Browser worker runs are identical to the Node engine** for every field of all 30 generation statistics, for seed 1 at 512, seed 0 at 512 and seed 1 at 1000.
- **Replay identity:** two browser runs of seed 1 at 512 produced identical histories and bit-identical best-path samples.
- **Other seeds and longer runs** (Node; full data in [improvement-history.json](improvement-history.json)):

| Run | Gen-1 first record | Final record | Improvement | Records |
| --- | ---: | ---: | ---: | ---: |
| 512 · seed 1 · 30 gens | 9.4953 | 8.5513 | 9.94% | 18 |
| 512 · seed 1 · 60 gens | 9.4953 | 8.5176 | 10.30% | 23 |
| 512 · seed 0 · 30 gens | 9.1003 | 8.5387 | 6.17% | 15 |
| 512 · seed 7 · 30 gens | 9.2889 | 8.5269 | 8.20% | 18 |
| 1000 · seed 1 · 30 gens | 9.1248 | 8.5481 | 6.32% | 15 |
| Mirrored (counter-clockwise) oval · 15 gens | 17 laps in gen 1 | 8.6948 | — | — |

- **Every record lap passed an independent path validator** (`scripts/lap-validate.mjs`, run on Node and browser records):
  - Starts exactly at spawn at t=0.
  - Time is strictly increasing, and the final sample's time equals `lapSeconds`.
  - The final pose lies on the **finite** start line.
  - Winding about the oval centre is +2π ± 0.0001 (one clockwise loop).
  - No earlier forward crossing of the start line.
  - Every sample stays within the drivable band (max 40.96 of an allowed 41 units from the centerline).
  - Implied speed is ≤ 240 on full-tick segments.
  - The 10 Hz chords never cross a wall (0 occurrences).
  - The final sub-tick segment (dt ≈ 0.0003 s) shows Float32 timestamp quantisation of about 0.2% "speed". This is a measurement artefact, not a defect.
- **Gate adversaries** (scripted through the engine's own `progressQuery`, `progressDelta` and `lapCrossing` with its jump guard). All were rejected:
  - 4,000 alternating ±2 jitters at the start line.
  - A full reverse lap followed by a forward crossing.
  - 96% of a lap followed by wiggling at the line.
  - A full lap 60 units inside the road, crossing the line's extension.
  - Half a lap forward and back.
  - A teleport loop.
  - A genuine full lap was accepted.
- **Crash and finish behaviour (real worker, 352 snapshots):**
  - 133,741 crashed-car and 3,754 finished-car observations: none moved after stopping, all had speed 0, and `inactiveSeconds` grew monotonically.
  - Every finished car sat exactly on the finite start line.
  - Active cars always had `inactiveSeconds` = 0, and there were no non-finite values.
- **Event order** across 5 browser runs: exactly one `generation` event per generation, always before the next generation's snapshots (0 violations, 0 duplicates).

## Browser checks (real module worker; screenshots in `screenshots/`)
Viewports: **1440×900 at DPR 2 (mouse)**, **390×844 at DPR 3 (touch)** and **844×390 at DPR 3 (touch)**.

| Check | 1440×900 | 390×844 | 844×390 |
| --- | --- | --- | --- |
| Horizontal overflow | none | none | none |
| Controls ≥44 px | yes | yes | yes |
| Canvas `touch-action:none`, `user-select:none` | yes | yes | yes |
| 1× / 4× / fast (fixed steps per wall second) | 59.9 / 240.4 / 3295 | 60.0 / 240.3 / 3355 | 60.0 / 240.2 / 3564 |
| Pause: ticks advanced in 2 s | 0 | 0 | 0 |
| Real pointer selection hits the intended car | mouse ✔ (car 80) | touch ✔ (car 2) | touch ✔ (car 245) |
| Selected 7 sensors / 90 weights / 18 activations consistent | ✔ | ✔ | ✔ |
| **Snapshot equals Node replay bit-for-bit** (all cars, plus selected sensors, weights and activations) | ✔ tick 9543 | ✔ tick 9799 | ✔ tick 9812 |
| Selection is null in the first snapshot of the next generation, and the panel resets | ✔ | ✔ | ✔ |
| Invalid reset (population 1001) keeps run 1 running and shows the error | ✔ | ✔ | ✔ |
| Stale reset or stale-run command produces no reply and no effect | ✔ | ✔ | ✔ |
| Rapid actions: 30 toggles and rate changes, then 5 population resets | final run 7, settled with no stray errors | same | same |
| Resize to 70% width and back keeps the run and the tick continues | ✔ | ✔ | ✔ |
| Console and page errors | 0 | 0 | 0 |

Inspection consistency means:
- Each ray endpoint equals pose + direction × distance × 180 to within 0.05.
- Every hit with distance < 1 lies on a wall segment.
- The network inputs equal the sensor distances and speed/240.
- An independent `forward()` on the 90 weights reproduces the 18 activations (maximum error 0).
- The DOM shows 7 sensor rows, 10 activation rows and 10 weight rows.

The running-selection tap at 844×390 missed because the target car was below the fold (target y=778 in a 390-tall viewport). That is my test's limit, not a defect. The paused touch selection at the same size passed.

**Real worker lifecycle** (raw protocol on a blank same-origin page):
- Reset produces `ready`, then a paused snapshot at tick 0, generation 1, rate 1, no selection.
- **Backpressure:**
  - With no recycling, exactly 3 slots are outstanding. Fast mode advanced 8,287 steps while no snapshot could be delivered.
  - Pausing with no free slot produced no snapshot. Recycling one slot detached its buffers in main and returned one paused snapshot reporting all 8,287 accumulated steps.
  - The paused tick then stayed stable.
- Paused for 3 s: 0 ticks. Resume: 15 ticks in the first 250 ms (no catch-up burst).
- Reset to run 2 while run-1 slots were outstanding: the old recycles and commands were ignored and run 2 stayed at tick 0.
- Stale resets (2 and 1) got no reply. Invalid reset 3 returned an error, and run 2 continued.
- 10 malformed geometry cases were all rejected with specific messages. A non-cloneable track throws `DataCloneError` in main.
- Controlled host (real structured-clone transfers):
  - A 30 s timer stall adds only 15 steps (0.25 s cap) at both 1× and 4×.
  - At most 3 slots exist even after 6 foreign recycles.
  - Wrong-size, detached or shared buffers are rejected.
  - 9 forms of invalid or stale car id clear the selection.
  - Three different schedules (1× with recycling, fast without recycling, 4× with jittered pumps and selections) all match a directly stepped Engine bit-for-bit.
  - 18 invalid settings and geometry cases were rejected transactionally: tick, genomes and RNG state were unchanged, and the run kept running.

## Performance (1440×900, DPR 2, headless Chrome 158, Apple M5; 2 s warm-up, 6 s sample)
- **Render mode:** harness Canvas2D draws the cached track bitmap, the best path and every active or fading car triangle. Fast mode draws **no** cars, so its FPS is not a rendering claim.
- **Live/inactive mix:** "alive" and "drawn" are means over delivered snapshots.
- **Raw data:** per-frame intervals in [perf-raw.json](perf-raw.json).

| Population · mode | rAF FPS (p95 / p99 ms) | Frame callback mean / p95 ms | **Frames with new sim state** | Snapshots/s | Fixed steps/s | Worker ms/step · busy | Alive / drawn mean | Pause round trip |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | ---: |
| 512 · 1× · gen 1 | 60.0 (16.7 / 16.8) | 0.27 / 0.70 | **57%** | 34.2 | 60.3 | 0.16 · 1% | 34 / 172 | 2.1 ms |
| 512 · 4× · gen 2–3 | 60.0 | 0.18 / 0.40 | 87% | 52.3 | 240.1 | 0.15 · 4% | 71 / 124 | 1.6 ms |
| 512 · fast | 60.0 (no cars drawn) | 0.04 | 15% | 9.2 | **2,532** | 0.20 · **50%** | 322 / — | 1.6 ms |
| 512 · 1× · gen 15 | 60.0 | 0.31 / 0.70 | **53%** | 32.2 | 60.2 | 0.72 · 4% | 310 / 339 | 1.6 ms |
| 512 · 4× · gen 16–17 | 60.0 | 0.25 / 0.70 | 84% | 50.5 | 240.2 | 0.35 · 8% | 180 / 223 | 1.4 ms |
| 1000 · 1× · gen 1 | 60.0 | 0.25 / 0.50 | **54%** | 32.3 | 60.0 | 0.18 · 1% | 65 / 332 | 2.4 ms |
| 1000 · 4× · gen 2–3 | 60.0 | 0.16 / 0.50 | 87% | 52.7 | 240.1 | 0.07 · 2% | 28 / 44 | 1.9 ms |
| 1000 · fast | 60.0 (no cars drawn) | 0.04 | 16% | 9.3 | **2,073** | 0.24 · **50%** | 538 / — | 5.0 ms |
| 1000 · 1× · gen 15 | 60.0 (16.7 / 16.8) | 0.70 / 1.40 | **56%** | 33.5 | 60.2 | 1.42 · 9% | 566 / 617 | 2.1 ms |
| 1000 · 4× · gen 16–17 | 60.0 | 0.52 / 1.30 | 82% | 49.3 | 239.8 | 0.97 · 23% | 445 / 590 | 2.2 ms |
| Render stress: paused, all cars at spawn, 512 / 1000 | 60.0 / 60.0 | 0.53 / 0.98 mean | — | — | 0 | — | 512 / 1000 drawn | — |

- **Presentation:** 60.0 fps with 0 frames over 25 ms in every case. Main-thread frame cost stays ≤1.4 ms at p95 even with 600+ cars drawn. Headless rAF is a synthetic 60 Hz clock and excludes GPU and compositor cost, so this is not a physical-device guarantee.
- **Builder's ~60 fps claim:** confirmed for rAF cadence. The *state* behind those frames refreshes at only about 33 Hz at 1× (finding M1).
- **Builder's fast throughput claims (2,911 / 2,406 steps/s):** I measured 2,532 / 2,073 here (−13% / −14%), with a different generation and alive mix. In my viewport runs the same mode reached 3,295–3,564 at 512 cars. Throughput is workload-dependent, and the worker is only about 50% busy in fast mode (L2).
- **Worst case in Node** (generation 31, every car active): 0.26–0.31 ms/step at 512 and 0.50–0.72 ms/step at 1,000. Even at 4× with 1,000 cars that is ≤17% of one core.
- **Allocation:** heap after GC grew by 256 B over 1,500 steps, so there is no leak.
- This is the harness workload, not the final article workload. The T4 renderer, inspection visuals and article must be re-measured, ideally headed and on real devices.

## Findings (ranked)

### M1 — Medium · 1×/4× snapshots arrive at ~30–38 Hz / ~48–52 Hz, not the display rate (`src/sim/runtime.ts:102-104`)
- **Cause:** the delivery gate `end - lastDelivery >= 1000/60` is compared against a pump scheduled after `(FIXED_DT - accumulator) * 1000 / rate`. The residual accumulator makes the next pump land just under 16.667 ms, so about every other pump skips delivery.
- **Repro, controlled host** (`scripts/qa-hidden-cadence.mjs`, no rendering): with **zero timer jitter**, 1× delivers 30.1 snapshots/s and 99.7% of deliveries carry 2 steps. 4× delivers 48/s. With realistic 0–1.5 ms jitter: 37.5/s and 52/s.
- **Repro, real browser:** only 53–57% of 60 Hz frames receive a new state at 1×, and 82–87% at 4×. Snapshot intervals have a median of 29 ms and 63% are above 25 ms.
- **Impact:**
  - Cars move in irregular 1-step and 2-step jumps (about 4 and 8 world units at top speed), so the hero visibly judders despite 60 fps rendering.
  - This contradicts the doc's "Snapshot cadence targets 60 Hz normally".
  - The harness's "Presentation FPS 60.0" readout hides it.
- **Suggested fix:** deliver on every pump that advanced steps when a slot is free, or use a tolerance such as `>= 1000/60 - 4`. Keep the fast-mode 10 Hz throttle. Recheck the "frames with new sim state" share.

### M2 — Medium · An exhausted error budget silences invalid-reset replies (`src/sim/runtime.ts:79-84`)
- **Repro (real worker):** reset run 10, then send 8 malformed commands alternating `set-running:1` and `set-rate:3` (distinct consecutive messages, so all 8 are emitted). Then send reset 11 with `population: 5000`. **No `ready` and no `error` arrives.** A later valid reset 12 still works.
- **Impact:** the contract says main clears its pending reset on `error` and keeps the old run. Here the pending reset never resolves, so the UI can stay "applying" forever. Each failed reset also consumes its ID.
- **Fix:** exempt reset validation errors from the per-run budget, or reset the budget per reset request.

### L1 — Low · Validation accepts walls inconsistent with the centerline and width (`src/sim/validation.ts`)
- **Repro:** keep only the outer wall loop and add a 2×2 loop at the inner start-line endpoint. `validateTrack` accepts this as two closed loops with valid spawn and start line, so the whole infield becomes drivable.
  - A constant right-turn genome then completes a "lap" (13.16 s, net progress 2,687 > L).
  - Evolution's 8.82 s record leaves the declared 92-wide road (46.9 units from the centerline).
- **Impact:** this is only reachable through malformed upstream geometry, but it can score laps on a road the track does not describe.
- **Suggestion:** check that the centerline lies between the two loops, and that wall distance from the centerline is roughly `width/2` (or that the loops are nested with the centerline between them).

### L2 — Low · Fast mode leaves the worker idle half the time (`src/sim/runtime.ts:93-105`)
- The worker is busy 50% of wall time (`workerBusyShare` 0.50 at both 512 and 1000). The cause is the 32-step cap plus a `setTimeout(0)` yield, which browsers clamp to ≥4 ms when nested.
- Commands still respond quickly (pause round trip 1.6–5 ms), so this is efficiency only.
- Yielding through a `MessageChannel` or allowing more steps per batch could roughly double fast-forward throughput.

### L3 — Low · Stale or duplicate reset IDs are silently ignored (`src/sim/runtime.ts:69-70`)
- This matches the contract, but if T4 ever reuses an ID its pending reset will never resolve.
- T4 should guarantee monotonic IDs or time out a pending reset.

### L4 — Low · The harness canvas starts below the first screen
- Canvas top is at y = 426 (1440×900), 611 (390×844) and 518 (844×390). At 844×390 no simulation is visible without scrolling.
- This is harness only and does not constrain the final UI.

### Not defects / informational
- Fast mode harness draws no cars and delivers 10 Hz snapshots, as documented.
- `computeMs/step` at 1× reads higher (up to 1.42 ms) than fast mode because pumps run single steps; the busy share remains ≤23%.
- Foreign, correctly sized recycled buffers are accepted up to the outstanding credit. This is documented, and the pool stays bounded at 3.

## Limits of this QA
- **Headless only:**
  - Hidden-tab visibility could not be emulated: `bringToFront` on another tab left `visibilityState` as `visible`, and rAF continued.
  - CDP `Page.setWebLifecycleState: frozen` did **not** suspend the dedicated worker (ticks advanced normally).
  - Suspension and no-catch-up were therefore verified with the controlled host (15-step cap) and with pause/resume in the real worker.
  - The worker has no visibility handling. Pausing on a hidden tab belongs to T4, and the harness does not do it.
- Touch is Chromium touch emulation, not iOS Safari.
- Performance is a single machine and headless.
- No optimal-racing-line claim is made.

## Evidence
- [results.json](results.json): condensed results and findings.
- [improvement-history.json](improvement-history.json): every record and per-generation statistic.
- [best-trajectories-pop512-seed1.json](best-trajectories-pop512-seed1.json): actual best-path samples.
- [perf-raw.json](perf-raw.json): raw frame intervals.
- Raw outputs: [browser-results.json](browser-results.json), [node-results.json](node-results.json), [hidden-cadence-results.json](hidden-cadence-results.json).
- Scripts: `scripts/` (`node-checks.mjs`, `node-followup.mjs`, `qa-browser.mjs`, `qa-init.js`, `qa-hidden-cadence.mjs`, `lap-validate.mjs`, `summarize.mjs`, vite configs).
- Logs: `logs/`.
- Screenshots: `screenshots/` (23 PNGs covering all three sizes: running, fast, paused inspection, evolved with best path, running inspection, rejected reset, plus full-page mobile views).

## Teardown
- The dev server on 127.0.0.1:5197 is stopped.
- All Playwright browsers and contexts were closed by the scripts, and the static server on 5198 is closed.
- The preview tab was closed.
- `git status --porcelain` is empty.

Independent whole-product QA is still mandatory after T4 integration.
