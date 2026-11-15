# Gridborn decisions

Newest decisions first. All product and quality requirements in `pm/brief.md` remain fixed.

## 2026-11-15 — T2 acceptance and integration scheduling (Codex PM)

- Accepted T2's scoped independent PASS (no high findings). Neural driving, lap validity, determinism, and real improvement are independently confirmed. Performance evidence is explicitly split: renderer rAF held 60 Hz, but state updates at 1× were only about 33 Hz and visibly uneven. Do not claim a smooth 60 fps product until T4 resolves and remeasures this.
- Assign the localized worker delivery/reset-error fixes and the malformed-inner-wall validation gap to the integration worker, alongside renderer timing and transactional reset UI. These are part of the integration's correctness boundary; fresh T4 QA must recheck the original reproduction scripts and actual scene smoothness.
- Start T4 concurrently with T1R: all base feature branches meet their no-high gates, contracts are unchanged, and file ownership is disjoint. This supersedes the earlier conservative T4-waits-T1R sequencing. Final whole-product QA still waits for both accepted results.
- Fast-mode throughput varies with active population and browser scheduling; independent QA measured lower rates than the implementation run. Preserve raw results rather than quote the best sample as a guarantee. Optimizing idle yields is lower priority than smooth 1×/4× presentation and responsive commands.

## 2026-11-15 — T1 QA acceptance and closure correction (Codex PM)

- T1's independent round 1 meets the no-high-severity gate and its implementation is merged. Its one medium issue (common overshot closure rejected) and low jitter issue affect a primary interaction, so a focused substantive geometry follow-up T1R is required before T4 integration. This is more than a cosmetic one-line review fix: normalization must preserve true self-intersection rejection and geometry invariants, with new deterministic and real-input regressions.
- Prefer trimming a completed loop's short redundant tail and removing negligible hand jitter before validation, using conservative thresholds. Do not globally accept self-crossings or hide errors. Large sharp triangles may receive adaptive corner rounding when safe; overly tight shapes can still be rejected with actionable feedback.
- T1 harness-only feedback placement and touch target findings can be corrected alongside its regression surface. Production validation visibility remains a T4 requirement. All findings remain recorded until the new independent round verifies them.

## 2026-11-15 — T3 conditional acceptance and T2 review (Codex PM)

- Accepted and merged T3 under the requested no-high-severity threshold, explicitly taking the reviewer's handoff option for all three medium issues. Inspector visibility, focus restoration/Escape, and readable diagram text are mandatory T4 scope and must be independently re-reviewed before final acceptance. The 13 failed browser assertions remain recorded; no all-checks-pass claim is made.
- T4 may adjust presentation/shared demo interfaces narrowly to provide actual track context, pending/reset feedback, and current circuit naming. These are concrete integration needs identified by QA, not speculative abstractions. Fix the other low polish findings while integrating their affected surfaces.
- Keep an intentionally unchecked “Follow selected car” unchecked across selections: it is the visitor's chosen illustrative mode. Make the current mode explicit; the actual hero inspector always shows the selected live car.
- T2 initialization uses small randomized steering outputs and positive throttle bias, with no track-specific controller. This is acceptable if independent QA verifies every driving decision comes from sensor NN outputs. Real seeded fixture improvement is promising but not yet accepted, and fixture performance does not establish final app or phone performance.

## 2026-11-15 — T3 presentation handoff (Codex PM; implementation by T3 Astra worker)

- Teaching diagrams redraw on input or supplied live data, rather than idle timers. This meets interactive/live teaching goals while reducing offscreen work and respecting reduced motion. Selected-car arrays are copied before recycling; illustrative modes are labeled. Independent QA is checking behavior and data ownership.
- The preset control is an action picker because the shared PageState has no accepted preset id; it must not falsely label an unacknowledged reset as current. Final integration can show current circuit context separately if useful.
- PM inspected desktop/portrait/landscape hero screenshots. The landscape hero now appears in the first screen, addressing the disposable scaffold's layout direction. This is provisional visual assessment, not final integrated QA.

## 2026-11-15 — T1 handoff defaults (Codex PM; implementation by T1 Astra worker)

- Accepted for review: the editor inherits current track width, closes loose endpoints, resamples near 16-world-unit edges, and smooths based on road width. Raw crossings and narrow wall overlaps are rejected to preserve unambiguous drivable circuits.
- CSS geometry changes cancel an unfinished stroke; DPR-only backing-store changes preserve it. Clear drawing retains the valid circuit. Deterministic local drawn IDs are separate from monotonic simulation run IDs.
- These are reported implementation choices, not QA acceptance. Fresh Opus round 1 is running before merge.

## 2026-11-15 — T0 scoped acceptance and finding disposition (Codex PM)

