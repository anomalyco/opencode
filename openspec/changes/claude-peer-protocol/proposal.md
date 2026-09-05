# Native cross-session peer messaging between opencode-skein and Claude Code (gated)

## Status: blocked on `claude-peer-protocol-spike`

This change is intentionally not fully specced. Per the user's explicit direction, the peer
protocol hypothesis must be proven with disposable spikes before production architecture is
committed to it. **Do not add real implementation tasks here until `claude-peer-protocol-spike`
reports its findings and recommendation.**

## Why (provisional — depends on spike outcome)

If the spike confirms opencode-skein can register as a genuine Claude-compatible local peer, this
change implements it for real: a Claude-protocol adapter module (registry publisher/reader, socket
client/server, codec, auth, receipts) sitting behind the `Peer`/`PeerMessage` domain model
`peer-messaging` already ships for opencode-to-opencode — this change adds `"claude-code"` as a
second reachable harness on that same model and tool surface, it does not invent a parallel one.
The existing `send_peer_message` tool (from `peer-messaging`) gains a Claude-Code-reachable target
alongside opencode-skein peers; no new `list_agents`/`send_message` tool pair. Inbound policy
(accept/hold/refuse) ensures a peer message — from either harness — never bypasses normal opencode
permissions.

If the spike reports no-go, this change is re-scoped or closed based on exactly what failed —
not silently replaced with a bespoke bridge protocol, which the user explicitly ruled out as an
acceptable substitute.

## What Changes

Left undefined until the spike lands. The spike's `findings.md` and `design.md` research checklist
are the source for the real task breakdown: registry/socket/codec/auth implementation, PID/process-
identity model (whichever of Option A/B/C the spike chose), inbound policy (accept/hold/refuse),
busy/idle scheduling semantics, `list_agents`/`send_message` tool surface, diagnostics, and the
conformance/security test suite the user's original request specified in detail (unit tests for
registry parsing, frame codec, auth handling, process-start handling, name ambiguity, receipts,
stale peers, message-size limits, malformed frames; a manual conformance suite against real stock
Claude Code; security tests for wrong session ID/token, stale PID, PID reuse, world-writable
directories, symlink attacks, oversized frames, replay, forged attribution).

## Non-Goals

- Everything the original request explicitly excluded: remote/cross-machine federation, cloud
  ChatGPT, MCP messaging, A2A, a generic distributed agent protocol, persistent message history
  service, team/task orchestration, shared memory, file transfer/attachments, broadcast channels,
  a central broker, llama-skein integration, specsync integration.
- Not a mandatory daemon — matches the spike's constraint.
- Not replacing `fleet-instance-presence`/`agent-coordination-bus` for opencode-to-opencode
  presence unless the spike's Slice 4 findings and a follow-up reconciliation decision say so.

## Dependencies

- **Hard dependency: `claude-peer-protocol-spike`.** This change has no real tasks.md until that
  one produces `findings.md` with a go recommendation.
- **Hard dependency: `peer-messaging`.** Provides the `Peer`/`PeerMessage` domain model and
  `send_peer_message` tool this change extends with a Claude-compatible harness adapter. This
  change should not start even after a "go" spike finding until `peer-messaging` has landed.

## Impact

- TBD by spike findings.
