# Proposal: Context-aware, slot-aware local sub-agent placement

## Why

opencode prefers dispatching sub-agents (Task/Explore) to local llama-skein
providers. Two bugs make that routing send work to a provider that cannot serve
it and then double-book it (audit 2026-07-11):

1. **The scorer ignores context adequacy → biases to the worst model.**
   `LocalPlacement.pick`/`bestModel` (`packages/opencode/src/local/placement.ts`)
   scores a candidate as
   `fit_level×1000 + parent-match + resident + tokens/sec + free-VRAM`.
   `fit_level` measures whether the model fits in **VRAM**, not whether its
   **context** is usable. A model pinned to a tiny ctx (e.g. a host's 614-token
   models, `max_safe_ctx=0`) fits perfectly, leaves the most free VRAM, and is
   fastest — so it **wins every term the scorer measures** and is selected for
   every sub-agent, which then can't fit the prompt and never returns a useful
   result. `max_safe_ctx`/`configured_ctx` are never read; the sub-agent prompt
   size is never passed into placement; the `/api/fit` probe is called with no
   `ctx` argument.

2. **No single-slot concurrency gate → double-booking.** Parallel Task calls run
   with `concurrency: "unbounded"` (`session/processor.ts`) and each calls
   `pick()` independently. `isBusy` reads a point-in-time `inference.busy`
   snapshot; both concurrent picks see the same idle host before either
   dispatches (TOCTOU), and the only mitigation is a *soft* post-hoc
   `RECENT_PLACEMENT_PENALTY`. `slots_total`/`in_flight` exist in the client but
   are never used for scheduling. The inherit-parent fallback has no gate at
   all. Two sub-agents thus land on a single-slot (`--parallel 1`) provider; the
   second is queued by llama-skein with no error, and opencode only retries on
   errors with no wall-clock timeout — so it hangs indefinitely.

## What

- **Context-aware selection.** Placement MUST estimate the sub-agent's prompt
  size and exclude any candidate whose usable context (`max_safe_ctx`, or a
  per-model `/api/fit?ctx=` probe at the estimated size) cannot serve it. A
  model that cannot fit the prompt MUST NOT be selected regardless of VRAM fit /
  speed / free-VRAM score. Context adequacy is a hard filter, not a score term.
- **Slot-aware concurrency.** Placement MUST maintain an in-process reservation
  keyed by `providerID`, respecting the provider's `slots_total` against a live
  in-flight count, held for the sub-agent's lifetime. A provider with no free
  slot MUST NOT be selected — including on the inherit-parent fallback path —
  so a single-slot provider is never double-booked within a turn. Concurrent
  picks MUST serialize their reservation decisions (close the TOCTOU gap), not
  merely apply a soft penalty.
- **Bounded wait.** A sub-agent request to a local provider MUST have a
  wall-clock ceiling so a silently-queued request cannot hang forever; on
  timeout it re-places or falls back.

## Non-goals

- No display/overflow changes (separate change
  `ctx-display-and-overflow-correctness`).
- No skein-supervisor changes; skein already gates one agent per provider at
  pipeline granularity but cannot see intra-process sub-agent fan-out — the fix
  must live here.

## Impact

- `packages/opencode/src/local/placement.ts`: prompt-size input; hard
  context-adequacy filter; per-provider reservation/semaphore honoring
  `slots_total`/`in_flight`; apply gate to the inherit path; replace/keep the
  recent-placement penalty as a tiebreak only.
- `packages/opencode/src/tool/task.ts`: pass prompt-size estimate into `pick`;
  hold the reservation across the sub-agent run; release on completion.
- `packages/opencode/src/session/retry.ts` (or the local dispatch path): a
  wall-clock ceiling on local sub-agent inference.
