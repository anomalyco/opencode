# Design: loop-spec-queue

## D1 — The cursor is derived, not stored

Loop state is an in-memory `Ref<Map<LoopID, Record_>>` (`loop.ts:138`) with no
persistence, and driver fibers are forked into the layer scope (`loop.ts:380`). Both die
with the process. A queue run is expected to last hours, so storing the cursor in that
`Ref` would mean a restart loses the run.

Instead the cursor is **recomputed from disk** on every iteration: scan the queue's
changes in order, and the current change is the first one with an unchecked task. The
durable state is `tasks.md`, which the work itself already updates.

Consequences:

- A restart resumes correctly with no persistence work.
- Two queue loops over overlapping changes would fight. Guard: refuse to start a queue
  loop if another queue loop is active in the same directory.
- A human editing `tasks.md` mid-run moves the cursor. This is a feature — it is how you
  redirect a running queue — but it must be reflected in the report.

## D2 — The completion token is a claim, not proof

`loop-completion-contract` makes the token reachable. It must not become authoritative.
A model emitting `<promise>COMPLETE</promise>` is asserting a hypothesis; the queue
verifies it against the checkboxes and the validation commands.

On a false claim the next prompt is the discrepancy, e.g.:

```
You signalled completion, but tasks 3.2 and 4.1 in openspec/changes/<slug>/tasks.md
are unchecked and `bun typecheck` exits 1 with:
<output>
Continue: either complete those tasks or explain why they cannot be completed.
```

This is the single most important guard in the design. Without it, "done" means "the
model said so", which is exactly the failure mode that makes unattended runs untrustworthy.

## D3 — Gates are ratchets, with a bounded retry

Gates advance in one direction per change: `implement → test → verify → commit`. Any
failure returns to `implement` with the failure output attached — it does not retry the
gate in place, because a failing test usually means the implementation is wrong, not that
the test runner was unlucky.

Three consecutive failures of the _same_ gate halt the queue. Rationale: two failures can
be a genuine fix-and-retry cycle; three is a loop. This is deliberately stricter than the
existing `DefaultNoProgressLimit = 3` (`loop.ts:21`) semantics, which only counts
zero-tool-call iterations — a gate can fail repeatedly while the model makes tool calls
every time, so the existing no-progress guard would never fire.

## D4 — Authority is enforced by the permission system, not the prompt

The autonomy ceiling (edit/test/verify/commit; no push, no deploy) is a security boundary,
and a prompt instruction is not a boundary. It is enforced by the existing permission
layer that already produces `evaluated permission=bash pattern=…`.

Deny-list for unattended queue runs:

- `git push`, `git tag`, `gh release`, `gh pr merge`
- the release workflow trigger and any `script/deploy*` / `fleet-deploy*` path
- `npm publish`, `bun publish`

Open review question: the deny-list must not be bypassable by indirection — a subprocess,
a shell alias, a `git` invocation through a wrapper script, or a heredoc written to a file
and then executed. Pattern-matching bash strings is weak against this. The task list
includes an explicit adversarial review of the boundary, and if pattern matching proves
insufficient the fallback is to run queue loops with a git credential-less environment so
a push cannot authenticate even if the command is reached. **Defence in depth: deny-list
plus no credentials.**

## D5 — Commit granularity

One commit per change, on a branch named `loop/<change-slug>`, created off the current
branch when the `commit` gate is first reached. Never commits to the default branch
(`dev`).

The commit message is derived from the change's proposal H1 plus the standard trailer.
The queue does not amend or rebase — if a change needs more work after its commit, the
next commit is additive. Squashing is the human's decision at PR time.

## D6 — Why not just use skein

skein already does phases, gates, and promise tokens, and it stays the right tool for
fleet-wide orchestration across hosts and repos. But it drives opencode from the outside,
which means it cannot see session state: it cannot tell a wedged stream from a slow one,
cannot cancel an in-flight turn, and cannot reuse the session's own permission profile.

The queue driver lives inside opencode precisely so it can use `Loop`, `SessionPrompt`,
and `Permission` directly. The two are complementary: this change makes one repo's change
queue drain reliably; skein decides which repos and hosts to point at.

## D7 — Reporting

The run ends with a report, not just a status enum:

- each change: final gate reached, iterations used, commit sha if any
- the halting change and the verbatim failure output
- what is committed and awaiting push

This is the artifact the user reads after leaving it running. It matters as much as the
mechanism; a queue that halts without explaining which spec was wrong just moves the
debugging cost.

## D8 — Quarantine over halt (relentless mode)

The original design halted the whole queue on any stuck change. That optimizes for
diagnosis at the cost of throughput — and the queue's reason to exist is throughput: a
fleet of local providers that should never idle while planned work remains. One sick
change halting a 40-change backlog inverts the priority.

So a stuck change (same gate failed 3×, stall, `max_reached`, or a deliberate
`<promise>BLOCKED</promise>`) is **quarantined**: `.skein/blocker.md` is written into the
change with the gate/reason, verbatim failure output, and a timestamp, and the queue
advances. Three properties make this safe:

1. **The blocker file is already the exclusion mechanism.** Queue resolution skips
   blocker-bearing changes (D1), so a quarantined change cannot re-enter this run or any
   later run until a human — or `/skein-interpret-stuck` — clears it. Quarantine is
   durable, visible in `git status`, and reversible.
2. **Failure context is not lost, it is relocated.** Everything the halt report would
   have said lands in the blocker file and the run report instead.
3. **A systemic-failure guard bounds the blast radius.** Three consecutive quarantines
   with zero gates passed anywhere in the run halts with a suspected systemic cause. A
   broken test runner must not consume the backlog's eligibility one blocker at a time.

Because the cursor is derived from disk each iteration (D1), the queue is effectively
live: changes added during the run join it, and the run ends only when a fresh resolution
finds nothing eligible. "Done" means the backlog is drained or quarantined-with-cause,
never "the first problem stopped everything".

## D9 — Fan-out is a brief-level nudge, not queue orchestration

`ctx-aware-subagent-placement` already gives the task tool everything needed to put a
subagent on an idle llama-skein peer: capacity probing, slot reservation, context-fit
filtering. What is missing during unattended runs is _awareness_ — the model driving an
iteration has no reason to consider delegation unless told capacity exists.

The brief builder asks `LocalPlacement` whether idle peers exist and, only if so, appends
one paragraph naming the option (delegate implement/test/verify subtasks via the task
tool). No new orchestration, no queue-level parallelism (still serial per D6/Non-Goals),
no claim about which peer — placement decides that at call time, and the reservation
machinery keeps two loops from oversubscribing a single-slot host.
