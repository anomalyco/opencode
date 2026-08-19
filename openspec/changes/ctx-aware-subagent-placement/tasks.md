# Tasks: ctx-aware-subagent-placement

- [x] 1. Pass an estimated sub-agent prompt size from `task.ts` into
     `LocalPlacement.pick` (`promptText`; `estimateRequiredCtx`).
- [x] 2. `placement.ts`: hard context-adequacy filter in `bestModel` — exclude
     any candidate whose `max_safe_ctx` cannot serve the estimated prompt,
     before scoring. Selection never returns a model that can't fit the prompt.
- [x] 3. `placement.ts`: per-`providerID` in-process reservation (`reserve`/
     `reservedFor`/`freeSlots`) honoring `slots_total` vs live in-flight;
     reserved synchronously before any await so concurrent picks serialize
     (TOCTOU closed); TTL backstop against leaks.
- [x] 4. `task.ts`: hold the reservation for the sub-agent lifetime; release via
     `Effect.ensuring` on completion/error/interrupt (foreground + background).
- [ ] 5. Add a wall-clock ceiling on local sub-agent inference so a queued
     single-slot request cannot hang forever; re-place or fall back on timeout.
     (REMAINING — load-bearing. The earlier note claiming the primary hang
     cause was fixed by tasks 2–3 is WRONG: see task 9. Today the only
     backstop is `SUBAGENT_TASK_TIMEOUT_MS = 10 * 60 * 1000`
     (`packages/opencode/src/tool/task.ts:36`), which reads to a human as
     "hung forever". Bound it far tighter and re-place on timeout.)
- [x] 6. Tests (`test/local/placement.test.ts`): tiny-ctx model never selected
     even when resident/perfect/fastest; no adequate model → null;
     `freeSlots` slot/in-flight/reservation accounting; `estimateRequiredCtx`.
     (Note: concurrency serialization is covered at the `freeSlots`+reservation
     unit level, not a full two-pick integration test.)
- [x] 7. `bun run typecheck` (0 errors) + `bun test` (10 pass) green.
- [x] 8. Design-first codegen: regenerated the opencode TS llama-skein client
     (`bun run build:llama-skein-client`) from the updated spec; the new
     `unknown` fit_level forced FIT_RANK to handle it (ranked 0 / excluded).
     Committed a9112d3.

## Reopened 2026-07-25 — the inherit-parent path was never gated

The proposal mandates the slot gate "including on the inherit-parent fallback
path". That was not implemented, so the reported session hang is still live.

- [x] 9. Gate the inherit-parent path. `packages/opencode/src/tool/task.ts:190-210`
     skips placement entirely when `!provider || next.model || session ||
 local_subagent_placement === false`, and when `LocalPlacement.pick`
     returns `null` it falls through to `model = ... ?? inherited` — with **no
     busy/free-slot preflight**. The sub-agent is then dispatched to the exact
     single-slot provider the parent is currently occupying, where it queues
     invisibly behind the parent. `placement.ts:216` filters candidates with
     `.filter((info) => info.id !== input.parent.providerID)`, so the slot gate
     at `:232` (`if (freeSlots(...) <= 0) continue`) never evaluates the parent.
     Apply the same `freeSlots` check before inheriting; if the parent has no
     free slot, fail fast or fall back rather than inherit.
     Validation: a test where the parent provider has 0 free slots asserts the
     sub-agent is NOT dispatched to it.
     **Fixed**: changed `capacity === "no-slot"` to `capacity !== "free"` in
     task.ts — blocks both "no-slot" and "unknown" (unreachable parent).
- [x] 10. Do not let a failed probe degrade into the unguarded path.
      `placement.ts:218-221` uses a 1.5 s probe budget and treats probe failure
      as `null` → inherit. A provider that is up but unreachable on
      `/api/hardware` therefore lands on the very path task 9 fixes. Treat probe
      failure as "unknown, do not inherit" rather than "inherit".
      Validation: test with the probe stubbed to fail asserts no inherit-dispatch.
      **Fixed**: the `capacity !== "free"` change in task 9 also covers this —
      "unknown" (returned when probe fails) now blocks inheritance. Tests updated
      to document the contract.
- [ ] 11. Consume llama-skein readiness once available. `model-failure-state`
      (llama-skein) adds a `failed` state, a retained `last_error`, and a
      `/health` body reporting per-model state plus provider-level `busy`.
      Preflight that before dispatch instead of inferring readiness from
      reachability. Until it lands, tasks 5/9/10 are the caller-side mitigation.
      Validation: with a provider reporting `failed`, no sub-agent is dispatched
      to it.
- [ ] 12. Header timeout coverage. `packages/opencode/src/provider/provider.ts:58,65`
      defines `LOCAL_PROVIDER_HEADER_TIMEOUT_DEFAULT = 180_000` and
      `LOCAL_PROVIDER_CHUNK_TIMEOUT_DEFAULT = 120_000`, applied at `:2058-2070`
      but **gated on `model.api.npm === "@ai-sdk/openai-compatible"`** — a local
      provider registered under any other adapter gets no header timeout at all.
      Apply the timeouts by provider locality, not by npm adapter identity.
      Validation: a local provider on a different adapter still gets both timeouts.
