# EventV2 Migration Plan

## Goal

Make EventV2 the stable runtime event surface before removing
`OPENCODE_EXPERIMENTAL_EVENT_SYSTEM`, then build mailbox-backed async prompts and
background agents on top of that surface.

## Current State

EventV2 already exists as an Effect service:

- `packages/core/src/event.ts` defines `EventV2.Service`, event definitions,
  persistence, projectors, replay, and listeners.
- `packages/opencode/src/event-v2-bridge.ts` publishes with instance/workspace
  location and forwards to `GlobalBus`.
- `EventV2Bridge.defaultLayer` is part of `AppLayer`.
- Many session publications are still gated by
  `RuntimeFlags.experimentalEventSystem`.
- Session projectors in `packages/core/src/session/projector.ts` exist but are
  not ready to enable wholesale.

Do not remove event gates first. Harden the EventV2 contract, then ungate event
families incrementally.

## Target Principles

- EventV2 persisted/wire payloads are schema-encoded JSON-compatible values.
- Replay decodes payloads before listeners or projectors observe them.
- Event timestamps use a numeric wire/storage contract.
- Existing experimental EventTable rows are tolerated or migrated where
  practical.
- Canonical v2 transcript identity uses `evt_*` IDs for event-created entities.
  Legacy `msg_*` and `prt_*` IDs are temporary adapter concerns only.
- User messages are created by runner-dequeued events, not by queue insertion.
- Event definitions have explicit registry ordering for SDK/OpenAPI generation
  and schema snapshot validation.
- `GlobalBus` is a temporary compatibility bridge, not a durable queue.
- Projectors are enabled one family at a time after replay, idempotency, and
  parity tests.

## Event Classes

Classify each event before ungating publication:

- **Durable persisted events**: transcript lifecycle, final tool results,
  mailbox state changes, background lifecycle, and other state needed for replay,
  sync, or audit.
- **Live-only high-volume events**: token/text deltas, progress notifications,
  transient stream status, and other events that should not bloat durable history
  unless a later design requires it.

Persisted events must satisfy the encode/decode and replay contract. Live-only
events may be bridged for UI/CLI updates but should still have stable schemas if
they are exposed through SDK/OpenAPI surfaces.

## Migration Phases

### Phase 0 — EventV2 Contract Hardening

Fix serialization boundaries before enabling more publication.

Scope:

- encode EventV2 data at persisted and wire boundaries
- decode EventTable replay before listener/projector delivery
- lock numeric timestamp shape for stored and emitted events
- tolerate or migrate existing experimental rows with decoded domain objects
- test EventTable, SSE, GlobalBus bridge, replay, and sync-history shapes

Validation focus:

- DateTime and branded schema encode/decode tests
- EventTable JSON-compatible payload tests
- replay compatibility tests for old experimental rows
- SSE and `GlobalBus` payload shape tests
- sync history compatibility tests

### Phase 1 — Canonical Transcript Identity

Define the v2 transcript catalog around event-created identity.

Rules:

- canonical event-created entities use the publishing event's `evt_*` ID or an
  explicit stable entity ID carried by the event
- user messages are created when the runner claims/dequeues input and commits the
  user-message event
- assistant messages, durable parts, shell messages, compaction messages, and
  final tool results must have stable event-derived identity
- legacy `msg_*` and `prt_*` IDs remain only in compatibility adapters until old
  consumers are migrated

Validation focus:

- event catalog tests for stable IDs and parent/part references
- replay examples that rebuild transcript identity consistently
- adapter tests proving legacy IDs do not leak into canonical v2 state

### Phase 2 — Registry, SDK, OpenAPI, And Consumer Compatibility

Centralize event registration so generated surfaces are deterministic.

Rules:

- import/register every published event definition in a stable order
- snapshot SDK/OpenAPI event schemas
- fail validation when an event is published but missing from the registry
- keep `EventV2Bridge -> GlobalBus` only as a compatibility adapter while
  consumers migrate to direct EventV2 subscriptions
- treat `GlobalBus` as live fanout only; never use it as a queue or source of
  mailbox truth

