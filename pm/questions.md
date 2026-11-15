# Gridborn questions

Updated: 2026-11-15. Newest first. Away mode: PM resolves questions using the brief and records decisions rather than waiting for Krrish.

## Open

None. No credential or permission blocker found in initial repository/provider checks.

## Resolved — 2026-11-15 T1 QA (Codex PM)

- Overshooting a loop's start is ordinary drawing behavior: correct it conservatively before integration rather than asking visitors to stop precisely.
- Jitter cleanup must retain rejection of true crossings and road overlap. This requires a geometry follow-up plus fresh QA, not simply removing validation.

## Resolved — 2026-11-15 T3 QA and T2 handoff (Codex PM)

- T3 has no high-severity defect, but three medium issues need production fixes: assign them explicitly to T4's integrated inspector/layout work and fresh re-QA; do not call the product complete yet.
- Preserve the user's unchecked illustrative-mode preference across car selections; keep mode labels clear and the hero inspector live.
- Small random steering weights and positive throttle bias are acceptable initialization, provided there is no embedded driving policy or track knowledge. Fresh T2 QA will independently check that and lap improvement.

## Resolved — 2026-11-15 T3 handoff (Codex PM)

- “Live” teaching demos respond to input and actual supplied simulation data; they need no decorative continuous motion. Illustrative genetics and corner exploration remain explicitly labeled.
- The preset menu emits a load action and returns to its prompt rather than implying a requested track has already been accepted.

## Resolved — 2026-11-15 T1 handoff (Codex PM)

- Drawing width inherits the selected circuit's width (presets use 92 world units).
- Resize/scroll/view changes during drawing cancel the stroke instead of remapping it; density-only changes preserve it. Independent QA will test this behavior.

## Resolved — 2026-11-15 T0 QA (Codex PM)

- Who owns overlay hit testing? T1 disables overlay pointer events outside drawing; T3 starts it disabled; T4 selects cars on the underlying hero canvas and suppresses selection while drawing.
- What if a reset fails? Keep the previous accepted run until a new `ready` acknowledgement; reject the pending run without stalling the old one.
- Should disposable scaffold findings delay all feature work? No high-severity findings remain, so accept the scoped scaffold and carry every applicable low issue into its production replacement and fresh QA, as recorded in decisions.

## Resolved — 2026-11-15 scaffold handoff (Codex PM)

- Review location: use the completed worker checkout and exact SHA without changing branches; QA writes only evidence, PM preserves it on acceptance.
- Concrete geometry and NN defaults: 1200 × 800 world; 7 ray distances plus speed into an 8 → 8 → 2 tanh network. These are within the fixed brief and now documented for feature workers.

## Resolved — 2026-11-15 (Codex PM)

| Question | Resolution |
| --- | --- |
| Does “1,000 cars at 60 fps” imply every phone/browser? | Treat it as a benchmark target, expose the population, measure at requested viewports, and disclose actual limits. Default to hundreds and use a worker as warranted. |
| What should happen with tiny or self-intersecting drawings? | Reject with useful inline feedback while retaining the last usable track. |
| Which visual style and dependencies? | Light editorial design, restrained racing accent, system fonts, native DOM/Canvas2D, Vite + TS + Vitest, deterministic local simulation. |
| Should optional dark mode delay delivery? | No; required experience and QA take priority. |
| Should this workflow create a hosted Site or deploy Cloudflare Pages? | No. Commit/push `feat/v1`, provide `npm run build` / `dist/` handoff, and leave deployment to Cortana. |
| How can parallel tasks agree without speculative abstractions? | A small scaffold establishes contracts and file ownership before track, engine, and editorial workers begin. |
