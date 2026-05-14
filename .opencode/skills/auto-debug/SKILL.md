---
name: auto-debug
description: Systematically debug failures to root cause before shipping a fix
---

# Auto-Debug

Use this skill when a build, test, type check, runtime path, deployment step, or other check fails and the next move is to diagnose and fix it. Debug autonomously until resolved, externally blocked, or the remaining risk is documented.

## Mindset

- Find the root cause; do not patch symptoms.
- Never silence a failing check, suppress an error, remove a failing assertion, broaden a `catch`, or skip a test to make the signal go away.
- Treat a flaky or unrelated-looking failure as a real signal until proven otherwise.
- Keep the change scope tight: fix the cause, then add the smallest validation that would have caught it.
- If the problem is outside your access (sandbox, permissions, network, credentials, infrastructure), stop and surface the blocker with evidence instead of working around it.

## Failure Workflow

1. **Reproduce reliably.** Re-run the failing command in the same environment. If it is intermittent, run it enough times to characterize the rate before investigating.
2. **Capture the signature.** Save the exact command, inputs, config, environment, logs, error message, stack trace, exit code, and affected scope. Quote line numbers and `file:line` references.
3. **Inspect the surrounding state.** Look at recent changes (`git log`, `git diff`), environment assumptions, dependency versions, contracts, traces, metrics, and the code paths the failure touches. Read before editing.
4. **Isolate the failure.** Narrow to the smallest failing unit: a single test, a single input, a single boundary, a single invariant. Bisect commits or inputs when useful.
5. **Form a falsifiable hypothesis.** State what you believe is wrong and what observation would prove it. Then run the experiment that distinguishes hypotheses.
6. **Implement the smallest correct fix.** Match the existing style and conventions. Do not bundle unrelated cleanup. Preserve unrelated user changes in the worktree.
7. **Add or update regression coverage.** Add a test or assertion that would have caught this failure, when practical. If the failure is environmental, add a guard, precondition, or doc note instead.
8. **Re-validate.** Re-run the originally failing command, the targeted tests, then validation proportional to blast radius (lint, types, broader tests, smoke checks).
9. **Document the outcome.** Record root cause, fix, validation evidence, and residual risk. For non-trivial work, update `delivery/` notes.

## Failure Classification

Before fixing, classify the failure. The classification drives the fix location:

- **Product bug** — code under test is wrong. Fix the code, add a regression test.
- **Test bug** — code is correct, test asserts the wrong thing. Fix the test; do not weaken the assertion to match buggy code.
- **Flaky test** — non-deterministic due to timing, ordering, shared state, network, or randomness. Fix the source of non-determinism; do not retry-loop around it.
- **Environment issue** — wrong tool version, missing dep, OS-specific behavior, permissions, path, or env var. Fix the environment or add an explicit guard/precondition; document it.
- **Dependency issue** — upstream package change or bug. Pin, patch, or work around with a comment linking to the upstream issue.
- **Infrastructure issue** — CI runner, sandbox, network, secrets, or service outage. Surface as a blocker with evidence; do not paper over with retries.
- **Requirement/design assumption** — the failure reveals a contradiction in requirements or design. Stop, raise it, and re-decide before coding further.

## Anti-Patterns

- Removing or weakening an assertion to make a test pass.
- Adding `try`/`catch` to swallow an error so the run completes.
- Marking a test `skip`/`only`/`todo` without an explicit reason and follow-up task.
- Adding sleeps, retries, or `waitFor` loops to hide a race condition instead of fixing it.
- Bumping a timeout to mask a slow path or a deadlock.
- Replacing a real call with a mock to bypass an integration failure.
- Disabling a lint rule, type check, or CI step locally to ship.
- Reverting unrelated user changes in the worktree while debugging.
- Claiming a fix works without re-running the originally failing command.

## Evidence and Reporting

When reporting a fix, include:

- The exact failing command and its original error signature.
- The root cause in one or two sentences, with `file:line` references.
- The minimal change that fixes it.
- The validation that now passes (commands and outcomes).
- Any residual risk, deferred follow-up, or environmental caveat.

If you stop without a fix, report:

- What you tried and what it ruled out.
- The current best hypothesis.
- The specific blocker (access, information, decision) needed to proceed.
