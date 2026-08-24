# `/nudge` — correct a running loop without killing it

## Why

Today, if a run is going the wrong way, the only input that reaches it is a plain message —
and a plain message **cancels the loop** and takes over the session. There is nothing
between "watch it do the wrong thing" and "stop everything".

`/btw` is not that thing and was never meant to be. It answers *you* a question from
context, uses no tools, and deliberately never joins the conversation. It changes nothing,
which is exactly its value.

So the gap is real: no way to say "stop rewriting the TUI" to work that is already running.

## Should `/nudge` and `/btw` just be one verb?

Worth taking seriously — the request to declutter these commands was well founded, and two
verbs that both mean "type something without blowing up the run" looks like exactly the
clutter that made auto mode unlearnable.

They should stay separate, and there is a single test that separates them: **does it leave
a trace?**

| | `/btw` | `/nudge` |
| --- | --- | --- |
| direction | asks *you* a question | tells *the work* something |
| history | must NOT persist — that is the point | must persist, or the next iteration forgets it |
| tools | forbidden | the target keeps working normally |
| effect | none | changes what happens next |

Merging them produces one verb whose most important property — whether what you typed
survives — flips invisibly depending on what is running. That is the hidden mode-switch
that made auto mode confusing, reintroduced in a smaller place.

And the failure is concrete, not theoretical. Under a merged verb, typing *"what was that
file called?"* while a loop runs would inject "what was that file called?" into the run's
standing instructions and the agent would try to act on it.

The thing they genuinely share is already modelled: both are **run control** — input that
must never cancel a running loop, alongside `/loop` and `/auto`. `/nudge` joins
`isRunControlInput`, and that is the whole of the overlap.

Two verbs, one distinction, learnable in a sentence: **`/btw` asks, `/nudge` tells.**

## What Changes

### 1. `/nudge <text>` steers the running loop

The text becomes a correction carried into **every subsequent iteration's** prompt, marked
as coming from the operator and as outranking the earlier standing instruction where they
conflict.

This works for both loop modes. A queue run already rebuilds its brief every iteration; a
prompt loop already rebuilds its continuation prompt. Both are rebuilt from the record, so
appending to the record is delivery — no mid-turn injection, no race, nothing to poll.

The current iteration is not interrupted. `/nudge` reports that the steer **applies from the
next iteration**, because that is what is true.

### 2. It never cancels the run

`/nudge` joins `/loop`, `/auto` and `/btw` in `isRunControlInput`. Typing a correction to
avoid restarting a run must not restart the run.

### 3. With no running loop, it says so

`/nudge` with nothing to steer reports that and delivers nothing. It does not fall back to
sending a normal message — a steer that silently becomes a prompt is worse than one that
fails, because it may cancel the very thing it was trying to preserve.

## Deliberately not in this change

**Steering a specific subagent mid-turn.** That was the original scope, and it is the
harder and rarer case: a subagent is transient, and delivery has to land between steps of a
running turn (see `design.md` for why the obvious approaches silently drop the message).
The loop is the target that is actually worth hitting — it is long-lived, it re-reads its
instructions every iteration, and it is what is going the wrong way when you want to
intervene. Subagent targeting can be added later as `/nudge <n> <text>`, on the roster
`peers` already computes.

## Impact

- One new prompt verb, one loop-service method, one route. No change to `/btw`, the task
  tool, or gate behaviour.
- `--guidance` at start and `/nudge` mid-run become the same channel: one sets the standing
  instruction, the other appends corrections to it.
