---
description: Full 7-stage development process — Research → Architect → Implement → Code Critic → QA → Security → Documentation → Gate. Use at the start of any non-trivial task.
---

# Dev Loop — 7-Stage Process

Every non-trivial task follows this pipeline. Stages 3, 4, and 6 are never skippable. Others have skip conditions noted.

## Step 0: Pick the track

- **CODE track** — TypeScript features, bugfixes, refactors, Effect services. Goes through all 7 stages.
- **CHANGE track** — config, docs, commands, agents, AGENTS.md edits. Skips stages 1–4; goes straight to verify-by-observation → Security (if touching auth/secrets) → Documentation → Gate.

## Stage 1: Research (conditional)

**Skip when:** you have explicit requirements, the task is a trivial single-file change, or the codebase area is already well-understood.

**Invoke:** switch to the `research` agent. Ask it to investigate and return a READY/BLOCKED verdict.

What it produces: relevant files, constraints, risks, recommended approach.

## Stage 2: Architect (mandatory for non-trivial)

**Skip when:** trivial single-function change or config edit where the interface is obvious.

**Invoke:** switch to the `architect` agent. Give it the Research findings. Ask for a design artifact + APPROVED/NEEDS_IMPROVEMENT/BLOCKED verdict.

What it produces: interface contracts, module boundaries, data flow, edge cases, out-of-scope list.

Gate: do not proceed to Implementation until APPROVED.

## Stage 3: Implementation (never skip)

Use the primary model (or invoke a specialized context if needed). Implement against the Architect's design artifact.

Rules (CODE track):
- **Vertical slices only.** One `RED → GREEN → REFACTOR` cycle at a time — see `/tdd`.
- Integration tests through public interfaces. Mock only at system boundaries.
- `bun test` from the package dir after each slice. Never from repo root.
- `bun typecheck` before handing off to Code Critic.

Rules (CHANGE track):
- Make the change.
- Verify by direct observation — re-read the config value, check the service, read the log line.
- An unobserved result is never a pass.

## Stage 4: Code Critic (mandatory, blocking — never skip)

**Invoke:** switch to the `code-critic` agent after every Implementation that modified TypeScript files.

Give it: files modified, stated intent, any verification evidence you cited.

It will re-run your verification commands independently. It returns APPROVE / WARN / BLOCK.

Gate: do not proceed to QA until Code Critic returns APPROVE or WARN. On BLOCK, return to Implementation with findings. Maximum 3 cycles before escalating to user.

## Stage 5: QA (mandatory)

**Invoke:** switch to the `qa` agent.

It runs `bun test` and `bun typecheck` from the correct package dir and verifies runtime behavior where tests can't cover it. Returns QA PASSED / QA FAILED with verbatim evidence.

Gate: do not proceed to Security until QA PASSED.

## Stage 6: Security (mandatory, blocking — never skip)

**Invoke:** switch to the `security` agent.

It reviews auth/authz, secrets, injection surfaces, SSRF, deps, and runs a credential scan on the diff. Returns APPROVE / WARN / BLOCK.

Gate: do not proceed to Documentation on BLOCK. On BLOCK, return to Implementation. On APPROVE or WARN, proceed.

## Stage 7: Documentation (mandatory)

**Invoke:** switch to the `documentation` agent.

It updates UPCOMING_CHANGELOG.md, AGENTS.md (if a new convention was established), and any public API docs. Returns DOCUMENTATION COMPLETE or DOCUMENTATION SKIPPED with reason.

## Gate: no-mistakes

After Stage 7, run the gate:

```
git push no-mistakes <branch>
```

This runs review → test → docs → lint in a disposable worktree and opens a clean PR only when all checks pass.

**Graceful degradation:** if `no-mistakes` is unavailable, fall back to small logical commits + manual PR. Use `/commit` which checks for no-mistakes automatically.

## Skip audit

When any non-skippable stage is skipped (Code Critic, Security), note it explicitly:

```
⚠️ Stage 4 (Code Critic) skipped: <reason>
Files modified: <list>
Risk: <what could be missed>
```

Three or more skips in one task → surface the cumulative review debt to the user.
