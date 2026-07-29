# Tasks: fleet-instance-presence

## Phase 1: Advertise the instance

- [ ] 1.1 Extend `local/mdns.ts` to advertise an opencode instance service type
  - Advertise instance id, host, pid, API base URL, version; keep the existing llama-swap
    discovery untouched
  - Validation: two local instances discover each other; `bun test test/local/ --timeout 30000` green

- [ ] 1.2 Add a config switch, defaulting to off on non-trusted networks
  - Mirrors the `experimental.local_subagent_placement` kill-switch pattern
  - Validation: disabled instance is undiscoverable and otherwise unaffected

## Phase 2: Presence records

- [ ] 2.1 Define the presence record type
  - `sessionID`, `directory`, `agent`, `model`, `status`, `loopIteration?`, `lastEventAt`, `heartbeatAt`
  - Validation: `bun typecheck` — zero errors

- [ ] 2.2 Derive status from the existing session state rather than new bookkeeping
  - Source `SessionStatus` plus the runner state; `awaiting-permission` from the permission layer
  - Validation: unit tests map each underlying state to the right presence status

- [ ] 2.3 Expose presence over the instance HTTP API
  - Validation: `bun run test:httpapi` passes

- [ ] 2.4 Suppress content; metadata only
  - Assert no prompt text, tool output, or message content is reachable through presence
  - Validation: test inspects the serialized record for content leakage

## Phase 3: Wedge detection and heartbeat

- [ ] 3.1 Track time since last token/tool/state event per in-flight turn
  - Validation: unit test — a silent in-flight turn crosses the threshold and flips to `stalled`

- [ ] 3.2 Keep publishing while stalled
  - A wedged session must not drop out of presence
  - Validation: test asserts the record persists after the threshold

- [ ] 3.3 Heartbeat, with `unreachable` on lapse and withdrawal on clean exit
  - Validation: killed instance → `unreachable` with last-heartbeat time; clean exit → withdrawn

- [ ] 3.4 Regression test reproducing the 2026-07-25 hang shape
  - Provider reports zero in-flight while the client still has a turn open
  - Assert: session reported `stalled`, provider health does not suppress it
  - Validation: new test passes

## Phase 4: The human view

- [ ] 4.1 `/fleet` lists instances and sessions with status and age
  - Validation: manual — four instances across three directories all listed

- [ ] 4.2 Cancel/pause a session on a remote instance through its API
  - Reuses the cancel path; depends on `session-cancellation-integrity` for cancel to be
    reliable on a wedged session
  - Validation: manual — cancelling a stalled remote session updates its status

- [ ] 4.3 Sort so the things needing attention surface first
  - `stalled` and `awaiting-permission` above `busy` above `idle`
  - Validation: manual — a stalled session appears at the top

## Phase 5: Verification

- [ ] 5.1 Multi-instance soak
  - Run three instances; wedge one deliberately; confirm it is reported stalled and is
    cancellable from another instance
  - Validation: recorded run

- [ ] 5.2 Full typecheck and test
  - Validation: `bun typecheck` zero errors; `bun test packages/opencode --timeout 60000` green
