# Let an agent send a message to another live opencode-skein session

## Why

`session-peer-awareness` shipped discovery (`peers` — who else is working here) but deliberately
did not ship messaging: "Enforcement... should stay [elsewhere]. Awareness, not enforcement." That
was the right scope for that change. But nothing has since filled the messaging half, and the gap
is not hypothetical — it's the single piece of `claude-peer-protocol`'s eventual scope that has no
dependency on the unproven Claude-compatibility hypothesis at all. Two opencode-skein sessions on
one machine sending each other a short message is a same-app problem: both speak the same HTTP
API already.

There is prior art, and it is informative about the gap rather than a solution: an untracked,
unregistered file, `packages/opencode/src/plugin/skein-peers.ts`, sketches exactly this — a
`list_agents`/`send_message` tool pair. It should not be built on directly (see What's wrong with
it, below), but it correctly identifies that `send_message` is the missing half, and its
prompt-injection approach (POST to the target's `/session/{id}/prompt_async` with a provenance
prefix) is the right shape for the same-instance case.

### What's wrong with the prior art

- `list_agents` duplicates `peers` under a different tool name instead of extending it — exactly
  the "parallel concept instead of extending an existing tool" anti-pattern the original request
  warned against by name.
- Its registry read (`fetch(`${ctx.worktree}/../.skein/peers.json`)`) is not a valid `fetch` call —
  no scheme, so it fails outright — and it invents a `.skein/peers.json` file nothing writes.
- `send_message`'s target discovery hardcodes `http://localhost:4096`, assuming exactly one
  opencode instance on a fixed port. Real deployments run multiple instances on different ports
  across different directories (`fleet-instance-presence`'s whole reason for existing).
- No exclusion of the caller's own session/descendants (the bug class `session-peer-awareness`
  1.2 specifically fixed for `peers`).
- No delivery semantics: no distinction between "the HTTP POST returned 200" and "the message was
  actually injected and will be seen," no handling of a target that disappears mid-send, no
  provenance beyond a bare text prefix.

## What Changes

### 1. Extend `peers`, don't parallel it

The existing `peers` tool gains a sibling `send_peer_message` tool (or an optional parameter on
`peers` itself — implementation detail to resolve in tasks, but the model stays one thing: a
`PeerRef`/`PeerMessage` pair, not a second roster). No new `list_agents` tool. Resolve a target by
session id or an unambiguous prefix of its title; an ambiguous match is refused, never guessed.

### 2. Two delivery paths, one tool surface

- **Same-directory (same store):** the target is already visible via `session/peers.ts`'s
  `resolvePeers` — no HTTP hop needed; inject directly through the local session/prompt API,
  exactly like `session.synthetic`/`session.prompt` already do internally.
- **Cross-instance (different directory/port), once `fleet-instance-presence` Phase 4's
  remote-instance control API exists:** resolve the target instance's real `baseURL` from presence
  data (never a hardcoded port) and deliver through that instance's own HTTP API, the same pattern
  Phase 4 already establishes for cancel/pause.

A caller does not need to know which path applies — the tool resolves it from where the target
actually is.

### 3. Explicit provenance, explicit delivery status

An injected message carries structured provenance (sending session id/title, not just a text
prefix) so the receiving agent can distinguish it from a human prompt, matching the same
"metadata not content, provenance always explicit" posture `session-peer-awareness` and
`fleet-instance-presence` already hold. Delivery is fire-and-forget (same pattern as the
background-subagent result injection in `task.ts` — awaiting a full reply would block the sender
on the peer's whole turn), so the tool result reports "accepted for delivery" honestly rather than
claiming a stronger guarantee it cannot back up; a mid-turn target is refused outright rather than
risked, and a disappeared target is reported as unreachable rather than accepted.

### 4. Retire the prior art

Once this ships, `packages/opencode/src/plugin/skein-peers.ts` is superseded. Delete it as part of
this change rather than leaving it as an unregistered, confusing duplicate.

## Non-Goals

- Not the Claude-compatible cross-session protocol — that's `claude-peer-protocol`, which is
  expected to extend this same `Peer`/`PeerMessage` model with a Claude-Code-reachable harness
  adapter once its spike proves the mechanism, not reinvent a tool surface.
- Not solving the roster-accuracy problem for cross-instance targets — that's
  `fleet-instance-presence` Phase 6; this change consumes that data, it doesn't fix it.
- No broadcast, no channels, no persistent message history — a single short message to a single
  named peer, same restraint the original request asked for.

## Dependencies

- Same-directory delivery: none beyond what `session-peer-awareness` already shipped.
- Cross-instance delivery: depends on `fleet-instance-presence` Phase 4 (remote-instance control
  API) for the target-instance HTTP pattern. Can ship same-directory-only first and add
  cross-instance delivery once Phase 4 lands, rather than blocking entirely.
- `claude-peer-protocol` depends on this change's `Peer`/`PeerMessage` model existing first, so it
  has something to extend rather than something to duplicate.

## Impact

- New: `send_peer_message` tool (or `peers` extension) in `packages/opencode/src/tool/`, sharing
  `packages/opencode/src/session/peers.ts`'s data model.
- Deleted: `packages/opencode/src/plugin/skein-peers.ts`.
- Modified: `packages/opencode/src/session/peers.ts` (delivery, not just resolution), instance HTTP
  API surface for the cross-instance path (co-designed with `fleet-instance-presence` Phase 4).
