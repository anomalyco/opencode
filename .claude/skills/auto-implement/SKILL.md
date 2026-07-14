---
name: auto-implement
description: Fully automate a change end-to-end — clarify + file the ticket for your approval, then a background subagent runs the whole workflow (plan → implement → PR) in a worktree while this instance reviews and loops it to green, stopping at an open PR for you. Use for lower-stakes work you want driven hands-off.
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Agent, WebSearch, WebFetch, mcp__linear-axiomic__*
---

# auto-implement

Drive the entire standard workflow for the requirement in `$ARGUMENTS` with **exactly two
human touchpoints**: you approve the ticket, and you review the finished PR. Everything
between is automated. **This skill never merges** — the open PR is the handoff.

You are the **orchestrator**. You do the interactive ticket work yourself, then spawn a
**background subagent** that does the code work inside the worktree, and you run the
review loop against it. The four interactive skills (`/plan`, `/implement`, `/pr`,
`/merge`) are **not modified** — the subagent runs them in *autonomous mode* purely
because you instruct it to (see §4).

**Operate from first principles** (see "Operating mode: first principles" in `CLAUDE.md`).
After the ticket is approved there is **no channel to the user** — you and the subagent
resolve every downstream ambiguity by reasoning from first principles and recording the
decision, never by pausing to ask.

## 1. Config + stakes read
Read `.axiomic.toml` (`ticket_label`, `github_repo`, `default_base`, `commands.*`) and
`.claude/axiomic-shared.toml` (`linear_team`). Skim `STORIES.md`.

Judge the **stakes** from the requirement — this only tunes how much you ask up front:
- **Low-stakes** — reversible, small surface, no new dependency, no schema/migration, no
  infra (`*.tf`) change, no security-story impact. → Ask **nothing** (or one round at
  most); go straight to the draft.
- **Higher-stakes** — touches a security story, schema/migration, infra, or a new
  dependency. → Always ask at least one clarification round, and always show the ticket.

## 2. Ticket stage (interactive — the one place you may ask)
Run the `/write-ticket` procedure yourself, in this instance:
- Ground the requirement in the code (Explore agents, scaled to complexity).
- Ask **outcome-level** clarifications only, from first principles, scaled to stakes
  (§1). Keep them at the "what/why" altitude — **no implementation-detail questions**
  (those are resolved autonomously in `/plan` later).
- Draft the ticket body (Overview / FRs / NFRs / Success Criteria / User-story impact /
  Key files), exactly as `/write-ticket` specifies.

**Approval gate — required.** Show the draft and `AskUserQuestion`: **Approve / Revise /
Abort**. On *Approve*, create the real Linear issue (team `linear_team`, label
`ticket_label`) and capture its id + URL. This is the last time you interact with the
user until the PR.

## 3. Worktree (reuse `/worktree`)
Run the `/worktree create <TICKET>` procedure (do not reinvent it): pick the base ref,
create branch + worktree at the sibling `-worktrees/<TICKET>` dir, seed `workspace/`
with `context.md` from the ticket, and verify the main checkout is untouched. Capture the
worktree path as `WT`.

## 4. Spawn the background subagent (autonomous mode) + gate the plan
Spawn **one** subagent (Agent tool) to do all the code work inside `WT`. Its prompt must
carry the **autonomous-mode override** — this is what suppresses the interactive gates
without touching the skills:

