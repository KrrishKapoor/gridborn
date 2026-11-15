# T2 simulation and integration handoff

The module worker is `src/sim/worker.ts`. It implements the unchanged shared `SimulationCommand` / `SimulationEvent` protocol. T2 imports shared contracts only; it does not import T1/T3, modify `src/main.ts`, or integrate the production page. The independent harness is `/qa/t2.html` (`npm run dev -- --port 5192`). A passing harness is not final application acceptance.

## Driving and learning

- Clockwise world coordinates, fixed 1/60 s steps, radius-5 circular collision envelope. Cars are independent; they do not collide with one another.
- Kinematic bicycle: wheelbase 26, steering angle `0.5 * tanhOutput` radians; acceleration `150 * throttle - 0.45 * speed` world units/s². Throttle is `(output + 1) / 2`. Speed stays nonnegative and is capped by `maxSpeed`. Midpoint speed/heading integrate each fixed step. Swept circle/wall collision prevents tunnelling; a crash retains the last safe pose, sets speed to zero, and increments `inactiveSeconds` on subsequent ticks.
- Seven rays in the shared order, followed by speed/maxSpeed, feed the destination-major 8 → 8 → 2 tanh network (90 weights). Cached inference at the current pose drives the next step. Inspection copies those actual distances, endpoints, weights and activations. An inactive car has real inference recomputed at its stopped pose/speed, but does not move.
- Initialization is deliberately movement-biased, **not an expert policy**: hidden weights/biases uniform in ±1; output weights and steering bias uniform in ±0.35; throttle bias uniform in [0.5, 1.1]. No track geometry, target steering, wall-following rule, or supplied genome is used to initialize or drive. Steering has no left/right prior. All decisions come from the network.
- Mulberry32 consumes exactly the supplied uint32 seed, including zero. Keep `eliteCount` genomes bit-for-bit in rank order. Other children use two independent 3-way rank tournaments from the top half, per-weight uniform crossover, then independent Bernoulli mutations with uniform ±`mutationScale` increments. Nonelite weights clamp to ±8. Engine steps consume randomness only at initialization/breeding; delivery, selection and wall-clock scheduling do not consume it.

## Progress, laps, and fitness

Centerline projection is a **measurement**, never a driving input. Signed, wrapped projection deltas accumulate net distance, including reverse travel. Deltas greater than four times actual displacement plus 0.01 world units are rejected as ambiguous projection jumps. Summing only positive motion is deliberately avoided: start-line jitter and repeated backtracking cannot accumulate a lap.

A finish requires seven ordered eighth-lap distance gates, at least 98% of one net circuit, and a negative-to-nonnegative crossing of the **finite** start line with positive forward velocity. Spawn-on-line, reverse crossings, outside-road line extensions, and near-start oscillation do not qualify. The first valid lap stops the car. Its timestamp interpolates the crossing within the actual fixed step; its final recorded pose lies on the finish line.

Let `p` be signed net progress, `L` track length, `t` the actual completed lap time, and `D = ceil(generationSeconds / FIXED_DT) * FIXED_DT`:

- Incomplete fitness: `p / (L + abs(p))`, strictly increasing within (-1, 1).
- Completed fitness: `2 + max(0, 1 - t / D)`, within [2, 3].

Ranking explicitly compares real lap times for finishers, then signed progress for incomplete cars, then slot index for exact ties. The numeric statistics preserve that ordering without clipping negative or beyond-one-loop incomplete progress. Snapshot fitness is Float32 for rendering; ranking uses Float64 progress/lap state. A car with more progress but no valid crossing cannot outrank any valid finisher.

A generation ends when all cars stop or the ceiling-rounded deadline expires. Emit exactly one completed-generation event, breed, increment generation, clear selection, and reset car state before the next snapshot. `tick` remains cumulative. Per-generation lap statistics are null when nobody finished.

## Recorded paths and bounded storage

