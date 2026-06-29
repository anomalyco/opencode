# Updating owner-opencode From Upstream

This repository is a fork mirror of upstream OpenCode used by the `owner` repo as a submodule at:

```text
apps/forge-ui/vendor/opencode
```

Do not use a GitHub pull request to update the fork from upstream. A PR from upstream into the fork can show a very large diff, may compare the wrong direction, and can fail with permission errors because GitHub treats it as a cross-repository PR. Update the fork with local git instead.

Important: updating and pushing this fork is not enough for Forge UI to use the new code. The `owner` repo pins `apps/forge-ui/vendor/opencode` to a specific submodule commit. Changes only take effect in Forge UI after the `owner` repo updates that submodule pointer and commits the new gitlink.

## Repositories

- Fork repo: `https://github.com/owner/owner-opencode.git`
- Upstream repo: `https://github.com/anomalyco/opencode.git`
- Default branch: `dev`
- Parent repo that pins this fork as a submodule: `/Users/aidan/Desktop/work/code/owner`
- Fork checkout: `/Users/aidan/Desktop/work/code/owner-opencode`

## Safe Fork Update Workflow

Run these commands from `/Users/aidan/Desktop/work/code/owner-opencode`.

```bash
git status --short --branch
git remote -v
```

The working tree should be clean before rebasing. Ensure `origin` points to `owner/owner-opencode` and `upstream` points to `anomalyco/opencode`.

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
```

If `upstream` already exists, skip that command.

Fetch upstream and inspect counts without loading the full diff:

```bash
git fetch upstream dev
git rev-list --left-right --count upstream/dev...dev
git log --oneline upstream/dev..dev
```

The first number is commits present only in upstream. The second number is commits present only in the fork. Review the fork-only commit list before rebasing.

Rebase the fork onto upstream:

```bash
git checkout dev
git rebase upstream/dev
```

If a fork-only bug-fix commit conflicts heavily with rewritten upstream code, inspect only that commit's patch and the conflicted regions:

```bash
git show --stat --oneline <commit>
git show --format= --unified=30 <commit> -- <specific-file>
rg -n "^(<<<<<<<|=======|>>>>>>>)" <conflicted-files>
```

If upstream has already replaced the affected area and the local fix is obsolete, skip the commit:

```bash
git rebase --skip
```

Only hand-port a local fix when the current upstream source still has the same bug. Do not preserve stale fork logic just to keep a fork commit.

Verify the result:

```bash
git status --short --branch
git rev-parse dev upstream/dev origin/dev
git rev-list --left-right --count upstream/dev...dev
```

When satisfied, update the fork remote:

```bash
git push --force-with-lease origin dev
```

Use `--force-with-lease`, not plain `--force`, so the push fails if someone else updated `origin/dev` after the last fetch.

## Updating The Parent Submodule Pin

Pushing `owner-opencode` does not update the version used by `owner` or Forge UI. The parent repo records a specific submodule commit, so it remains pinned until the gitlink is changed and committed in `/Users/aidan/Desktop/work/code/owner`.

Run these commands from `/Users/aidan/Desktop/work/code/owner`.

```bash
git status --short --branch
git submodule status --recursive
git ls-tree HEAD apps/forge-ui/vendor/opencode
```

Then update the submodule checkout to the desired fork commit:

```bash
cd apps/forge-ui/vendor/opencode
git fetch origin dev
git checkout origin/dev
git rev-parse HEAD
cd /Users/aidan/Desktop/work/code/owner
git status --short
```

The parent repo should now show `apps/forge-ui/vendor/opencode` as modified. That is the submodule gitlink update.

Commit the parent repo pointer change:

```bash
git add apps/forge-ui/vendor/opencode
git commit -m "chore(forge-ui): update opencode submodule"
```

Do not expect submodule updates to appear as normal file diffs in the parent repo. The parent commit stores only the new submodule commit SHA.

## Notes For Agents

- Avoid loading the full upstream-vs-fork diff when upstream is hundreds of commits ahead.
- Prefer commit counts, commit lists, `git show --stat`, and targeted file inspection.
- Do not push until local `dev` has been checked against `upstream/dev`.
- Do not update the parent repo submodule pin until the fork remote has the target commit.
- The submodule checkout is often detached; that is normal.