> You are implementing ticket `<TICKET>` inside the worktree at `<WT>`. Do all work there.
> Follow the `/plan`, then (once the plan clears review) `/implement`, then `/pr` skill
> procedures **in autonomous mode**:
> - **Never use `AskUserQuestion`** and never wait for a human — there is none. Wherever a
>   skill says to ask the user or presents an approval gate, instead decide from **first
>   principles** (the constraints + the ticket's success criteria), pick the most
>   defensible option, and **record the decision and the alternatives** in the plan's
>   *Risks/decisions* section and in the PR body's *Review notes*. Skip `/plan`'s
>   interactive questionnaire + approval gate and the PR approval gate.
> - **Stop after `/plan` writes the plan file** and report its path back — do not start
>   implementing until told the plan cleared review.
> - Otherwise obey the skills exactly: TDD (red → green → refactor), update `STORIES.md`,
>   respect `.claude/principles.md`, punt anything out of scope to `DEFERRED.md`, run
>   `commands.{format,lint,typecheck,test}` clean before opening the PR.
> - Open the PR keyed to the `<TICKET>` branch and report the **PR number + URL** back.

**Plan gate.** When the subagent reports the plan path, run the `/plan-review` procedure
against it — fresh-context skeptics given the artifacts alone; hand them nothing you or
the subagent decided along the way (findings land as a Linear comment):
- **Pass** → tell the subagent to proceed (`/implement` → `/pr`).
- **Changes needed** → send the findings to the same subagent to revise the plan, then
  re-run `/plan-review`. Never proceed to implementation over an open blocker — a wrong
  assumption is cheap here and expensive after the tests are written around it.
- **Trivial plan** (low-stakes per §1; `/plan` skipped exploration) → skip the gate and
  say so in the final report.

Keep this subagent alive — you will send it the review findings and it will fix in place,
with its context intact.

## 5. Review loop (in-loop rounds + a blind exit gate)
The structural risk this loop must defeat: **in-loop reviewers are spawned from your
context** — your framing, your constraints, your grounding — so they cannot catch your
own blind spots. In-loop rounds buy fast convergence; the merge-ready stamp only ever
comes from a **blind** review that starts from the artifacts alone.

Repeat (in-loop rounds):
1. Run the `/adversarial-review` procedure against the PR. It posts its findings as a
   PR comment (always), records the verdict in Linear, and returns it to you. Two rules
   for how you spawn its skeptics:
   - **Constraints are review targets, not rules.** Any constraint you gave the
     implementer ("don't touch §4", "stay out of `app/`") is handed to skeptics phrased
     as a claim to refute — "this edit boundary causes no falsehood elsewhere" — never
     as a rule to enforce. A reviewer that praises the PR for respecting your constraint
     has inherited your blind spot.
   - **One fresh eye per fix round.** Never scope a post-fix round to "verify the fixes"
     alone — alongside fix-verification, spawn **one skeptic with no prior-round
     context**, so discovery never turns off.
2. **Changes needed** → send the concrete findings back to the **same** subagent (continue
   it so its context is intact) with instruction to fix in autonomous mode, re-run the
   `commands.*` gates, and push to the same PR. Then loop.
3. **Pass** → proceed to the blind exit gate.

**Blind exit gate — the only path to merge-ready.** Spawn a **fresh subagent** whose
prompt is only the PR number + repo + "run the `/adversarial-review` procedure": no
orchestrator grounding, no constraint list, no round history, no summary of what was
already reviewed. The blindness is the mechanism — its only advantage over the in-loop
rounds is starting from the artifacts alone, and handing it your context would defeat it.
- Blind **pass** → the loop ends; the PR is merge-ready.
- Blind **changes needed** → its findings go back to the subagent like any in-loop
  round's, and the loop continues (re-enter at step 1; the next exit attempt is a new
  blind review). Blind/in-loop disagreement is evidence the loop was blind to something —
  never grounds to overrule the blind review.

**No round cap** — iterate until the blind gate passes; the terminal state is always the
PR, never a question to the user. **Non-convergence safeguard:** if a round produces no
net change on the findings (the same blockers recur, or the subagent reports it cannot
resolve them from first principles), **stop and leave the PR open** with the outstanding
findings called out — do *not* spin forever, and do *not* escalate mid-flow; the PR
itself is the escalation.

### Driving parallel tickets: pass expiry + the join pass
A review pass is stamped **against the base state it reviewed** — it is not timeless.
When you drive sibling tickets in parallel:
- **Pass expiry.** When a sibling PR lands a decision touching shared semantics (a path
  convention, a shared doc section, a contract both PRs cite), every other sibling's
  pass **expires** and its review re-opens. This is not merge-conflict avoidance —
  disjoint hunks can still contradict each other ("`corpus/uploads/` examples were
  wrong-on-arrival once the sibling settled on `corpus/artifacts/`").
- **Join pass.** After the last sibling passes its blind gate, run one final pass that
  checks each PR's examples and claims against the others' final choices, then merge in
  the recommended order.

## 6. Stop at the PR
Never run `/merge`. Report to the user:
- ticket id + URL, PR number + URL, worktree path;
- plan gate outcome (passed after N rounds / skipped-as-trivial);
- review outcome (blind gate passed, or stopped-with-findings and what remains);
- the **key first-principles decisions** the subagent recorded (so you know what to check).

Next step is **yours**: review the PR, then `/merge <TICKET>` (or `/adversarial-review`
again by hand) when you're satisfied.

---

$ARGUMENTS
