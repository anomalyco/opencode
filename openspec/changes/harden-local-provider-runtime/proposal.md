# Proposal: Harden local-provider runtime paths

## Why

Code review (2026-07-05) verified three defects in the fork's local-provider
plumbing:

1. **Unbounded hang in model discovery (H).** `fetchLocalModelFit`
   (`packages/opencode/src/provider/provider.ts:1388`) awaits
   `client.getFitReport()` with no timeout — the generated llama-skein client
   has none. The adjacent `/models` fetch is aborted at 2s, but discovery then
   awaits the fit promise; a host that accepts TCP and never answers
   `/api/fit` (observed: a host mid rootfs-swap) stalls that provider's model
   discovery indefinitely, wedging provider/model listing.

2. **Lost-update race on global provider config (M).** `syncLocalProviders`
   (`packages/opencode/src/local/sync.ts`) and the `/connect`/`/disconnect`
   handlers (`.../httpapi/handlers/local.ts`) each do a non-atomic
   `getGlobal() → mutate → updateGlobal(replace: ["provider"])`. Concurrent
   execution (sync timer vs. user connect; multiple opencode processes)
   silently drops one side's write — a manually connected provider can vanish.

3. **Stale VRAM meter sample on provider switch (L).** The sidebar's in-flight
   `getHardware()` (`packages/tui/src/feature-plugins/sidebar/context.tsx`)
   is not invalidated when `baseURL` changes; a slow response from the old
   host overwrites the new host's reading for up to one 30s poll cycle.

## What

- Bound every control-plane fit fetch with the same 2s abort budget as the
  models fetch; on timeout, fall back to the existing empty-fit-map path.
- Serialize in-process global-config read-modify-write through one mutex and
  re-read the config inside the critical section.
- Tag each sidebar poll with its originating baseURL and drop results that no
  longer match; abort in-flight requests on effect cleanup.

## Constraints

- The generated client (`src/local/llama-skein/gen/`) must not be hand-edited;
  timeouts are applied at call sites via fetch `signal` options (supported by
  the hey-api client) or `Promise.race` if signal passthrough is unavailable.
- Cross-process config racing is only narrowed, not eliminated (file-level
  locking is out of scope); the fix must make single-process behavior correct.
- No visual/UX changes to the sidebar.

## Non-goals

- File-level locking of `~/.config/opencode/opencode.json` across processes.
- Event-journal retention (tracked separately).
- Loop durability (separate change; prerequisite for supervisor work).
