# Usage statistics latency

## Target

Reduce the time `/stats` spends on its loading screen without changing the
reported statistics. Primary metric: median `SessionStats.get` latency for the
TUI's year-to-date, all-projects, `tools: "none"` request.

## Benchmark

Run from `packages/core` against a private, consistent SQLite backup, never the
live database. The harness opens read-only, bypasses migrations, runs the actual
core implementation, and prints a response digest, wall time, and maximum
event-loop timer delay. It does not print model identities or message contents.

```sh
bun run benchmark:stats --database /path/to/snapshot.db \
  --from 1767243600000 --to 1788622355637 --timezone America/New_York --runs 7
```

One warmup precedes seven measured runs. Use the same snapshot and fixed range
for every experiment. Compare response digests as well as latency; pass
`--expected-digest <baseline-digest>` to fail if the result changes. The final
confirmation used nine measured runs. SQL spans were temporarily enabled in
the Drizzle adapter during diagnosis and removed afterward. Their timings
included driver overhead, not just native-query CPU time.

Take SQLite backups with a pinned read transaction on the source so concurrent
writes cannot continually restart the backup. Set `journal_mode=DELETE` on the
completed **copy** before opening it read-only. Apply the new migration to that
copy before benchmarking the indexed candidate. Do not run migrations on the
live database as part of this benchmark.

## Initial evidence

- Base: `97303c39dd` on V2.
- Installed server: `0.0.0-dev-19134`.
- Live year-to-date request: **20.78 s**, including CLI overhead. This initial
  probe used `Europe/London` for activity grouping; the fixed snapshot benchmark
  uses the machine's local timezone, `America/New_York`.
- Live response: 846,911 assistant steps, 4,141 top-level sessions, and 15,548
  subagent sessions. Local database approximately 18 GiB.
- The TUI shows no statistics until the entire resource resolves.
- SQLite adapters execute synchronously, so long individual statements also
  block the server event loop.

## Hypotheses

1. Reading and parsing message JSON dominates: a query avoiding payload access
   should reduce SQL time substantially.
2. Compaction event lookup dominates: its SQL spans should account for most of
   the total, and a better lookup plan should reduce them.
3. JavaScript aggregation dominates: SQL spans should be small compared with
   total duration; cheaper daily grouping should reduce that gap.

## Experiments

### Baseline diagnosis

The first three measured snapshot runs were 54.93 s, 54.44 s, and 54.36 s
(cold warmup: 90.06 s). Message SQL accounted for about 53 s per warm run;
JavaScript and the remaining work accounted for about 1.3 s. Compaction event
queries took about 5 ms in total: the missing `event_aggregate_type_seq_idx` in
this particular database is **not** the bottleneck. Its original migration is
marked complete, but the index's historical absence has not been explained.

`EXPLAIN` shows nine `Column` operations loading `message.data` per message,
one before each `json_extract`. A native sample localized most samples to
SQLite overflow-payload reads (`vdbeColumnFromOverflow` → `pread`).

### Experiment 1: extract once

Hypothesis: a materialized CTE that extracts only model, tokens, and cost once
will avoid eight repeated large-payload reads without changing write behavior.
The outer SELECT extracts the same fields from the compact intermediate JSON.

Correctness: existing stats test plus a large-body fixture covering a 31-day
window boundary, non-UTC activity grouping, fractional costs, model variants,
and the exclusive upper range bound.

**Discard.** Median 56,412.77 ms versus the 54,926.37 ms baseline. Avoiding
repeated extraction did not remove the underlying large-payload I/O cost.

### Experiment 2: covering index

Add `session_message_stats_idx` over timestamp, session ID, type, and the nine
scalar model/token/cost expressions already selected by `SessionStats.get`.
`EXPLAIN QUERY PLAN` confirms `USING COVERING INDEX`: the query no longer loads
message bodies. No statistics-query rewrite or separate projection is needed.

**Keep.** Median **2,017.73 ms**, with the same response digest in all runs.
Index size: 96,362,496 bytes (**91.9 MiB**). One-time build: **69.64 s** on
the private snapshot. This is a real startup migration cost, not a free cache.

