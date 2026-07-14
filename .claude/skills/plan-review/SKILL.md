---
name: plan-review
description: Adversarial gate on a plan before any implementation — fresh-context skeptics try to refute the plan from the artifacts alone (ticket, plan file, repo). Use after /plan writes the file, before /implement.
allowed-tools: Read, Grep, Glob, Bash, Agent, mcp__linear-axiomic__*
---

# plan-review

The pre-implementation gate. Default stance: **the plan is wrong until proven
otherwise.** Refute it, don't bless it. The cost asymmetry is the point: a wrong
assumption is cheap to fix in the plan and expensive to fix after `/implement` has
written the tests and the code around it.

**Blindness is the mechanism, not a detail.** The context that wrote a plan cannot catch
its own blind spots — the same structural failure `/adversarial-review`'s blind exit
gate closes at the PR stage, one stage earlier. Every skeptic is spawned with **the
artifacts alone**: the Linear ticket, `workspace/plans/<TICKET>.md`, the repo,
`STORIES.md`, `.claude/principles.md` — nothing else. No authoring rationale, no
summary from whoever wrote the plan, no conversation history. If a skeptic prompt
contains anything the planner said, the gate has failed its own premise.

**This skill never edits the plan and never implements** — Edit/Write are deliberately
absent from its tools. Findings go back to the caller: a human re-runs `/plan` to
revise; `/auto-implement` feeds them to its subagent. Its side-effects are a **Linear
comment** with the findings and the **returned verdict** — nothing else.

**Trivial-plan escape hatch:** for changes trivial enough that `/plan` skipped
exploration, skip this gate too and say so. The gate must not tax one-liners.

## 1. Gather (artifacts only)
Config + ticket detection (worktree dir → branch → `$ARGUMENTS`). Pull:
- the ticket: `mcp__linear-axiomic__get_issue` (FRs, NFRs, Success Criteria, story impact),
- the plan: `workspace/plans/<TICKET>.md`,
- `STORIES.md` and `.claude/principles.md`.

## 2. Skeptic passes (spawn in parallel, one per lens)
Each skeptic gets the artifact paths only, is told to **find what's wrong**, and reports
findings with evidence (file:line for code claims; the plan section for plan claims) and
a severity (blocker / major / minor):

- **Requirements coverage** — every FR, NFR, and Success Criterion maps to a story and
  a named failing test in the plan. A criterion that is unmapped, or that cannot be
  tested as written, is a **blocker**.
- **Test integrity, at design time** — would the *proposed* tests genuinely assert the
  criteria? Hunt tautological tests, tests that would pass without exercising the
  behavior, tests that mock away the thing under test, and security stories with no
  negative test. Strictly cheaper to catch here than in the PR.
- **Grounding / feasibility** — every claim the plan makes about the codebase is
  checked against the codebase: files, functions, and patterns it says it will reuse
  must exist at file:line (a failed lookup is the evidence). Flag missing integration
  points, migration/ordering hazards, and payload-proportional or event-loop-blocking
  work in the proposed design.
- **Scope & altitude** — steps that violate `.claude/principles.md`, over-build
  relative to the ticket, hidden scope, doc bloat, or new markdown created to explain
  code.

## 3. Assumption audit
Enumerate the plan's load-bearing assumptions — from the skeptics' reports plus the
plan's own *Risks/decisions* section. Each is either **grounded** in code (file:line)
or **flagged as an assumption**. An ungrounded load-bearing assumption is a finding,
not a footnote.

## 4. Verdict
- **Changes needed** — blockers/majors remain, each with concrete evidence and the fix
  it implies.
- **Pass** — only when every Success Criterion maps to a real, non-tautological
  proposed test and no guardrail/altitude violation remains.

## 5. Comment + return
Post the findings as a comment on the Linear ticket (`mcp__linear-axiomic__save_comment`)
— the plan stage has no PR, so the ticket is where the review trail lives. Then
**return** the verdict and findings to the caller (a human revises via `/plan`;
`/auto-implement` feeds them to its subagent). Never edit the plan file, never write
code, never commit.

---

$ARGUMENTS