Each car records its actual spawn, every sixth tick (10 Hz at defaults), and its exact final pose/time. For very long deadlines the interval increases to cap storage at 602 points/car. Default 30 s storage is 302 points/car; 1,000 cars use 4,832,000 bytes for trajectories. There is no centerline-derived substitute path. A timeout/crash path stays `lapSeconds: null`.

At generation completion, emit one copied best trajectory only if the record improved: progress fitness before the first valid lap; strictly faster valid laps thereafter. No partial path can replace a full-lap record. This deliberately publishes record paths at generation boundaries, not on every sensor/physics update. Main retains the latest best path and maintains the bounded 256-entry history from generation events.

Engine state is permanently owned typed-array storage. Two genome matrices, per-car sensor/activation arrays, ranking, progress/gates/laps, and trajectory storage are reused. No arrays/objects are allocated inside the per-car/per-step loops. Generation records, winner copies and message envelopes allocate only at boundaries/delivery.

The transport allocates exactly three snapshot slots at a successful reset. At 1,000 cars that is 97,548 total bytes across the three slots. A delivered slot's four buffers detach; a recycled slot must contain four distinct, full, non-shared Float32 ArrayBuffers of exact sizes. Outstanding-slot credits cap the pool. Withheld buffers skip snapshots while evolution continues. The wire protocol has no slot identity token, so validation cannot cryptographically establish that a correctly sized returned buffer is the original one; credits and size/ownership checks still bound worker allocations.

## Lifecycle and limits

- Reset validates settings/geometry and constructs the replacement engine/pool before changing the accepted run. Invalid reset leaves the previous engine, running state and RNG intact. Failed request IDs are consumed; all reset requests must use monotonically increasing positive safe integers.
- Successful reset emits `ready`, then a paused generation-1/tick-0 snapshot with rate 1 and null selection. **T4 must keep its accepted run ID until ready**, then explicitly send running/rate intentions. Store desired rate separately from the rate reported by an older in-flight snapshot.
- Other stale run commands/recycles are ignored. Stale generation car IDs clear selection. A paused simulation schedules no steps. Resume and rate changes clear elapsed accumulation, preventing catch-up after a long pause.
- Rates 1/4 use a 250 ms **simulated-time** accumulator cap. Fast uses at most 32 steps or approximately 8 ms computation per task, then yields via a timer. The time cap is checked after each step, so a single expensive generation boundary can exceed 8 ms. Snapshot cadence targets 60 Hz normally and 10 Hz in fast mode; command state updates may deliver immediately. `computeMs` and `steps` measure delivered-interval worker computation, not FPS, and accumulate while the pool is exhausted.
- Malformed commands produce bounded error messages (at most eight per accepted run, consecutive duplicates suppressed). A runtime fault stops scheduling. Worker termination is the teardown; there is no additional shutdown command.
- Reset supports 3–2048 centerline vertices and 6–4096 wall segments. It checks finite fields, world bounds, exact cumulative geometry lengths within Float32 tolerance, nonzero edges, two closed unbranched wall loops, self-intersections/overlap, centerline-wall crossings, spawn clearance, and a perpendicular start line. Reset-only topology checks are quadratic; dense adversarial inputs can delay a reset. Generation deadlines must fit signed 32-bit ticks, and ray endpoints must be safely Float32-representable. These are internal resource/numerical validation limits, not shared-interface changes.
- Determinism is verified within a runtime and between the tested Node/Chrome versions. Other engines may differ in the last bits of transcendental functions; do not promise cross-browser bit identity.

## Fixture and repeatable results

`src/sim/fixtures/oval.ts` is independent of T1: clockwise ellipse centered at (600,400), radii 400 and 230, 96 centerline edges, width 92 using normal-offset boundaries (192 wall segments). Length is 2015.039794921875 world units. Spawn is (600,170), heading right; start endpoints are (600,216) and (600,124). All boundaries fit the 1200×800 world.

Default settings are unchanged: seed 1, population 512, mutation probability 0.1, scale 0.25, 8 elites, 30 s deadline, rays 180, max speed 240. Generation 1 has 15 actual finishers; its best is 9.495347595214843 s. By generation 30 there are 339 finishers and the record is 8.551251983642578 s (9.94% faster). Two actual worker runs produced identical 30-generation statistics (excluding run ID) and identical record histories. The unit test also compares complete car/genome state and trajectory arrays while varying observation schedules.

