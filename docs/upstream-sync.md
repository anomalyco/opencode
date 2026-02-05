# Upstream Sync Playbook

## Baseline Snapshot (2026-02-05)
- Upstream repo/branch: `anomalyco/opencode` `dev`
- Fork repo/branch: `pRizz/opencode` `dev`
- Merge base: `dac099a4892689d11abedb0fcc1098b50e0958c8` (source: `docs/upstream-sync/merge-base.txt`)
- Fork commits ahead: 410 (source: `docs/upstream-sync/fork-commits.log`)
- Upstream first-parent commits behind: 1307 (source: `docs/upstream-sync/upstream-first-parent.txt`)
- Batch boundaries (every 200 commits): 6 (source: `docs/upstream-sync/boundary-commits.txt`)

## Patchset Report
- Fork commits: `docs/upstream-sync/fork-commits.log`
- Range-diff: `docs/upstream-sync/range-diff.txt`
- Upstream first-parent list: `docs/upstream-sync/upstream-first-parent.txt`
- Boundary commits: `docs/upstream-sync/boundary-commits.txt`

To regenerate:
```bash
git fetch upstream --tags
git branch -f parent-dev upstream/dev
git log --oneline parent-dev..dev > docs/upstream-sync/fork-commits.log
git range-diff parent-dev...dev > docs/upstream-sync/range-diff.txt
MERGE_BASE=$(git merge-base parent-dev dev)
echo "$MERGE_BASE" > docs/upstream-sync/merge-base.txt
git rev-list --first-parent ${MERGE_BASE}..parent-dev > docs/upstream-sync/upstream-first-parent.txt
awk 'NR % 200 == 0 {print NR ":" $0}' docs/upstream-sync/upstream-first-parent.txt > docs/upstream-sync/boundary-commits.txt
wc -l docs/upstream-sync/upstream-first-parent.txt > docs/upstream-sync/upstream-first-parent.count
```

## Must-Keep Fork Areas (Verify and Extend)
- `docs/docker-install-fork.md` (fork installation guidance)
- `docs/README.md` references fork-specific usage
- Any fork-only auth features or configuration paths (audit during conflict resolution)

## Known Conflict Notes
- None recorded yet. Add entries here as they appear during the merge train.

## Merge Train Procedure (One-Time Catch-Up)
1. Pause new work on `dev` until catch-up completes.
2. Use `docs/upstream-sync/boundary-commits.txt` to select boundary commits.
3. For each boundary commit:
   - Create a branch `sync/catchup-<n>` from `dev`.
   - Merge the boundary commit, resolve conflicts, and update this doc with resolutions.
   - Regenerate SDK artifacts if the SDK changes: `./packages/sdk/js/script/build.ts`.
   - Open a PR to `dev` labeled `sync` and merge after CI passes.

## Ongoing Sync Automation
- Script: `script/sync-upstream.ts`
- Workflow: `.github/workflows/sync-upstream.yml` (runs every 3 hours)
- Secrets required: `UPSTREAM_SYNC_TOKEN` (fine-grained PAT or GitHub App token)
- Workflow behavior:
  - Updates `parent-dev` to match `upstream/dev` (force push).
  - Opens a sync PR when upstream is ahead.
  - Enables auto-merge once checks pass.
  - On conflict, opens an issue labeled `sync-conflict` with merge details.

## Repo Settings Checklist
- Enable auto-merge on the repository.
- Require `test` and `typecheck` checks on `dev`.
- Allow merge commits.
- Ensure the PAT/App used by `UPSTREAM_SYNC_TOKEN` can create PRs, labels, and enable auto-merge.
