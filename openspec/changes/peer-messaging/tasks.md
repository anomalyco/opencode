# Tasks: peer-messaging

## Slice 1: Domain model

- [x] 1.1 Added `resolveTarget` (id-or-unambiguous-title-prefix resolution over the existing
      `Peer` roster) and `formatPeerMessage` (structured provenance envelope) to
      `session/peers.ts`, rather than a separate `PeerMessage` struct — the roster this reuses
      (`resolvePeers`) is already harness-implicit (`opencode-skein` is the only source today), so
      `claude-peer-protocol` adds a `harness` field to `Peer` when it has a second harness to
      represent, instead of this slice speculatively adding one now with only one value.
  - File: `packages/opencode/src/session/peers.ts`
  - Validation: `bun run typecheck`

## Slice 2: Same-directory delivery

- [x] 2.1 Added `send_peer_message` tool: resolves by exact session id or unambiguous
      case-insensitive title prefix (ambiguous → refused with the candidate list; exact id always
      short-circuits title matching). Targets are drawn from the same `resolvePeers` roster the
      `peers` tool uses, so caller/descendant exclusion is inherited, not reimplemented.
  - File: `packages/opencode/src/tool/send-peer-message.ts`, registered in
    `packages/opencode/src/tool/registry.ts`
  - Validation: `bun test test/session/peers.test.ts` (`resolveTarget` cases: exact id, unambiguous
    prefix, ambiguous refusal, not-found, id-shadows-title-prefix)
- [x] 2.2 Delivery via `TaskPromptOps.prompt` (the same `ctx.extra.promptOps` primitive
      `task.ts` uses for background-subagent result injection — see
      `subagent-notification-reliability` for the parent-wake-up reliability question this
      shares), with `formatPeerMessage`'s structured provenance envelope rather than a bare
      prefix.
  - File: `packages/opencode/src/tool/send-peer-message.ts`
  - Validation: `bun test test/session/peers.test.ts` (`formatPeerMessage` — provenance separate
    from message text)
- [x] 2.3 Scope-adjusted from the original wording: delivery is fire-and-forget (forked, matching
      `task.ts`'s own background-result-injection pattern) rather than awaited, because awaiting
      the full `prompt()` call would block the sender on however long the peer's entire reply
      takes to generate — wrong for a lightweight coordination message. The honest claim available
      without that block is "accepted for delivery" (target existed and was not mid-turn at send
      time), not "confirmed injected". A literally busy (mid-generation) target is refused
      up front rather than risking joining/racing its turn, the same foreign-turn hazard
      `loop.ts` guards against — `awaiting-permission`/`stalled`/`cancelling` are not mid-generation
      and are still valid targets.
  - File: `packages/opencode/src/tool/send-peer-message.ts`
  - Validation: covered by the tool's own not-found/ambiguous/busy/unreachable result branches;
    see `specs/peer-messaging/spec.md` for the corresponding requirement update

## Slice 3: Cross-instance delivery (depends on fleet-instance-presence Phase 4)

- [ ] 3.1 Once `fleet-instance-presence` Phase 4's remote-instance control API exists, resolve a
      cross-instance target's real `baseURL` from presence data and deliver through that
      instance's HTTP API.
  - File: `packages/opencode/src/session/peers.ts`
  - Validation: integration test with two instances on different ports
- [ ] 3.2 Handle target-instance-unreachable and target-session-disappeared distinctly from a
      same-directory failure.
  - Validation: unit test for each failure mode

## Slice 4: Retire prior art

- [x] 4.1 Deleted `packages/opencode/src/plugin/skein-peers.ts` — unregistered, unwired to any
      plugin loader, and fully superseded by Slices 1-2.
  - File: `packages/opencode/src/plugin/skein-peers.ts`
  - Validation: `git status` shows it removed; `grep -rn skein-peers packages/opencode/src` empty

## Slice 5: Verification

- [x] 5.1 `bun run typecheck` (opencode, sdk, tui all clean) and `bun test test/tool/ test/session/`
      — 762 pass (2 pre-existing, unrelated failures confirmed present on a clean checkout before
      this change: a stale snapshot from `subagent-background-default`, fixed opportunistically
      since it was a one-line, safe `--update-snapshots`; and a known-flaky
      `test/session/prompt.test.ts` timing test, left as-is — see prior session notes).
- [ ] 5.2 Live check: two same-directory sessions exchange a message end to end; if Slice 3 has
      landed, two cross-instance sessions do too.
