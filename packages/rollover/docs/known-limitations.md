# Known limitations

Measured/verified as of 2026-11-19, v2 (suite: 273 tests, all pass / 1 skip; live smoke for the deterministic contract documented in `bench/seed/B6.json` + `bench/hidden/B6.json`).

## Token cost in short conversations (measured, v1 benchmark)

> The numbers below are v1 measurements; the v2 default (`mode: "off"`,
> per-session opt-in) and the `ledger: false` switch bound this cost, and the
> swap itself adds no LLM call at all.

- Extraction runs at idle after **every** turn — regardless of whether a swap ever happens. In the benchmark's short scripted scenarios, cumulative experimental input was **159.6% higher** than baseline: the per-turn extraction call plus the render prepend cost more than truncation saves at that scale.
- The idle hook **awaits** extraction (Ruling #8; debounced scheduling raced short-lived `opencode run` processes), so the end of each turn waits for the extraction LLM call — a small wall-clock cost per turn.
- Mitigations: `ledger: false` (swap-only pipeline), `extractionModel` for a cheap model, high/`null` threshold (default computes from the model limit, so short sessions never swap), or `mode: "off"`. Cumulative savings turn positive when history is long enough that the ~98% per-request reduction after a swap outweighs extraction overhead.

## Benchmark coverage

- **B8 (consolidation concurrency) and B10 (restart recovery) were NOT run** — both require runtime evidence (timing-dependent races; serve restart). They are labeled "not run" in the report; no numbers are invented for them.
- B7 ran, but wake-up delivery shape is runtime-dependent (P0-6); treat its result as env-specific.
- Extraction/consolidation answers are **scripted** in the mock LLM: retention scores reflect scripted extraction fidelity, not a production model's.
- Mock usage estimation: input tokens = payload chars/4 and cache values are 0 under `autoUsage` — absolute numbers approximate real provider accounting; baseline-vs-experimental comparisons share the same estimator.

## Retention scorer

- Token-Jaccard ≥ 0.4 cannot match single-token facts (e.g. B2's file fact `deploy.ts`), which drags measured recall (B2: 0.67) even though all flags (critical omissions, wrong invalidations, unresolved open items, false claims) were none. It is a measurement floor, not observed ledger loss.
- B1 (no rollover by design) and B6 (extraction scripted to fail) are excluded from retention scoring. In v2 B6's deterministic swap fires anyway — its mechanical projection carries the discarded turns, so the removed "in intact history" escape no longer exists; the render itself must be readable (verified by the B6 smoke).

## Behavior trade-offs (rulings)

- Ruling #7 removed the consecutive-same-role rejection from `buildViewPlan`: live 2.x primary requests legitimately contain consecutive assistant rows. A genuinely malformed tail could now render; mitigated by tail selection in `freezeRollover`.
- Extraction JSON schema validation is strict (B2/B7 initially shipped an invalid `status: "pending"` and extraction failed — by design). Real-model extraction must emit the exact schema.
- `/rollover` threshold validation rejects values above the model limit (verified: `150k` on a 100k-limit model → error message). No override exists.

## Not verified / deferred

- The TUI toast rendering was verified via state + text derivation only (P0-13); no human visual check of the live TUI toast has been done.
- Global/desktop OpenCode installs are untouched by design; using the plugin there requires merging the fork or replicating the 2.x surface — untested outside this repo.
- `metrics_only` mode runs metrics but no swaps; it is covered by unit tests, not by an end-to-end scenario drive.
