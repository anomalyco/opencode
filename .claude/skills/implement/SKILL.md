---
name: implement
description: Run a ticket from red to a PR — build the proof, watch it fail, make it pass, add the regression tests, run the gates, open the PR. Stops for exactly three reasons. Use after /worktree.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, Agent, AskUserQuestion, mcp__linear-axiomic__*
---

# implement

Take the ticket from red to an open PR. **Never reviews** — `/review` is invoked by the
owner, separately, after this finishes.

```
build the proof → RED → make it pass → GREEN → regression tests → suite + gates → PR
```

## The three stop reasons

Stop, report, and hand back when any of these happens. They are the only exits other
than a PR.

1. **Can't get red.** The proof passes on unfixed code. The outcome is already met, or
   the proof does not discriminate. Cheap failure — say which, and stop.
2. **Can't get green** after a bounded number of attempts. Report what the proof still
   shows.
3. **Needs a human to press something.** Anything irreversible, credential-minting,
   customer-facing, or costing real money. Do everything up to that point, then hand
   over the button.

**And one thing that is never your call: filing a ticket.** If you find something
worth its own ticket — a second bug, an adjacent hazard — **surface it and wait.** Do
not create a Linear issue, and do not bury it in `DEFERRED.md` to avoid asking;
`DEFERRED.md` is for *not now*, and a real finding routed there is a finding lost. You
run unattended, which is exactly why this one is not yours to decide.

## 1. Load
`.axiomic.toml` for `commands.{format,lint,typecheck,test}`. Detect the ticket. Read
its **Outcome** and **Proof**.

The stack the proof names must be up. If the repo has `/stack`, run it — a fresh
worktree has no `.env`, and in agents-platform every pytest invocation dies at
collection until `/stack up` writes one.

## 2. RED — build the proof and watch it fail

**Before any implementation.** The ticket fixed *what* to observe; write the script that
observes it, run it, and confirm it shows the bad state.

This is the most valuable step in the workflow and the one most easily skipped. It buys
three things at once:

- **The outcome is real.** You have reproduced it, not inferred it.
- **The proof discriminates.** A proof that never went red proves nothing when it later
  goes green.
- **The ticket wasn't stale.** A proof written from ticket text that cites deleted code
  fails here, for a few minutes, instead of in review round three.

Red also *is* the design gate. There is no separate plan review: a plan is prose about
code that does not exist, and prose cannot be falsified. A failing observation can.

Commit the proof. It is a first-class artifact — it will run again at green, and a
third time against staging after deploy. **Never leave it in a scratch directory.**
AXI-142's soak driver was written last, run never, and ended up in a temp folder; the
criterion the whole ticket rested on was never demonstrated.

## 3. GREEN — make it pass

Now design the change, constrained by a real signal. Keep it minimal: the smallest
thing that turns the proof green. TDD inside here freely — that is the technique, not
the gate.

Resolve decisions from first principles (see `CLAUDE.md`), record the load-bearing ones
in the PR body. Run the proof. Green is **done**.

## 4. Regression tests

*Now* write the tests that stop this regressing — the proof reduced to something
repeatable where it can be, plus whatever else pins the behaviour. Update `STORIES.md`;
security stories get **negative** tests.

Tests are the source of truth for **regression**, not for success. Success was decided
in §3 by the proof. That ordering is the whole point: a test written by the same agent,
from the same understanding, at the same time as the code cannot falsify that agent's
model of the problem — if the model is wrong, the test is wrong in the same direction
and green proves only self-consistency.

**A test whose stack is missing must fail, never skip.** A suite that silently skips
lets green mean "ran, or didn't". That is how 5342 passing tests coexisted with an
unexercised criterion.

## 5. Suite + gates

```
<commands.format>   <commands.lint>   <commands.typecheck>   <commands.test>
```

Full suite, no regressions. These gates are where **principles adherence** is decided —
types, docstrings, coverage, import hygiene, no `TODO` in code (use `DEFERRED.md`), no
stray markdown, no credentials read or committed. If a gate can decide it, the gate
decides it, and `/review` never re-litigates it.

## 6. PR

Run `/pr`. The body carries the proof's **red and green output** as its evidence —
that, not a description, is what says the work is done. Also record the first-principles
decisions worth checking.

## 7. Output

Report: ticket, PR URL, what went red→green, anything sent to `DEFERRED.md`, and any
part of the proof you could **not** run and why. Never claim a command passed without
having watched it pass.

Next step is the owner's: `/review <PR#>`, then `/merge`.

---

$ARGUMENTS
