# Tasks: fleet-instance-presence

## Phase 1: Integrate existing instance discovery

- [x] 1.1 Confirm the existing `server/mdns.ts` HTTP advertisement is the opencode
      instance-discovery mechanism; do not add a second Agent-specific advertiser or
      transport. #discovery
  - Evidence: `packages/opencode/src/server/mdns.ts` publishes the running server
    over mDNS and `server/server.ts` owns its lifecycle.
- [ ] 1.2 Add an Agents discovery adapter that consumes the existing opencode mDNS
      HTTP announcements and queries each instance's metadata-only `/agents` endpoint.
      Keep the existing llama-swap provider discovery untouched.
  - Validation: two local instances are returned as Agent sources and stale
    instances are handled without affecting provider discovery.

- [ ] 1.3 Add a config switch for Agents discovery, defaulting to off on
      non-trusted networks
  - Mirrors the `experimental.local_subagent_placement` kill-switch pattern
  - Validation: disabled instance is undiscoverable and otherwise unaffected

## Phase 2: Presence records

- [x] 2.1 Define the presence record type
  - `owner`, `instanceID`, `sessionID`, `loopID?`, `directory`, `agent`, `provider`, `model`, `status`, `loopIteration?`, `lastEventAt`, `heartbeatAt`, and explicit `canPrompt`, `canBtw`, `canAbort` capabilities
  - Metadata only: no prompt, tool call, or tool output fields
  - Validation: `bun typecheck` — zero errors

- [x] 2.2 Derive status from the existing session state rather than new bookkeeping
  - Source `SessionStatus` plus the Agent execution state; `awaiting-permission` from the permission layer
  - Validation: unit tests map each underlying state to the right presence status

- [x] 2.3 Expose presence over the instance HTTP API
  - Validation: `bun run script/httpapi-exercise.ts --mode coverage --include agents.list`
    exercises `GET /agents` successfully. The full harness remains non-green because
    14 unrelated pre-existing routes lack scenarios.

- [x] 2.4 Suppress content; metadata only
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

## Phase 4: The Agents view

- [ ] 4.1 `/agents` lists instances and sessions with status and age
  - Validation: manual — four instances across three directories all listed

- [ ] 4.2 Cancel/pause a session on a remote instance through its API
  - Reuses the cancel path; depends on `session-cancellation-integrity` for cancel to be
    reliable on a wedged session
  - Validation: manual — cancelling a stalled remote session updates its status
- [ ] 4.4 Preserve the control boundary used by Skein
  - A normal prompt is interrupting; `/btw` is side-channel input that does not
    enter the main history or stop a loop; pause/resume/cancel remain owner APIs
  - Validation: integration test covers a loop receiving `/btw` and continuing,
    then a normal prompt aborting the loop

- [ ] 4.3 Sort so the things needing attention surface first
  - `stalled` and `awaiting-permission` above `busy` above `idle`
  - Validation: manual — a stalled session appears at the top

## Phase 4A: Supervisor integration

- [ ] 4.5 Include project, repository/worktree, Role, task/feature metadata,
      availability, and control capabilities in the Agent roster without exposing
      transcript content
- [ ] 4.6 Add a Supervisor-facing read path for the roster and progress events;
      the Supervisor receives summaries/events while the owning Agent retains the
      full session transcript
- [ ] 4.7 Define delegation handoff semantics: reuse an eligible existing Agent
      when possible, otherwise request a new Agent through Skein; reject stale,
      unavailable, ambiguous, or duplicate assignments

## Phase 5: Verification

- [ ] 5.1 Multi-instance soak
  - Run three instances; wedge one deliberately; confirm it is reported stalled and is
    cancellable from another instance
  - Validation: recorded run

- [ ] 5.2 Full typecheck and test
  - Validation: `bun typecheck` zero errors; `bun test packages/opencode --timeout 60000` green
