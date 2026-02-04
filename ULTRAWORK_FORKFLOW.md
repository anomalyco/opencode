# Open Ultrawork Forkflow

## Branch Roles

- **origin/dev**: Clean mirror of OpenCode’s dev branch.
- **origin/ultrawork/dev**: Integration branch with Open Ultrawork changes.
- **origin/<work-branch>**: Short-lived branches for features and fixes.

## Why these branches matter

- **origin/dev**: Used as the baseline for rebasing and clean comparisons.
- **origin/ultrawork/dev**: A stable integration point. **We build and release from this branch**.
- **origin/<work-branch>**: Isolates each change set for review, testing, and clean rebases.

## Automated Sync

The sync process runs **daily at 8am UTC** via `.github/workflows/sync-upstream.yml`.

### How it works

1. **Mirror update**: `origin/dev` is force-pushed to match `upstream/dev`
2. **Integration update**: A PR is auto-created to merge `dev` → `ultrawork/dev`
3. **Auto-merge**: Clean merges auto-merge when CI passes
4. **Conflicts**: PRs with conflicts are labeled `sync-conflict` and require manual resolution

### Manual trigger

Run via GitHub Actions: **Actions** → **sync-upstream.yml** → **Run workflow**

### Rollback procedures

```bash
# Rollback origin/dev (mirror)
git checkout dev
git reset --hard <known-good-sha>
git push origin dev --force

# Rollback ultrawork/dev (bad merge)
git checkout ultrawork/dev
git revert -m 1 <merge-commit-sha>
git push origin ultrawork/dev

# Emergency: disable workflow
# Actions → sync-upstream.yml → "..." → Disable workflow
```

## Manual Sync (Override)

The sync is automated, but you can manually sync if needed (e.g., to test before automation runs).

1. Update mirror branch from upstream:
   - `git fetch upstream`
   - `git checkout dev`
   - `git reset --hard upstream/dev`
   - `HUSKY=0 git push --force-with-lease origin dev`

2. Rebase integration branch on dev:
   - `git checkout ultrawork/dev`
   - `git rebase dev`
   - `HUSKY=0 git push --force-with-lease origin ultrawork/dev`

## Feature Work

1. Create a work branch:
   - `git checkout -b <name> ultrawork/dev`

2. Do as much work as needed, but break it into small, descriptive commits for easier review.

3. Rebase work branch on integration:
   - `git checkout <name>`
   - `git rebase ultrawork/dev`
   - `HUSKY=0 git push --force-with-lease origin <name>`

4. Open PR: `<name>` → `ultrawork/dev`.

5. Merge PR into `ultrawork/dev`.

## Notes

- `HUSKY=0` bypasses pre-commit hooks that fail on upstream's build errors, so we're not blocked by issues we don't control.
- This repo (optionally) uses Mise to pin Bun for consistent hooks.
  - Toolchain config lives in `mise.toml`.
  - Install tools once per machine: `mise install`.