- Accepted the fresh independent T0 PASS under the requested “stop when no high-severity findings remain” rule. The 75/79 browser assertion count is retained verbatim; it is not represented as a complete all-checks pass. Production behavior is still unbuilt.
- Resolved medium M1 by assigning disabled overlay `pointer-events: none` to T1, initial overlay CSS to T3, and hero-only car hit testing to T4. Drawing blocks selection.
- Resolved contract ambiguity L5 by retaining an accepted run ID until a pending reset receives `ready`; an error for the pending request retains the old accepted simulation and shows feedback.
- Documented T4's DPR and tiny-canvas responsibilities. DPR is checked during frames and on focus/visibility return; invalid available drawing size skips rendering, never throws.
- The temporary scaffold will be deleted by T4, so cosmetic/edge-case defects in it are carried to the replacing feature work rather than extending throwaway code. T3 handles phone landscape layout and the mono-font fallback; T4 handles focus behavior, accessible canvas semantics, DPR-only changes, and tiny/hidden sizes. Fresh task and final QA will recheck these.
- Independent QA evidence is committed selectively from this repository's worker artifacts (reports/scripts/results/screenshots/logs; no dependencies or build output). Chromium touch emulation is evidence, not a claim of physical iOS testing. True hidden-page behavior still needs final verification.

## 2026-11-15 — Scaffold handoff and review (Codex PM; contracts by T0 Astra worker)

- Accepted the proposed 1200 × 800 logical world, 7 rays plus speed, and 8 → 8 → 2 topology as concrete shared interfaces, pending independent QA. Positive run IDs and generation-scoped selections prevent stale inspection after reset. Bounded transferable pools avoid per-step serialization allocations.
- Task QA reviews the worker's existing isolated checkout at its committed SHA; the reviewer does not create another checkout or change branches. Its only writes are evidence under that checkout's `artifacts/qa/`. PM will preserve selected evidence during acceptance. This keeps QA on the actual task branch while the PM remains on `feat/v1`.
- T0's browser preview snapshots timed out twice; the worker used the permitted independent Playwright fallback and reported successful checks. Each QA reviewer must independently follow the available browser-tool policy and document any fallback.

## 2026-11-15 — Initial execution defaults (Codex PM, on Krrish's behalf)

- **Away mode:** Resolve normal product and implementation questions autonomously and record the answer here. Ask only for an unavailable credential or permission that truly blocks progress. No open preference question delays work.
- **Performance risk:** About 1,000 cars at 60 fps is a measured target, not a universal device guarantee. Plan for 512 cars by default, at least 256 on narrow/mobile screens if measurement warrants it, and an exposed 1,000-car setting. Prefer a simulation worker, bounded stepping, reusable typed arrays, and efficient collision queries. QA must report measured FPS and simulation throughput under stated conditions; do not quietly reduce the tested population. Any failure to reach the target is a disclosed gap.
- **Scientific honesty:** Cars must steer and accelerate from their sensor-driven neural networks. Fitness uses forward progress and lap timing. Seeded initialization, elitism, crossover, and mutation must be reproducible. Never fake improvement, drive cars along a precomputed line, or present decorative demo data as live evolutionary results. Educational illustrative diagrams are labeled appropriately.
- **Drawing ambiguity:** A drawn path represents a centerline and is closed/smoothed automatically when valid. Reject tiny paths and ambiguous self-intersections with a clear inline explanation; preserve the last usable circuit instead of crashing or accepting unsafe geometry. Include several deterministic presets and clear/reset controls.
- **Minimal stack:** Use Vite, TypeScript, Vitest, browser-native DOM and Canvas2D, and a worker when needed. No backend, accounts, analytics, third-party runtime dependencies, or heavy framework. npm lockfile and static `dist/` output are the deployment handoff. A dark theme is optional and deferred until all required behavior and QA pass.
- **Visual direction:** Light, warm neutral canvas; near-black type; restrained electric green or similarly legible accent for the winning trajectory. Use typography, thin rules, and space instead of cards, gradient blobs, or emoji. System font stacks avoid external font/network dependencies. Four distinct live teaching demos explain sensors, network inference, genetic operators, and emergent racing lines.
- **Task isolation:** T0 defines contracts and a minimal runnable shell. T1 track/editor, T2 engine, and T3 editorial presentation then run independently. T4 integrates genuine engine data and inspection. QA of scaffolds/harnesses is scoped honestly and does not replace complete final browser QA.
- **Review independence:** Each QA attempt is a new Claude Opus 5.5 high delegated thread that did not implement the reviewed code. QA may write evidence but must not edit application code. Corrections go to Astra workers. Three-round limits are enforced; remaining defects are recorded rather than hidden.
- **Repository and deployment boundary:** Work only in Gridborn. The Sites skill is used in its local-only mode, which skips registration, hosted source sync, and publication. The explicit Vite choice and Cloudflare Pages handoff take precedence over generic Site defaults. Cortana deploys later; PM never deploys or merges main.

## Known gaps

T0 has no high-severity defects. Its low findings L1–L7 and the production implementation of clarified M1/L5 remain tracked for T3/T4 verification above. T3 adds three medium presentation findings and low polish issues assigned to T4 above. The full product, independently verified evolution/performance, and physical iOS behavior remain unverified.
