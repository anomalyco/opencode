# Test Plan: Upstream Sync Strategy

## R1: Audit capability

| Test | Procedure | Expected |
|------|-----------|----------|
| Gap count | `git log --oneline upstream/dev..origin/dev | wc -l` | Output is 500–700 |
| Diff scope | `git diff origin/dev...upstream/dev --name-only > .skein/upstream-diff-scope.txt` | File exists, lists all upstream-modified files |
| Table completeness | Cross-reference `FORK_WORKFLOW.md` rows against upstream diff | Every custom change file appears in the diff or is marked `none` impact |

## R2: Sync tooling flags

| Test | Procedure | Expected |
|------|-----------|----------|
| Help text | `bun script/sync-upstream.ts --help` | All new flags (`--validate`, `--report`, `--dry-diff`) documented |
| Dry diff | `bun script/sync-upstream.ts --dry-diff` | Prints `git diff --stat` output, exits 0 |
| Validate mode | `bun script/sync-upstream.ts --apply --validate` (in worktree) | Runs install → typecheck → build; exits non-zero on failure |
| Report mode | `bun script/sync-upstream.ts --apply --report` (in worktree) | Writes `sync-report.json` with required keys |

## R3: Conflict detection

| Test | Procedure | Expected |
|------|-----------|----------|
| Conflict exists | Run conflict-check on a merge with known conflicts | Exits non-zero, lists unmerged files |
| No conflict | Run conflict-check on a clean merge | Exits 0, reports no conflicts |

## R4: Sync-state tracking

| Test | Procedure | Expected |
|------|-----------|----------|
| File exists | `test -f openspec/changes/intake-20260601-162810-431015/sync-state.md` | Passes |
| Frontmatter valid | Parse YAML frontmatter | All required fields present (`last_sync`, `upstream_commit`, `upstream_date`, `gap_commits`, `pending_ports`) |
| Update command | Run `sync-state update` after a merge | Frontmatter updated with current upstream commit and date |

## R5: Conflict-resolution playbook

| Test | Procedure | Expected |
|------|-----------|----------|
| Hotspot coverage | Read each subsection in "Conflict Resolution Playbook" | Each has: files to diff, diff command, port strategy, verification checklist |
| mDNS hotspot | Verify `src/local/mdns.ts` subsection exists | Present with all 4 elements |
| Provider hotspot | Verify `src/provider/provider.ts` subsection exists | Present with all 4 elements |
| Agent flag | Verify `src/cli/cmd/run.ts` subsection exists | Present with all 4 elements |
| Token cache | Verify `packages/core/src/github-copilot/` subsection exists | Present with all 4 elements |
| llama-swap | Verify `llama-swap/proxy/` subsection exists | Present with all 4 elements |

## R6: Post-merge checklist

| Test | Procedure | Expected |
|------|-----------|----------|
| Checklist completeness | Count checklist items vs table rows | Checklist covers every row in "Custom Changes to Preserve" |
| Checkbox format | Inspect each item | All use `- [ ]` format with specific file/feature name |

## R7: Table currency

| Test | Procedure | Expected |
|------|-----------|----------|
| File existence | `test -f <file>` for every row | All pass (or marked `REMOVED`) |
| Impact column | Inspect table | Every row has `Upstream Impact` populated |
| No omissions | Compare table rows to actual custom changes | No custom areas missing |