Candidate consumers to inventory and migrate:

- CLI run stream transport
- TUI session/debug surfaces
- notifications
- subagent/footer inspectors
- future mailbox inspectors

### Phase 3 — SessionMailbox Foundation

Add SQL/service-backed mailbox state for async prompt and background messages.

Rules:

- mailbox rows are the source of truth for queued async delivery
- EventV2 mailbox events are observations, not the only queue storage
- queued mailbox messages are not user messages until a runner claims/dequeues
  them at a safe boundary
- dequeue is atomic and idempotent

Initial mailbox events:

```text
session.mailbox.enqueued
session.mailbox.processing
session.mailbox.delivered
session.mailbox.failed
session.mailbox.cancelled
```

### Phase 4 — Mailbox-Backed `prompt_async`

Change async prompt delivery to use the mailbox when the target session is busy.

Behavior:

1. enqueue the prompt as a mailbox message with sender metadata
2. do not write a user message immediately
3. wake or interrupt the target runner as requested by the caller
4. runner claims the message at a safe boundary
5. runner emits/commits the user-message event and processes it

Interrupt-send should cancel or interrupt the active target run, then wake the
runner so it claims the queued mailbox entry. Non-interrupt async sends may wait
for the next safe boundary.

### Phase 5 — BackgroundAgent Replacement

Replace `task background=true` with supervised background-agent relationships
over child sessions plus mailbox messaging.

Rules:

- do not stabilize synthetic parent auto-prompt injection as the design
- parent/child communication goes through `SessionMailbox`
- cancellation must stop both runtime job state and the child runner
- `task_send` uses authorization, sender envelopes, and mailbox delivery
- completion can publish background events, but parent auto-continue semantics
  need a separate explicit design if added later

Initial background events:

```text
session.background.started
session.background.cancelled
session.background.completed
session.background.failed
```

### Phase 6 — Incremental Event Ungating

Remove `experimentalEventSystem` publication gates family by family only after
that family has encoding, fanout, consumer, and replay coverage.

Prefer low-volume final-state events before high-volume stream/progress events.
Keep rollback simple: EventV2 publication should be harmless if a projector is
disabled.

### Phase 7 — Projectors And Legacy Cleanup

Enable or rebuild projectors one family at a time after tests prove:

- replay is deterministic
- duplicate delivery is idempotent
- projected transcript state matches legacy transcript state
- sync replay and SDK/OpenAPI snapshots remain stable

After consumers move to direct EventV2, remove the `GlobalBus` bridge, old
experimental flags, and legacy background paths.

## Validation Checklist

The authoritative phase-by-phase validation plan lives in
[`event-v2-test-plan.md`](./event-v2-test-plan.md). Run the tests for the phase
being committed plus the common typecheck gate. Representative commands:

```bash
bun --cwd packages/opencode test test/effect/runtime-flags.test.ts
bun --cwd packages/opencode test test/server/httpapi-event.test.ts
bun --cwd packages/opencode typecheck
```

Concrete test categories:

- EventV2 encode/decode at persistence and wire boundaries
- numeric timestamp contract for stored and emitted events
- replay of current and existing experimental EventTable rows
- SDK/OpenAPI schema snapshots and event registry import ordering
- SSE and `GlobalBus` compatibility shape without duplicate output
- `evt_*` transcript identity and legacy adapter isolation
- mailbox FIFO, atomic claim, cancellation, retry/failure, and idempotent dequeue
- `prompt_async` busy isolation, interrupt wakeup, idle wakeup, and no duplicate
  user-message events
- background cancellation, `task_send` authorization/envelope, and no stale
  parent synthetic completion injection
- projector replay, idempotency, parity, and family-by-family rollback

## Risks And Follow-Ups

- High-volume stream/progress events may need live-only handling to avoid durable
  event bloat.
- Existing projectors may be stale; do not enable them wholesale.
- Duplicate legacy and EventV2 consumers can confuse CLI/TUI output during the
  bridge period.
- Event publication should not break prompt execution unless the event is part of
  a transactional state transition.
