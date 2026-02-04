# Open Ultrawork Forkflow

## Branch Roles

- **origin/dev**: Clean mirror of OpenCode’s dev branch.
- **origin/ultrawork/dev**: Integration branch with Open Ultrawork changes.
- **origin/<work-branch>**: Short-lived branches for features and fixes.

## Why these branches matter

- **origin/dev**: Used as the baseline for rebasing and clean comparisons.
- **origin/ultrawork/dev**: A stable integration point. **We build and release from this branch**.
- **origin/<work-branch>**: Isolates each change set for review, testing, and clean rebases.

## Sync on New Releases

OpenCode tags releases (e.g., `v1.1.x`) directly on dev. Check for new tags regularly and sync when a new release is found.

1) Update mirror branch from upstream:
   - `git fetch upstream`
   - `git checkout dev`
   - `git reset --hard upstream/dev`
   - `HUSKY=0 git push --force-with-lease origin dev`

2) Rebase integration branch on dev:
   - `git checkout ultrawork/dev`
   - `git rebase dev`
   - `HUSKY=0 git push --force-with-lease origin ultrawork/dev`

## Feature Work

1) Create a work branch:
   - `git checkout -b <name> ultrawork/dev`

2) Do as much work as needed, but break it into small, descriptive commits for easier review.

3) Rebase work branch on integration:
   - `git checkout <name>`
   - `git rebase ultrawork/dev`
   - `HUSKY=0 git push --force-with-lease origin <name>`

4) Open PR: `<name>` → `ultrawork/dev`.

5) Merge PR into `ultrawork/dev`.

## Notes

- `HUSKY=0` bypasses pre-commit hooks that fail on upstream's build errors, so we're not blocked by issues we don't control.
- This repo (optionally) uses Mise to pin Bun for consistent hooks.
   - Toolchain config lives in `mise.toml`.
   - Install tools once per machine: `mise install`.
