---
name: adversarial-review
description: Skeptically review a PR before merge — try to refute that it is correct and complete. Verifies tests actually cover the success criteria, and flags doc bloat or prose that contradicts the tests. Use after /pr, before /merge.
allowed-tools: Read, Grep, Glob, Bash, Agent, AskUserQuestion, mcp__linear-axiomic__*
---

# adversarial-review

The merge gate. Default stance: **the PR is incomplete until proven otherwise.** Your
job is to *refute* it, not to bless it.

**This skill only reviews and reports. It never fixes and never merges.** It has exactly
two side-effects — a **PR comment** with the findings, and the **Linear status** that
records the verdict — and neither touches the work itself: it does not edit code, does not
push, does not open follow-up work, and does not call `/merge`. Fixing is someone else's
job (`/implement` when a human drives it; the background subagent when `/auto-implement`
drives it). This skill also **returns a verdict** (pass / changes-needed with the
findings) to whoever invoked it — reporting the verdict to the caller is not "fixing".

## 1. Gather
Config + ticket. Pull:
- the diff: `gh pr diff <PR#> --repo <github_repo>` (and changed-file list),
- the PR body: `gh pr view <PR#> --repo <github_repo> --json body` (its claims get
  fact-checked like any other prose),
- the ticket: `mcp__linear-axiomic__get_issue` (FRs, NFRs, Success Criteria, story impact),
- `STORIES.md`, `DEFERRED.md`, and the touched tests.

## 2. Adversarial passes (spawn skeptics in parallel)
Spawn Explore/Agent skeptics, each told to **find what's wrong** and report findings
with file:line evidence and a severity (blocker / major / minor). The review target is
**the repo as it will exist after merge**, not the hunks — a diff can be locally clean
and still make the merged world false:

- **Correctness** — bugs, unhandled edge cases, race conditions, wrong assumptions.
  For app-code changes, one skeptic carries a **resource-cost lens**: per-request
  CPU/memory, event-loop blocking, payload-proportional work — on the *accept* path as
  well as the reject path (a skeptic reading a function through a does-it-leak lens
  will miss the full-payload decode sitting next to it).
- **Test integrity** — does each Success Criterion have a test that genuinely asserts
  it? Hunt for weakened/tautological tests, tests that pass without exercising the
  behavior, missing negative tests for security stories, and any test mocking away the
  thing under test. A green suite that doesn't pin the criteria is a **blocker**.
- **Story/doc honesty — in the merged world.** Two directions, both mandatory:
  - *The diff falsifies existing prose:* search `STORIES.md`, `DEFERRED.md`, and skill
    text for claims the change makes false — especially claims the diff never touches
    (a widened allowlist falsifies a "sole write is X" security story sections away).
  - *New prose invents behavior:* every behavioral claim in DEFERRED entries, doc
    text, and the PR body must trace to code (file:line) or be flagged — explicitly
    including claims about code the PR does not touch ("resume re-syncs the workspace"
    is checked against the actual resume path, never against the PR's own text).
  Also flag doc bloat, stray markdown (anything beyond CLAUDE.md/STORIES.md/DEFERRED.md),
  and any markdown created to explain code.
- **Guardrails & hygiene** — credentials/variables read/committed (`*.tfvars` / `.env*`
  / `secrets/` / `*.tfstate` / keys); `TODO`/`FIXME` left in code instead of a `DEFERRED.md` entry;
  code that violates `.claude/principles.md` (stack rules, e.g. dataclasses instead of
  Pydantic); new code not covered.

## 3. Adjudicate
Collect findings, dedupe, and keep the ones that survive scrutiny. For each blocker/
major, give the concrete evidence and the fix.

## 4. Verdict
Decide one of:
- **Changes needed** — blockers/majors remain, each with concrete evidence and the fix
  it implies. Do **not** proceed to merge. (Whoever called this decides what to do with
  the findings — a human runs `/implement`; `/auto-implement` feeds them to its subagent.
  This skill does neither.)
- **Pass** — only when every Success Criterion is backed by a real test, stories are
  honest, and no guardrail/hygiene violations remain.

## 5. Post the comment (always) + record the verdict + return it
**Always** post the findings as a PR comment — whether the verdict is pass or
changes-needed:
```
gh pr comment <PR#> --repo <github_repo> --body "<verdict + findings>"
```

**Then record the verdict in Linear**, so a PR that failed review is never mistaken for
one merely awaiting it:
- **Changes needed** → "Changes Requested"
- **Pass** → "PR Open" (restores the state a prior changes-needed round moved it out of;
  a no-op on a first-round pass)
```
mcp__linear-axiomic__save_issue(id: "<issue id>", state: "<state>")
```
Write it on **every** round — under `/auto-implement` the loop re-reviews after each fix,
and the status must track the latest verdict, not the first one.

Finally, **return** the verdict and findings to the caller (state it plainly in chat so a
human, or the `/auto-implement` orchestrator, can act on it). This skill never edits code,
never pushes, and never merges — the comment, the status, and the returned verdict are its
only outputs.

---

$ARGUMENTS
