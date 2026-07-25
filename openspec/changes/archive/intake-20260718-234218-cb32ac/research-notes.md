# Research: Remove compat dual-writes from change state store

## Summary
This change targets the removal of backward-compatibility dual-write logic from the Skein change state store. The original `change-state-store` migration (already completed and archived as `openspec/archive/change-state-store/`) introduced a two-phase approach: `NewWithCompat` dual-wrote to both legacy `openspec/changes/<slug>/.skein/` and new `<repo>/.skein/changes/<slug>/` locations, then readers were flipped to the new path. The compat writes have **already been removed** — `NewWithCompat` no longer exists, `FileStore` writes only to `runtimeBase`. However, residual legacy fallback functions, stale comments referencing `NewWithCompat`, and TODO markers remain scattered across the codebase. This intake should be **closed as already done**, with a follow-up cleanup change to remove the remaining artifacts.

## Affected Files / Modules
- `internal/infra/changestate/current.go:19` — Comment references non-existent `NewWithCompat`
- `internal/supervisor/maintenance_test.go:165` — Comment references `NewWithCompat`
- `internal/supervisor/blocked_reason.go:24-43` — `legacySetBlocked()` function + TODO; called from `progress_gate.go:91` (but only when store is nil, which production never is)
- `internal/supervisor/stuck_reason.go` — `markStuck()` nil-fallback to `legacyWriteStuckReason()` + `writeStuckReason()` wrapper; several callers pass nil (see Risks below)
- `internal/supervisor/run_result.go:29-48` — `ReadRunResult()` reads from legacy path; TODO to migrate callers to `store.ReadRunResult()`; one production caller in `agent.go:928`
- `internal/openspec/flags.go` — `skeinDir()`, `ResetFlags()`, `TouchVerified()`, `TouchStuck()` all have nil-fallback to legacy paths
- `openspec/archive/change-state-store/tasks.md:46` — Archived tasks doc references `NewWithCompat` (documentation only)
- `openspec/changes/supervisor-outcome-robustness-antiloop/design.md:82,84` — Design doc references `NewWithCompat` (documentation only)

## Prior Art
- **Original migration**: `openspec/archive/change-state-store/` — full proposal + tasks (all 16 slices complete, archived)
- **Migrate command**: `internal/infra/changestate/migrate.go` — `Migrate(specBase, runtimeBase)` copies legacy state to primary; left in place for external repos (e.g., brick-now) that may still need it
- **Pattern**: The codebase already uses `changestate.Current() != nil` guards everywhere; when non-nil, the store is always wired to `<repo>/.skein/changes/`

## Risks and Unknowns
1. **`markStuck()` nil callers**: `change_queue_adapter.go:50`, `verification_backlog.go:149,157`, `pipeline_coder.go:145`, `pipeline_stages.go:967` all pass `nil` as store. Removing the nil-fallback in `markStuck()` would break these call sites. The store is wired in `supervisor.go` but these callers may run in contexts where store isn't propagated.
2. **`ReadRunResult` caller**: `agent.go:928` calls the legacy `ReadRunResult(changeSkeinDir)` directly. Migrating it to `store.ReadRunResult(slug)` requires access to the store, which `agent.go` may not have.
3. **`legacySetBlocked()`**: Called from `progress_gate.go:91` when store is nil. Production always passes a non-nil store, so removing it is safe.
4. **Unknown**: Whether any external repos (brick-now, deal_hunter) still depend on the `skein migrate-state` command or legacy `.skein/` paths.

## Recommendation
**Close this intake as already done.** The compat dual-writes are removed. Schedule a **separate cleanup change** with these slices:

1. **Slice A (safe)**: Remove `legacySetBlocked()` from `blocked_reason.go` and its call in `progress_gate.go:91`. Remove stale `NewWithCompat` references from comments in `current.go`, `maintenance_test.go`, and archived docs. Remove the `resolveStatus` TODO in `blocked_reason.go`.
2. **Slice B (requires wiring)**: Replace `ReadRunResult()` callers with `store.ReadRunResult()` — requires threading store through `agent.go`. Remove `run_result.go` legacy helper.
3. **Slice C (requires care)**: Remove nil-fallback from `markStuck()` and fix callers (`change_queue_adapter.go`, `verification_backlog.go`, `pipeline_coder.go`, `pipeline_stages.go`) to pass the store.
4. **Slice D (low priority)**: Clean up nil-fallbacks in `openspec/flags.go` (`skeinDir()`, `ResetFlags()`, `TouchVerified()`, `TouchStuck()`).

Priority: Slice A first (no behavioral change, pure cleanup). Slices B–C require testing.
