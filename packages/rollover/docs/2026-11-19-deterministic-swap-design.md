# Rollover v2 — Deterministic Swap Design

Date: 2026-11-19 · Status: approved in conversation · Replaces the executable
parts of `docs/spec.md` Part A §7.1/§8.3 (safe-point) and withdraws the
extraction gate.

## Intent and why

The ledger pipeline entered the swap's critical path: the swap's safe-point
condition required the extraction cursor to equal the last assistant message,
so any extraction failure (per-model JSON discipline, provider quotas, ~50 s
median latency) deferred the swap indefinitely. Measured across real sessions
in one project: 32/75 extraction runs failed; every one of 54 defers was
`extraction_lagging`; only 5 swaps ever happened. Behavior differed per model
because extraction ran on the session's own chat model.

The Nº 1 behavioral contract of the original spec was "Swap is deterministic,
contains no LLM call, and happens — always, without exception." v2 restores
that contract: the swap is one pure transformation. The LLM ledger shrinks to
an optional, never-blocking enrichment.

## Goals

- One deterministic transformation decides and applies the swap; no LLM in the
  critical path; sub-5 ms transform work.
- Identical behavior on every model: nothing model-dependent can defer a swap.
- The compression stays faithful without an LLM: verbatim user prompts,
  first-lines of assistant replies, deterministic touched-file list.
- Ledger extraction survives as an optional enrichment that can only improve
  the frozen render, never gate or retry it.
- Single source of truth: `opencode/packages/rollover`.

## Non-goals

- Replacing the harness's own compaction.
- Making extraction quality model-independent (it is enrichment; failures are
  invisible by construction).
- Smarter retrieval, embeddings, or cross-session memory.

## Anti-goals (failure modes this design must exclude)

- No state in which a threshold-crossing turn ends without a swap happening on
  the next real user message (except: user turned rollover off, tool parts
  still open, or the same prompt already decided).
- No dead code paths: the gate and the cursor-based safe point are removed,
  not disabled behind a flag.

## Approaches considered

1. **Pure mechanical swap, ledger deleted** — bulletproof and smallest, but
   discards the durable decision/correction memory the ledger already provides.
2. **Deterministic core + optional ledger enrichment (CHOSEN)** — the frozen
   render is built mechanically at swap time; the extraction module keeps
   appending records in the background, and completed records enrich the
   frozen render in place. LLM failure changes render richness, nothing else.
3. **Repair the existing pipeline** (pin an extraction model, break
   starvation) — keeps an LLM dependency inside the gating condition; this is
   precisely the churn loop the user wants out.

## Design

### The single transformation

```
runTransform (context hook, every LLM call):
  state/config/normalize (unchanged)
  decideSwap: real user last ∧ ¬decided ∧ prior turn ∧ context ≥ threshold
              (extraction cursor and caught-up-ness are GONE from the decision)
  swap → freeze (below) → persist → metric + toast
  apply frozen view, idempotent, single splice (unchanged)
```

### Mechanical projection (`core/projection.ts`, new)

Built once at swap, replaced only by ledger enrichment, rendered verbatim
afterwards. Deterministic from (messages, epoch, config, activeRecords):

- `## User prompts so far` — every pre-cutoff real user message, verbatim,
  each capped at 600 chars (middle-truncated with `[...]`).
- `## Assistant progress` — one first-line per pre-cutoff assistant reply,
  capped at 200 chars, newest last.
- `## Files touched` — derived at freeze time from the dropped region's tool
  parts (`edit|write|patch|multiedit` input paths), repo-relative, dedup'd,
  max 40, newest first; unioned with `state.touchedFiles`.
- `## Durable ledger` — active ledger records rendered by the existing packer
  when the enrichment module has produced any (see below).
- `## Last assistant reply` — verbatim, first 1500 chars, only if the tail
  does not already carry it.

Packing priority when the total exceeds `renderBudgetTokens`: drop oldest
assistant progress lines first, then truncate the ledger section, then widen
user-prompt caps last. Emits `render_truncated` when anything was dropped.

### Ledger enrichment (optional, `ledger: true` by default)

- `session.idle` → extraction runs exactly as today (debounce, inflight
  coalescing, delta cursor, consolidation) minus the scheduling gate.
- After a successful extraction/consolidation, the frozen record's render is
  re-rendered with the same cutoff/epoch (idempotent; a refresh rewrites only
  `state.rollover.renderText`).
- Extraction failure or `ledger: false` changes nothing else in the pipeline.

### What is removed

- `core/gate.ts` and the `extractionGate` config key (with its tests).
- The `extractionCaughtUp` input and safe-point condition of `decideSwap`;
  the `extraction_lagging` defer reason disappears entirely.
- The standalone-package divergence: `ignoreDecided` (released 0.1.14) and the
  touched-file tracking gate land in the fork package as part of this change.

### Residual model variance (accepted, visible)

- Context counter: per-step `session.step.ended` usage (fork normalizes
  non-cached + cache-read/write = inclusive input); providers that report
  nothing fall back to the chars/4 estimate. `lastContextSource` is shown in
  `/rollover status`.
- Threshold: computed from the model's context limit where published, session
  override always wins, 100k fallback otherwise.

## Testing strategy

- Decision: threshold crossed with a never-run extraction cursor → swap (the
  headline regression test for the old starvation loop).
- Projection: golden-output snapshot per scenario (long prompts, tool-only
  turns, empty turns, budget overflow ordering); exact determinism on repeated
  calls (two freezes with identical input render byte-identically).
- Idempotency: applying a frozen record repeatedly does not change the view;
  ledger refresh does not move cutoff/epoch or duplicate the synthetic part.
- Scheduler: per-turn extraction without the gate; concurrent idle coalescing.
- Existing gate tests are removed with the module; touched-file tracking
  regains its tests (currently red on `dev`).

## Verification before shipping

- `packages/rollover`: full `bun test` green, `bun run typecheck` clean.
- `opencode` repo root: `bun run check`.
- Live smoke: isolated fork-built runtime, scratch project, real model —
  threshold crossed by scripted turns → swap on the following user message
  with zero extraction preconditions; `/rollover status` reflects it.

## Out of scope for this PR, done right after

- Sync `context-rollover` (standalone npm package) from this package's v2.
  The published README documents `opencode plugin add context-rollover`;
  the local machine meanwhile runs the plugin via the global-config
  re-export mechanism (`plugin/rollover/index.ts` → this package's source).
