# remove compat dual-write leftovers from change state store

## Why

The change-state-store migration (archived as `openspec/archive/change-state-store/`) completed the two-phase rollout: dual-write → single-writer. The `FileStore` now writes only to `.skein/changes/<slug>/`, and all readers use `changestate.Current()` exclusively.

However, the codebase still contains:
- Stale references to the removed `NewWithCompat` in comments
- Dead helper functions (`legacySetBlocked`, `legacyWriteStuckReason`, `writeStuckReason`)
- Nil-fallback paths in `markStuck()`, `skeinDir()`, `ResetFlags()`, `TouchVerified()`, `TouchStuck()`, and priority resolution that still construct legacy paths
- A legacy `ReadRunResult()` that reads from `openspec/changes/<slug>/.skein/` instead of the store
- Stale references in archived docs and design docs

These artifacts persist from the migration era and add confusion. They should be cleaned up.

## What

This change removes **all residual compat artifacts** left over from the dual-write migration. It does NOT change runtime behavior — it removes dead code and nil-fallback paths.

**Scope (sorted by risk, safest first):**

### Slice A — Pure comment/doc cleanup (no code behavior change)
- Remove `NewWithCompat` reference from comment in `current.go:19`
- Remove `NewWithCompat` reference from comment in `maintenance_test.go:165`
- Remove stale "Slice 8" / compat references from archived docs
- Remove stale `NewWithCompat` references from design docs

### Slice B — Remove dead `legacySetBlocked()` path
- Remove `legacySetBlocked()` from `blocked_reason.go`
- Remove its call site in `progress_gate.go:91` (production always passes non-nil store)
- Remove TODO comment in `blocked_reason.go`

### Slice C — Migrate `agent.go` to `store.ReadRunResult()`, remove legacy helper
- Thread store through `agent.go` to use `store.ReadRunResult(slug)`
- Remove legacy `ReadRunResult()` from `run_result.go` and its TODO

### Slice D — Remove nil-fallback from `markStuck()`, fix callers
- Remove nil-fallback from `markStuck()` so it always uses the store
- Fix callers that pass `nil` for store in `change_queue_adapter.go`, `verification_backlog.go`, `pipeline_coder.go`, `pipeline_stages.go`
- Remove `legacyWriteStuckReason()` and `writeStuckReason()` helpers

### Slice E — Clean up nil-fallbacks in `openspec/flags.go`
- Simplify `skeinDir()`, `ResetFlags()`, `TouchVerified()`, `TouchStuck()` to require non-nil store
- Update any callers that pass empty `changesDir`

## Constraints

- **Safe first**: Slices A and B are pure cleanup with no behavioral change. They can be landed independently.
- **Store must be non-nil**: Slices C and D require that callers pass a valid store. The store is wired in `supervisor.go` and `cli/` entry points. Some callers (queue adapters, pipeline stages) may need store threading.
- **No new functionality**: This change is purely removal of dead code and nil-fallback paths.
- **Backward compatibility**: The `skein migrate-state` command is retained (useful for external repos).

## Non-goals

- Do NOT change the `Migrate` command — it remains for external repos
- Do NOT modify the `port.ChangeStateStore` interface
- Do NOT touch `internal/templates/` or `internal/cli/.skein/skills/` docs (those reference the on-disk paths used by agent workflow, not the runtime state store)
- Do NOT run migrate on external repos as part of this change (brick-now, deal_hunter)

## Steering

- `architecture.md: runtime state ownership` — `FileStore` is the sole owner of runtime state writes; dead compat paths violate this
- `architecture.md: single source of truth` — `.skein/changes/<slug>/` is the canonical location; legacy path references confuse developers
- `architecture.md: nil-safety pattern` — callers must pass non-nil store; nil-fallbacks mask wiring bugs
- `openspec/archive/change-state-store/` — archived migration is the prior art; this cleanup is its natural conclusion
