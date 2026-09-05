# Design notes: Claude Code peer-protocol research

Everything below is a **research checklist**, not a set of confirmed facts. Every field, path, and
behavior named here is a hypothesis to verify against the actually-installed Claude Code version
(`claude --version`) on this machine, and against the reverse-engineered reference implementation.
Do not hard-code any of it into production code before it is verified. Where verification is
impossible (undocumented, changed, or ambiguous), say so explicitly rather than guessing.

## Prior art to study first

- `github.com/PeterSR/claude-code-socket-transport` — reverse-engineered Claude local cross-session
  inbox protocol. Read `README`, `paths.go`, `message.go`, `client.go`, `inbox.go`, `auth.go`,
  `addr.go`, `platform_*.go`, and its tests. Understand the protocol; do not copy code verbatim.
- `github.com/anthropics/claude-code` — the real client. Cross-check behavior against it.
- `Jesse-njx/dsh-crosstalk` — a different, file-inbox/heartbeat-based cross-session tool. Useful for
  identity, stale-peer handling, provenance, and busy/idle delivery ideas, but its transport is
  deliberately not what this spike is testing (Claude-native compatibility, not a parallel inbox).
- This machine's live Claude Code install and (read-only, non-destructive) observation of real
  session state under locations that may include `~/.claude/sessions/`, `$XDG_RUNTIME_DIR/cc-socks/`,
  `$CLAUDE_CODE_TMPDIR/cc-socks/` — exact paths TBD by research, never mutate live files.

## What to verify about Claude's current cross-session model

**Session registry** — exact location (candidate: `$CLAUDE_CONFIG_DIR/sessions/<pid>.json`, falling
back to `~/.claude/sessions/<pid>.json`), exact schema, required vs. optional fields, which fields
`ListAgents` actually reads, how reachability/state/display-name are determined, how renames
propagate, how staleness is handled, how `cwd` is represented, how peer-protocol version is
advertised, whether PID ownership and process-start time are verified, and whether the registry
PID must match the process actually accepting the socket connection.

**Inbox socket** — path shape (candidate: `<runtime>/cc-socks/<pid>.sock`), directory/socket
ownership and mode (candidate: dir `0700`, socket `0600` — verify, never weaken to ease
compatibility), macOS vs. Linux differences, path-length behavior, `uds:` address encoding,
fallback paths.

**Wire protocol** — newline-delimited JSON, one frame per line; candidate message shape includes
`msgV`, `msg_id`, `type`, `message.role`/`message.content`, `priority`, `from`, `session_id`,
plus control/receipt/rename/auth frame types. Verify against the real transport and real Claude
behavior, not this list. Implement a strict codec that rejects malformed/oversized/unsupported
frames.

**Auth/peer tokens** — candidate key file shape `<claude-config>/sessions/<pid>.<socket-hash>.key`
containing something like `{"peerToken": "...", "procStart": "..."}`. Verify filename rule, hash
input, token format, when auth is required, what a sender does with a target's token, how Claude
classifies authenticated vs. unauthenticated senders, whether our peer must publish this file to
behave natively, and whether Claude's sender expects target PID/proc-start to match a real process.
Implement real validation — never disable it to pass a test.

**Process identity** — Claude's model appears tied to PID + kernel process-start identity. Map the
real opencode-skein relationship: one process may host multiple sessions; do not assume 1:1 or
assume the opposite. If Claude verifies PID/proc-start against a real process, do not invent fake
identity — evaluate: (A) each opencode-skein session already has its own process, use it directly;
(B) a small per-peer sidecar process that legitimately owns a PID/socket per session; (C) some
other mechanism Claude's registry actually tolerates. Choose the simplest option that preserves
correct identity and security, and state explicitly which one was chosen and why.

**Session identity** — do not use PID as opencode-skein's permanent identity. Claude's own PID can
outlive a logical session (e.g. across `/clear`) or vice versa. Map: opencode session ID →
Claude-compatible runtime registration (PID, procStart, socket, compatible session ID, compatible
display name) — a translation layer, not a replacement of opencode's canonical session ID.

**Return address / replies** — verify exactly how a Claude receiver gets enough information to
reply to an opencode sender (`from`, `from-name`, registry identity, message IDs, receipts). A
one-way send that cannot be replied to fails the actual goal (bidirectional conversation).

**Receipts / delivery status** — verify Claude's receipt concepts (candidates: `held`, `denied`,
`expired`, `delivered`). opencode-skein must distinguish at minimum: socket-accepted, queued
locally, injected into target session, rejected, unreachable — and must never claim "delivered"
when it only knows `write()` succeeded.

**Priority** — candidates `now`/`next`/`later`. Verify wire representation. Priority affects
scheduling only, never authorization — a `now` message must not bypass permissions.

**Attribution envelope** — Claude reportedly expects a tagged `<cross-session-message ...>...
</cross-session-message>`-shaped envelope for correct sender attribution, with careful escaping.
If confirmed, reproduce it exactly at the compatibility boundary only; normalize into an internal
peer message immediately after decoding so Claude's wire format never leaks into the rest of
opencode-skein. Message content must never be able to forge sender identity or envelope
boundaries.

## Security requirements (non-negotiable, verify Claude's actual expectations and match them)

Same-OS-user scope by default. Defend against: other local users, forged registry files, socket
replacement/symlink attacks, stale PID reuse, world-writable runtime directories, forged auth/key
files, message replay, malformed JSON, oversized frames, message flooding, duplicate message IDs.
If the expected runtime directory has insecure ownership/mode, fail closed with a clear diagnostic
— never silently weaken permissions to make the compatibility easier to hit.

## Inbound policy (design question to answer, not just implement)

A peer message is agent context/request, never a permission grant — normal opencode tool
permissions stay authoritative regardless of what a Claude peer's message says. Design at minimum
accept/hold/refuse semantics, analogous to Claude's own inbound policy concept.

## OpenCode-side integration questions to research against the current plugin/session API

Not the old API — inspect what this repo's current `packages/opencode` plugin/session layer
actually exposes: session listing/lookup/hierarchy/status, `session.synthetic(...)`,
`session.prompt(...)`, session lifecycle events (`session.created/updated/idle/status/deleted`).
Specifically determine whether `session.synthetic(...)` can wake/resume an idle session, can be
queued for a busy one, and retains explicit provenance (peer name, harness, message id) — this is
the same wake-up primitive `subagent-notification-reliability` is independently investigating for
background subagents; if that investigation finds the injection path fundamentally unreliable, this
spike inherits that problem for inbound Claude messages too and should say so.

## Definition of done for this spike (see proposal.md and tasks.md)

A written, dated finding per spike (1-5), a go/no-go recommendation, and — if go — enough of a
verified protocol description that `claude-peer-protocol` can be planned as real, scoped tasks
instead of another research change.
