# Upstream Sync Playbook

## Baseline Snapshot (2026-02-06)
- Upstream repo/branch: `anomalyco/opencode` `dev`
- Fork repo/branch: `pRizz/opencode` `dev`
- Merge base: see `docs/upstream-sync/merge-base.txt`
- Current divergence: `0` behind / `418` ahead (`git rev-list --left-right --count upstream/dev...origin/dev`)
- `parent-dev` mirror status: `0 0` (`git rev-list --left-right --count upstream/dev...origin/parent-dev`)
- Catch-up status: upstream catch-up complete; fork decoupling restored post-catch-up.

## Patchset Report
- Restore manifest: `docs/upstream-sync/restore-missing-commits.txt`
- Restore file map: `docs/upstream-sync/restore-file-map.txt`
- Upstream first-parent list: `docs/upstream-sync/upstream-first-parent.txt`
- Boundary commits: `docs/upstream-sync/boundary-commits.txt`

To regenerate:
```bash
git fetch upstream --tags
git branch -f parent-dev upstream/dev
git log --oneline dev..sync/decouple-fork-layer > docs/upstream-sync/restore-missing-commits.txt
git diff --name-status dev...sync/decouple-fork-layer > docs/upstream-sync/restore-file-map.txt
MERGE_BASE=$(git merge-base parent-dev dev)
echo "$MERGE_BASE" > docs/upstream-sync/merge-base.txt
git rev-list --first-parent ${MERGE_BASE}..parent-dev > docs/upstream-sync/upstream-first-parent.txt
awk 'NR % 200 == 0 {print NR ":" $0}' docs/upstream-sync/upstream-first-parent.txt > docs/upstream-sync/boundary-commits.txt
wc -l docs/upstream-sync/upstream-first-parent.txt > docs/upstream-sync/upstream-first-parent.count
```

## Must-Keep Fork Areas (Verify and Extend)
- `docs/upstream-sync/fork-feature-audit.md` (authoritative ownership map)
- `packages/fork-*` (fork behavior implementation)
- Hook/stub surfaces under `packages/opencode/src/**` (must stay minimal)

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
