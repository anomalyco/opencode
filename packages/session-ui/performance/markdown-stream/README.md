# Markdown Streaming Projection

Micro-benchmark of `project()` in `src/components/markdown-stream.ts`. It streams
deterministic fixtures through `project(previous, text, true)` with the same small
delta cadence a provider emits tokens, and records total projection time,
per-update latency (median / p95 / p99 / max), and the characters scanned by
`@opencode/patchmark`. No OpenCode server, session, or user data is used.

Run from `packages/session-ui`:

```sh
bun performance/markdown-stream/project.bench.ts [output.json] [reps]
bun performance/markdown-stream/scale.bench.ts [output.json]
```

`project.bench.ts` runs the main workloads (default 5 measured passes each after a
JIT warm-up). `scale.bench.ts` sweeps one boundary-less paragraph over 250, 500,
1,000, and 2,000 words. Both accept an optional JSON output path.

The scanner counters wrap `PatchmarkStream.prototype.update`, which `project()`
calls once per delta, and sum the `charsScanned` field from its frame. That is the
incremental parser's own measure of work for the update, so the totals show how
much of the accumulated message is re-scanned as the response grows.
`project.bench.ts` also checks the partition contract
`blocks.map(b => b.raw).join("") === text` on every update. While streaming,
patchmark may hold a trailing bare marker (`- `, `1. `) or setext candidate until
its first content character arrives, so the partition is a prefix for those
updates; the harness reports those as `heldTails` separately from real
`partitionMismatches`.

The workloads are:

- `many-paragraph-deltas`: 200 short paragraphs, each delta adding a blank-line boundary.
- `one-long-paragraph`: one boundary-less paragraph, one word per delta.
- `completed-head-live-tail`: 40 completed paragraphs delivered up front, then a growing 500-word tail.
- `mixed-long-response`: headings, prose, lists, a table, and TypeScript fences streamed in 8-char chunks.
- `growing-list`: 300 list items appended.
- `growing-table`: 300 table rows appended.
- `open-code-fence`: an open `ts` fence streamed 400 lines.

## Results

Representative run on one machine (Linux x86_64, AMD Ryzen Threadripper 1920X,
Bun 1.4.2), 3 measured passes per workload after a JIT warm-up (medians shown).
Absolute times are machine-specific; the ratios and scan counts are the signal.

`Marked baseline` is `f2735ef79b^`, the commit before streaming projection moved
to `@opencode/patchmark` (#57016), run through the same fixtures and timing loop
with its `marked` lexer counters. `Current` is the patchmark-backed projection in
`src/components/markdown-stream.ts`.

The baseline harness is not part of this PR. The numbers were produced by checking
out `f2735ef79b^` in a separate worktree, copying both benchmark scripts there, and
replacing the patchmark scanner counters with `Marked.prototype.lexer` counters.
The fixtures and timing loop are otherwise identical. This is a one-off comparison,
not something CI regenerates.

| Workload                       | Marked baseline | Current  | Speedup | Baseline lex chars | Current chars scanned |
| ------------------------------ | --------------- | -------- | ------- | ------------------ | --------------------- |
| `many-paragraph-deltas`        | 160.6 ms        | 4.6 ms   | 35.0×   | 928,093            | 9,251                 |
| `one-long-paragraph` (12.6 KB) | 10,870.9 ms     | 118.0 ms | 92.1×   | 12,630,526         | 12,630,526            |
| `completed-head-live-tail`     | 263.8 ms        | 9.1 ms   | 29.1×   | 1,830,207          | 789,207               |
| `mixed-long-response`          | 894.2 ms        | 16.8 ms  | 53.1×   | 6,148,374          | 243,227               |
| `growing-list`                 | 422.5 ms        | 5.2 ms   | 80.5×   | 1,832,940          | 12,272                |
| `growing-table`                | 171.6 ms        | 2.6 ms   | 65.5×   | 1,284,344          | 8,601                 |
| `open-code-fence`              | 1.2 ms          | 4.6 ms   | 0.26×   | 6                  | 8,186                 |

`scale.bench.ts` (one size per row), one boundary-less paragraph streamed one word
per delta:

| Words | Chars  | Marked baseline | Current  | Baseline lex chars | Current chars scanned |
| ----- | ------ | --------------- | -------- | ------------------ | --------------------- |
| 250   | 1,576  | 32.6 ms         | 7.4 ms   | 197,240            | 197,240               |
| 500   | 3,151  | 112.2 ms        | 16.0 ms  | 789,207            | 789,207               |
| 1,000 | 6,316  | 418.2 ms        | 37.5 ms  | 3,157,346          | 3,157,346             |
| 2,000 | 12,626 | 11,098.4 ms     | 117.6 ms | 12,630,526         | 12,630,526            |

For a paragraph with no newline the active line is the whole paragraph, so the
scan count still grows with the square of the response length — both
implementations re-scan the same text. The difference is what happens per scan:
patchmark parses incrementally instead of re-lexing and re-healing the full
document, so wall time stays ~90× below the baseline instead of following the
scan count. Structured responses (paragraphs, lists, tables) settle closed blocks
and stop scanning them, which is why their scan totals stay near the final text
length.

The open code fence is the one measured regression: patchmark does more work per
update for a single still-open fence than the old dedicated code fast path. The
absolute difference is ~3.4 ms across 401 updates.

`project.bench.ts` reports `partitionMismatches: 0` on every workload; the
`mixed-long-response` `heldTails` count comes from `- ` list markers split across
8-char deltas.

## Limitations

- This measures `project()` CPU only. It does not measure worker message passing,
  the Solid reactive store, or DOM/HTML re-parsing. Renderer-side per-delta cost
  is tracked separately (#54427) and must not be inferred from these numbers.
- Fixtures are synthetic and English-only. The algorithmic properties measured
  (per-delta scan work, block settling) are workload-independent, but real
  responses can differ in token cadence and markdown mix.
