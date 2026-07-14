---
name: plan
description: Produce a TDD implementation plan for a ticket — parallel exploration, an interactive requirements pass, a user approval gate, then the stories and failing tests to write first and the code steps. Use after /worktree; /plan-review gates the result before /implement.
allowed-tools: Read, Grep, Glob, Bash, Agent, AskUserQuestion, WebSearch, WebFetch, mcp__linear-axiomic__*
---

# plan

Turn a ticket into a **test-first** plan written to `workspace/plans/<TICKET>.md`. The
plan names the stories and tests **before** any implementation — that ordering is the
point. No code is written here.

**This is where the "how" is decided.** The ticket (from `/write-ticket`) fixed the
*what* — FRs, NFRs, success criteria, story impact. `/plan` is the **sole owner of the
implementation-detail questionnaire**: data models, file layout, algorithms, library
choices, API shapes, migration strategy. Every implementation-level question the ticket
deliberately deferred gets asked and answered *here*, before the file is written.

**Operate from first principles.** Before asking anything, derive from first principles
which implementation unknowns are actually *load-bearing* — and ask only those. When you
present approach options, present first-principles-derived options with a reasoned
recommendation, not a menu. (See "Operating mode: first principles" in `CLAUDE.md`.)

## 1. Load context
Config from `.axiomic.toml`; detect the ticket (worktree dir → branch → `$ARGUMENTS`).
Read `workspace/context.md` (or `mcp__linear-axiomic__get_issue`) for FRs / NFRs / Success
Criteria, and read `STORIES.md` and `.claude/principles.md` (the stack's dev rules — the
plan and tests must conform).

## 2. Parallel exploration
Spawn **all four** Explore agents concurrently (skip for trivial changes). Each returns
structured findings **and its open questions**:
1. **Architecture** — map the system around the feature area: service boundaries, data
   flow, integration points. Flag decisions that need the user.
2. **Code patterns** — existing implementations of similar features; conventions and
   utilities to reuse; the exact files/functions that will change.
3. **Test coverage** — the test patterns, markers, and structure to match (per
   `.claude/principles.md` and the stack); where the new tests belong.
4. **External docs** — web-search/fetch docs for any new dependency, API, or framework;
   summarize the relevant best practices.

## 3. Present the exploration summary (in chat)
Before asking anything, post a short summary of each explorer's findings and the
consolidated list of open questions. This is for the user to react to.

## 4. Interactive requirements pass (the implementation questionnaire)
This is the one place implementation-detail questions get asked. Resolve the open
questions with `AskUserQuestion`, in batches of 2–4. Always cover in round 1: any
**architecture/pattern/data-model decision** the explorers surfaced, plus scope in/out
if the ticket left it open. These are the *how* questions the ticket deferred here on
purpose. Keep asking rounds until the user is satisfied or says "no more context". Skip
entirely if the implementation approach is unambiguous.

## 5. Derive stories and tests (the TDD core)
- **Stories:** for each behavior change, the **functional (can-do)** story and, where
  there's an authz/isolation/forbidden-action angle, the **security (cannot-do)** story.
  Every FR → at least one story.
- **Tests:** for each story and each Success Criterion, the concrete test that will
  assert it — file path + what it checks. Security stories → **negative** tests
  (assert the action is blocked). These are written first and must fail initially.
- Confirm every Success Criterion maps to a test; flag any that can't be tested.

## 6. Approval gate (before writing the file)
Summarize the proposed plan **in chat** — stories, test count, step count, key files,
risks, and the assumptions/decisions made. Then `AskUserQuestion`:
- **Plan looks good** → write the file.
- **Need revisions** → iterate on the named sections, re-summarize.
- **Add requirements** → incorporate, re-summarize.

Only write `workspace/plans/<TICKET>.md` after approval. This gate is for fast,
human-facing convergence — it is **not** the adversarial check. The context that wrote
the plan cannot catch its own blind spots; that is `/plan-review`'s job, after the file
exists.

## 7. Write `workspace/plans/<TICKET>.md`
```markdown
# Plan: <TICKET> — <title>

## Summary
<1–2 sentences: what this implements and why.>

## Stories to add/change (STORIES.md)
- Functional: <story> → <test path>
- Security:  <story> → <test path>

## Tests to write first (must fail red)
- [ ] <test path> — asserts <FR/criterion>

## Implementation steps (red → green → refactor)
1. <step>: write failing test(s) → minimal code to green → refactor.

## Files
- create/modify: `path` — <why>

## Risks / decisions
- <decision> — <choice + why>
```

## 8. Output
Confirm the file was written and restate the plan headline (stories, test count, step
count). Next step: `/plan-review` (the adversarial gate; skip only for trivial plans),
then `/implement`.

---

$ARGUMENTS
