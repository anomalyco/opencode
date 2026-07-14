---
name: merge
description: Merge the ticket's PR into the base branch, set Linear status, and clean up the branch + worktree. Use after /adversarial-review passes.
allowed-tools: Read, Bash, AskUserQuestion, mcp__linear-axiomic__*
---

# merge

Merge a ticket's PR into its base. Single repo — ordinary `git` + `gh pr merge`, with
the safety habits worth keeping: rebase on a backup tag, an explicit approval gate,
push verification, then Linear status + worktree cleanup.

## 1. Resolve
Config (`github_repo`, `default_base`); detect `<TICKET>` and `TARGET` (from
`$ARGUMENTS` "into <branch>", else `default_base`). Find the PR: `gh pr view <TICKET>
--repo <github_repo> --json number,state,mergeStateStatus,statusCheckRollup`.

**Preconditions** (stop if unmet): `/adversarial-review` has passed, the PR is open,
and required checks are green. If `mergeStateStatus`/checks are not clean, stop and
report — don't merge over red. Confirm a **clean working tree** first
(`git status --porcelain` empty); if dirty, `AskUserQuestion` (**stash / abort**) before
touching the branch.

## 2. Rebase on target (with backup)
```
git tag "_backup/<TICKET>/$(date +%Y%m%d-%H%M%S)" HEAD     # recoverable point
git fetch origin <TARGET>
git rebase origin/<TARGET>                                  # resolve conflicts with the user if any
git push --force-with-lease origin <TICKET>
git fetch origin <TICKET>
[ "$(git rev-parse <TICKET>)" = "$(git rev-parse origin/<TICKET>)" ] || echo "PUSH VERIFY FAILED"
```

## 3. Approval gate
Show the final diffstat and the PR URL, confirm the rebased branch's checks are green,
then `AskUserQuestion`: **Merge / Abort**. Only proceed on explicit confirmation.

## 4. Merge
```
gh pr merge <TICKET> --repo <github_repo> --squash --delete-branch
```
(Squash keeps one tidy commit per ticket on the base. Verify the PR shows MERGED.)

## 5. Linear status
`mcp__linear-axiomic__get_issue` then set state by target:
- `TARGET` == staging → "Merged to Staging" (the deploy/verify gates take it from here:
  `/deploy-staging` → "Deployed to Staging", `/e2e-staging` on pass → "Done". A merged
  ticket is not done until a deployed build is verified against its Success Criteria.)
- `TARGET` == main/master → "Done"
- another feature branch → leave unchanged (tell the user)
```
mcp__linear-axiomic__save_issue(id: "<issue id>", state: "<state>")
```

## 6. Cleanup
- Remove the worktree: `git worktree remove "$(dirname $(git rev-parse --show-toplevel))/$(basename ...)-worktrees/<TICKET>"` (or run `/worktree remove <TICKET>`).
- Delete the local branch: `git branch -d <TICKET>` (remote already deleted by `--delete-branch`).
- Delete backup tags: `git tag -l "_backup/<TICKET>/*" | xargs -r git tag -d`.

## Recovery
If the rebase (step 2) goes wrong, nothing is lost — recover from the backup tag:
`git rebase --abort` (if mid-rebase), then `git reset --hard "$(git tag -l "_backup/<TICKET>/*" | tail -1)"`.
The tag is deleted only in step 6, after a clean merge.

## 7. Output
Summary: PR merged → TARGET, Linear status, branch/worktree cleaned. If TARGET is
staging and the repo has a deploy skill (e.g. `/deploy-staging <PR#>`), point the user
there as the next step.

---

$ARGUMENTS
