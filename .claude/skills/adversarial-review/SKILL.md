---
name: adversarial-review
description: One code-review pass over a PR whose proof is green — you RUN things to ground every claim, then judge what execution cannot settle. No rounds, never blocks. Reports findings with reproductions and returns them to you. Invoked by the owner after /implement, before /merge.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, Agent, mcp__linear-axiomic__*
---

# adversarial-review

The code review. **You invoke this** — it is not chained from `/implement`.

**One pass. No rounds. Never blocks a merge.** It reports; you decide.

## The rule that makes one pass safe

**Every claim you make is grounded by something you ran.** Not "this looks wrong" —
"I did X, here is what it printed."

This is the whole difference between a review that converges and the one that took six
rounds. That loop was not bad because it was adversarial; it was bad because it was
**adversarial without evidence**. Findings were arguments, so each round produced new
arguments, and prose about code cannot be falsified. A finding that ships with a
reproduction is settled the moment someone re-runs it.

So: be as hostile to the change as you like — but pay for every accusation with a
command and its output. If you cannot produce one, say so and mark the finding
advisory.

## What the proof does and does not settle

The proof is written by the **same agent that wrote the code**. A red run proves the
proof discriminates *for the case that agent chose* — not that they chose the right
case, and not that the fix generalises.

AXI-142 is the counterexample. Four occurrences, each round fixing the instance while
the next one waited. A proof of "abandon 50 streams, `current_count` returns to
baseline" goes green against in-path cleanup that still breaks at a *different*
interruption point. **The proof passes and the invariant does not hold.**

So do not treat green as the end of the correctness question. Treat it as the start of
§2.

## Scope — only what no proof covers

- **Is the abstraction right?** Wrong shape, wrong seam, duplication a grep cannot see.
- **Does the diff falsify prose elsewhere?** `STORIES.md`, `DEFERRED.md`, runbooks,
  skill text — especially claims the diff never touches. A widened allowlist can
  falsify a "sole write is X" security story sections away.
- **Does it widen a security boundary?** Authz, isolation, tenancy, egress.
- **Is something dangerous sitting beside the change?** The reference case: AXI-142
  shipped a runbook with `UPDATE agent_sessions SET status='CANCELLED' WHERE
  organization_id=... AND status='RUNNING'` — no `flow_run_id` predicate, no age
  predicate. A healthy idle chat session parks at exactly that state, so running it
  during an incident cancels every live session in the org. **No proof of "abandoned
  streams release slots" would ever have caught that.** A reviewer reading the diff
  would.

**Still not in scope:** whether the code follows the stack principles. The gates decide
that — lint, types, docstrings, coverage, hooks. Re-litigating what a linter settles is
how six rounds happen.

## Blind — this is the mechanism, not a detail

Spawn **one** skeptic (`model: "opus"`, passed explicitly — see "Subagent model" in
`CLAUDE.md`) whose prompt is only: the PR number, the repo, and this scope. **No
orchestrator grounding, no constraint list, no summary of what was already reviewed.**

Reviewers spawned from your context inherit your blind spots. In the AXI-142 session
the blind gates found 4 of 6 blockers, including a regression that three in-loop
skeptics had passed. Handing it your context defeats the only advantage it has.

Scale to blast radius: one reviewer is the default. A migration, a security story, or
an infra change earns a second with a different lens — never four by habit.

## Procedure

### 1. Gather
`gh pr diff <PR#> --repo <github_repo>`, the PR body (its claims get fact-checked like
any other prose), the ticket's **outcome + proof**, `STORIES.md`, `DEFERRED.md`.

### 2. Get your own checkout — do not review in the implementer's worktree

You are about to break code on purpose. Doing that where the implementer is working
corrupts their tree and produces findings that are artefacts of your own edits.

This already happened: three skeptics mutating source in a **shared** worktree produced
a "these tests fail 4 of 9 runs" report that was pure cross-contamination, and it nearly
reached the implementer as a real finding in the final round.

So: a fresh worktree at the PR's head, or `isolation: "worktree"` on any agent you
spawn. Restore anything you break before you finish, and never push.

### 3. Run the proof yourself

Do not take the PR body's word for it — an AXI-142 PR body claimed "5342 passed / all
four gates clean" while CI was red on an F401 that gated the test step, so the test job
never ran at all.

Run it. Confirm green. If the proof cannot be run, or the PR carries no red/green
output, **that is the finding** — stop and say so rather than reviewing a change whose
outcome was never demonstrated.

### 4. Break the fix and re-run the proof — it MUST go red

Revert the diff's load-bearing hunk (`git` is enough — revert, run, restore; you never
need to hand-edit) and run the proof again.

- **Goes red** — good. The proof genuinely pins the fix.
- **Stays green** — **blocker.** The proof does not test the thing it claims to, and
  green after the fix meant nothing. Report it with the exact revert you made and the
  output.

This is the cheapest high-value check in the whole workflow, and it is the one that
catches test theatre. Its bigger cousin found, in one session: a test that passed on
*unfixed* code, a test that passed against a plain starlette response with **zero**
production code, and a function whose body could be replaced with `pass` while all 25
tests stayed green.

### 5. Try to find the case the fix misses — one attempt, then stop

Look for the neighbouring failure the proof does not cover: the adjacent interruption
point, the boundary just outside the tested range, the second code path with the same
shape.

**One attempt.** If you find something, reproduce it and report it as a blocker with the
reproduction. If you do not, say so and move on. Do **not** keep hunting — that open
ended search is precisely what turned into six rounds, and its findings decayed into
prose fixes and one SQL predicate.

### 6. Judge what execution cannot settle
The scope list above — abstraction, prose falsified elsewhere, security boundaries,
dangerous adjacent content. These are opinions and are reported as opinions.

### 7. Report
Comment on the PR (always, pass or not):
`gh pr comment <PR#> --repo <github_repo> --body "<findings>"`

Every finding states **what you ran and what it printed**, or is explicitly marked
advisory. Then return the findings to the owner in chat. Do not set a Linear status —
the proof, not a reviewer, decides what state this ticket is in.

## What this skill never does

Never leaves a mutation behind. Never pushes. Never merges. Never opens follow-up
tickets — surface what you found and let the owner decide. Never iterates: if findings
need fixing, that is `/implement` again, driven by you.

It *does* now hold `Edit`/`Write`, solely so it can break things in its own checkout.
Using them to fix the PR is out of bounds — a reviewer that repairs what it reviews has
no independent view of it left.

---

$ARGUMENTS
