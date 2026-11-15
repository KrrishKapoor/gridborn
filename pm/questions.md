# Gridborn questions

Updated: 2026-11-15. Newest first. Away mode: PM resolves questions using the brief and records decisions rather than waiting for Krrish.

## Open

None. No credential or permission blocker found in initial repository/provider checks.

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
