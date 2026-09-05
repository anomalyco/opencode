# Spike: can opencode-skein become a native Claude Code peer?

## Why

The user wants same-machine, bidirectional discovery and messaging between opencode-skein
sessions and Claude Code sessions — opencode-skein visible to stock Claude Code's own
`ListAgents`/`SendMessage`, and vice versa, with no plugin, no MCP, no bridge, and no daemon
required on Claude's side. That is the hypothesis worth testing: Claude Code already has a local
cross-session peer protocol (registry file + Unix-domain socket + NDJSON wire format); if
opencode-skein can register as a compatible peer on it, discovery and transport are solved for
free in both directions, with one protocol instead of two merged registries.

**This is unproven and must not be assumed.** Claude's local peer protocol is not a documented
public API. Everything about it — file locations, schema, auth/token handling, PID/process-start
identity requirements, wire format, receipts, priority semantics — must be verified against the
actually-installed Claude Code version on this machine before any production code is written
against it. The detailed research checklist the user provided (registry fields, socket security
expectations, auth token derivation, PID/proc-start identity questions, wire protocol frame
shape, attribution envelope format, five specific spikes) is preserved in `design.md` rather than
repeated here.

This repo already has a mature, deliberately-non-daemon approach to same-machine coordination
(`fleet-instance-presence` uses mDNS + per-instance HTTP; `agent-coordination-bus`, an MQTT push
transport, is explicitly gated as speculative until presence proves the polling ceiling). Whatever
this spike finds must be reconciled with that existing direction, not built as a third, disconnected
mechanism — see Non-Goals.

## What Changes

This change produces **findings and disposable spike code, not production architecture.** Per the
user's explicit direction: research first, prove the hypothesis with throwaway spikes, then decide.

### Five spikes (detail in `design.md`)

1. opencode/test process → stock Claude Code, via Claude's native socket.
2. Stock Claude Code `ListAgents`/`SendMessage` → a fake but protocol-compatible opencode peer.
   **This is the load-bearing spike** — if this doesn't work reliably, the entire premise fails
   and the change should stop here with a clearly documented reason, not fall back to a hidden
   bridge protocol.
3. Round trip: opencode → Claude → reply → opencode.
4. opencode ↔ opencode over the same compatibility mechanism — **reframed:** `peer-messaging`
   now delivers opencode-to-opencode messaging independently, over opencode's own HTTP API, not
   gated on this spike. Spike 4's question is therefore narrower than originally scoped: not "is
   opencode↔opencode messaging possible" (already yes, via `peer-messaging`) but "would
   consolidating onto the Claude-compatible mechanism be worth replacing that direct path" — a
   question to answer, not a requirement to satisfy for opencode↔opencode to work at all.
5. Busy-recipient semantics: a message arriving mid-turn must not corrupt the active turn.

### Deliverables

- A written, dated record of the verified protocol (or the specific point it broke down),
  including the exact Claude Code version tested against.
- Disposable spike code in an isolated location (not wired into the real session/plugin system),
  using temporary `CLAUDE_CONFIG_DIR`/`XDG_RUNTIME_DIR`, never touching real Claude sessions.
- A go/no-go recommendation for `claude-peer-protocol` (the gated implementation change), including
  the PID/process-identity design question (one process per addressable session vs. a per-peer
  sidecar process vs. some other mechanism Claude's registry actually tolerates).

## Non-Goals

- No production registry, socket server, or tool surface — that is `claude-peer-protocol`, and it
  does not proceed past a stub until this spike's findings land.
- No remote/federation, no MCP, no A2A, no central broker, no llama-skein or specsync messaging
  integration — all explicitly out of scope per the user's direction.
- Not superseding `fleet-instance-presence`/`agent-coordination-bus` for opencode-to-opencode
  presence — Spike 4 investigates whether the Claude-compatible mechanism could serve that need
  too, but does not commit to replacing the existing mDNS/HTTP approach without a separate
  reconciliation decision after findings land.

## Prior Art Found In This Repo

`packages/opencode/src/plugin/skein-peers.ts` exists (untracked in git, not registered in any
plugin loader) — a rough, non-working sketch of `list_agents`/`send_message` tools (hardcoded
`localhost:4096`, a broken relative-path `fetch` for a local JSON file). Its actual disposal and
the harvesting of anything reusable from it is `peer-messaging`'s job, not this spike's — that
change targets the exact same-machine opencode-to-opencode messaging problem this file sketched,
without depending on Claude compatibility at all. This spike references it only for context.

## Dependencies

- None required to start. Runs independently of every other change in this plan.
- `peer-messaging` is not a dependency of this spike, but the two are closely related: once
  `peer-messaging` ships a harness-agnostic `Peer`/`PeerMessage` model for opencode-to-opencode,
  this spike's findings determine whether `claude-peer-protocol` extends that same model with a
  Claude-Code-reachable harness, rather than building a separate one.
- Gates `claude-peer-protocol` (implementation) — that change does not get real tasks until this
  one reports findings.

## Impact

- No production code paths touched. Spike code lives under an isolated scratch location (e.g.
  `packages/opencode/spike/claude-peer/` or the session's scratchpad — not `packages/opencode/src/`)
  and is deleted or explicitly promoted, never left half-wired.
- Research touches read-only inspection of `~/.claude/` config/session state on this machine —
  read-only, isolated temp dirs for anything destructive, per the user's explicit instruction.
