# Gridborn

An interactive neuroevolution racing explainer, in development. The planned experience lets you draw a circuit and watch sensor-driven neural networks learn to race.

Current milestone: **T0 scaffold only.** The page demonstrates responsive Canvas2D pointer/keyboard coordinates. No racing simulation, evolution, track editor, or performance claim yet.

## Run locally

Use Node `^22.12.0 || ^24.0.0 || >=26.0.0` (verified with Node 26.13.1 and npm 11.20.0).

```sh
npm ci
npm run dev -- --port 5190
```

Open the printed localhost URL. Tap/drag the marker, or focus the canvas and use arrow keys (Shift for larger steps). Home or **Center marker** resets its position. The preview adapts to desktop, portrait, and landscape layouts; its readout remains in logical world units.

```sh
npm test                         # Vitest, once; no watch process
npm run typecheck                # Strict TypeScript
npm run build                    # Typecheck + static output in dist/
npm run preview -- --port 4190   # Serve the production build
```

Vite, TypeScript and Vitest are exact-pinned with an npm lockfile. No framework, external fonts, backend, or runtime dependencies. Ports are strict; select a different explicit port if occupied. Some npm versions may report an unapproved optional `fsevents` install script; the tested install/build/dev flow works without approving it.

## Implementation handoff

[Architecture and exact shared contracts](docs/architecture.md) define T1 track/editor, T2 simulation worker, T3 editorial UI and T4 runtime ownership, coordinates, reset semantics, selection identity, and transferable buffer reuse. Independent task previews use `/qa/t1.html`, `/qa/t2.html`, `/qa/t3.html` once their owner creates them; they are not production build inputs.

Tests currently verify coordinate mapping and snapshot transport. Physics/ray/NN/GA tests and measured 1,000-car performance belong to later tasks. Fresh independent browser QA remains a separate gate. Generated QA evidence belongs in `artifacts/qa/`.

This is a static, browser-only Vite application. `dist/` is the eventual Cloudflare Pages handoff; deployment and merging are owner actions.
