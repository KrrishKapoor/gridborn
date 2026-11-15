# Gridborn implementation contract

T0 establishes tooling, shared types, tokens, and a disposable canvas check. **No racing engine, track editor, final article, or car inspection is implemented yet.** The PM brief and decisions remain authoritative. This file coordinates the independent T1–T4 implementations; the TypeScript definitions are the importable source of truth.

## Ownership and import boundaries

| Owner | Files to produce / maintain | Public entry point |
| --- | --- | --- |
| T0 | `src/shared/**`, `src/styles/tokens.css`, package/TS configuration, `docs/architecture.md`, temporary `src/scaffold/**` | Contracts listed below |
| T1 | `src/track/**`, including geometry, validation, presets, editor, tests | `src/track/index.ts` |
| T2 | `src/sim/**`, including physics, rays, NN, RNG, GA, tests and worker | `src/sim/worker.ts` (module worker) |
| T3 | `src/ui/**`, `src/styles/**` except `tokens.css` | `src/ui/page.ts`, `src/ui/demos/{sensors,network,genetics,racing-line}.ts` |
| T4 | `src/main.ts`, `src/runtime/**`, final `index.html`, integration tests/docs | Application composition and renderer |

T1, T2, T3 may import `src/shared/**` but **must not import each other's unfinished modules**. `shared` imports no feature module and no dependencies. T1 editor does not render cars. T2 has no DOM work or T1 dependency. T3 emits user intentions and displays supplied data; it does not construct the worker, mutate simulation state, or implement the track editor. T4 owns main-thread frame scheduling, car/track rendering, hit testing, inspection, visibility handling, responsive sizing and cleanup. T4 replaces the two scaffold imports in `main.ts` and deletes `src/scaffold/` once integrated.

Keep changes within each owner's directories. Treat the shared types/tokens as agreed APIs; propose a concrete adjustment before changing them in a downstream task. T1/T2 internal helpers can have their own exports and tests; this document fixes integration surfaces, not implementation internals. No barrel that imports all features, plugin registry, event bus, framework, backend, or runtime dependencies.

## Shared exports (implemented by T0)

| Module | Exact named exports |
| --- | --- |
| `src/shared/geometry.ts` | Values `WORLD_WIDTH`, `WORLD_HEIGHT`; types `Point`, `Bounds`, `Segment`, `Pose`, `TrackGeometry`, `TrackIssueCode`, `TrackIssue`, `TrackValidation`, `TrackBuildOptions`, `TrackPreset`, `ViewTransform`, `TrackEditorOptions`, `TrackEditorChange`, `TrackEditor` |
| `src/shared/view.ts` | `fitView(bounds: Bounds, width: number, height: number, padding?: number): ViewTransform`; `cssToWorld(x: number, y: number, view: ViewTransform, out: { x: number; y: number }): void`; `worldToCss(point: Point, view: ViewTransform, out: { x: number; y: number }): void` |
| `src/shared/simulation.ts` | Values `FIXED_DT`, `MAX_POPULATION`, `HISTORY_LIMIT`, `SENSOR_ANGLES`, `NETWORK_LAYERS`, `WEIGHT_COUNT`, `ACTIVATION_COUNT`, `SENSOR_STRIDE`, `CAR_STRIDE`, `CAR`, `CAR_STATUS`, `TRAJECTORY_STRIDE`, `DEFAULT_SETTINGS`; types `SimulationSettings`, `SimulationRate`, `CarId`, `SnapshotStorage`, `SimulationSnapshot`, `GenerationStatistics`, `GenerationHistory`, `BestTrajectory`, `SimulationCommand`, `SimulationEvent`; functions `createSnapshotStorage(population: number): SnapshotStorage`, `snapshotTransferList(storage: SnapshotStorage): ArrayBuffer[]` |
| `src/shared/presentation.ts` | Types `PageActions`, `PageOptions`, `PageState`, `GridbornPage`, `TeachingDemo` |

Interfaces are intentionally plain objects and discriminated message unions. There is no runtime engine or settings validator hidden in these contracts. T2 must validate incoming settings and geometry once per reset and report an `error` for malformed input rather than throwing out of the worker.

## Geometry and pointer coordinates

