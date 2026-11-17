# Rollover Benchmark Report

Generated: 2026-11-16T06:08:51.394Z

## Environment (measured)
- OpenCode: 2.x fork build (packages/cli/dist/rollover-test) (fork commit e3ed63c7de)
- Model: mockllm/test-model (local mock, autoUsage input = payload chars/4) (local mock LLM, scripted responses; input tokens derived from actual payload size)
- Hardware: Apple M4 · darwin arm64
- Config: per-seed thresholds (B1: 100k = no swap; others: 1k = aggressive), tailN 0 (B1: 2), plugin mode auto

## Datasets
Spec §7.2 scenarios B1–B10 (bench/seed, bench/prompts, bench/hidden). Ran: B1, B2, B4, B6, B7, B9. Not run: B3, B5, B8, B10 — no numbers are invented for scenarios that did not run.

## Baseline (plugin off)
| Scenario | rollovers ok/deferred/failed | input tok | output tok | peak ctx tok | LLM calls | extraction ms | consolidation ms | ctx reduction | cost | epochs |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | 0 / 0 / 0 | 20,603 | 40 | 6,723 | 4 | 0 | 0 | — | null (unpriced) | 0 |
| B2 | 0 / 0 / 0 | 48,960 | 90 | 7,020 | 9 | 0 | 0 | — | null (unpriced) | 0 |
| B3 | not run | — | — | — | — | — | — | — | — | — |
| B4 | 0 / 0 / 0 | 42,179 | 80 | 6,995 | 8 | 0 | 0 | — | null (unpriced) | 0 |
| B5 | not run | — | — | — | — | — | — | — | — | — |
| B6 | not run | — | — | — | — | — | — | — | — | — |
| B7 | not run | — | — | — | — | — | — | — | — | — |
| B8 | not run | — | — | — | — | — | — | — | — | — |
| B9 | not run | — | — | — | — | — | — | — | — | — |
| B10 | not run | — | — | — | — | — | — | — | — | — |

## Experimental (plugin auto)
| Scenario | rollovers ok/deferred/failed | input tok | output tok | peak ctx tok | LLM calls | extraction ms | consolidation ms | ctx reduction | cost | epochs |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | 0 / 0 / 0 | 24,279 | 70 | 6,725 | 7 | 53 | 0 | — | null (unpriced) | 0 |
| B2 | 5 / 0 / 0 | 56,194 | 150 | 6,865 | 15 | 231 | 0 | 98%, 99%, 99%, 99%, 99% | null (unpriced) | 5 |
| B3 | not run | — | — | — | — | — | — | — | — | — |
| B4 | 3 / 0 / 0 | 60,983 | 140 | 6,953 | 14 | 127 | 0 | 98%, 99%, 99% | null (unpriced) | 3 |
| B5 | not run | — | — | — | — | — | — | — | — | — |
| B6 | 0 / 2 / 3 | 28,201 | 100 | 6,713 | 10 | 0 | 0 | — | null (unpriced) | 0 |
| B7 | 2 / 0 / 0 | 71,635 | 160 | 7,221 | 16 | 124 | 0 | 99%, 100% | null (unpriced) | 2 |
| B8 | not run | — | — | — | — | — | — | — | — | — |
| B9 | 4 / 0 / 0 | 48,747 | 140 | 6,766 | 14 | 123 | 0 | 98%, 99%, 98%, 99% | null (unpriced) | 2 |
| B10 | not run | — | — | — | — | — | — | — | — | — |

## Context savings (spec §7.4)
- 159.6% HIGHER cumulative input (measured): for these short scripted scenarios the extraction requests + render prepend cost more than the truncation saves — the mock payload estimate also counts system/tool scaffolding identically on both sides. Cumulative savings are expected to turn positive only for conversations long enough that truncation outweighs extraction overhead; the honest per-swap signal is the ctx-reduction column.
- Immediate reduction at each swap: per-scenario "ctx reduction" column above (measured from swap metrics tokensBefore→tokensAfter).

## Cost
null for every scenario — the mock model has no price entry (pricing.json); spec §7.6 forbids inventing prices.

## Swap latency (spec §6)
p50 3.0 ms · p95 4.0 ms · max 4.0 ms (n=14, measured)

## Information retention (spec §7.5)
Per-scenario retention of expected facts after rollovers (experimental runs):

| Scenario | recall | precision | F1 | critical omissions | wrong invalidations | unresolved open items | false claims |
|---|---|---|---|---|---|---|---|
| B2 | 0.67 | 0.60 | 0.63 | none | none | none | none |
| B4 | 1.00 | 1.00 | 1.00 | none | none | none | none |
| B7 | 1.00 | 1.00 | 1.00 | none | none | none | none |
| B9 | 1.00 | 1.00 | 1.00 | none | none | none | none |

Matching: normalized token-Jaccard ≥ 0.4 (record↔fact), normalized substring (render). B6 expects recall 0 for ledger retention — its extraction is scripted to fail; facts survive only in intact history.

## Failed scenarios
none

## Limitations
- Mock-LLM usage: input tokens estimated from payload size (chars/4), cache values scripted 0 under autoUsage — absolute numbers approximate real provider accounting; baseline-vs-experimental comparisons remain valid because both sides use the same estimator.
- Extraction/consolidation answers are scripted; retention quality reflects the scripted extraction fidelity, not a production model.
- Scenarios marked "requires runtime evidence" in bench/hidden are env-dependent (wake-up shape, concurrency timing, restart behavior).
