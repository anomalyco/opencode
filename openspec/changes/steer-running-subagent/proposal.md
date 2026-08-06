# Steer a running subagent from the prompt

## Why

Once `/auto` fans out, a subagent is a sealed box. You can watch it, or you can kill the
whole run. If you can see it heading somewhere wrong — reading the wrong file, about to
rewrite something it should not touch — there is nothing between "say nothing" and
"cancel everything".

Pi is the only one of the harnesses surveyed that solves this: `pi-subagents-comtac`
carries `contact_supervisor` escalations up from running children and lets `resume` steer
a still-running async child. Hermes and skein both lack it. It is the idea worth stealing.

The important part: **opencode already has the primitive.** The `task` tool takes a
`task_id`, and passing one for a live background job routes through `background.extend`,
which chains further work onto that job's session — the tool literally reports
*"Additional context sent to the running background task."* Injecting into a live session
is a demonstrated capability, not a hypothesis; it has been observed happening
accidentally, from outside, to a session a human was sitting in.

So this is not new machinery. It is a user-facing path to machinery that exists and is
currently reachable only by the model, for children the model happens to have launched in
background mode.

`/btw` is deliberately not that path and is not changing. `/btw` asks *you* a question
from context, runs no tools, and never joins the conversation. Steering does the opposite:
it puts a message into someone else's conversation and expects them to act on it. Same
keyboard, opposite intent — they must stay separate verbs.

## What Changes

### 1. `/nudge` — list live children, then talk to one

`/nudge` with no arguments lists the subagent sessions currently live under the session
you are in: index, agent name, and what it was asked to do.

`/nudge <text>` steers the only live child when there is exactly one.

`/nudge <n|agent> <text>` steers a named or indexed child.

With no live children, it says so and does nothing. It never falls back to messaging the
main agent, because a steer that silently lands somewhere else is worse than one that
fails.

### 2. Steering is delivery, not interruption

The message is appended to the target child's session as user input. If that child is
mid-turn, the message is delivered when the turn completes — the same `extend` semantics
the `task` tool already uses, and the same thing Pi's `resume` does. The steer is
acknowledged as *delivered*, not as *acted on*, because those are different and only one
of them is true at the moment of the call.

### 3. `/nudge` never cancels the run

Like `/loop`, `/auto` and `/btw`, `/nudge` is run control: typing it while a loop is
driving the session must not stop the loop. Steering a subagent so the run *doesn't* have
to be restarted is the entire point.

## Impact

- One new prompt verb and one server route. No change to `task`, `/btw`, or the loop.
- Only children of the current session are addressable. Steering an arbitrary session by
  id is deliberately out of scope — it is the accidental behaviour that proved this
  possible, and it is not a feature.