- Logical world: `1200 × 800` world units; +x right, +y down. Heading is radians clockwise from +x. Speeds are world units/second; time is seconds; fitness/progress are independent of pixels. T1 keeps road boundaries inside this world.
- `fitView` letterboxes any positive `Bounds` into CSS width/height and padding, without stretching. `cssX = worldX * scale + offsetX`, likewise y. Both point helpers write into caller-owned output objects and do not allocate. Zero-size/hidden canvases skip drawing until measurable; `fitView` rejects invalid sizes.
- Subtract `canvas.getBoundingClientRect().left/top` from `PointerEvent.clientX/Y`, then call `cssToWorld`. **Do not multiply pointer positions by DPR.** Canvas has no CSS border/padding/rotation. Hero/editor overlays share the same CSS size and view.
- Backing store size is rounded CSS size × DPR (a measured cap, initially 2, is fine). Renderer applies backing-store/CSS ratios, then the world transform. Resizing and DPR changes do not reset world geometry or simulation. Editor uses pointer capture, primary pointer only, and cancels unfinished gestures on `pointercancel`/disable/destroy.
- Interactive canvases use `touch-action: none`, `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none`. Restrict this to the interaction surface; page text stays selectable and the surrounding page scrolls normally.

`TrackGeometry` is a validated, closed drivable circuit. `centerline` is packed `[x, y, …]` in forward order with no repeated closing vertex; n ≥ 3. `cumulativeLengths` has n+1 entries, starts at zero, increases with each edge including the implicit last→first edge, and ends at `length`. `width` is the full road width. `walls` is packed `[ax, ay, bx, by, …]` containing every segment of both closed collision boundaries. It is sufficient for ray intersection and wall collision; T2 must not need T1 private helpers. `bounds` encloses the road, not just centerline. All numbers must be finite and segment lengths nonzero.

`spawn` sits at centerline vertex zero. `startLine` crosses the road at that vertex; its endpoint order is immaterial. `startForward` is the unit forward tangent and `spawn.heading = atan2(startForward.y, startForward.x)`. A forward crossing has positive velocity dot startForward. Spawning on the line is not a completed lap. T2 uses accumulated forward progress / ordered progress gating before accepting a whole lap and rejects backwards crossings or start-line jitter; one crossing alone cannot award a lap. A rectangle fixture can provide centerline, cumulative lengths and explicit wall segments entirely inside `src/sim/`.

## T1: track entry point to implement

```ts
// src/track/index.ts
export function buildTrack(points: readonly Point[], options: TrackBuildOptions): TrackValidation;
export const TRACK_PRESETS: readonly TrackPreset[];
export function createPreset(id: string): TrackGeometry;
export function createTrackEditor(options: TrackEditorOptions): TrackEditor;
```

`TRACK_PRESETS` has at least three deterministic loops; first is the default. Unknown preset ids throw `RangeError` (an integration error, not user drawing validation). Preset width defaults to 92 world units. `buildTrack` takes freehand centerline samples and `{ id, width }`; it closes, smooths, and validates. Invalid drawings return issues (`too-short`, `self-intersection`, `too-tight`, `out-of-bounds`, `invalid-input`) with a short actionable message, never an unusable track. No arbitrary wall-clock/randomness in geometry.

`createTrackEditor` attaches to the transparent editor overlay; starts disabled; retains its last valid track. It draws its draft only and emits `draft`, `commit`, `invalid`, `clear`. T4 renders the committed track. Only `commit` replaces usable geometry and triggers a simulation reset. Invalid edits preserve the last usable circuit. `clear()` removes the draft, emits `clear`, and keeps the usable circuit; it does not create an empty track or reset learning. The UI label should make that behavior clear (e.g. “Clear drawing”). `setTrack(track)` updates the usable track and clears its draft without emitting `commit`; T4 uses this for preset/reset actions. `destroy()` removes listeners and cancels pending gesture/render work. Draft point lists are callback-scoped and may be reused by the editor; copy if retaining them.

## T2: worker protocol to implement

T4 creates `new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' })` from `src/runtime/` (adjust relative path if called from `main.ts`). The worker accepts `SimulationCommand` and emits `SimulationEvent`. Only this protocol is the T2 integration API; engine module names under `src/sim/` are T2's choice. Keep physics/rays/NN/GA/RNG directly unit-testable without a real worker or track editor. Do not load `main.ts` or a feature harness in production.

### Run and generation semantics

