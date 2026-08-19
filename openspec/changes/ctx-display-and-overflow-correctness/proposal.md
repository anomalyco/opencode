# Proposal: Show the enforced context limit, and overflow-patch to a safe size

## Why

opencode's context display and its 413-overflow auto-patch both use the wrong
"context size", which hid a fleet-wide misconfiguration for weeks (audit
2026-07-11).

1. **The status bar shows capacity, not the enforced wall.** The sidebar
   denominator (`packages/tui/src/feature-plugins/sidebar/context.tsx`) reads
   `model.limit.context`, which discovery sets to `/api/fit` `max_safe_ctx`
   (or, when fit is unavailable, `/v1/models context_length`, or ultimately the
   models.dev catalog's native value). None of those is the enforced
   `--ctx-size`. A fleet model pinned at `--ctx-size 3072` displayed as
   "… / 467k" (the catalog native), so requests 413'd at 3072 while the UI
   implied a 467k window. opencode already fetches the enforced value as a
   separate `contextMax` (`configured_ctx`) but never shows it.

2. **Setting ctx via opencode reverts.** `setModelCtxSize`
   (`server/routes/instance/httpapi/handlers/local.ts`) PATCHes the backend
   (correct) and optimistically writes `limit.context` in memory as the raw
   `ctx_size`. But `provider.list()` never re-discovers, so on the next
   discovery `limit.context` is repopulated from `max_safe_ctx` — a different
   quantity — and the set value appears to "not stick".

3. **The 413-overflow handler patches to the native max.**
   `adjustLocalContextOnOverflow` (`packages/opencode/src/provider/provider.ts`)
   reacts to a 413 by PATCHing the backend `ctx_size` to the reported `max_ctx`
   (the model's native context). On a VRAM-constrained host that value cannot
   load — observed live: it bumped one host's 35B to 262144 and another's 35B to
   110592, both unloadable. It "fixes" overflow by creating an OOM.

## What

- **Display the enforced limit.** The context denominator MUST be the enforced
  per-request context (`contextMax` / `configured_ctx`), not `max_safe_ctx` and
  never the catalog native. Where both are useful, show used / safe-budget with
  the enforced ceiling in parentheses; never present a capacity number the
  backend will reject against.
- **Make a set stick.** After `setModelCtxSize` succeeds, re-run discovery for
  that provider (or re-fetch `/api/fit`) so `limit.context` reflects the new
  enforced value with consistent semantics, instead of an in-memory value that
  reverts on the next discovery.
- **Overflow-patch to a safe size.** `adjustLocalContextOnOverflow` MUST patch
  `ctx_size` to a VRAM-safe value derived from `/api/fit` (the achievable
  ceiling for current VRAM), not the raw native `max_ctx`. If no safe value is
  available it MUST surface the overflow rather than set an unloadable ctx.

## Non-goals

- No routing/placement changes (separate change
  `ctx-aware-subagent-placement`).
- No change to llama-skein's `/api/fit` math (separate change
  `bound-max-safe-ctx` in the llama-skein repo).

## Impact

- `packages/tui/src/feature-plugins/sidebar/context.tsx` and the app metrics
  helper: denominator source.
- `packages/opencode/src/provider/provider.ts`: `adjustLocalContextOnOverflow`
  target value; discovery-refresh after set.
- `packages/opencode/src/server/routes/instance/httpapi/handlers/local.ts`:
  `setModelCtxSize` triggers a provider re-discovery.
