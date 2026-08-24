# Spec deltas: remove compat dual-write leftovers

## REMOVED

### `changestate.NewWithCompat` function
- **File**: `internal/infra/changestate/current.go` (comment reference)
- **Rationale**: Function has been removed; only stale comment references remain. Comments updated.

### `supervisor.legacySetBlocked()` function
- **File**: `internal/supervisor/blocked_reason.go`
- **Rationale**: Dead code path. `markBlocked()` already handles nil store by returning early. No callers should pass nil in production.

### `supervisor.legacyWriteStuckReason()` function
- **File**: `internal/supervisor/stuck_reason.go`
- **Rationale**: Dead code path. `markStuck()` with non-nil store uses the `port.ChangeStateStore` exclusively.

### `supervisor.writeStuckReason()` wrapper
- **File**: `internal/supervisor/stuck_reason.go`
- **Rationale**: Wrapper around `legacyWriteStuckReason()`. Both are dead code.

### `supervisor.ReadRunResult()` legacy helper
- **File**: `internal/supervisor/run_result.go`
- **Rationale**: Reads from `openspec/changes/<slug>/.skein/run-result.json` (legacy path). `changestate.Store.ReadRunResult()` is the canonical reader.

## MODIFIED

### `changestate.SetCurrent` comment
- **File**: `internal/infra/changestate/current.go`
- **Change**: Remove reference to `NewWithCompat` from comment on `SetCurrent` function.

### `supervisor.markStuck()` signature behavior
- **File**: `internal/supervisor/stuck_reason.go`
- **Change**: When `store` is nil, the function previously fell back to direct file writes. After this change, callers must pass a valid store. The function will always use `store.WriteTextFile()` and `store.SetFlag()`.

### `openspec.flags.skeinDir()`, `ResetFlags()`, `TouchVerified()`, `TouchStuck()`
- **File**: `internal/openspec/flags.go`
- **Change**: These functions previously had nil-fallback to legacy path construction. After this change, they require `changestate.Current()` to be non-nil. Callers must ensure the store is wired.

### `openspec.resolvePriority()`
- **File**: `internal/openspec/load.go`
- **Change**: When store is set but returns an invalid priority, the function previously fell through to legacy file read. After this change, it returns 0 (unset) when the store priority is invalid.

### `openspec.load.isInitializedChange()` comment
- **File**: `internal/openspec/load.go`
- **Change**: Update comment to reflect that legacy openspec/ path is no longer consulted (already implemented; comment was stale).

## ADDED

None. This change removes dead code and nil-fallback paths; it does not add new behavior.
