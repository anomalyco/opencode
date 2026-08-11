# Design

## Merge strategy
Use existing fork sync tooling: `bun run sync:check --apply` creates worktree `sync/upstream-YYYYMMDD`. Merge `upstream/dev` into worktree, resolve conflicts, verify, then merge back to `dev` via PR.

## Conflict resolution policy
- Fork-owned files: keep fork implementation, verify imports
- Patched upstream files: start from upstream structure, reapply minimal Skein behavior
- Moved subsystems: port capability to new location
- Upstream equivalent exists: remove fork code
- Lockfiles/generated: regenerate

## Verification
- `bun run fork:verify`
- Typecheck packages/opencode
- Behavioral smoke tests for loop, auto-reply, local provider discovery, themed loading

## Manifest update
Update baseline.upstreamRef to merged upstream SHA, baseline.syncedAt to today, baseline.forkTag to new tag. Commit atomically with sync merge.

## Safety
Rerere enabled, merge.conflictstyle zdiff3, pre-sync tag `pre-sync/2026-08-11`, backup branch `backup-dev-2026-08-11`.