The following is the **entire** record-improvement history for that 30-generation run; omitted generations produced no new record. Every row has a real full lap (no partial entry is disguised as a completion).

| Generation | Lap seconds | Recorded poses |
| --- | ---: | ---: |
| 1 | 9.495347595214843 | 96 |
| 2 | 9.352527280685681 | 95 |
| 3 | 9.100212900495151 | 93 |
| 5 | 8.898640245672466 | 90 |
| 9 | 8.816481012400688 | 90 |
| 10 | 8.745249975839144 | 89 |
| 14 | 8.724490610758464 | 89 |
| 15 | 8.707076587368196 | 89 |
| 16 | 8.673056284586588 | 88 |
| 17 | 8.63982197807787 | 88 |
| 19 | 8.589251454671224 | 87 |
| 20 | 8.585829925537109 | 87 |
| 21 | 8.578666941324869 | 87 |
| 22 | 8.57007293701172 | 87 |
| 24 | 8.558355458577473 | 87 |
| 26 | 8.55507583618164 | 87 |
| 29 | 8.554567209879558 | 87 |
| 30 | 8.551251983642578 | 87 |

The separate 1,000-car seed-1 run completed 30 generations / 28,407 ticks, with 26 finishers in generation 1. Its complete improvement history follows (same genetic/physical settings, only population differs):

| Generation | Lap seconds |
| --- | ---: |
| 1 | 9.124802901292966 |
| 3 | 9.074684622819065 |
| 4 | 9.014082947760624 |
| 5 | 8.922808034874079 |
| 7 | 8.802229224845238 |
| 10 | 8.786554438017328 |
| 11 | 8.7514404296875 |
| 13 | 8.639947255452475 |
| 16 | 8.634923577732 |
| 18 | 8.626498921712239 |
| 19 | 8.599759419759115 |
| 20 | 8.589097849527995 |
| 21 | 8.566981506347656 |
| 22 | 8.565793863932292 |
| 25 | 8.54811757405599 |

## Measured performance and browser evidence

Measurements on Apple M5 / macOS 27.2, Node 26.13.1 and headless Chrome 157.0.8103.51 via Playwright. Desktop viewport 1440×900, DPR 2. Each browser timing uses 1 s warm-up and 5 s measurement. FPS is animation-frame presentation cadence while drawing Canvas2D, not simulation-step count and not a physical-device guarantee.

The render-only test pauses the worker at spawn and draws **every** car each frame (all spawn poses coincide). The headless test runs real evolving generations with car rendering off. The live test combines 1× physics and rendering. Active counts drop as cars crash/finish; the reported worker means are not a worst-case all-active cost. Main-thread render CPU measurements exclude worker compute and browser GPU/compositing time.

| Cars | Test | Presentation FPS | Render mean / p95 ms | Worker ms / fixed step | Fixed steps / wall second | Mean cars drawn | Sampled active mean |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 512 | render | 60.00 | 0.536 / 0.700 | 0.000 | 0.0 | 512.0 | 0.0 |
| 512 | worker | 60.00 | 0.025 / 0.100 | 0.148 | 2910.6 | 0.0 | 230.0 |
| 512 | live | 60.00 | 0.411 / 0.800 | 0.331 | 59.8 | 302.4 | 105.5 |
| 1000 | render | 60.00 | 0.783 / 1.100 | 0.000 | 0.0 | 1000.0 | 0.0 |
| 1000 | worker | 60.00 | 0.023 / 0.100 | 0.193 | 2406.3 | 0.0 | 463.9 |
| 1000 | live | 60.00 | 0.565 / 1.200 | 0.725 | 59.8 | 593.9 | 208.7 |

The 1,000-car fast-mode pause roundtrip was 1.40 ms in this run. A separate real-worker backpressure test withheld all three slots: only three snapshots arrived, computation advanced 1,549 steps, pause remained responsive, and recycling one detached slot recovered a paused snapshot reporting all 1,549 accumulated steps. A later reset to 512 ignored old-run buffers/commands and remained at tick 0.

