---
name: implement
description: Execute a plan test-first (TDD) — write/extend STORIES.md and failing tests, then code to green, refactor, commit. Use after /plan-review passes (or straight after /plan for trivial changes).
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion, mcp__linear-axiomic__*
---

# implement

Execute `workspace/plans/<TICKET>.md` strictly **test-first**. Red → green → refactor,
one step at a time. Code documents itself; the only docs you touch are `STORIES.md` and
(if you punt anything) `DEFERRED.md`.

**Operate from first principles.** The plan set the direction, but real decisions still
surface mid-implementation. Resolve them by reasoning from first principles — the actual
constraints and the desired behavior — not by pattern-matching the nearest example. If a
choice is load-bearing and genuinely underdetermined, prefer the most defensible option
and record the assumption (in the plan's Risks/decisions), rather than guessing silently.
(See "Operating mode: first principles" in `CLAUDE.md`.)

## Setup
Config from `.axiomic.toml` (`commands.test`, `commands.typecheck`, `commands.format`).
Detect the ticket; read the plan. If there's no plan, run `/plan` first. If the plan
hasn't been through `/plan-review` (no review comment on the ticket), run that first —
unless it's a trivial plan, in which case say you're skipping the gate.

## The TDD loop (per plan step)
1. **RED.**
   - Add or update the relevant `STORIES.md` entry — **functional (can-do)** and, where
     relevant, **security (cannot-do)** — and point it at the test path.
   - Write the test(s). Security stories get **negative** tests (assert the action is
     blocked). Run `commands.test` (scoped to the new tests) and **confirm they fail for
     the right reason**. A test that passes immediately is suspect — fix the test.
2. **GREEN.** Write the **minimal** code to make them pass. Run the tests → green.
   Never weaken or delete a test to get green.
3. **REFACTOR.** Clean up names/structure; keep tests green. Add short usage docstrings
   to new public surfaces; let type hints carry the types. No code-doc markdown.
4. **Commit** the step: `git commit -m "<TICKET>: <what this step did>"`.

## Rules
- **Follow the stack principles.** Obey `.claude/principles.md` (e.g. Python: Pydantic
  for all data models, never dataclasses or bare dicts at boundaries). Violations fail
  review.
- **Self-documenting code only.** Docstrings on public surfaces (usage-focused), clear
  names, comments explain *why* not *what*. Never create a markdown file to explain code.
- **Guardrails.** Terraform source (`*.tf`) is fine to read; **variables/credentials are
  not** — `*.tfvars`, `*.tfstate`, `.env*`, `secrets/`, and keys are blocked by the hook.
  If you think you need a secret value, stop and ask.
- **Punt to DEFERRED.md, not to a TODO.** Anything out of scope / known limitation /
  follow-up gets a dated entry in `DEFERRED.md` (what · why · ticket). No `TODO`/`FIXME`
  left in code.
- **No real external calls in tests.** Mock at the boundary; use a test DB.

## Done check
- `commands.test` passes — **full suite, no regressions**; new code is fully covered.
- `commands.typecheck` and `commands.format` are clean.
- Every Success Criterion in the ticket is green and every changed story links to a
  passing test.

## Output
Summarize: stories added/changed, tests added (red→green), files touched, anything sent
to `DEFERRED.md`. Then present **2–3 manual verification scenarios** for the human to
spot-check before handoff (action → expected result) — the things a test can't prove.
Next step: `/pr`.

---

$ARGUMENTS
