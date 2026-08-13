# Capture Feedback Performance

## Goal

Minimize edit-to-feedback latency for one catalog flow while preserving an isolated, reproducible full capture.

## Benchmark

```sh
bun run bench:capture-flow
```

The benchmark performs one warmup and seven measured runs of `search-lifecycle` against immutable OpenCode revision `5d5b33f195cc`.

## Metrics

- Primary: `capture_flow_total_median_ms`
- Secondary: preparation median, total MAD, best, and worst

## Baseline

Cold targeted capture before cache reuse:

- Preparation: 24,261 ms
- Total: 48,642 ms

The previous full-catalog-only workflow also replayed the baseline and every preceding flow before reporting a late failure, so it had no bounded per-flow feedback metric.

## Hypotheses

1. Reusing a revision-keyed immutable worktree removes repeated checkout and install cost.
2. Running all scenarios through one OpenCode process removes repeated server and TUI startup from full capture.
3. Staging frames outside `public` prevents failed experiments from contaminating authoritative artifacts.

## Experiments

### Revision-keyed worktree cache

- Before: 48,642 ms cold targeted capture; 24,261 ms preparation
- After: 15,448 ms warm targeted median; 102 ms preparation median
- Spread: 4,077 ms MAD; 11,371 ms best; 22,619 ms worst
- Decision: keep

The cache removes repeated checkout and dependency installation while retaining the exact resolved commit. `--fresh` remains available to deliberately rebuild the prepared checkout.

### Registry-driven process reuse

- Before: nine OpenCode server/TUI lifecycles for the baseline and eight lifecycle scenarios
- After: two lifecycles, grouped by the Drive controller's `queue` and `serve` response modes
- Full 60-state capture: 88,910 ms
- Scenario execution: approximately 40,100 ms; remaining time is baseline capture and two process lifecycles
- Decision: keep

A single process cannot truthfully combine `queue` and dynamic `serve`: Drive deliberately locks each controller to one response mode. Grouping by declared scenario mode preserves that invariant while removing seven process launches.

### Staged publication

- Before: failed runs wrote partial and orphaned frames directly into `public/captures`
- After: full runs write to a unique staging tree and replace revision directories only after all scenarios pass
- Decision: keep for correctness; it does not target the latency metric

### Registry-declared client isolation

- Before: 150,825 ms with one fresh TUI client per scenario
- After: 142,652 ms with one shared client for reset-safe queue scenarios and isolated clients for assistant interruption and read permission
- Improvement: 5.4%
- Decision: keep

The next pooling candidates require weakening explicit lifecycle guarantees for a small projected gain, so optimization stops here.

## Dead Ends

- Repeated full capture after each marker edit recreated and reinstalled the same revision.
- A manually prepared `/tmp` worktree reused Bun install metadata without creating complete local dependency links.
