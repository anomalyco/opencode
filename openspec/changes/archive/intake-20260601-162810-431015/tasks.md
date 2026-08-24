# tasks.md

## Phase 1: Audit custom changes

- [ ] Read `FORK_WORKFLOW.md` and verify every row in the "Custom Changes to Preserve" table: check that each file path still exists in the current repo and note whether upstream has touched the same area
- [ ] Run `git log --oneline upstream/dev..origin/dev` and count commits to confirm the 500–700 gap figure
- [ ] Run `git diff origin/dev...upstream/dev --name-only` and write the output to `openspec/changes/intake-20260601-162810-431015/.skein/upstream-diff-scope.txt`
- [ ] For each row in the table, run `git diff origin/dev...upstream/dev -- <file>` on the first 3 entries and record conflict likelihood (high / medium / low) in a new column `Upstream Impact`
- [ ] Update `FORK_WORKFLOW.md` "Custom Changes to Preserve" table: add `Upstream Impact` column, mark any rows where the file no longer exists as `REMOVED`, and add any new custom areas not yet listed

## Phase 2: Enhance sync tooling

- [ ] Add `--validate` flag to `script/sync-upstream.ts`: when set, after the merge step runs a sequence of `bun install`, `bun typecheck`, and `bun run build` inside the worktree, exiting non-zero on the first failure
- [ ] Add `--report` flag to `script/sync-upstream.ts`: after the merge step, runs `git diff --stat origin/dev...upstream/dev` and writes a JSON summary to `openspec/changes/intake-20260601-162810-431015/.skein/sync-report.json` with keys `files_changed`, `lines_added`, `lines_removed`, `conflict_hotspots`
- [ ] Add `--dry-diff` flag to `script/sync-upstream.ts`: prints `git diff --stat origin/dev...upstream/dev` without creating a worktree, for quick gap inspection
- [ ] Add a `conflict-check` subcommand (or `--check-conflicts` flag) that does a `git merge --no-commit` in a temp worktree, captures `git diff --name-only --diff-filter=U` for any unmerged files, and exits non-zero if conflicts exist
- [ ] Update the CLI help text in `script/sync-upstream.ts` to document all new flags

## Phase 3: Sync-state tracking

- [ ] Create `openspec/changes/intake-20260601-162810-431015/sync-state.md` with frontmatter fields `last_sync`, `upstream_commit`, `upstream_date`, `gap_commits`, `pending_ports` (table of custom changes not yet merged)
- [ ] Write a helper script `script/sync-state.ts` that reads `sync-state.json` (or `sync-state.md`) and prints a one-line summary: last sync date, upstream commit, gap size, and any pending ports with status
- [ ] Add a `sync-state update` command path (or `--update-state` flag to `sync-upstream.ts`) that writes the current upstream commit hash and date to `sync-state.md` after a successful merge

## Phase 4: Conflict-resolution playbook

- [ ] In `FORK_WORKFLOW.md`, add a "Conflict Resolution Playbook" section with subsections for each hotspot area:
  - `src/local/mdns.ts` — mDNS discovery (high conflict risk if upstream touches providers)
  - `src/provider/provider.ts` — provider metadata merging
  - `src/cli/cmd/run.ts` — `--agent` flag preservation
  - `packages/core/src/github-copilot/` — token cache_write
  - `llama-swap/proxy/` — HTTP/1.1 and SSE usage
- [ ] For each hotspot, write: (a) the exact files to compare, (b) the diff command to run, (c) the port strategy (re-apply patch / re-implement from scratch / let upstream win), (d) a checklist item for post-merge verification
- [ ] Add a "Post-Merge Verification Checklist" section at the bottom of `FORK_WORKFLOW.md` with one checkbox per custom change area

## Phase 5: Spec and test plan

- [ ] Create `specs/initial/spec.md` describing the sync strategy as a spec with requirements, constraints, and test criteria (see spec below)
- [ ] Add a `test-plan.md` inside the change directory listing each requirement from spec.md with the test command or procedure to verify it

## Phase 6: Final review

- [ ] Read the full `FORK_WORKFLOW.md` end-to-end and verify the sync procedure is complete and unambiguous for a new contributor
- [ ] Verify `script/sync-upstream.ts --help` outputs all new flags correctly
- [ ] Verify `sync-state.md` is present and has valid frontmatter
- [ ] Confirm no custom change rows in the table reference files that have been deleted
