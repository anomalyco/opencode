# Tasks: claude-peer-protocol (gated)

## Slice 0: Unblock

- [ ] 0.1 Read `openspec/changes/claude-peer-protocol-spike/findings.md`. If it does not exist yet,
      stop — this change is not ready to be worked.
- [ ] 0.2 Confirm `peer-messaging` has shipped (its `Peer`/`PeerMessage` model and
      `send_peer_message` tool exist in `packages/opencode/src/`). If not, this change is not
      ready to be worked either — implement `peer-messaging` first.
- [ ] 0.3 If the spike recommendation is "go": replace this tasks.md with a real, dependency-ordered
      task breakdown covering the workstreams listed in proposal.md (Claude protocol compatibility
      adapter extending `peer-messaging`'s domain model, opencode session integration, agent tools,
      diagnostics, conformance tests, security tests), sized and file-scoped like every other
      change in this plan.
- [ ] 0.4 If the spike recommendation is "no-go": do not write implementation tasks. Instead write
      a short closing note in this file summarizing why, and route back to the requester for a
      decision on whether any narrower fallback is worth pursuing outside this change's scope.