The browser completed the 512-car 30-generation run in 9.203 s wall time, then exactly replayed it. Engine-only Node measurement took 3.935 s for 25,543 ticks at 512 cars (mean 201.8 active), and 7.335 s for 28,407 ticks at 1,000 cars (mean 334.0 active). These are measured throughput runs, not display FPS.

A 64-world-unit uniform grid accelerates ray traversal, swept collisions and nearby progress projection. On 100,000 seeded ray queries against the 192 fixture walls, grid traversal took 9.364 ms versus 65.406 ms brute force, with identical checksums (6.98× in this Node sample). A separate 4,000-case unit test compares individual accelerated and brute-force rays, including cell edges/corners and outside-grid origins.

The implementation browser script passed at 1440×900, 390×844 and 844×390. Checks include real worker stepping, stable paused tick, 4× switching, invalid-reset preservation of the accepted run, actual selected sensor/weight/activation data, mouse/touch car hit selection, no horizontal overflow, and no console errors. Phone sizes use Chromium touch emulation, not physical iOS. The preview tool's snapshot command timed out twice (`Preview automation snapshot timed out after 15000ms.`); the permitted independent Playwright fallback was used. The failed preview tab was closed.

Evidence is intentionally uncommitted under `artifacts/qa/t2/implementation/`:

- `browser-results.json`, `browser-smoke.mjs`, `browser-smoke.log`: complete histories, six timing runs, viewport checks.
- `browser-lifecycle.json`, `browser-lifecycle.mjs`: real transfer/backpressure/reset test.
- `engine-measurements.json`, `bench-engine.mjs`, `bench-entry.ts`: full 512/1,000 histories and spatial benchmark.
- `desktop-inspection.png`, `portrait-inspection.png`, `landscape-inspection.png`, `desktop-evolved.png`: screenshot evidence.
- `harness-build.log`, `harness-dist/`: separately bundled harness including the emitted module worker. Default production `dist/` still contains only T0's scaffold until T4 imports the engine.

`npm ci` passed with zero vulnerabilities. `npm test` passed **66 tests in 6 files**. `npm run build` passed TypeScript and emitted static `dist/`. Tests cover parallel/tangent/collinear/missed rays, accelerated geometry equivalence, swept collision and speed/steering integration, analytic NN values, RNG repeatability, movement bias, elite retention/crossover/mutation, signed progress/finite forward lap gates, malformed input/topology/buffers, reset acceptance, pause/resume/rate scheduling, pool exhaustion, generation ordering, stale selection/run handling, deterministic evolution, and real improving recorded laps.

## Integration limits and tuning

Keep the unchanged 512-car defaults for initial integration. The 1,000-car fixture achieved the target desktop cadence in this harness, but the final article, T1 presets/freehand circuits, more complex boundaries, browser devices, and inspection rendering still require integrated measurement. No arbitrary freehand circuit is guaranteed to be learnable; especially tight turns may require a lower max speed, more generations, or T1 rejecting insufficient clearance.

T4 should recycle superseded incoming snapshots immediately, retain the currently displayed one until the next render finishes, and copy any inspection/demo data that must outlive it. Use `snapshot.selected` from that exact snapshot. Handle null selection at every generation boundary. Drive visible running/rate state from worker snapshots while keeping separate requested intentions during pending resets. Pause for page visibility in T4; the worker itself does not know document visibility. Honor null lap times, partial-path labels, and the event-driven 256-entry history. Measure final renderer FPS separately from `computeMs/steps`.

The model is a lightweight bicycle with no tire slip or vehicle interactions. Paths sample real motion at 10 Hz, so rendered straight segments are a visualization approximation. This task proves a repeatable, improving sensor-network policy on an independent oval; it does not claim optimal racing lines, universal 60 FPS, complete app integration, or independent QA acceptance. Fresh Opus QA remains the owner’s next step. No deployment, PR, merge, push, or checkout change was performed.
