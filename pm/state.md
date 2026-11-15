# Gridborn execution state

Updated: 2026-11-15. Owner: Codex PM (gpt-6-astra, xhigh).

## Fixed scope and boundaries

`pm/brief.md` and the user's orchestration instructions are authoritative. Deliver a static Vite + TypeScript neuroevolution explainer on `feat/v1`, push to origin, and stop before merge to main or deployment. Root checkout `/Users/krrishai/Documents/Grok/gridborn` must remain clean on `main`. Only Gridborn may be accessed. PM plans, coordinates, integrates, and records; isolated workers implement; fresh independent QA reviewers inspect without editing application code.

Worker model: `codex / gpt-6-astra / reasoningEffort=xhigh`. QA model: `claudeAgent / claude-opus-5-5 / effort=high`. Both verified available. At most four implementation workers concurrently. Use T3-created isolated worktrees based on the current committed local `feat/v1`; no hand-made child checkouts. No PR, deployment, force push, or edits to other repositories are needed.

## Task graph and acceptance checks

| ID | Small task | Dependencies | Done when | State |
| --- | --- | --- | --- | --- |
| P0 | Plan and resolve initial choices | None | State, dated decisions, and question log committed and pushed before application code; root verified clean main | Complete: `1a64443` pushed |
| T0 | Shared scaffold and contracts | P0 | Vite + TS + Vitest install/test/build work; light design tokens and responsive semantic shell render; stable typed track/simulation/inspection contracts and ownership map documented; independent three-viewport smoke QA passes | Worker running; QA round 0/3 |
| T1 | Track geometry and pointer editor | T0 accepted | Deterministic presets and freehand closed-loop smoothing produce valid tracks with width/start line; mouse/touch drawing, clear/reset, invalid tiny/self-intersecting input, and resize behave predictably; geometry tests/build and fresh task browser QA pass | Blocked on T0 |
| T2 | Deterministic neuroevolution engine | T0 accepted | Typed-array physics, ray casting, NN forward pass, seeded RNG, selection/crossover/mutation, progress/lap fitness, stopped/fading crashes, generation statistics, and bounded worker stepping are real; unit tests/build pass; a browser harness demonstrates repeatable evolution and measured performance; fresh task QA passes | Blocked on T0 |
| T3 | Editorial page and four teaching demos | T0 accepted | Minimal light page has polished typography, whitespace, hero/control/inspection slots, and distinct live sensor/network/genetics/racing-line demos with one or two explanatory sentences each; responsive and accessible controls; fresh task QA passes | Blocked on T0 |
| T4 | Connect hero, editor, engine, controls, and inspection | T1, T2, T3 accepted | Live hundreds-car hero starts automatically, best trajectory glows, editor replaces track, generation/best-lap/sparkline are real, play/pause/1x/4x/headless work, car click/tap reveals live rays and NN weights/activations, 1,000-car mode is measured, hidden/resume/resize are safe; tests/build and fresh task QA pass | Blocked on T1-T3 |
| T5 | Release evidence and run instructions | T4 accepted | README documents install/dev/test/build (`dist/`) and honest limitations; final fresh Opus QA covers complete behavior at all three viewports, fixes are re-reviewed, screenshot/report evidence preserved under `artifacts/qa/`; branch pushed and root clean main verified | Blocked on T4 |

T1, T2, and T3 run concurrently after T0 is accepted and merged. Integration depends on their published contracts, not uncommitted work. Each task is committed on its isolated branch, reviewed there before merge, then merged into `feat/v1` and pushed. Fixes are assigned to an Astra worker and receive a new fresh Opus reviewer. Maximum three QA rounds per task and three final rounds; unresolved findings are recorded honestly, and no claim of QA pass is made with outstanding high-severity defects.

## QA protocol

Every task review runs unit tests and production build plus real Playwright browser checks at 1440x900, 390x844, and 844x390. Reviews cover relevant behavior, console/page errors, touch, rapid input, resize, pause/resume and hidden tabs where implemented; track reviews include tiny and self-intersecting paths. An intentionally incomplete scaffold or isolated harness is identified as such and cannot satisfy final integration acceptance. Save screenshots and a severity-ranked report under `artifacts/qa/<task>/round-<n>/` and record the reviewed commit.

Final QA additionally draws a track and observes genuine subsequent generations, demonstrates actual best-lap improvement across generations on a fixed seed, clicks/taps a car and checks live inspection, samples FPS with default and 1,000-car populations, and judges visual polish in all three viewports. Record timing/population/browser conditions and simulation throughput separately from rendering FPS. No fabricated lap histories, canned best lines, or substituted scripted drivers.

## Current execution

- Baseline `8859a2f`: README and committed brief only.
- Verified feature worktree clean on `feat/v1`, tracking `origin/feat/v1`.
- Verified root checkout clean on `main`, tracking `origin/main`.
- P0 committed and pushed as `1a644430657686b0aa8ebc8fe76fe7799fd3a41c` before any application code.
- T0 worker started from that committed baseline in a T3-managed isolated worktree, with the required Astra xhigh settings.
- Worker: [Gridborn T0 — shared scaffold and contracts](t3-thread://v2/6461e9d4-c1cb-4b2d-ab40-74f5ac908ae8/thread:delegated-task:command%3Amcp%3Aa545451b-9cfb-422c-a92f-7c588fdcd00f%3Adelegate-task%3A936ca71e-20e9-4410-8959-b874d7279e09)
- Task ID: `node:delegated-task:command%3Amcp%3Aa545451b-9cfb-422c-a92f-7c588fdcd00f%3Adelegate-task%3A936ca71e-20e9-4410-8959-b874d7279e09`.
- Thread ID: `thread:delegated-task:command%3Amcp%3Aa545451b-9cfb-422c-a92f-7c588fdcd00f%3Adelegate-task%3A936ca71e-20e9-4410-8959-b874d7279e09`.
- Next: on completion, read the worker result and inspect branch/commit; start a fresh Opus 5.5 high task QA reviewer against the worker worktree before integrating. T1-T3 remain blocked until T0 acceptance. Delegate completion wakes the PM automatically; do not poll.

## Resume instructions

Read this file, `pm/decisions.md`, `pm/questions.md`, and `pm/brief.md`. Inspect actual Git and task results before updating status. Use each recorded task's T3 completion notification; do not poll active delegates. Read a supplied thread ID before reporting its result. Preserve exact task/thread links and branch/commit identities here. Always update and commit the PM logs after a significant transition.
