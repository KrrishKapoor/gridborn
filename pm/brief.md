# Gridborn brief

Gridborn is a new public repo (github.com/KrrishKapoor/gridborn, currently just a README). Work on the feature branch `feat/v1`.

## What it is
This is a static, browser-only website (no backend, deployable to Cloudflare Pages). It's an interactive explainer for neuroevolution, a genetic algorithm evolving tiny neural nets, applied to racing lines. The page reads like an Apple product page or a top-tier interactive article (think apple.com, Bartosz Ciechanowski, distill.pub): few words, lots of live demos. Clean, minimal, generous whitespace, beautiful type, smooth motion. Light by default, dark mode optional. It must not look vibe-coded: no generic gradient blobs, no emoji, no card soup.

## Core experience
1. **Hero.** A live sim is already running on a default track: hundreds of cars (target up to ~1000 while staying at 60fps) evolving, with the best line glowing.
2. **Draw your own circuit.** Freehand-draw a closed loop with mouse or touch, auto-smoothed into a track with sensible width, plus start/finish. Reset/clear and a few preset tracks.
3. **Evolution live.** Each car has ray sensors feeding a small neural net (e.g. 5-7 rays plus speed, one or two small hidden layers, outputs steer and throttle). Crashed cars stop and fade. Each generation, keep the fittest (by progress along the track, then lap time), then crossover and mutate. Show a generation counter, best lap, a fitness-over-generations sparkline, and play/pause/speed (1x, 4x, fast-forward headless).
4. **Inspect a car.** Click or tap a car to see its sensor rays drawn live and its network visualized with weights and activations lighting up, in the spirit of an LLM visualizer.
5. **Short explanatory sections below,** each with its own small live demo: what a sensor sees, what the network does, selection/crossover/mutation shown visually, and why the racing line emerges. Short text, one or two sentences per beat.

## Tech
Use Vite + TypeScript with no heavy framework unless it clearly earns its place. Use Canvas2D or WebGL for the sim. Run the sim in a Web Worker if needed for 60fps. Use typed arrays and avoid per-frame allocation. Deterministic seeded RNG. Responsive and good on phones (touch drawing, no iOS selection/callout on the canvas). Vitest unit tests for physics, ray casting, NN forward pass, and GA operators.

## Quality bar
Keep diffs small and code simple, with no premature abstractions. Prove it works: run the dev server and verify in a real browser.

## QA (mandatory before done)
Use a FRESH Claude Opus 5.5 (effort high) QA thread that did not build it. Have it run real Playwright checks at desktop 1440x900 and mobile 390x844 and 844x390 covering: draw a track and see cars evolve, best lap improving over generations, clicking a car opens inspection, FPS holds, no console errors, layout and visual polish. It saves screenshots to `artifacts/qa/`. Fix what it finds, then re-QA.

## Git
Commit as you go on `feat/v1` and push the branch to origin. Do NOT merge to main or deploy; Krrish reviews first. Leave the root checkout on clean main.

## Final report
Include the branch and latest SHA, how to run it locally, the build command and output directory, QA screenshot paths, what's done, and known limitations.
