# Tasks: claude-peer-protocol-spike

## Slice 0: Ground truth

- [ ] 0.1 Record installed Claude Code version (`claude --version`) and platform (macOS/Linux) —
      every finding below is scoped to this exact version.
  - Validation: recorded in `findings.md`
- [ ] 0.2 Read `PeterSR/claude-code-socket-transport`: README, paths.go, message.go, client.go,
      inbox.go, auth.go, addr.go, platform_*.go, tests. Summarize the protocol (not the code) in
      `findings.md`.
  - Validation: `findings.md` section written
- [ ] 0.3 Read-only inspection of real local Claude session/registry/socket state on this machine
      (candidate paths in `design.md`). Never mutate live files. Record actual observed paths,
      schema, and permissions.
  - Validation: `findings.md` section written, or explicit note that inspection was not possible

## Slice 1: opencode/test process → stock Claude

- [ ] 1.1 Build a disposable script that discovers a live stock Claude Code session's registry
      entry and inbox socket, and sends one NDJSON frame through it.
  - File: isolated scratch location, not `packages/opencode/src/`
  - Validation: the live Claude session visibly receives the message
- [ ] 1.2 Record pass/fail and exact frame shape that worked, in `findings.md`.

## Slice 2: stock Claude → fake opencode peer (load-bearing)

- [ ] 2.1 Build a disposable process that publishes a Claude-compatible registry entry, auth/key
      material if required, and binds a compatible inbox socket, using isolated
      `CLAUDE_CONFIG_DIR`/`XDG_RUNTIME_DIR` — never the user's real Claude config.
  - File: isolated scratch location
  - Validation: unmodified stock Claude Code's `ListAgents` lists the fake peer as reachable
- [ ] 2.2 From Claude, use `SendMessage` targeting the fake peer; confirm the disposable process
      receives and correctly decodes the frame.
  - Validation: message received and decoded
- [ ] 2.3 If 2.1 or 2.2 fails, document precisely why (protocol mismatch, identity verification
      failure, permission rejection, etc.) — do not fall back to inventing a bridge protocol to
      paper over the failure. This is the point where the spike may conclude "no-go."
  - Validation: `findings.md` states pass, or a specific documented failure reason

## Slice 3: round trip

- [ ] 3.1 opencode → Claude → Claude replies via its native `SendMessage` → opencode receives the
      reply on the original sending peer, with no human relay.
  - Validation: reply observed programmatically, not just visually in a terminal

## Slice 4: opencode ↔ opencode over the same mechanism

- [ ] 4.1 Run two disposable Claude-compatible peer processes representing two opencode-skein
      instances; confirm each discovers the other and can send/receive both directions using the
      same mechanism proven in Slices 1-3 — no second registry.
  - Validation: bidirectional message exchange observed between the two disposable peers

## Slice 5: busy-recipient semantics

- [ ] 5.1 Start simulated long-running work in one disposable peer; send it a message mid-turn;
      confirm the active turn is not corrupted and the message is queued/steered per whatever
      priority semantics Slice 0 research found.
  - Validation: no corruption observed; message delivery timing recorded

## Slice 6: findings and recommendation

- [ ] 6.1 Write the final go/no-go recommendation for `claude-peer-protocol`, including the
      PID/process-identity design decision (Option A/B/C from `design.md`) and which security
      requirements were verified vs. assumed.
  - File: `openspec/changes/claude-peer-protocol-spike/findings.md`
  - Validation: findings.md exists and states a clear recommendation
- [ ] 6.2 Delete or explicitly quarantine all disposable spike code — nothing from this change is
      wired into the real plugin/session system.
  - Validation: `git status` shows no spike code left in `packages/opencode/src/`
- [ ] 6.3 Flag `packages/opencode/src/plugin/skein-peers.ts` to the user for disposal now that real
      findings exist (see proposal.md Prior Art).
