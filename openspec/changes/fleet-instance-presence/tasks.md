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

## Phase 6: Backlog fan-out roster accuracy (added 2026-09-05)

Reported symptom: `/backlog`'s fan-out nudge (`loop-spec-queue` §6) and local placement
(`ctx-aware-subagent-placement`, `role-placement-policy`) suggest "free" agents that are
frequently wrong — the caller's own current session, or a peer that is actually busy/unreachable.
`session-peer-awareness` already excludes the caller and its descendant lineage (1.2, shipped),
so a same-session false positive after Phase 6 lands would be a regression worth its own test, not
expected behavior. The more likely cause is upstream of exclusion logic entirely: Phases 3 and 4
above — the parts of *this* change that give a roster entry actual liveness — were never built,
so anything consuming presence today (the fan-out nudge included) is reading a roster with no
wedge/heartbeat/staleness signal at all. An entry that looks busy-and-fine may be a session that
died 20 minutes ago.

- [ ] 6.1 Once Phase 3 lands, verify the fan-out nudge in `packages/opencode/src/loop/loop.ts`
      (queue-mode brief construction) filters candidates through the same liveness/heartbeat
      status this change defines, not just raw presence existence.
  - File: `packages/opencode/src/loop/loop.ts`
  - Validation: unit test — a `stalled`/`unreachable` peer is never named in the fan-out nudge
- [ ] 6.2 Perform the three outstanding "live check against a real fleet" verifications that were
      left unchecked elsewhere, now that Phase 3/4 give them something real to check against:
      `session-peer-awareness` task 4.2, `role-placement-policy` task 4.2,
      `subagent-background-default` task 6. Record the outcome in each change's tasks.md rather
      than only here.
  - Validation: each of the three referenced tasks is checked with a one-line evidence note, or
    reopened as a bug if the live check fails
- [ ] 6.3 If 6.2 surfaces a real delegation-notification bug (parent idles after backgrounding a
      subagent instead of being woken by the injected result), do not fix it here — file it under
      `subagent-notification-reliability`, which exists specifically to investigate that failure
      mode and depends on this phase's roster accuracy to rule out "stale roster" as the cause.
  - Validation: n/a — coordination task
