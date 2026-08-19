# Session sync streaming performance

## Goal

Keep the engine data layer's per-token-delta cost negligible next to the
legacy `createData` path, so the sync engine's immutable fold/render
architecture is not a streaming CPU regression.

## Benchmark

```
cd packages/client
bun run bench:sync
```

Env knobs: `BENCH_TRANSCRIPT` (messages, default 200), `BENCH_DELTAS`
(default 2000), `BENCH_RUNS` (default 7, median after 1 warmup).

## Metrics

- `engine_deltas_ms` (primary) — wall clock to stream `BENCH_DELTAS` text
  deltas into the active assistant message.
- `legacy_deltas_ms` — same scenario through legacy `createData`.
- `*_hydrate_ms`, `*_retained_mb` — secondary.

## Files in scope

- `src/solid/engine-data.ts` — store adapter (`update`, clone boundary)
- `src/solid/engine/engine.ts` — `render`, `applyOverlayToMessages`

## Experiment log (200 messages, 2000 deltas)

Baseline: engine 240µs/delta vs legacy 0.3µs/delta.

1. KEEP — drop full-view `structuredClone` per publish → 41ms (11.6×).
   Follow-up: raw pass-through was unsound (reconcile mutates the store's
   backing tree in place, corrupting engine state / aliased clones).
2. KEEP — identity-diff consecutive views (the fold is a persistent
   structure) and clone only changed subtrees, each clone used at exactly
   one store path → 67ms sound (7.1× vs baseline).
3. KEEP — reference-preserving `render`: identity-stable `pending` when the
   outbox is empty, skip pending-derived message work when nothing pending,
   remap only overlay-touched messages → 16.3µs/delta.
4. KEEP — skip `legacy.session.remember` clone when `view.session` is
   identity-unchanged → 9.4µs/delta.
5. KEEP — hand-rolled recursive clone instead of `structuredClone` for the
   small per-event subtrees → 3.5µs/delta.

Final: 240 → 3.5µs/delta (69×) at 200 messages; 23.6µs/delta at 2000
messages (remaining cost is the O(n) identity walk, ~10ns/message/delta).

Simplify pass (no benchmark movement, closes paths the scenario misses):
`render` memoizes its durable base on fold/outbox identity and the
usage-adjusted session on the usage entry, so identity preservation holds
even with a live usage overlay or pending steers/outbox items; `publish`
skips render and notify when folded/outbox/overlay are identity-unchanged
(synced flips, stale replays). The bench scenario streams with an empty
outbox and no usage entry, so those paths need the memo caches for cover.

## Dead ends

- WeakMap-memoized structural-sharing clone: unsound. `reconcile` merges
  nodes in place, so a memoized clone reachable from two store paths (or a
  later view) gets corrupted; caught by the TUI `updates session location
  when moved` test via fold state that aliases `previous.location`.
- Microtask coalescing of publishes: each stream item already arrives on
  its own microtask, so `queueMicrotask` batching collapses nothing; real
  frame coalescing (~16ms timer) left unexplored as unnecessary at current
  numbers.