### Experiment 3: yield between daily batches

The covering index alone still delayed a 1 ms event-loop timer for up to
2,053.05 ms: the Effect loop did not yield to the host between message batches.
Use daily message windows and an explicit `Effect.yieldNow` after each fold.
Tool-statistics windows remain unchanged.

**Keep for responsiveness.** Median **2,229.38 ms**, maximum measured timer
delay **69.13 ms**. The approximately 0.2 s latency cost removes the multi-second
server stall. Calendar windows are not a hard row-count or latency bound.

### Experiment 4: reuse the local date within a day

After removing payload I/O, about 1.3 s remained in per-message aggregation.
Cache the last formatted date with timezone-aware start/end bounds instead of
calling `Intl.DateTimeFormat.formatToParts` for every assistant message. The
cache is local to one stats request, not a stale-results cache. Effect DateTime
handles 23/25-hour days; tests cover both DST transitions and a quarter-hour
timezone offset.

**Keep.** Median **876.98 ms**, maximum timer delay **31.24 ms**. Digest unchanged.

### Experiment 5: compact JSON index alternative

Test one `json_extract(data, '$.model', '$.tokens', '$.cost')` index expression
plus the materialized CTE. This reduced incremental projection-write cost, but
made reads slower and the index larger.

**Discard.** Median **2,537.05 ms**, maximum timer delay **81.98 ms**; index
190,930,944 bytes (**182.1 MiB**), build **65.96 s**. Restore the scalar covering
index and original SELECT shape.

## Write-cost guardrail

`benchmark-stats-writes.ts` uses new in-memory databases and the production
`SessionProjector` through `Bus.publish(MessageContentUpdated)`, verifies the
projected content, alternates indexed/unindexed samples, and disables event
retention in both cases to isolate projection work. These are incremental
projection costs, not an end-to-end streaming or disk-durability benchmark.

```sh
bun run benchmark:stats-writes --updates 1000 --runs 9
bun run benchmark:stats-writes --bytes 1048576 --updates 100 --runs 9
# Reproduce the discarded compact-index write comparison:
bun run benchmark:stats-writes --compact --bytes 1048576 --updates 100 --runs 9
```

| Body size | No stats index | Scalar covering index | Increment per update |
| --------- | -------------: | --------------------: | -------------------: |
| 64 KiB    |      0.1437 ms |             0.2204 ms |            0.0767 ms |
| 1 MiB     |      0.6095 ms |             1.7628 ms |            1.1533 ms |

The compact alternative measured 0.1812 ms at 64 KiB (baseline 0.1403 ms),
and 1.2712 ms at 1 MiB (baseline 0.5977 ms). It saves write CPU but loses the
primary read-latency comparison and nearly doubles index storage.

## Final confirmation

After removing all temporary tracing and the discarded index:

- **891.91 ms median**, 881.95–905.67 ms across nine measured runs.
- **28.50 ms maximum observed event-loop timer delay**.
- Same response digest as baseline in warmup and all measured runs.
- Approximately **61.6× faster** than the snapshot baseline (54,926.37 ms).
- This is an isolated-core comparison, not a claim that the live installation
  has been updated. The original live observation remains 20.78 s.
- Regression coverage: large bodies, range/window boundaries, indexed updates
  and deletes, model variants, fractional costs, project/fork/subagent filtering,
  compaction usage, DST transitions, and fractional timezone offsets.
- The query-plan regression captures SQL from the actual `SessionStats.get`
  through Effect's statement transformer and asserts the covering index with
  `EXPLAIN QUERY PLAN`; it does not duplicate the SELECT in a test.
- Verification: 20 tests pass across `session-stats.test.ts` and
  `session-projector.test.ts`; `bun typecheck` and `bun run migration --check`
  pass from `packages/core`.

Remaining costs are ordinary metadata iteration and index maintenance. Stop
here rather than introduce a separate statistics projection or stale cache.
The live service and database were not modified.
