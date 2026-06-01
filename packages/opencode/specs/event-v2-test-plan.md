# EventV2 Phase Test Plan

This plan is the phase-by-phase validation companion for
[`event-v2-migration.md`](./event-v2-migration.md). Keep tests close to the
code they exercise, prefer focused fixtures over broad integration setup, and
update this file when a phase changes scope.

## Common Commit Gate

Before each phase commit, run the phase-specific tests plus the package
typecheck:

```bash
bun --cwd packages/opencode test <phase-specific-test-file>
bun --cwd packages/opencode typecheck
```

Run additional compatibility or snapshot commands when the phase touches
generated SDK/OpenAPI output, CLI/TUI rendering, sync history, or durable
storage.

## Recommended Test Locations

| Area | Suggested locations |
| --- | --- |
| EventV2 service, encoding, replay, projectors | `packages/core/test/event-v2/` or existing core-adjacent test directories |
| Session identity, mailbox, prompt delivery, background agents | `packages/core/test/session/`, `packages/opencode/test/session/` |
| HTTP/SSE, sync, SDK/OpenAPI compatibility | `packages/opencode/test/server/`, `packages/opencode/test/openapi/`, SDK snapshot tests |
| CLI/TUI output compatibility | `packages/opencode/test/cli/`, `packages/opencode/test/tui/` |

Use the repo's existing test layout where a more specific convention already
exists. The paths above are intended as placement guidance, not a migration
requirement for unrelated tests.

## Phase 0 — EventV2 Contract Baseline

Likely files to add or extend:

- `packages/core/test/event.test.ts` or `packages/core/test/event-v2/contract.test.ts`
- `packages/opencode/test/server/httpapi-event.test.ts`
- `packages/opencode/test/server/session-messages.test.ts` if sync-history shape is exposed there

Required unit tests:

- encode/decode EventV2 data at persistence and fanout boundaries, including `DateTime`, branded IDs, and nested domain objects
- assert `EventTable` payloads are JSON-compatible values, not live domain objects
- assert stored and emitted timestamps use the numeric wire/storage contract
- decode replayed rows before listeners and projectors observe them

Required integration tests:

- publish through `EventV2Bridge` and verify encoded `GlobalBus` payload shape
- stream the same event through the HTTP/SSE route and verify the SSE event shape
- verify sync-history output uses the same encoded payload and timestamp contract

Regression, failure-injection, and concurrency cases:

- malformed persisted EventTable rows fail or skip predictably without poisoning later replay
- legacy experimental rows with ISO timestamps still replay or migrate through the compatibility path
- fanout encode failure for one listener/SSE event does not fail the durable publish path
- concurrent publish/replay preserves sequence ordering for the same aggregate

Smoke/manual checks:

- if the phase changes SSE or sync output, manually inspect one streamed event from a local server or recorded fixture before merging

Commit gate examples:

```bash
bun --cwd packages/core test test/event.test.ts
bun --cwd packages/opencode test test/server/httpapi-event.test.ts
bun --cwd packages/opencode typecheck
```

## Phase 1 — `evt_*` Transcript Identity

Likely files to add or extend:

- `packages/core/test/session/event-identity.test.ts`
- `packages/core/test/session/projector.test.ts`
- `packages/opencode/test/v2/session-message-updater.test.ts`
- compatibility-adapter tests near the current session/message API tests

Required unit tests:

- user-message events create canonical user message IDs from the publishing `evt_*` ID or explicit stable event-carried entity ID
- assistant message, durable part, shell, compaction, and final tool-result events produce stable event-derived IDs
- parent, message, part, and tool-result references remain stable after encode/decode and replay
- legacy `msg_*` and `prt_*` IDs are emitted only by adapters and never stored in canonical v2 transcript state

Required integration tests:

- run a minimal prompt transcript through the session processor and compare canonical EventV2 identity with the rebuilt transcript
- replay the same event history into a fresh state and assert identical IDs and references
- verify legacy API consumers can still receive adapter IDs without changing canonical state

Regression, failure-injection, and concurrency cases:

- duplicate replay of the same event does not allocate new message or part IDs
- mixed legacy/v2 transcript rows do not leak legacy IDs into canonical projector output
- concurrent final tool results in one assistant message keep distinct event-derived part/result IDs

Smoke/manual checks:

- inspect one real or fixture transcript containing text, tool, shell, and compaction entries when shell/compaction identity changes

Commit gate examples:

```bash
bun --cwd packages/core test test/session/event-identity.test.ts
bun --cwd packages/core test test/session/projector.test.ts
bun --cwd packages/opencode test test/v2/session-message-updater.test.ts
bun --cwd packages/opencode typecheck
```

## Phase 2 — Registry, SDK, OpenAPI, And Consumer Compatibility

Likely files to add or extend:

- `packages/core/test/event-v2/registry.test.ts`
- `packages/opencode/test/openapi/event-schemas.test.ts`
- SDK snapshot tests under the existing SDK test or generation location
- consumer tests in `packages/opencode/test/cli/`, `packages/opencode/test/tui/`, and server event tests where direct EventV2 subscriptions are added

Required unit tests:

- every published EventV2 definition is imported and registered exactly once
- registry ordering is stable and deterministic for generation
- event schema snapshots include type, version, data schema, and durability/live-only classification where exposed
- fail validation when a published event is missing from the registry

Required integration tests:

- regenerate or exercise OpenAPI/SDK event schema snapshots and verify no unexpected diff
- verify direct EventV2 subscriptions for migrated consumers receive the same encoded shape as SSE/SDK consumers
- assert `GlobalBus` is only a compatibility fanout and is not used as durable truth, a queue, or mailbox state

Regression, failure-injection, and concurrency cases:

- adding a new event without registry registration fails the registry test
- duplicate registration fails instead of silently changing generated output order
- concurrent subscribers cannot mutate shared event payload objects observed by other subscribers

Smoke/manual checks:

- inspect generated SDK/OpenAPI diffs before committing any approved schema change

Commit gate examples:

```bash
bun --cwd packages/core test test/event-v2/registry.test.ts
bun --cwd packages/opencode test test/openapi/event-schemas.test.ts
bun --cwd packages/opencode test test/server/httpapi-event.test.ts
bun --cwd packages/opencode typecheck
```

## Phase 3 — SessionMailbox Foundation

Likely files to add or extend:

- mailbox SQL/migration tests near `packages/core/test/database-migration.test.ts`
- `packages/core/test/session/mailbox.test.ts`
- EventV2 mailbox observation tests in `packages/core/test/event-v2/` or `packages/core/test/session/`

Required unit tests:

- enqueue preserves FIFO order per target session and queue family
- claim is atomic under concurrent runners and returns each queued row at most once
- state transitions cover queued, processing, delivered, failed, and cancelled
- claim, delivery, failure, retry, and cancellation paths are idempotent
- EventV2 mailbox observations are emitted for state changes but are not the mailbox source of truth

Required integration tests:

- persist mailbox rows through the real database layer and recover them after service restart/rebind
- run multiple mailbox consumers against the same session and prove only one runner owns a claimed row
- replay mailbox events and verify projected/observed state matches SQL state without replacing it

Regression, failure-injection, and concurrency cases:

- crash/failure after claim but before delivery leaves a recoverable processing row or failed state according to the service contract
- cancelling a queued or processing row is safe to repeat and cannot resurrect delivery
- concurrent enqueue while a runner is claiming preserves FIFO for unclaimed work
- projection-only state cannot make a queued message visible if the mailbox table says it is cancelled or delivered

Smoke/manual checks:

- inspect mailbox table rows in a temporary fixture database when adding or changing SQL schema

Commit gate examples:

```bash
bun --cwd packages/core test test/database-migration.test.ts
bun --cwd packages/core test test/session/mailbox.test.ts
bun --cwd packages/opencode typecheck
```

## Phase 4 — Mailbox-Backed `prompt_async`

Likely files to add or extend:

- `packages/opencode/test/server/session-actions.test.ts`
- `packages/opencode/test/server/session-messages.test.ts`
- `packages/core/test/session/mailbox.test.ts`
- runner or processor tests near existing session processor coverage

Required unit tests:

- busy target sessions enqueue only; they do not write a user message at send time
- runner safe-boundary claim creates exactly one user-message EventV2 event
- interrupt-send cancels or interrupts the active run, then wakes the runner to claim the queued entry
- sender metadata, target session, workspace/instance context, and permissions are preserved in the mailbox envelope
- idle target sessions either claim immediately or wake deterministically according to the chosen contract

Required integration tests:

- call `prompt_async` against a busy target and verify mailbox row, no immediate transcript write, later claim, and final transcript event
- call interrupt-mode `prompt_async` and verify active run cancellation/interruption plus queued prompt delivery
- verify prompts do not leak across sessions, workspaces, or instance contexts

Regression, failure-injection, and concurrency cases:

- repeated wakeups or retries do not duplicate mailbox delivery or user-message events
- failed runner claim returns the row to the correct retry/failed state without losing sender context
- concurrent async sends to the same target preserve FIFO and do not interleave prompt bodies
- duplicate request/idempotency key does not enqueue duplicate prompts when the API exposes one

Smoke/manual checks:

- manually exercise one busy-session async prompt flow if CLI/TUI behavior changes are user-visible

Commit gate examples:

```bash
bun --cwd packages/core test test/session/mailbox.test.ts
bun --cwd packages/opencode test test/server/session-actions.test.ts
bun --cwd packages/opencode test test/server/session-messages.test.ts
bun --cwd packages/opencode typecheck
```

## Phase 5 — BackgroundAgent Replacement

Likely files to add or extend:

- `packages/opencode/test/background/job.test.ts`
- `packages/opencode/test/tool/task.test.ts`
- `packages/opencode/test/server/session-actions.test.ts`
- `packages/core/test/session/mailbox.test.ts`
- new background-agent tests under `packages/opencode/test/background/` if the replacement gets a new service

Required unit tests:

- parent/child session relationship is durable and queryable after restart/rebind
- cancellation stops both durable job state and the child runner; repeated cancellation is idempotent
- parent/child operations enforce authorization and reject unrelated sessions
- `task_send` creates an authorized mailbox envelope with sender metadata and target child/parent routing
- background completion publishes explicit background events but does not synthesize a parent auto-prompt injection