1. Main supplies a monotonically increasing positive integer `runId` in `reset`, along with a full cloned valid track and settings. Validate before replacing the old run. Successful reset discards all brains, progress, best records/history and RNG state; uses exactly the supplied uint32 seed; sets generation=1, tick=0, generationTick=0, selection=null, rate=1, running=false. Emit `ready` and an initial snapshot. T4 explicitly sends `set-running: true` for the initial autoplay experience.
2. A new track, preset, population, seed or genetic setting requires a reset and a new runId. Reset with identical track/settings reproduces identical engine steps. `set-running`, `set-rate`, `select` and resize do not reset learning. Pause advances no ticks. Main ignores stale events; worker ignores commands for stale runIds, including obsolete recycled buffers. Terminating the worker disposes it; no extra shutdown protocol.
3. Physics/inference use fixed `FIXED_DT = 1/60`, never frame delta. Rates 1 and 4 request that many simulated seconds per wall-clock second using a bounded accumulator. `fast` runs bounded batches without wall-clock catch-up and throttles delivery; it is a throughput mode, not a claim of a fixed multiplier. Worker yields between batches so commands remain responsive. Hidden-page pausing is T4's responsibility; clear accumulated wall time on resume. Batch scheduling and snapshot drop rate must not change the seeded sequence for a given number of steps.
4. Generation starts with the configured population in deterministic slot order. Stop each crashed car and retain its pose; `inactiveSeconds` grows for a visual fade. A valid first completed lap marks a car `finished` and stops it for that generation. End when all cars are inactive or `generationSeconds` expires (ceil to fixed ticks). Rank valid finishers by lap time, then non-finishers by forward progress; the numeric fitness used in statistics must preserve that ordering and be documented/tested by T2. Fitness cannot reward a fabricated path or time.
5. Emit exactly one `generation` event for the completed generation, before any snapshot for the next one. Preserve `eliteCount` genomes, use seeded selection/crossover/mutation for the rest, increment generation, reset generationTick and per-car progress. `tick` remains cumulative across generations. Selection clears at each boundary. Each `CarId = { runId, generation, index }` identifies one actual slot only; stale ids clear inspection. T4 may explicitly select a new car if it wants to follow a leader.

### Array layouts and ownership

`cars[index * CAR_STRIDE + CAR.<field>]`: x, y, heading, speed, progress (unwrapped forward world distance), fitness, inactiveSeconds (0 while active), status (0 active / 1 crashed / 2 finished). Population and array lengths agree exactly. All numeric contents must be finite. `alive` counts active cars only.

Inspection is for `snapshot.selected` in that same snapshot. Each of 7 `sensors` records is `[distance/rayLength, hitX, hitY]`, in `SENSOR_ANGLES` order; a miss is distance 1 with a world endpoint. Network input is the 7 normalized distances plus speed/maxSpeed clamped to [0,1]. Topology is **8 → 8 → 2**. Hidden and output activations use tanh; outputs are steering [-1,1] and throttle mapped as `(output + 1) / 2`. Weights are destination-major: each destination neuron stores all incoming weights then its bias, hidden layer first, output layer second (90 floats). `activations` contains 8 inputs, 8 hidden, 2 raw outputs (18 floats). T2 defines steering/acceleration constants with tests. The selected weights and activations come from the actual driving inference; never decorative randomness.

Worker owns engine arrays permanently; it **never transfers engine state**. At reset allocate a bounded pool of three `SnapshotStorage` slots. Copy render/inspection data into one free slot, then post `{ type: 'snapshot', snapshot }` with `snapshotTransferList(snapshot.storage)`. Its four full buffers detach in the worker. Main owns the received slot until finished rendering/inspection. To return it, post `{ type: 'recycle', runId, storage }` with the same transfer list; buffers detach in main and return to the worker pool. Never read detached arrays, retain subarray references after return, or transfer the immutable main track. No SharedArrayBuffer / cross-origin isolation requirement.

Main keeps at most the latest snapshot for rendering, immediately recycling a superseded pending snapshot. A displayed snapshot may be retained until its replacement is drawn, allowing redraw while paused. Every consumer (including teaching demos) must finish reading before recycle. With no free slot, worker skips delivery rather than allocating another or blocking steps. Target at most one delivery per display interval; inspection shares that delivery. Small message envelopes/transfer lists may allocate at delivery time; **no array/object allocation in per-car/per-step inner loops**. `createSnapshotStorage` is a pool/reset helper, not a frame helper.

`computeMs` and `steps` measure worker computation time and fixed steps since the preceding delivered snapshot; exclude waiting/transport. T4 measures rendering FPS separately. No benchmark is claimed by T0. Measure 512 and 1,000-car populations under stated browser/viewport conditions before claiming the target.

### History and actual best paths

Main owns `GenerationHistory`, appending completed statistics, keeping the latest `HISTORY_LIMIT = 256` entries oldest-first and a separate total `completedGenerations`. Reset empties it. `bestLapSeconds` in a generation is null until an actual valid completed lap; use an em dash / “No lap yet,” never 0 or invented samples. History is event-driven, not resent each frame.

