# Standardize Chronological Ordering for Session Message Ingestion and Timelines: Session Message Timelines Transcript Exports Sync

Status: proposed
Date: 2026-10-01
Deciders: AI (signal conversion)

## Context

- Session message delivery and state synchronization across client applications (including packages/app, packages/tui, packages/opencode, and packages/web) occur over asynchronous transport channels such as WebSocket and SSE connections.
- Previously, timeline aggregation, sync hydration reducers, transcript exports, and history revert calculations relied on array ingestion order (the sequence in which messages arrived at the client or were inserted into arrays).
- Out-of-order network arrival caused message sequence corruption, desynchronized transcripts across frontend surfaces, and broken session revert points when updates arrived non-sequentially.

## Problem Statement

Relying on implicit arrival sequence and array insertion order for session messages leads to transcript desynchronization, corrupt timelines, and broken history revert boundaries during out-of-order network delivery.

## Decision

1. MUST: Session message timelines, transcript exports, and sync hydration reducers MUST order messages deterministically by persistent creation timestamp rather than array insertion sequence.

## Policy Block

- MUST Session message timelines, transcript exports, and sync hydration reducers MUST order messages deterministically by persistent creation timestamp rather than array insertion sequence.

In scope:
- packages/app message timelines, layout helpers, server session context, and sync reducers
- packages/tui session sync context, session routes, and transcript utilities
- packages/opencode session message models, prompt compaction, revert logic, and session state
- packages/web shared session components

Out of scope:
- Ephemeral real-time byte chunk streaming prior to boundary message creation
- Non-message system event logs that do not participate in session revert or transcript export

## Rationale

- Persistent creation timestamps provide an immutable, deterministic ordering baseline that is independent of transport latency or packet reordering.
- Enforcing timestamp-based sorting across all frontends and transcript storage layers ensures timeline consistency across packages/app, packages/tui, packages/opencode, and packages/web.
- Calculating session revert boundaries based on creation timestamps ensures that rollback operations target the true chronological history rather than an arbitrary arrival sequence.

## Consequences

Positive:
- Eliminates message timeline sequence corruption caused by out-of-order network delivery over SSE and WebSocket connections.
- Ensures consistent transcript exports and synchronization state across web, app, and TUI clients.
- Provides deterministic and accurate session history revert operations.

Negative:
- Introduces explicit sorting overhead at sync hydration and timeline rendering boundaries.
- Requires consistent timestamp generation precision across all message producer boundaries.

## Alternatives

- Implicit array appending and ingestion sequence for session message order and history revert boundaries (rejected)
  Rejected because: Relying on implicit arrival order caused message sequence corruption, transcript desynchronization, and broken session revert points when updates arrived out of order over WebSocket or SSE connections across multiple client surfaces.
- Server-assigned monotonic sequence numbers for timeline ordering (deferred)
  When valid: May be evaluated if sub-millisecond timestamp collisions occur across distributed message producers.

## Risks

- Messages generated with identical creation timestamps may experience non-deterministic sorting order across clients.
  Mitigation: Incorporate a secondary deterministic tie-breaker (such as unique message ID) when creation timestamps are equal.
  Owner: Core Architecture Team

## Implementation Notes

- Sorting logic should be implemented at hydration and reducer ingestion boundaries to prevent propagation of unordered arrays.
- Refactoring applies across packages/app (context/global-sync, context/server-session, pages/session/timeline), packages/tui (context/sync, routes/session, util/transcript), packages/opencode (session/message-v2, session/revert, session/session), and packages/web (components/Share).

## Continuation Context


Verify commands:
- Discover and run the project's test suite for session synchronization, timeline aggregation, and revert calculation to ensure chronological ordering under out-of-order input payloads.
- Discover and run the repository linter and type-checker across packages/app, packages/tui, packages/opencode, and packages/web.

Accept when:
- Sync reducers and timeline views sort messages strictly by creation timestamp even when supplied out-of-order test events.
- Transcript exports and revert boundary calculations produce deterministic outputs matching creation timestamp ordering across all packages.

## Enforcement

- Verified by: Automated unit and integration test suites validating out-of-order message hydration and timeline sorting.
- Verified by: Code review of sync hydration reducers, transcript generators, and timeline model components.
- Violation handling: Pull requests introducing array-append ordering or unsorted ingestion boundaries will fail automated tests or code review.
- Violation handling: Discrepancies in timeline synchronization between packages will be logged as sequencing regressions.
- Exception process: Exceptions for ephemeral, non-persisted streaming event buffers must be reviewed and approved by the Core Architecture Team.

## References

- file:packages/app/src/context/server-session.ts
- file:packages/app/src/context/global-sync/event-reducer.ts
- file:packages/app/src/context/sync.tsx
- file:packages/app/src/utils/session-message.ts
- file:packages/app/src/pages/session/timeline/message-timeline.tsx
- file:packages/app/src/pages/session/timeline/model.ts
- file:packages/app/src/pages/session/timeline/rows.ts
- file:packages/app/src/pages/layout/helpers.ts
- file:packages/tui/src/context/sync.tsx
- file:packages/tui/src/routes/session/index.tsx
- file:packages/tui/src/util/transcript.ts
- file:packages/opencode/src/session/message-v2.ts
- file:packages/opencode/src/session/prompt.ts
- file:packages/opencode/src/session/revert.ts
- file:packages/opencode/src/session/session.ts
- file:packages/web/src/components/Share.tsx
- commit:5aa5cb35235509c7bcb206179cf29ee11627276e
- commit:91132551141aeb93ca3053a64295a294312c78a7
- commit:23cc677108069e4a7e5ae914d508fde9671b9431
- commit:28bcc0e4f4d4679946542e05412cb96d737a0428
- commit:20750c332e75dd68a10e88f9a0c6b1ca9ac41213
- commit:db581e47a3a6f4900a6289ad7fddec60fec44e1c
- commit:a54a693af242108b0b5c9db6ae498c10b2d8843b
- pr:#40990
- pr:#40991
- pr:#40994
- pr:#40995
- pr:#41000
- pr:#41001
- pr:#41006