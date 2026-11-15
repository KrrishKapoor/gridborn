# Gridborn

An interactive article about neuroevolution. Hundreds of small sensor-driven neural networks learn to race, entirely in your browser.

## Run locally

Use Node 22.12+, 24+, or 26+ and npm. There are no runtime dependencies, accounts, API keys, or backend services.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Development opens at `http://127.0.0.1:5173`; preview serves the built application at `http://127.0.0.1:4173`. Add `-- --port 5194` to either server command to choose another port. `npm run typecheck` runs TypeScript alone. Some npm versions warn about the optional macOS `fsevents` install script; it is not required to run or build the application.

`npm run build` produces **`dist/`**, including the real application and its module worker. This is the Cloudflare Pages handoff: build command `npm run build`, output directory `dist`. Serve over HTTP(S), not `file://`, so module workers load. No deployment has been performed.

## Explore

- The default oval starts with 512 cars. Choose 128, 256, 512, or 1,000; a population or circuit change starts fresh learning.
- Draw a generous loop with a mouse, pen, or touch. The previous circuit remains until a valid replacement is accepted. **Clear drawing** erases only the draft. **Reset learning** restarts the current circuit with the same seed.
- Pause, watch at 1× or 4×, or choose **Fast** to learn without rendering cars. Fast is throughput mode, not a fixed multiplier. A hidden tab pauses computation and resumes the visitor's chosen state without catching up.
- Click/tap an actual car, or focus the field and press Enter / an arrow key. Inspection shows its real rays, signed weights, and activations. Escape or Close returns focus to the field. A selection belongs to one generation and clears at the next.
- The four lessons distinguish illustrative controls from live observations. Unchecking **Follow selected car** preserves that preference. The hero inspector always uses actual data.

## Model and limits

Seven wall-distance rays plus speed feed an **8 → 8 → 2** tanh network. Its outputs drive steering and throttle; the network has no map or ideal line. A seeded genetic algorithm keeps elites, selects parents, crosses weights, and mutates offspring. Fitness ranks valid timed laps above incomplete forward progress. Cars are independent and do not collide with each other. See [simulation details](docs/simulation.md).

The glowing line is a recorded winning trajectory. Before a car finishes, the best attempt remains partial and the lap readout says “no lap yet.” Improvement is not guaranteed for every circuit, seed, population, or generation; very tight, crossing, or out-of-bounds drawings are rejected. Short closure tails and ordinary hand jitter are smoothed; sharp corners, long retraced tails, and some noisy phone strokes can still be rejected. The previous circuit survives a rejected drawing. Draw inside the dashed guide, which leaves room for the road around your stroke; Escape cancels an unfinished stroke.

Canvas2D renders on the main thread; fixed-step inference and evolution run in a worker. Normal presentation uses a small, bounded interpolation buffer of actual poses, with no extrapolation. Inspection uses exact snapshot poses to keep its network and rays coherent. The road and recorded line are cached, history is capped at 256 generations, and transferable snapshots use a bounded pool. Fast mode sends about ten observations per second and hides the cars.

Performance depends on browser, hardware, population, and how many cars survive. The implementation evidence separates display FPS, fresh state, interpolated motion, worker steps, and compute time; it is not a universal 60 fps claim. Current verification uses desktop Chrome and emulated touch/DPR, not physical iOS Safari. See [integration and reproduction notes](docs/integration.md), `artifacts/qa/t4/implementation/`, and the independent T4 PASS in `artifacts/qa/t4/round-1/`. Fresh final Opus QA passed the combined branch: 144 unit tests and 634 final browser assertions at 1440×900, 390×844 and 844×390, with no high or medium findings. See the [final QA report](artifacts/qa/final/round-1/report.md) and [review/deployment handoff](pm/handoff.md) for evidence and retained limits.
