# Implementation Plan

## Completed

- [x] Rename the project and process to `opencode-pty`.
- [x] Remove the descriptor-handoff POC implementation.
- [x] Add portable-pty terminal creation and process ownership.
- [x] Add isolated reader, actor/parser, writer, and child-wait threads.
- [x] Add authoritative libghostty parsing and PTY query responses.
- [x] Add bounded raw replay with absolute offsets and explicit truncation.
- [x] Add parsed screen and VT checkpoint snapshots.
- [x] Add create, list, write, resize, snapshot, replay, and terminate operations.
- [x] Add an interactive multi-terminal playground.
- [x] Add multi-terminal, lifecycle, replay, and query-response tests.
- [x] Add persistent daemon startup, election, and atomic private registration.
- [x] Add authenticated framed IPC and the multi-terminal request API.
- [x] Tie daemon lifetime to one owner and preserve terminals across explicit restart handoff.
- [x] Add raw replay-to-live subscriptions and bounded slow-subscriber handling.
- [x] Add exclusive controller and observer roles with explicit takeover.
- [x] Transport authoritative snapshots and VT checkpoints over IPC.
- [x] Add a lazy OpenCode backend proxy with independent per-server runtime identities.

## Next

- [ ] Harden process-tree termination on Unix and Windows.
- [ ] Vendor or harden portable-pty's Windows ConPTY backend.
- [ ] Integrate persistent terminals and ordered groups into OpenTUI.
