# Upstream Sync Strategy

## Why

The opencode fork tracks `anomalyco/opencode` on the `dev` branch and is currently 500–700 commits behind. The fork adds critical local features (mDNS discovery, LAN scan, `--agent` flag, skein integration) that upstream does not have. Without a systematic sync strategy, the gap widens, conflicts compound, and the port chain to skein breaks.

## What

This change defines a repeatable, testable upstream sync process that:

1. **Detects** the current gap between fork `dev` and upstream `dev`.
2. **Prepares** a clean sync branch in a worktree (already partially automated by `script/sync-upstream.ts`).
3. **Merges** upstream `dev` into the sync worktree with `--no-ff`.
4. **Validates** the merge (build, typecheck, smoke test).
5. **Resolves** conflicts in the worktree — preserving all custom changes listed in `FORK_WORKFLOW.md`.
6. **Merges back** into `dev` and tags the result.
7. **Documents** the sync state for the next iteration.

## Scope

### In scope

- Audit and refresh the "Custom Changes to Preserve" table in `FORK_WORKFLOW.md` (each area's file paths, diff strategy, conflict resolution notes).
- Enhance `script/sync-upstream.ts` with a `--validate` mode that runs the narrow validation suite (typecheck, build, smoke test) in the worktree.
- Document the full sync procedure with conflict-resolution playbooks for each hotspot area.
- Add a `sync-state.json` (or `sync-state.md`) to track last sync date, upstream commit, and pending custom-change porting status.
- Ensure the `--agent` flag, `src/local/` tree, and skein integration survive merges.

### Out of scope

- Porting specific upstream features into the fork (that is a downstream implementation change).
- Modifying upstream `anomalyco/opencode` itself.
- Changes to skein supervisor or llama-skein (those are separate repos).

## Risks

| Risk | Mitigation |
|------|-----------|
| Conflicts in `src/local/` when upstream touches provider code | Pre-merge diff inspection via dry run; resolve in worktree before merging back |
| Conflicts in `src/provider/provider.ts` when upstream refactors providers | Compare `provider.ts` diffs before merge; port local changes to new shape |
| `--agent` flag removed or renamed upstream | Check upstream diff for `--agent` removal; re-add if needed |
| Generated types (`llama-skein/gen/`) drift | Regenerate from OpenAPI spec after merge; diff to confirm no semantic changes |
| Gap grows too large for single merge | If gap exceeds ~1000 commits, consider intermediate syncs |

## Approach

### Phase 1: Audit (research)

1. Run `bun run sync-upstream` (dry run) to see the current diff scope.
2. For each custom change in `FORK_WORKFLOW.md`, verify the file still exists at the listed path and diff against upstream to see if upstream changed the same area.
3. Update the "Custom Changes to Preserve" table with current file paths and conflict notes.

### Phase 2: Sync tooling (implementation)

1. Add `--validate` flag to `script/sync-upstream.ts` that runs:
   - `bun install` (in worktree)
   - `bun typecheck` (in `packages/opencode`)
   - `bun run build` (in `packages/opencode`)
2. Add a `--report` flag that outputs a JSON summary of the diff (files changed, lines added/removed, conflict areas).
3. Ensure the script exits non-zero on validation failure so CI can gate on it.

### Phase 3: Documentation (delivery)

1. Write the full sync playbook in `FORK_WORKFLOW.md` with step-by-step conflict resolution for each hotspot.
2. Create `openspec/changes/upstream-sync-strategy/sync-state.md` tracking last sync, upstream commit, and pending ports.
3. Add a checklist in the proposal for verifying each custom area survives the merge.

## Success Criteria

- [ ] `FORK_WORKFLOW.md` "Custom Changes to Preserve" table is current (paths, notes, status).
- [ ] `script/sync-upstream.ts --validate` runs the full validation suite in the worktree.
- [ ] `sync-state.md` exists with last-sync metadata.
- [ ] The sync playbook documents conflict resolution for every hotspot.
- [ ] No custom change is lost during the merge process.
