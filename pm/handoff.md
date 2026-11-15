# Gridborn review handoff

Complete on `feat/v1`, pushed to `origin`. Root checkout remains clean `main`. Nothing was merged to main or deployed. The final independent review covered `50c48845a1787a64b064c2ca33aa511ad2ea8e12`; subsequent commits contain only documentation and preserved QA evidence. The final delivery SHA is the current `origin/feat/v1` tip.

## Built

A static Vite + TypeScript editorial explainer with an automatically running 512-car simulation (up to 1,000 selectable), mouse/touch track drawing and presets, genuine deterministic neural-network evolution in a Web Worker, lap/fitness history, a recorded glowing racing line, pause/speed/headless controls, exact car sensor/network inspection, and four interactive teaching sections. No framework, backend, account, or service credential is required.

## Run and build

Use the feature worktree so the root checkout stays on main:

```sh
cd ~/.t3/worktrees/gridborn/feat-v1
npm ci
npm run dev
```

`npm test` runs Vitest once. `npm run build` typechecks and produces the static **`dist/`** directory. `npm run preview` serves that build locally. Tested with Node 26.13.1; supported versions are declared in `package.json`.

Cloudflare Pages handoff for project **gridborn**: repository root is the build root, build command **`npm run build`**, output directory **`dist`**. No application environment variables or backend are needed. Cortana handles deployment after Krrish reviews.

## Independent QA

Every reviewer was a fresh Claude Opus 5.5 high thread that did not build the code. Workers were Codex GPT-6 Astra xhigh in isolated worktrees.

| Task | Result |
| --- | --- |
| T0 scaffold/contracts | PASS, round 1; applicable production follow-ups verified during integration |
| T1 editor + T1R closure/jitter | PASS after round 2; no high/medium remaining |
| T2 physics/NN/evolution worker | PASS, round 1; runtime follow-ups independently verified in T4 |
| T3 article/teaching demos | Conditional PASS, round 1; all three medium findings independently resolved in T4 |
| T4 production integration | PASS, round 1; drawing-guide and Escape follow-ups independently verified by final QA |
| Final combined product | **PASS, round 1; no high or medium findings** |

Final checks: **144/144 unit tests**, successful clean install and production build, and **634/634 final browser assertions** across dev and built production at **1440×900, 390×844, and 844×390**. Genuine improving laps, deterministic replay, real recorded paths, exact ray/NN inspection, drawing/cancellation, touch input, controls and visual polish were verified. No app console/page/request errors or horizontal overflow. Production diagnostics are absent.

Performance held approximately 60 fps with approximately 60 fresh simulation states/s at 512 and 1,000 cars in the measured M5/Chrome environment. The review distinguished moving frames from repeated states and measured worker throughput separately. This is not a physical-phone benchmark.

Final [report](../artifacts/qa/final/round-1/report.md), [results](../artifacts/qa/final/round-1/results.json), scripts, logs and raw data are preserved with **149 screenshots** in `artifacts/qa/final/round-1/`. Earlier task reviews remain under `artifacts/qa/t0/`, `t1/`, `t2/`, `t3/`, and `t4/`. Superseded test-script failures are retained and explained in the report; the final total excludes that superseded iteration. QA dependencies were omitted from the evidence copy.

Representative final screenshots:

- [Desktop hero](../artifacts/qa/final/round-1/screens/prod-1440x900-01-hero.png)
- [Portrait drawing guide](../artifacts/qa/final/round-1/screens/prod-390x844-guide-01-drawing-guide.png)
- [Landscape hero](../artifacts/qa/final/round-1/screens/prod-844x390-01-hero.png)

## Decisions and limitations

PM chose 512 default cars with 1,000 selectable; light styling without optional dark mode; system fonts; native DOM/Canvas2D plus a worker; and conservative invalid-track rejection that preserves the previous valid circuit. Full dated reasoning is in [decisions](decisions.md).

Five low final findings remain: cramped finger drawing in short landscape, a keyboard Escape hint on touch-only screens, scrolling at some intermediate laptop sizes, scrolling to the selected-car inspector, and unused worker capacity in Fast mode. Sharp/tight corners, long retraced tails and some noisy quantized strokes can be rejected. Selection clears each generation; offscreen demo labels refresh when revealed. Learning improvement is not guaranteed for every seed/circuit/generation.

Mobile input was Chrome-emulated; physical iOS/Safari/Android and genuine OS hiding were not verified. Controlled visibility and cleanup checks passed. All owned QA servers and browser sessions were closed. No open blocker remains.
