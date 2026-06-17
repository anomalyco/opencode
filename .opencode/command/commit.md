---
description: Commit and gate via no-mistakes (or fall back to direct commit)
model: opencode/kimi-k2.5
subtask: true
---

## Gate first

Before committing, check if `no-mistakes` is available:

```bash
which no-mistakes 2>/dev/null && no-mistakes status
```

If `no-mistakes` is available and this repo has it initialized (status shows a gate path), use it:
```
git push no-mistakes <current-branch>
```
This runs review → test → docs → lint in a disposable worktree and opens a PR only when all checks pass. Do not run `git commit` + `git push` manually when no-mistakes is available.

**Graceful degradation:** if `no-mistakes` is not available or not initialized for this repo, fall through to the direct commit below with small logical commits and a clear message.

---

## Direct commit (fallback)

commit and push

make sure it includes a prefix like
docs:
tui:
core:
ci:
ignore:
wip:

For anything in the packages/web use the docs: prefix.

prefer to explain WHY something was done from an end user perspective instead of
WHAT was done.

do not do generic messages like "improved agent experience" be very specific
about what user facing changes were made

if there are conflicts DO NOT FIX THEM. notify me and I will fix them

## GIT DIFF

!`git diff`

## GIT DIFF --cached

!`git diff --cached`

## GIT STATUS --short

!`git status --short`
