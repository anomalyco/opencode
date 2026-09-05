# Let a session see the other agents working in the same repo

## Why

Two sessions, same machine, same checkout, roughly the same minute:

```
Merge five specsync worktrees into main        ses_026b3f8f2ffepfJaU6jGwS0bd
Finishing specsync and merging worktrees       ses_026b5aa54ffezBc3qIAMGgNXNl
```

Same work, two agents, each believing it is the only one. That is two writers on one git
index — the same class of failure `agent-worktree-isolation` exists for — and neither
agent had any way to find out.

The uncomfortable part is that **the data was already there**. Sessions in a directory share
one store: a server started on one port lists sessions created by a server on another port
in the same directory (observed 2026-08-06 while smoke-testing `/auto`).
`fleet-instance-presence` already landed the presence record type and `GET /agents`, which
derives status from `SessionStatus`, the permission layer, and live loops.

So nothing needs to be discovered, transported, or announced for the same-repo case. What
is missing is smaller and duller: **no agent can ask.** Presence is a human-facing HTTP
endpoint; there is no tool, and nothing puts it in front of a model that is about to start
editing files someone else is already editing.

`/auto` makes this sharper rather than milder. A queue run works unattended for hours; if
you open a second session to look at something, neither side knows.

## What Changes

### 1. A `peers` tool

An agent can ask who else is working here. It returns the other sessions active in the same
directory: session id, title, status (`busy`, `awaiting-permission`, `stalled`, `idle`),
agent and model if known, loop id and iteration if one is driving it, and how long since
that session last did anything.

Its own session is excluded, and so are its own subagents — a coder asking "who else is
here" must not be told about the reviewer its own run spawned, or every fan-out looks like a
collision.

Titles are included even though the presence *record* is deliberately metadata-only. The
two sessions above are distinguishable by nothing else, and "is this the same work" is the
entire question the tool exists to answer. Titles are session metadata, not transcript
content; no message text, tool call, or tool output is exposed.

### 2. A queue run tells the model about its neighbours

When other sessions are active in the directory, the queue brief says so — the same shape
as the existing fan-out nudge, and suppressed the same way when there is nothing to say.
It names them and instructs the model to avoid files another session is likely working, and
to prefer asking over assuming.

This is **awareness, not enforcement**. Enforcement — separate working trees per concurrent
run — is `agent-worktree-isolation`'s job and should stay there. Something that silently
refuses to start is worse than something that says "someone else is in here" and lets you
decide.

### 3. Idle sessions are not neighbours

A session you opened yesterday and abandoned is not working on anything. Only sessions that
are actually doing something count: busy, awaiting permission, stalled, or driven by a live
loop. Otherwise the warning fires constantly and stops being read, which is the failure mode
of every collision warning ever built.

## Impact

- New `peers` tool; one new paragraph in the queue brief. No new storage, transport, or
  discovery — this is a projection over data two sessions in a directory already share.
- Cross-machine presence stays `fleet-instance-presence`'s problem. This is the same-repo
  case, which is the one that has actually bitten.
- `canPrompt` / `canBtw` in the presence record are the foundation `steer-running-subagent`
  needs. This change does not use them yet, but it is the same roster.

## Addendum (2026-09-05)

Task 4.2's live check was finally run and found the `peers` tool had never actually been
reachable by a model since it shipped: it was registered in the tool registry's layer/node
graph but never added to the separate `builtin` array that determines what the model actually
sees. Fixed in `packages/opencode/src/tool/registry.ts`; see task 4.2 and `peer-messaging` (which
found and fixed the identical bug for `send_peer_message`). This is a plausible partial
explanation for reports that agents "don't even seem to bother" using peer-awareness features —
the tool to do so was silently unavailable.
