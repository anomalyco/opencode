---
name: pr
description: Open (or update) the pull request for the ticket branch after running format/lint/typecheck/test. The body carries the proof's red-then-green output as its evidence. Run as the last step of /implement.
allowed-tools: Read, Bash, Grep, Glob, mcp__linear-axiomic__*
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

## Outcome
<the ticket's one sentence of world-state change>

## Proof
| # | Run | Red before | Green after |
|---|---|---|---|
| 1 | `<the command>` | <what it printed before> | <what it prints now> |

<The actual output, quoted. This is the evidence the work is done — not the
description below it. A PR whose proof was never run says so here, plainly.>

## Story changes
- Functional: <added/changed stories — or none>
- Security:  <added/changed negative stories — or none>

## Regression tests
<what now pins this so it cannot come back>

## Review notes
<first-principles decisions worth checking · anything you could NOT verify, and why>
```

**The proof section is the point.** A description of what changed is not evidence;
red-then-green is. If any part of the proof could not be run, say which and why —
never imply a command passed that you did not watch pass.

If the diff touches `*.tf`, append a collapsed `<details>` with a `terraform plan`
summary for the changed stack (warn but continue if it can't run).

**No approval gate here.** `/implement` runs this as its last step and ends at the
PR — that *is* the handoff. Opening a PR is reversible and gates nothing; the two
gates that matter are the owner approving the proof at `/write-ticket`, and the owner
invoking `/review` afterwards. A gate here would only stop an autonomous run from
finishing the one thing it is supposed to finish.

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
Report the PR URL and what went red -> green. Next step is the owner's:
`/adversarial-review <PR#>` when they choose to run it. Do not merge here.

---

$ARGUMENTS