Required integration tests:

- `task background=true` starts a child session, records lifecycle state, and returns immediately
- cancel a running background child and verify runtime runner stop, durable cancelled state, and background EventV2 cancellation event
- send `task_send` from parent to child and child to parent through `SessionMailbox` and verify FIFO delivery

Regression, failure-injection, and concurrency cases:

- cancelled child cannot later deliver stale completion into the parent
- unauthorized `task_send` cannot enqueue mailbox rows or publish background events
- duplicate completion/cancellation events do not duplicate parent notifications or mailbox deliveries
- background runner failure records failed state and does not leave a processing mailbox row stuck forever

Smoke/manual checks:

- manually inspect the CLI/TUI background notification flow if user-facing task output changes

Commit gate examples:

```bash
bun --cwd packages/opencode test test/background/job.test.ts
bun --cwd packages/opencode test test/tool/task.test.ts
bun --cwd packages/opencode test test/server/session-actions.test.ts
bun --cwd packages/opencode typecheck
```

## Phase 6 — Incremental Event Ungating

Likely files to add or extend:

- event-family tests near `packages/core/test/session/event-family.test.ts`
- `packages/opencode/test/effect/runtime-flags.test.ts`
- `packages/opencode/test/server/httpapi-event.test.ts`
- CLI/TUI duplicate-output tests under `packages/opencode/test/cli/` and `packages/opencode/test/tui/`

Required unit tests:

- each event family has an explicit publication matrix covering gated, ungated, durable, and live-only behavior
- persisted families meet encode/decode/replay requirements before ungating
- live-only families still satisfy schema and fanout contracts when exposed externally
- disabling a projector does not prevent safe EventV2 publication

Required integration tests:

- ungate one low-volume family at a time and verify SSE, direct EventV2, and `GlobalBus` compatibility output
- verify CLI/TUI consumers do not render duplicate output while both legacy and EventV2 bridge paths exist
- verify rollback by disabling the new projector or family consumer while publication remains harmless

Regression, failure-injection, and concurrency cases:

- durable events remain replayable when emitted while projectors are disabled
- live-only stream/progress events do not bloat durable EventTable history unless explicitly classified as durable
- concurrent legacy and EventV2 consumers do not double-ack, double-render, or double-notify
- per-family ungating does not accidentally enable unrelated experimental families

Smoke/manual checks:

- run a short CLI/TUI scenario for any family that changes visible stream, notification, or transcript output

Commit gate examples:

```bash
bun --cwd packages/opencode test test/effect/runtime-flags.test.ts
bun --cwd packages/opencode test test/server/httpapi-event.test.ts
bun --cwd packages/opencode test test/cli/run/stream.transport.test.ts
bun --cwd packages/opencode typecheck
```

## Phase 7 — Projectors And Legacy Cleanup

Likely files to add or extend:

- `packages/core/test/session/projector.test.ts`
- `packages/core/test/event-v2/projector-replay.test.ts`
- `packages/opencode/test/server/session-messages.test.ts`
- `packages/opencode/test/server/httpapi-event.test.ts`
- cleanup compatibility tests near `GlobalBus` bridge and runtime-flag tests

Required unit tests:

- projectors are idempotent when the same event is delivered or replayed more than once
- replay is deterministic from an empty projected state
- transaction rollback prevents partial projected state after projector failure
- projected transcript/session state matches legacy state for representative histories
- removing legacy flags and the `GlobalBus` bridge leaves direct EventV2 subscribers covered

Required integration tests:

- replay a full transcript history through projectors and compare server/session API output with legacy output
- sync replay produces the same durable state and SDK/OpenAPI schema snapshots remain stable
- remove or disable `GlobalBus` bridge compatibility in the tested path and verify migrated consumers still receive events

Regression, failure-injection, and concurrency cases:

- projector failure rolls back the current transaction without losing the underlying EventTable row
- restarting projection from sequence zero yields the same state as incremental live projection
- duplicate live delivery followed by replay does not create duplicate transcript entries
- rollback from a partially enabled projector family restores legacy/read-model parity

Smoke/manual checks:

- manually inspect one migrated session transcript and one background-agent transcript if legacy paths are deleted

Commit gate examples:

```bash
bun --cwd packages/core test test/session/projector.test.ts
bun --cwd packages/core test test/event-v2/projector-replay.test.ts
bun --cwd packages/opencode test test/server/session-messages.test.ts
bun --cwd packages/opencode test test/server/httpapi-event.test.ts
bun --cwd packages/opencode typecheck
```

## Maintenance Notes

- Add test files to the relevant phase section when implementation picks concrete
  filenames.
- Keep schema snapshots deterministic; registry-order changes should fail tests
  unless explicitly reviewed.
- Prefer failure-injection fixtures for malformed persisted rows over relying on
  production data samples.
- Do not use `GlobalBus` tests to prove durable behavior. Durable behavior must
  be asserted through EventV2 storage, replay, mailbox tables, or sync history as
  appropriate.
