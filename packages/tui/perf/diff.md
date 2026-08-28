# Diff Rendering

## Goal

Keep complete large diffs usable without hiding patches or requiring loading consent. Measure initial rendering and scrolling independently, and preserve first/last-line access, wrapping, gutters, navigation, syntax, and selection.

## Benchmark

Run from `packages/tui`:

```sh
bun run bench:diff hunks 1000
bun run bench:diff lines 50000
DIFF_BENCH_WIDTH=80 bun run bench:diff lines 50000
bun run bench:diff long 20000
DIFF_BENCH_FILES=40 bun run bench:diff hunks 25
```

The benchmark renders the production `PatchDiff`, with one containing box per file as in the viewer. It bypasses size guards, verifies access to the complete patch's last line, warms up once, and measures seven runs by default. `DIFF_BENCH_RUNS` overrides the measured run count; `DIFF_BENCH_SYNTAX=1` enables JSON highlighting. Report first-frame median/spread, scrolling p95/max, and process RSS separately.

Do not render hunks directly under the benchmark's scrollbox: that gives them direct-child viewport culling that the viewer's file cards do not have.

## Hypotheses

1. Per-hunk gutter-sync scheduling repeats whole-file work. Coalescing callbacks should remove that quadratic mount cost without changing rendered content.
2. Gutter framebuffers and background painting scale with content height. Viewport-bounded painting should reduce giant-hunk scroll cost and native allocation without windowing text content.
3. Repeated `lineInfo` reads decode full-document arrays. Correctly invalidated caching or range reads should reduce metadata allocation while preserving wrapped/source-line mappings.

## Results

Measured on the local machine with one warmup and three measured runs:

```sh
DIFF_BENCH_RUNS=3 bun run bench:diff hunks 1000
```

| Experiment                                     | Ready Median | Ready Range  | Scroll p95 | Scroll Max | Process RSS Max |
| ---------------------------------------------- | ------------ | ------------ | ---------- | ---------- | --------------- |
| Baseline, complete file-card subtree           | 8762 ms      | 7845-9027 ms | 33.36 ms   | 70.61 ms   | 1616 MB         |
| Coalesce whole-file gutter callbacks           | 324 ms       | 306-377 ms   | 31.58 ms   | 34.27 ms   | 967 MB          |
| Read widths without resetting number/sign maps | 307 ms       | 301-318 ms   | 29.61 ms   | 34.86 ms   | 967 MB          |

Keep callback coalescing: initial rendering improves substantially with the same complete content and tail access. It does not solve steady-state painting; scrolling remains about 32 ms p95. RSS includes JavaScript/native allocation and process high-water behavior across repeated mounts, not just gutter storage.

The narrower width pass removes redundant map replacement and unbounded argument-list maxima. Its timing difference overlaps the earlier spread; keep it for fewer data mutations, not as an independently proven speedup.

Before the renderer patch, the same component with a 50,000-line modified hunk at 160 columns measured 225 ms median ready time (215-239 ms), 22.55 ms scroll p95, and 25.52 ms scroll maximum across three runs. A 100,000-line modified hunk at 80 columns measured 530 ms ready time and 60.51 ms scroll p95 in a single measured probe; that single-run probe is diagnostic, not a stable benchmark comparison.

The benchmark's initial setup is not a performance result; production-component and full-viewer Drive verification are complementary. Record subsequent isolated experiments here before keeping them.

## Final Matrix

The unguarded V2 base `0d42e76006` and the final consumer patch use the same harness and fixtures. Each case warms up once and measures seven runs; all cases run sequentially without concurrent build/test activity. Syntax is disabled in this rendering benchmark; the production viewer tests and Drive fixtures exercise JSON highlighting separately.

| Fixture                               | Ready Median Before / After | Scroll p95 Before / After | Process RSS Max Before / After |
| ------------------------------------- | --------------------------- | ------------------------- | ------------------------------ |
| 1,000 original hunks, 160 columns     | 9083 / 264 ms               | 53.11 / 7.20 ms           | 1600 / 871 MB                  |
| 50,000 modified lines, split          | 231 / 160 ms                | 38.57 / 0.34 ms           | 784 / 677 MB                   |
| 50,000 modified lines, unified        | 236 / 164 ms                | 21.67 / 0.29 ms           | 1029 / 674 MB                  |
| 20,000-character modified line, split | 59 / 77 ms                  | 0.33 / 0.27 ms            | 240 / 234 MB                   |
| 40 files with 25 hunks each           | 343 / 161 ms                | 1.48 / 1.28 ms            | 790 / 568 MB                   |
| 100,000 modified lines, unified       | 552 / 331 ms                | 53.42 / 0.36 ms           | 1532 / 1084 MB                 |

All cases expose their complete tails. Long markers can cross wrap rows, so that case reconstructs the visible final Code pane without interleaving the other side; the earlier contiguous-screen-marker check falsely rejected both revisions and was corrected identically before accepting these results.

The long-line opening adds about one frame (18 ms) to settle actual pane-width alignment. That is a measured correctness tradeoff, not a speedup. The many-hunk base also shows substantial spread (7879-17307 ms ready, 309 ms maximum scroll frame); the final ready range is 259-301 ms with a 19 ms maximum scroll frame. Measurements include process/compiler/allocator behavior and should not be presented as hard latency or memory guarantees.

The dependency patch retains complete native text/layout and selection owners. It bounds decoration raster allocation, paint visits, and source-ID readback, not source loading or full content-node virtualization. Native `0.5.9` platform binaries remain unchanged.
