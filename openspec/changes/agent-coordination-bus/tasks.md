# Tasks: agent-coordination-bus

**Gated.** Do not start before `fleet-instance-presence` and `provider-slot-leases` have
landed and run long enough to show whether polling is actually insufficient. Phase 0 is a
decision gate with a real option to stop.

## Phase 0: Decision gate

- [ ] 0.1 Measure the polling ceiling from a real presence deployment
  - Record probe traffic and worst-case staleness at the current fleet size, and project to 20 nodes
  - Validation: written finding — does polling actually hurt, or is this premature?

- [ ] 0.2 Determine whether skein's existing message layer already covers decision fan-out
  - Two half-working coordination systems is the failure this repo is deleting elsewhere
  - Validation: written finding naming which system owns human decisions

- [ ] 0.3 Settle broker security before any publish
  - `192.168.1.131:1883` is plain-text; 8883 and 9001 are closed. Decide: add TLS + credentials, or publish reduced records only
  - Validation: decision recorded; if unresolved, this change stops here

- [ ] 0.4 Weigh the shared-failure trade
  - A broker outage removes coordination fleet-wide; per-instance HTTP fails only per instance
  - Validation: written finding

## Phase 1: Client and taxonomy

- [ ] 1.1 Optional MQTT client, disabled by default, with a dedicated topic prefix
  - Never subscribe outside the prefix — the broker carries unrelated home-automation traffic
  - Validation: test asserts no subscription escapes the prefix

- [ ] 1.2 Closed message taxonomy with unknown-type drop
  - Types: presence, lease, decision-request, decision-answer, artifact-result
  - Validation: unit tests — each type round-trips; unknown type is dropped

- [ ] 1.3 Assert there is no message type accepting free-form prose
  - Validation: schema review recorded; test asserts no unconstrained string content field

## Phase 2: Mirror presence and leases

- [ ] 2.1 Publish presence as retained messages; owning instance stays authoritative
  - Validation: test — retained message disagreeing with the owner loses

- [ ] 2.2 Publish lease announcements without conferring entitlement
  - Validation: test — two simultaneous announcements for one slot grant nothing

- [ ] 2.3 Reduced-record mode on an unprotected connection
  - Validation: test — no directory paths or titles published when unencrypted/unauthenticated

- [ ] 2.4 Broker outage degrades to polling
  - Validation: test — broker killed mid-run; discovery, capacity, and leasing all continue

## Phase 3: Liveness

- [ ] 3.1 Register LWT marking the instance's sessions unreachable
  - Validation: kill -9 an instance; subscribers see unreachable without a polling timeout

- [ ] 3.2 Clean shutdown withdraws retained records instead of publishing death
  - Validation: test distinguishes clean exit from crash

## Phase 4: Human decisions

- [ ] 4.1 Decision-request publication from a blocked agent, naming session and question
  - Validation: `bun typecheck`; unit test

- [ ] 4.2 Answer flow in the TUI, attributable to a client
  - Validation: manual — answering once unblocks three sessions waiting on the same question

- [ ] 4.3 Agents ignore answers to questions they did not ask
  - Validation: test — foreign answer is not acted on

- [ ] 4.4 Unanswered requests block; no defaulting
  - Validation: test — request left unanswered leaves the agent blocked

## Phase 5: Verification

- [ ] 5.1 Soak against the real broker with the fleet running
  - Validation: recorded run showing presence, LWT, and one fan-out decision

- [ ] 5.2 Full typecheck and test
  - Validation: `bun typecheck` zero errors; `bun test packages/opencode --timeout 60000` green
