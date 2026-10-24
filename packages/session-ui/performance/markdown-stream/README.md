# Markdown Streaming Projection

Micro-benchmark of `project()` in `src/components/markdown-stream.ts`. It streams
deterministic fixtures through `project(previous, text, true)` with the same small
delta cadence a provider emits tokens, and records total projection time,
per-update latency (median / p95 / p99 / max), and marked lexer invocations and
characters. No OpenCode server, session, or user data is used.

Run from `packages/session-ui`:

```sh
bun performance/markdown-stream/project.bench.ts [output.json] [reps]
bun performance/markdown-stream/scale.bench.ts [output.json]
```

`project.bench.ts` runs the main workloads (default 5 measured passes each after a
JIT warm-up). `scale.bench.ts` sweeps one boundary-less paragraph over 250, 500,
1,000, and 2,000 words. Both accept an optional JSON output path.

The lexer counters wrap `Marked.prototype.lexer`, which both the baseline and the
incremental implementation call. Text handled by the `refs()` shortcut never
reaches the lexer, so the counters reflect actual re-lex work. `project.bench.ts`
also checks the partition contract `blocks.map(b => b.raw).join("") === text` on
every update; this is a correctness signal, not a timing result.

The workloads are:

- `many-paragraph-deltas`: 200 short paragraphs, each delta adding a blank-line boundary.
- `one-long-paragraph`: one boundary-less paragraph, one word per delta.
- `completed-head-live-tail`: 40 completed paragraphs delivered up front, then a growing 500-word tail.
- `mixed-long-response`: headings, prose, lists, a table, and TypeScript fences streamed in 8-char chunks.
- `growing-list`: 300 list items appended.
- `growing-table`: 300 table rows appended.
- `open-code-fence`: an open `ts` fence streamed 400 lines.

Interpret the speedup ratios as the relevant result; absolute times are
machine-specific. To compare against a baseline, freeze that revision in a
separate worktree and run the same harness, runtime, and fixture there. The
benchmark targets the pre-change behavior where an ordinary live tail was
re-lexed from the whole accumulated message on every delta, so baseline lexer
characters grow roughly quadratically with response length while an in-place tail
stays constant.

## Results

Representative run on one machine (Linux x86_64, AMD Ryzen Threadripper 1920X,
Bun 1.4.2, Marked 18.0.11), `origin/dev` baseline vs this branch, both streamed
through the same harness in the same environment, 5 measured passes per workload
(medians shown). Absolute times are machine-specific; the ratios and lexer
character counts are the signal. Lexer characters are totals across the 5 passes.

| Workload | Baseline | Incremental | Speedup | Baseline lex chars | Incremental lex chars |
| --- | --- | --- | --- | --- | --- |
| `many-paragraph-deltas` | 145.3 ms | 9.1 ms | 15.9× | 4,640,465 | 92,230 |
| `one-long-paragraph` (12.6 KB) | 10,565.2 ms | 92.5 ms | 114.3× | 63,152,630 | 20 |
| `completed-head-live-tail` | 241.0 ms | 7.9 ms | 30.6× | 9,151,035 | 240 |
| `mixed-long-response` | 837.8 ms | 21.5 ms | 38.9× | 30,741,870 | 316,600 |
| `growing-list` | 406.0 ms | 19.1 ms | 21.2× | 9,164,700 | 170 |
| `growing-table` | 172.4 ms | 13.8 ms | 12.5× | 6,421,720 | 50 |
| `open-code-fence` | 1.6 ms | 0.8 ms | 2.0× | 30 | 30 |

`scale.bench.ts` (one size per row) shows the baseline lexer work growing
quadratically while the in-place tail stays constant:

| Words | Chars | Baseline | Incremental | Baseline lex chars | Incremental lex chars |
| --- | --- | --- | --- | --- | --- |
| 250 | 1,576 | 26.4 ms | 5.1 ms | 197,240 | 4 |
| 500 | 3,151 | 87.1 ms | 9.9 ms | 789,207 | 4 |
| 1,000 | 6,316 | 320.2 ms | 30.9 ms | 3,157,346 | 4 |
| 2,000 | 12,626 | 10,570.6 ms | 95.9 ms | 12,630,526 | 4 |

No measured workload regressed, and `project.bench.ts` reports 0 partition
mismatches (`blocks.map(b => b.raw).join("") === text`) on every update.

## Limitations

- This measures `project()` CPU only. It does not measure worker message passing,
  the Solid reactive store, or DOM/HTML re-parsing. Renderer-side per-delta cost
  is tracked separately (#54427) and must not be inferred from these numbers.
- The incremental path still runs a residual `heal`/`remend` scan over the live
  tail per delta, so a boundary-less tail is not strictly linear; total work
  keeps a mild superlinear term far below the baseline.
- Fixtures are synthetic and English-only. The algorithmic properties measured
  (per-delta lex work, quadratic-vs-linear growth) are workload-independent, but
  real responses can differ in token cadence and markdown mix.