`best` carries an actual recorded `BestTrajectory` when the run record improves. Before the first lap, compare forward-progress fitness; after it, only a strictly faster completed lap replaces the record. `lapSeconds: null` identifies a partial attempt; non-null samples cover the whole valid lap. Samples are packed `[x, y, heading, elapsedSeconds]`, time relative to sample zero, including start and final pose. Keep bounded recording storage (e.g. 10Hz samples plus endpoints for the configured deadline) and transfer a **copy** of the winning path once per improvement; preserve engine-owned recording storage. Main retains/replaces that record; there is no recycle protocol for these infrequent arrays. Never substitute a centerline/spline for a measured car path.

## T3: presentation entry points to implement

```ts
// src/ui/page.ts
export function mountPage(root: HTMLElement, options: PageOptions): GridbornPage;
// src/ui/demos/sensors.ts
export function mountSensorDemo(root: HTMLElement): TeachingDemo;
// src/ui/demos/network.ts
export function mountNetworkDemo(root: HTMLElement): TeachingDemo;
// src/ui/demos/genetics.ts
export function mountGeneticsDemo(root: HTMLElement): TeachingDemo;
// src/ui/demos/racing-line.ts
export function mountRacingLineDemo(root: HTMLElement): TeachingDemo;
```

`mountPage` creates semantic article/controls, equal-size hero/editor canvas slots, inspection root, and four demo sections. It mounts those demos and exposes their handles as `page.demos`. Callbacks in `PageActions` carry user intent only. `update(PageState)` reflects authoritative state at useful UI cadence; `showTrackIssues` provides inline validation feedback. `destroy()` disposes demos, listeners, observers and elements. T4 feeds all demo handles; each demo `update` borrows snapshot arrays only synchronously, copies any values it will retain, and handles null (no selected/live data) honestly. T4 calls `setVisible` using visibility observers; demos suspend their own motion when invisible and respect reduced motion. T3 can make deterministic interactive illustrative diagrams without T1/T2 imports, but labels them as such and cannot represent them as measured racing outcomes.

System-font tokens live in `src/styles/tokens.css`. Warm paper `#f7f7f2`, near-black ink `#20251f`, muted text `#5c645a`, dark racing green `#246b32`, blue focus `#195bb5`; no remote fonts or images. Green text has at least 4.5:1 contrast on paper/white. Reserve pale green for surface/highlight, thin neutral rules for separation. Token spacing ranges from 4px to 96px, with a fluid gutter/title size. Keep controls touch-sized (44px), visible keyboard focus, semantic labels and honest empty states. The T0 preview style is disposable, not a constraint on final editorial composition.

## Tiny task QA harness convention

- T0's `/` is the disposable preview. Downstream tasks leave `main.ts` alone and create only `qa/t1.html` + `qa/t1.ts`, `qa/t2.html` + `qa/t2.ts`, or `qa/t3.html` + `qa/t3.ts` as needed. Each HTML loads its matching TS with `<script type="module" src="/qa/tN.ts">` and imports its owner's modules plus shared contracts/tokens only.
- Open `/qa/tN.html` through the existing Vite dev server. Use visible “Task Tn harness” labeling and explicit real/illustrative status. Put T2's fixture in `src/sim/fixtures/`, not `src/track/`. Harness controls can expose repeatable seeds and observed values; no permanent `window` debug API in the product.
- Default Vite build has only root `index.html` as input. Unimported `qa/` pages are absent from `dist/`; do not configure them as production entries or import them from the app. Typecheck includes `qa/`. Tests live beside the feature as `*.test.ts`, and `npm test` runs once.
- QA writes reports/screenshots under ignored `artifacts/qa/<task>/round-<n>/`; attach or deliberately force-add chosen evidence, never bulk-add generated output. Fresh independent task QA is orchestrated by the owner, not by implementation workers.

## Commands and limits

Use a supported Node version (`^22.12.0 || ^24.0.0 || >=26.0.0`; T0 verified Node 26.13.1 / npm 11.20.0). `npm ci` uses committed exact top-level pins and lockfile. `npm run dev -- --port 5190` serves localhost with strict port selection; choose another explicit port if occupied. `npm test` runs Vitest once; `npm run typecheck` runs strict TypeScript; `npm run build` runs typecheck and writes static `dist/`; `npm run preview -- --port 4190` serves that build. Stop your own dev session when done.

The scaffold has no physics, rays, NN forward pass, genetics, saved state, editor or product metrics. T0 tests only transforms and buffer layout/transfer ownership. The smoke canvas is event-driven, supports pointer capture and keyboard positioning, and does no continuous animation. T2 supplies meaningful physics/rays/NN/GA tests; T4/T5 supply measured engine and rendering performance. Modern browser support assumes Canvas2D, ES modules, module workers, typed arrays, pointer events and ResizeObserver. No server or COOP/COEP headers are required. Deployment is a later owner action; T0 does not publish or provision Cloudflare resources.
