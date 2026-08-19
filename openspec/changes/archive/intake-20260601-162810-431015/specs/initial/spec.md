# Spec: Upstream Sync Strategy

## Purpose

Define a repeatable, testable process for merging `anomalyco/opencode` upstream `dev` into this fork's `dev` branch while preserving all custom local features (mDNS discovery, LAN scan, `--agent` flag, skein integration) and keeping the skein + llama-skein port chain healthy.

## Requirements

### R1: Audit capability

The fork maintainer must be able to audit the current gap between `origin/dev` and `upstream/dev` and identify which custom changes are at risk of conflict.

- **Test:** Run `git diff origin/dev...upstream/dev --name-only` and confirm it lists all upstream-modified files. Compare against the "Custom Changes to Preserve" table in `FORK_WORKFLOW.md` to verify completeness.

### R2: Sync tooling enhancement

`script/sync-upstream.ts` must support three new modes:

- **`--validate`**: After merging upstream into the worktree, run `bun install`, `bun typecheck`, and `bun run build` in the worktree. Exit non-zero on the first failure.
- **`--report`**: After the merge, output a JSON summary of the diff (files changed, lines added/removed, conflict hotspots).
- **`--dry-diff`**: Print `git diff --stat origin/dev...upstream/dev` without creating a worktree.

- **Test:** Run `bun script/sync-upstream.ts --help` and verify all three flags appear. Run `bun script/sync-upstream.ts --dry-diff` and confirm it prints diff stats and exits 0.

### R3: Conflict detection

Before committing to a merge, the maintainer must be able to detect conflicts in a temp worktree.

- **Test:** Run the conflict-check subcommand and confirm it exits non-zero when conflicts exist (can be verified by merging a known-conflicting branch).

### R4: Sync-state tracking

A `sync-state.md` file must exist at `openspec/changes/intake-20260601-162810-431015/sync-state.md` with frontmatter tracking:

| Field | Description |
|-------|-------------|
| `last_sync` | ISO date of last successful sync |
| `upstream_commit` | Full SHA of upstream/dev at last sync |
| `upstream_date` | Commit date of upstream/dev at last sync |
| `gap_commits` | Number of commits between fork dev and upstream dev |
| `pending_ports` | Table of custom changes not yet merged, with status |

- **Test:** Verify `sync-state.md` exists, has valid YAML frontmatter, and all required fields are present.

### R5: Conflict-resolution playbook

`FORK_WORKFLOW.md` must contain a "Conflict Resolution Playbook" section with subsections for each hotspot area. Each subsection must include:

1. Files to diff
2. Diff command
3. Port strategy (re-apply / re-implement / let upstream win)
4. Post-merge verification checklist

- **Test:** Read each hotspot subsection and verify it contains all four required elements.

### R6: Post-merge verification checklist

`FORK_WORKFLOW.md` must include a "Post-Merge Verification Checklist" with one checkbox per custom change area. Each checkbox must name the specific file or feature to verify.

- **Test:** Count checklist items and confirm they cover every row in the "Custom Changes to Preserve" table.

### R7: Custom changes table currency

The "Custom Changes to Preserve" table in `FORK_WORKFLOW.md` must be current:

- Every file path must exist in the working tree (or be marked `REMOVED`).
- An `Upstream Impact` column must indicate conflict likelihood (high / medium / low / none).
- No custom areas may be omitted.

- **Test:** For each row, run `test -f <file>` and verify all exist. Confirm the `Upstream Impact` column is populated for every row.

## Constraints

- Never modify upstream `anomalyco/opencode`.
- The `--agent` flag in `src/cli/cmd/run.ts` must never be removed.
- Generated types in `src/local/llama-skein/gen/` must be regenerated from the OpenAPI spec after every merge — never edited by hand.
- The sync must use a dedicated worktree, never merge directly into the active checkout.
- The gap must be monitored: if it exceeds ~1000 commits, split into intermediate syncs.

## Test Plan Summary

| Req | Test Command / Procedure |
|-----|--------------------------|
| R1 | `git diff origin/dev...upstream/dev --name-only` |
| R2 | `bun script/sync-upstream.ts --help`, `--dry-diff`, `--validate` |
| R3 | Conflict-check subcommand on a known-conflicting merge |
| R4 | Verify `sync-state.md` frontmatter fields |
| R5 | Read `FORK_WORKFLOW.md` Conflict Resolution Playbook subsections |
| R6 | Cross-reference checklist items with Custom Changes table |
| R7 | `test -f <file>` for every row in the table |
