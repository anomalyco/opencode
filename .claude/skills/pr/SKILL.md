---
name: pr
description: Open (or update) the pull request for the ticket branch after running format/lint/typecheck/test. PR body cites FRs, success criteria, and story changes. Use after /implement.
allowed-tools: Read, Bash, Grep, Glob, AskUserQuestion, mcp__linear-axiomic__*
---

# pr

Open the PR for the current ticket branch. Gate on a clean local check first — never
open a PR over red.

## 1. Config + ticket
`.axiomic.toml`: `github_repo`, `default_base`, `commands.*`. Detect the ticket from
the branch. Confirm you're on the `<TICKET>` branch with commits ahead of
`origin/<default_base>`.

## 2. Pre-flight gates (all must pass)
Run, in order, and stop on the first failure (report it; the fix is `/implement`, not
weakening the check):
```
<commands.format>     # must leave tree clean (no reformat diff)
<commands.lint>
<commands.typecheck>
<commands.test>
```
Also sanity-check the workflow invariants: `STORIES.md` reflects the behavior change,
no stray markdown was added (only CLAUDE.md / STORIES.md / DEFERRED.md), and nothing
read or committed under `*.tf` / `.env*` / `secrets/`.

## 3. Push (verified)
```
git push -u origin <TICKET>
git fetch origin <TICKET>
[ "$(git rev-parse <TICKET>)" = "$(git rev-parse origin/<TICKET>)" ] || echo "PUSH VERIFY FAILED"
```

## 4. Create or update the PR
Pull the ticket title/body from `mcp__linear-axiomic__get_issue`. Build the body:

```markdown
Linear: <ticket URL>

## Overview
<1–2 sentences>

## Success Criteria
- [x] <criterion> (covered by `tests/...`)

## Story changes
- Functional: <added/changed stories — or none>
- Security:  <added/changed negative stories — or none>

## Tests
<summary: tests added, coverage>

## Review notes
<concerns, trade-offs, areas needing attention — or none>
```

If the diff touches `*.tf`, append a collapsed `<details>` with a `terraform plan`
summary for the changed stack (warn but continue if it can't run).

**Approval gate — before creating.** Show the diffstat
(`git diff --stat origin/<default_base>...<TICKET>`), the proposed PR title + body, and
any review concerns from the pre-flight pass. `AskUserQuestion`: **Open PR / Revise /
Abort**. Only create or update on explicit approval.

```
gh pr view <TICKET> --repo <github_repo> --json number >/dev/null 2>&1 \
  && gh pr edit  <TICKET> --repo <github_repo> --title "<TICKET>: <title>" --body "<body>" \
  || gh pr create --repo <github_repo> --base <default_base> --head <TICKET> \
       --title "<TICKET>: <title>" --body "<body>"
```

## 5. Link back to Linear
Comment the PR URL on the ticket (`mcp__linear-axiomic__save_comment`) and move it to
"PR Open".

## 6. Output
Report the PR URL. Next step: `/adversarial-review <PR#>`. Do not merge here.

---

$ARGUMENTS
