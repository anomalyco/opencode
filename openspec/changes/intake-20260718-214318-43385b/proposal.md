# remove compat dual-writes from change state store

Skein currently maintains a duplicate runtime state location: the primary `.skein/changes/<slug>/` AND a compat mirror `openspec/changes/<slug>/.skein/` via `NewWithCompat`. This creates confusion, stale state, and makes the codebase harder to understand.

The goal is to have ONE source of truth: `.skein/changes/<slug>/` for Skein runtime state, and `openspec/changes/<slug>/` for OpenSpec planning content (proposal.md, tasks.md, specs/). No duplication.

**Current state:**
- `NewWithCompat(runtimeBase, specBase)` in `defaults.go` writes to both locations
- `HasFlag`, `FlagMtime` read from both (primary first, compat fallback)
- `SetFlag`, `ClearFlag`, `SetBlocked`, `WriteTextFile`, `AppendTextFile`, `SetPriority` write to both
- `isInitializedChange` in `openspec/load.go` checks for `.skein/` in the openspec dir as a marker
- `resolveStatus` in `openspec/load.go` has store-first path + legacy file fallback
- `resolveStatusWithStore` in `auditor/auditor.go` has store-first path + legacy file fallback
- Migrate command exists to copy state from compat→primary

**What to do:**

1. **Remove compat writes** — Change `NewWithCompat` to `New` in `defaults.go` and all callers. Remove the `specBase` field and all compat write logic from `file_store.go`.

2. **Update `isInitializedChange`** — Instead of checking for `.skein/` in the openspec dir, check if `.skein/changes/<slug>/` exists (via `changestate.Current().RuntimeDir(slug)`). Keep the `proposal.md` / `tasks.md` checks for hand-authored changes.

3. **Remove compat reads** — Remove the compat directory fallback from `HasFlag`, `FlagMtime` in `file_store.go`.

4. **Remove legacy fallback** — In `resolveStatus` in `openspec/load.go`, remove the legacy file check fallback and only use the store path. Same for `resolveStatusWithStore` in `auditor/auditor.go`.

5. **Run the Migrate command** on existing repos to copy compat state → primary, then clean up the compat directories.

6. **Update tests** — Tests that use `NewWithCompat` should use `New`. Tests that check for compat writes should be updated.

7. **Clean up comments** — Remove references to "Slice 8" and "compat" and "legacy" throughout.

**Key files:**
- `internal/port/adapter/defaults.go` — change `NewWithCompat` to `New`
- `internal/infra/changestate/file_store.go` — remove compat logic
- `internal/openspec/load.go` — update `isInitializedChange`, remove legacy fallback
- `internal/auditor/auditor.go` — remove legacy fallback
- `internal/cli/intake_test.go` — update test
- `internal/cli/migrate_state.go` — can be simplified/removed after migration

**Caution:** This is a breaking change for repos that have only compat state. The Migrate command should be run first on existing repos.
