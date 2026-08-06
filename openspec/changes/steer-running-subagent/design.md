# Design: where a steer is actually delivered

## The mistake this records

The first version of this proposal said the steer would be "delivered when the turn
completes", reusing the `background.extend` path that `task` already uses for `task_id`.
That reads as reasonable and is wrong twice over.

**Wrong for one-shot subagents.** For a subagent spawned to do one thing, the end of the
turn *is* the end of the subagent. The parent has already taken its result and moved on. A
steer delivered then opens a fresh turn nobody is waiting on and nobody reads. The whole
point of steering is to reach the agent while it can still change what it does.

**Wrong mechanically.** The obvious client-side shortcut — just call `session.prompt` on
the child — silently loses the message. `Runner.ensureRunning`
([runner.ts:126](packages/opencode/src/effect/runner.ts:126)) returns `awaitDone(st.run.done)`
when the state is `Running`: it *joins* the in-flight run and discards the work you
submitted. No error, no delivery. This is exactly the shape of bug that looks like it works
in a demo and never works when it matters.

`background.extend` is a real mechanism, but it chains work onto a job's session *after*
the current run, so it inherits the first problem.

## What delivery has to be instead

A steer has to land **between steps of the running turn**.

`prompt.ts` runs a `while (true)` step loop: set status busy, rebuild the message list from
the session, call the model, execute tools, repeat. That rebuild is the seam. A steer
persisted as an ordinary user message on the child's session before the next rebuild is
picked up by `MessageV2.filterCompactedEffect` like any other message, and the agent sees
it on its next model call — mid-turn, without interrupting the step in flight and without
inventing a second message channel.

This is the same thing Pi's `pi-subagents-comtac` provides with `contact_supervisor` and
`resume`, built on the message history rather than a side channel.

## Shape

- A per-instance store of pending steers, keyed by session.
- A drain at the top of the step loop in `prompt.ts`: if this session has pending steers,
  persist each as a `SessionV1.User` message with a text part before the message list is
  rebuilt. Same construction as the subtask summary message already written at
  [prompt.ts:436](packages/opencode/src/session/prompt.ts:436).
- The steer therefore appears in the transcript, which is correct — the user said it, and a
  later reader needs to see why the agent changed course.

## Why the drain is at the top of the loop and not at the write

Writing the message directly from the route would race the rebuild: a message persisted
while the list is being assembled may or may not make the current step, non-deterministically.
Draining at a single known point in the loop makes delivery either "this step" or "next
step", never "sometimes lost".

## Scope note

Only live children of the current session are addressable. Steering an arbitrary session by
id is deliberately excluded — that is the accidental behaviour that demonstrated injection
is possible in the first place, and it is not a feature.
