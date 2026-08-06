# Bind personas to the queue's gates so `/auto` is a team, not a soloist

## Why

`/auto` already runs a gate sequence per change — `implement → test → verify → commit` —
and the brief already ends with a vague nudge: *"where this change's tasks allow parallel
work, use the task tool to delegate subtasks"*. In practice one model does everything,
because that sentence names no agent, gives no trigger, and costs nothing to ignore.

Meanwhile the gate names are already the role names. `implement` is a coder. `test` is a
tester. `verify` is a reviewer. The mapping is not a design decision anyone has to make;
it is sitting there.

Two different things are missing, and conflating them is why the nudge does nothing:

1. **Opportunistic parallelism** — when the fleet is idle and a change's tasks are
   genuinely independent, spread them. This is a judgement call, so it belongs in the
   brief. It just has to name the persona instead of gesturing at "the task tool".

2. **A second opinion before the work is called done.** This is *not* a judgement call and
   must not be left to the model that wrote the code. An agent grading its own homework
   at the `verify` gate is the single weakest point in an unattended run: it is the last
   step before `commit`, and it is the one place where a wrong "yes" is expensive.

The `verify` gate today is a shell command. A passing command proves the tests ran, not
that the change is any good. Skein had the better instinct here — a reviewer persona that
reads the work and emits `LGTM` or `NEEDS_WORK` — and it is the piece worth taking.

## What Changes

### 1. The brief names the persona for the current gate

Where the brief nudges fan-out, it now names the agent for the gate it is at: at
`implement`, delegate implementation slices to `coder`; at `test`, delegate to `tester`.
The nudge stays conditional on idle fleet capacity — delegating onto a busy fleet is
slower than not delegating — and it now also stays conditional on the persona existing in
the registry, so a repo without these agents gets no instruction it cannot follow.

### 2. A review gate that a subagent decides, not a shell command

A new gate kind: **agent gates**. An agent gate is satisfied when a named subagent returns
a pass verdict, and failed when it returns a fail verdict — the same pass/fail contract
the existing command gates already have, so the strike counting, the repair turn, and the
quarantine path are unchanged.

`verify` becomes an agent gate bound to `reviewer` by default. The reviewer is given the
change, its `tasks.md`, and the diff, and is denied `write`/`edit` by its own persona, so
it cannot fix what it is complaining about. Its `NEEDS_WORK` text becomes the failure
detail on the next iteration's brief, which is exactly the channel a failing command gate
already uses to drive a repair turn.

Because the reviewer runs through `task`, it gets its own session, its own derived
permission, and `LocalPlacement` onto an idle fleet node — and its parts render inline in
the session the user is watching.

### 3. Configuration, with an off switch

```jsonc
{
  "experimental": {
    "queue_personas": {
      "implement": "coder",
      "test": "tester",
      "verify": "reviewer"
    }
  }
}
```

Defaults apply when the named agents exist. Mapping a gate to `false` or omitting the key
returns that gate to its current behaviour. A gate mapped to an agent that does not exist
is a configuration error reported at run start, not a silent no-op — a review gate that
quietly stops reviewing is worse than one that refuses to start.

## Impact

- `verify` becomes a review, not a re-run of the tests. Runs get slower and better.
- Depends on `repo-agent-personas` for the agents to exist.
- Composes with `role-model-chains`: a reviewer can be pinned to a different model than
  the coder, which is most of the value of a second opinion.
