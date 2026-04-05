# Rearchitect opencode-postgres-sync: SSE → Plugin Hooks

## TL;DR

> **Quick Summary**: Remove the SSE HTTP stream consumer from the opencode-postgres-sync plugin and replace it with direct event projection via the `hooks.event()` plugin hook, which already receives all OpenCode bus events. Rewrite projectors for the bus event shape via TDD.
>
> **Deliverables**:
>
> - Projectors rewritten to accept bus event shape `{ type, properties }` instead of SSE shape `{ id, seq, aggregateID, type, data }`
> - `consumer.ts` deleted — no SSE/HTTP dependency
> - `index.ts` rearchitected — all events routed through `hooks.event()`, metadata timer inlined
> - `serverUrl` removed from PluginOptions, HTTP auth env vars purged
> - All existing CI checks pass (typecheck, format, test) with updated + new tests
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 4 waves + final verification
> **Critical Path**: T1 (validate) → T2 (TDD projectors) → T3 (rearchitect index.ts) → T5 (cleanup) → T6 (CI verify) → F1-F4

---

## Context

### Original Request

Rearchitect the opencode-postgres-sync plugin so it does not rely on connecting to an HTTP port of the OpenCode process. The SSE stream at `/global/sync-event` is broken (port 0) and architecturally wrong — the plugin should use the hook system that already delivers all events.

### Interview Summary

**Key Discussions**:

- Bus events and SSE events have fundamentally different shapes — confirmed by previous session from actual code
- Decision: Rewrite plugin projectors for bus shape (no core OpenCode changes)
- Decision: TDD — failing tests first, then implementation
- Decision: Aurora Serverless Pulumi deferred to separate plan
- Decision: No env vars — config from PluginOptions only

**Research Findings**:

- `hooks.event()` receives ALL bus events via `bus.subscribeAll()` at plugin/index.ts:220
- Bus event shape: `{ type: "session.created", properties: { ...zod-validated } }`
- SSE event shape: `{ id, seq, aggregateID, type: "session.created.1", data: { ...raw } }`
- Bus event types include: session.created/updated/deleted, message.part.delta, and others
- **CRITICAL UNKNOWN**: `message.part.delta` (bus) vs `message.part.updated.1` (SSE) — semantics may differ (streaming partial vs full state). Must validate in T1.
- Consumer.ts exports Consumer type wrapping: todo, metadata, ensure, status, checkpoint methods
- These methods delegate to local.ts functions — can be inlined directly

### Metis Review

**Identified Gaps** (addressed in plan):

- **Bus/SSE semantic gap**: Added gating validation task (T1) before any implementation
- **`message.part.delta` mismatch**: Dedicated investigation in T1, TDD coverage in T2
- **Backfill/live race on startup**: Startup ordering defined in T3
- **In-process hook latency**: Bus `subscribeAll()` doesn't await plugin hooks — fire-and-forget, no blocking
- **Timer duplication**: Singleton lifecycle guard required in T3
- **Event table / replication_state fate**: Decided per hooks-vs-backfill path in T1, implemented in T3
- **Scope inflation**: Explicit whitelist of event types — no PTY/file/permission/question events

---

## Work Objectives

### Core Objective

Remove the broken SSE HTTP stream dependency from the opencode-postgres-sync plugin and project all events through the existing `hooks.event()` plugin hook, rewriting projectors for the bus event shape via TDD.

### Concrete Deliverables

- `src/projectors.ts` — replay() + all projector functions accept bus event shape
- `src/projectors.test.ts` — updated tests for bus event shape, new tests for message.part.delta semantics
- `src/index.ts` — hooks.event() routes all event types, metadata timer inlined, Consumer removed
- `src/consumer.ts` — deleted
- `src/replication.ts` — updated if event table/dedup behavior changes for hooks path
- Zero references to `serverUrl`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME` in source

### Definition of Done

- [ ] `bun test` passes (all existing + new tests) — run from plugin directory
- [ ] `bun typecheck` passes — run from plugin directory
- [ ] `bun run format` passes — run from plugin directory
- [ ] Zero grep matches for `consumer`, `serverUrl`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME` in `src/`
- [ ] `src/consumer.ts` does not exist
- [ ] Plugin loads without error when OpenCode starts (no HTTP connection attempt)

### Must Have

- Bus event projection for: session.created, session.updated, session.deleted
- Bus event projection for: message.updated, message.removed (or bus equivalents)
- Bus event projection for: message.part.updated/delta, message.part.removed (or bus equivalents)
- Todo sync via todo.updated event (already working — regression safety)
- Checkpoint trigger via session.status idle event (already working — regression safety)
- 30s metadata sync timer (moved from consumer.ts)
- Backfill still works on startup (reads local SQLite directly — should be unchanged)
- Plugin config via PluginOptions only (options.url, options.machine)

### Must NOT Have (Guardrails)

- No changes to core OpenCode code (packages/opencode/\*)
- No SSE/HTTP stream code in the plugin
- No env var config (`OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME`, `OPENCODE_SHARED_DB`, `OPENCODE_SYNC_MACHINE`)
- No projection of unrelated bus events (pty, file, permission, question, lsp, mcp, tui, etc.)
- No schema changes to Postgres DDL (unless T1 proves impossible without them)
- No new dependencies added to package.json
- No Aurora/infrastructure work (deferred)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES — bun test, 15 existing tests, CI green
- **Automated tests**: TDD — failing tests first, then implementation
- **Framework**: bun:test (native, zero-config)
- **TDD flow**: RED (failing test for bus shape) → GREEN (implement projector change) → REFACTOR

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Projector tests**: Use `bun test` — assert correct Postgres row state from bus events
- **Dead code**: Use grep — assert zero matches for removed identifiers
- **Integration**: Use `bun test` + manual inspection of generated SQL
- **Runtime**: Start plugin, verify no HTTP connection attempts in log output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Gating validation — MUST complete first):
└── T1: Bus event contract validation [deep]

Wave 2 (TDD projector rewrite — depends on T1):
└── T2: TDD: Rewrite projectors for bus event shape [deep]

Wave 3 (Runtime rearchitecture — depends on T2, parallel):
├── T3: Rearchitect index.ts — event routing + lifecycle [deep]
└── T4: Update replication.ts — event table + dedup for hooks path [quick]

Wave 4 (Cleanup — depends on T3/T4):
└── T5: Delete consumer.ts + purge SSE/HTTP artifacts [quick]

Wave 5 (Verification — depends on T5):
└── T6: Full CI verification + dead code assertions + runtime QA [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real QA execution (unspecified-high)
└── F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

Critical Path: T1 → T2 → T3 → T5 → T6 → F1-F4 → user okay
Parallel Speedup: ~20% faster than sequential (Wave 3 has parallel pair)
Max Concurrent: 2 (Wave 3)

### Dependency Matrix

| Task | Blocked By | Blocks |
| ---- | ---------- | ------ |
| T1   | —          | T2     |
| T2   | T1         | T3, T4 |
| T3   | T2         | T5, T6 |
| T4   | T2         | T5, T6 |
| T5   | T3, T4     | T6     |
| T6   | T5         | F1-F4  |

### Agent Dispatch Summary

- **Wave 1**: 1 task — T1 → `deep`
- **Wave 2**: 1 task — T2 → `deep`
- **Wave 3**: 2 tasks — T3 → `deep`, T4 → `quick`
- **Wave 4**: 1 task — T5 → `quick`
- **Wave 5**: 1 task — T6 → `quick`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Bus Event Contract Validation (GATING)

  **What to do**:
  - Read OpenCode core source to enumerate EXACT bus event types and their `properties` shapes for events the plugin needs:
    - Session events: find `session.created`, `session.updated`, `session.deleted` BusEvent definitions
    - Message events: find `message.updated`, `message.removed` or equivalent (may be named differently on the bus)
    - Part events: find `message.part.updated` or `message.part.delta` — determine if delta is a streaming partial or full state update
    - Also confirm `todo.updated` and `session.status` shapes (regression safety)
  - For EACH needed event, document: exact type string, properties shape with field types
  - Map each bus event to its SSE equivalent (e.g., `session.created` bus → `session.created.1` SSE)
  - Identify which SSE events have NO bus equivalent (especially `message.removed` and `message.part.removed`)
  - Document the `message.part.delta` semantics: is `properties` a full snapshot, a diff/patch, or append-only data?
  - Determine: can bus event `properties` populate ALL columns that `replay()` currently populates? If any column is impossible without `seq`/`id`/`aggregateID`, document the gap.
  - Output: A mapping document saved as evidence that all subsequent tasks reference
  - **STOP GATE**: If ANY required projection is impossible without core OpenCode changes, STOP and report back to user. Do NOT proceed with workarounds.

  **Must NOT do**:
  - Modify any files in core OpenCode (packages/opencode/\*)
  - Guess at event shapes — read actual event definitions. NOTE: core session/message events are defined via `SyncEvent.define()` (not `BusEvent.define()`) in the sync system, then published to the bus through `packages/opencode/src/sync/index.ts`. Search for both `SyncEvent.define` and `BusEvent.define` to find all event definitions.
  - Include events the plugin doesn't need (pty, file, permission, question, lsp, etc.)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires careful codebase reading across two repos, semantic analysis of event contracts, and a gating decision
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (solo)
  - **Blocks**: T2, T3, T4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `packages/opencode/src/sync/index.ts` — SyncEvent system that defines session/message events and publishes them to the bus. This is where the versioned types (session.created.1) originate and where the bus publication happens.
  - `packages/opencode/src/bus/bus-event.ts` — BusEvent.define() for non-sync events (todo.updated, session.status, etc.)
  - `packages/opencode/src/session/index.ts` — Session.Event definitions (Created, Updated, Deleted) with their Zod property schemas and `busSchema` mappings
  - `packages/opencode/src/session/message-v2.ts` — Message and part event definitions
  - `packages/opencode/src/bus/index.ts:86` — Bus Payload type that plugins receive

  **API/Type References**:
  - `packages/opencode/src/plugin/index.ts:220-229` — Where plugins subscribe to all bus events (subscribeAll -> hook["event"])
  - `packages/plugin/src/index.ts` — Plugin Hooks interface showing event hook signature

  **Existing Plugin References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/projectors.ts:496-550` — Current replay() function showing expected SSE event types and shapes
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/consumer.ts` — Current SSE consumer showing event parsing

  **WHY Each Reference Matters**:
  - sync/index.ts: The bridge between SyncEvent definitions and the bus — shows how events get from the sync system onto the bus that plugins subscribe to. CRITICAL: this is where to find the actual event types and shapes.
  - bus-event.ts: Shows HOW non-sync events are defined (todo.updated, session.status, etc.)
  - session/index.ts: Contains the actual Session.Event.Created/Updated/Deleted definitions with their `busSchema` — these schemas define what properties the bus event carries
  - message-v2.ts: Contains message and part event definitions — critical to understand if message.part.delta is a full snapshot or streaming partial
  - bus/index.ts: Shows the Payload type wrapper that hooks actually receive
  - plugin/index.ts: Confirms the subscription mechanism and proves bus events reach plugins
  - projectors.ts: Shows the current SSE shape that we're migrating FROM — needed for the mapping table

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All SSE event types have bus equivalents
    Tool: Bash (grep/ast_grep_search)
    Preconditions: Access to core repo at /home/ubuntu/opencode/db/packages/opencode/src/
    Steps:
      1. Search for SyncEvent.define() and BusEvent.define() calls in /home/ubuntu/opencode/db/packages/opencode/src/ matching: session.created, session.updated, session.deleted
      2. Search for SyncEvent.define() and BusEvent.define() calls in /home/ubuntu/opencode/db/packages/opencode/src/ matching: message.updated, message.removed (or equivalents)
      3. Search for SyncEvent.define() and BusEvent.define() calls matching: message.part.updated, message.part.delta, message.part.removed (or equivalents). Also check /home/ubuntu/opencode/db/packages/opencode/src/sync/index.ts for the sync-to-bus publish path.
      4. For each found event, read the Zod schema to extract property types
      5. Compare properties to the data fields that replay() currently accesses
    Expected Result: A complete mapping table covering all 7 SSE event types
    Failure Indicators: Any SSE event type with NO bus equivalent, or a bus event whose properties cannot populate required Postgres columns
    Evidence: .sisyphus/evidence/task-1-event-contract-map.md

  Scenario: message.part.delta semantics documented
    Tool: Bash (read source)
    Preconditions: message.part.delta BusEvent found
    Steps:
      1. Read the Zod schema for message.part.delta properties
      2. Determine if properties contain a full part snapshot or incremental delta
      3. Compare to what upsertPart() in projectors.ts expects
    Expected Result: Clear documentation of whether delta=snapshot (can use directly) or delta=incremental (needs accumulation logic)
    Failure Indicators: Ambiguous semantics that could silently corrupt part projection
    Evidence: .sisyphus/evidence/task-1-part-delta-semantics.md
  ```

  **Evidence to Capture:**
  - [ ] task-1-event-contract-map.md — Full mapping table: SSE type -> bus type -> properties shape -> projector function
  - [ ] task-1-part-delta-semantics.md — message.part.delta analysis

  **Commit**: NO (research only, no code changes)

- [x] 2. TDD: Rewrite Projectors for Bus Event Shape

  **What to do**:
  - **RED phase**: Write failing tests in `src/projectors.test.ts` for each event type using the bus event shape documented in T1:
    - `session.created` -> replaySession() should create session row with correct fields
    - `session.updated` -> updateSession() should update session row
    - `session.deleted` -> should delete session row
    - `message.updated` (or bus equivalent) -> upsertMessage() should create/update message row
    - `message.removed` (or bus equivalent) -> should delete message row
    - `message.part.updated`/`delta` (or bus equivalent) -> upsertPart() should create/update part row with correct semantics (per T1 findings)
    - `message.part.removed` (or bus equivalent) -> should delete part row
    - Regression: `todo.updated` handling unchanged
  - Tests should use concrete bus event payloads (not SSE shape) as input
  - Tests should assert the same Postgres row state as the current tests, just with different input shape
  - **GREEN phase**: Modify `replay()` and individual projector functions to accept bus event shape:
    - Change the `Sync` type (or create a new type) to match the bus event shape from T1
    - Update type matching in replay() switch from versioned (`session.created.1`) to unversioned (`session.created`)
    - Update each projector function to read from `properties.info`, `properties.sessionID`, etc. instead of `data.info`, `data.sessionID`
    - Handle the absence of `seq`/`id`/`aggregateID` — either derive them from properties or adjust the event table write
    - If T1 showed `message.part.delta` is incremental (not snapshot), implement accumulation logic
  - **REFACTOR phase**: Clean up any intermediate type bridges, remove SSE-specific type definitions no longer needed
  - Update existing 6 projector mapping tests to use bus event shape instead of SSE shape

  **Must NOT do**:
  - Change the Postgres schema (DDL in schema.ts)
  - Touch backfill.ts — it reads local SQLite EventTable which still uses the old shape
  - Touch resume.ts, local.ts, log.ts, tools.ts
  - Add projections for event types the plugin doesn't need

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: TDD cycle requiring careful type analysis, semantic understanding of event shapes, and systematic test + implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (solo)
  - **Blocks**: T3, T4
  - **Blocked By**: T1

  **References**:

  **Pattern References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/projectors.ts` — Current replay() and all projector functions. This is the file being rewritten.
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/projectors.test.ts` — Current 6 projector mapping tests. Update these for bus shape.

  **API/Type References**:
  - T1 evidence: `.sisyphus/evidence/task-1-event-contract-map.md` — The mapping table from T1 that defines exact bus event shapes
  - T1 evidence: `.sisyphus/evidence/task-1-part-delta-semantics.md` — message.part.delta semantics

  **Test References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/projectors.test.ts` — Existing test structure and assertion patterns to follow
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/resume.test.ts` — Example of bun:test patterns used in this project

  **WHY Each Reference Matters**:
  - projectors.ts: THE file being modified — need exact function signatures, switch cases, and data access patterns
  - projectors.test.ts: Need to understand existing test structure to update (not rewrite from scratch)
  - T1 evidence files: Define the exact bus shapes to code against — without these, implementation is guessing

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] All existing projector tests updated for bus event shape
  - [ ] New tests added for each event type listed above
  - [ ] `bun test src/projectors.test.ts` -> PASS (all tests)
  - [ ] `bun typecheck` -> PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Session created event projects correctly
    Tool: Bash (bun test)
    Preconditions: projectors.test.ts has test for session.created bus event
    Steps:
      1. Run `bun test src/projectors.test.ts` from /home/ubuntu/opencode/opencode-postgres-sync
      2. Verify test for session.created passes
      3. Verify test uses bus shape { type: "session.created", properties: { sessionID: "ses_test_1", info: {...} } }
    Expected Result: Test passes, session row created with correct id, title, model fields
    Failure Indicators: Test fails, or test still uses SSE shape (type: "session.created.1", data: {...})
    Evidence: .sisyphus/evidence/task-2-projector-tests.txt

  Scenario: message.part.delta handled per T1 semantics
    Tool: Bash (bun test)
    Preconditions: T1 determined delta semantics (snapshot vs incremental)
    Steps:
      1. Run test for message.part.delta event
      2. If snapshot: verify part row contains full state from single event
      3. If incremental: verify accumulation logic produces correct final state
    Expected Result: Part row state matches expected output based on T1's semantic determination
    Failure Indicators: Part data is corrupt, truncated, or uses wrong interpretation of delta
    Evidence: .sisyphus/evidence/task-2-part-delta-test.txt

  Scenario: No SSE-shaped types remain in projectors
    Tool: Bash (grep)
    Preconditions: Projector rewrite complete
    Steps:
      1. grep -n 'created\.1\|updated\.1\|removed\.1\|deleted\.1' src/projectors.ts
      2. Expect 0 matches (no versioned type strings)
    Expected Result: 0 matches — all type matching uses unversioned bus event names
    Failure Indicators: Any versioned type string remains
    Evidence: .sisyphus/evidence/task-2-no-versioned-types.txt
  ```

  **Evidence to Capture:**
  - [ ] task-2-projector-tests.txt — Full bun test output
  - [ ] task-2-part-delta-test.txt — message.part.delta specific test output
  - [ ] task-2-no-versioned-types.txt — grep output confirming no SSE types remain

  **Commit**: YES
  - Message: `test(postgres-sync): codify bus event projector contract`
  - Files: `src/projectors.ts`, `src/projectors.test.ts`
  - Pre-commit: `bun test && bun typecheck`

- [x] 3. Rearchitect index.ts — Event Routing + Lifecycle

  **What to do**:
  - Rewrite the `hooks.event()` handler to route ALL needed bus events through the new `replay()`:
    - Session events: session.created, session.updated, session.deleted
    - Message events: message.updated, message.removed (or bus equivalents from T1)
    - Part events: message.part.delta / message.part.updated (or bus equivalents from T1)
    - Keep existing: todo.updated -> syncTodos(), session.status (idle) -> checkpoint()
  - Remove the `import { start } from "./consumer.js"` and `sync = start(...)` call
  - Inline the Consumer interface methods directly using local.ts and consumer.ts as reference for the actual function names:
    - `todo(sid, todos)` -> call syncTodos() from projectors.ts directly
    - `metadata()` -> call syncMetadata() from local.ts directly
    - `ensure(sid)` -> call pullSession() from local.ts directly (NOTE: consumer.ts wraps this as `ensure` but the local.ts export is `pullSession`)
    - `status()` -> call remoteStatus() from local.ts directly (NOTE: consumer.ts wraps this as `status` but the local.ts export is `remoteStatus`)
    - `checkpoint(sid)` -> use checkpointState() + saveCheckpoint() from local.ts (NOTE: the consumer wraps checkpoint logic using these two functions, not a single `refreshCheckpoints` call). Read consumer.ts to understand the exact checkpoint flow before inlining.
  - Create a 30s `setInterval` for metadata sync + checkpoint refresh (moved from consumer.ts):
    - MUST be a singleton — guard against multiple timers per plugin instance
    - Call `timer.unref()` so it doesn't keep the process alive
    - NOTE: The plugin API (`packages/plugin/src/index.ts`) exposes only a `Hooks` return from `server()` and has NO unload/dispose hook. Therefore the timer cannot be explicitly cleaned up on plugin unload. Using `.unref()` ensures it won't prevent process exit. This is acceptable.
  - Understand the actual plugin lifecycle: The `server()` function is called once, returns a `Hooks` object, and then the core registers those hooks and subscribes to bus events AFTER `server()` returns. This means:
    1. Connect to Postgres inside `server()` (existing behavior)
    2. Kick off backfill as an async fire-and-forget inside `server()` (catches up missed events from local SQLite)
    3. Start metadata sync timer inside `server()` as a side effect
    4. Return the `Hooks` object — the core will wire up bus event subscription AFTER this returns
    - The hooks will start receiving events once the core finishes wiring. Backfill may overlap briefly but uses its own replication_state tracking, preventing conflicts.
  - Handle backfill/live overlap: backfill reads local SQLite EventTable which has different event IDs than live bus events. Since backfill uses replication_state to track its own progress, and live hooks write to Postgres directly, they should not conflict. Document this in a code comment.
  - Remove `serverUrl` / `input.serverUrl` usage from plugin init
  - Remove `server` variable that was passed to `start()`

  **Must NOT do**:
  - Change the Postgres schema
  - Modify core OpenCode code
  - Add new dependencies
  - Project unrelated bus events

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex runtime rearchitecture with lifecycle management, startup ordering, and singleton guarantees
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T4)
  - **Parallel Group**: Wave 3 (with T4)
  - **Blocks**: T5, T6
  - **Blocked By**: T2

  **References**:

  **Pattern References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/index.ts` — THE file being modified. Current hook registrations, consumer usage, plugin init flow.
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/consumer.ts:24-30` — Consumer type definition showing methods to inline
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/consumer.ts:171-178` — Current 30s timer pattern to replicate

  **API/Type References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/local.ts` — Functions to import directly. NOTE: Read the actual exports — the function names differ from Consumer method names. Key exports include: syncMetadata, pullSession, remoteStatus, checkpointState, saveCheckpoint. Verify exact names by reading the file.
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/projectors.ts` — replay() (new bus-shape version from T2) and syncTodos()

  **WHY Each Reference Matters**:
  - index.ts: The file being rewritten — need exact current hook structure, imports, init flow
  - consumer.ts: Shows what methods to inline and what timer pattern to replicate
  - local.ts: Provides the actual functions that the Consumer type was wrapping — import these directly

  **Acceptance Criteria**:
  - [ ] `bun typecheck` -> PASS
  - [ ] `bun test` -> PASS
  - [ ] No import of consumer.ts in index.ts
  - [ ] hooks.event() handles session, message, part, todo, and status events
  - [ ] 30s metadata sync timer exists with .unref()

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: hooks.event() routes session events to replay()
    Tool: Bash (grep + read)
    Preconditions: index.ts rewrite complete
    Steps:
      1. Read src/index.ts, find the hooks.event() handler
      2. Verify it calls replay() for session.created, session.updated, session.deleted events
      3. Verify it still calls syncTodos for todo.updated
      4. Verify it still calls checkpoint for session.status idle
    Expected Result: All 5+ event types handled in hooks.event()
    Failure Indicators: Any event type missing, or replay() not called for session/message/part events
    Evidence: .sisyphus/evidence/task-3-event-routing.txt

  Scenario: No consumer.ts imports remain
    Tool: Bash (grep)
    Preconditions: index.ts rewrite complete
    Steps:
      1. grep -n "consumer" src/index.ts
      2. Expect 0 matches
    Expected Result: Zero references to consumer module
    Failure Indicators: Any import, require, or reference to consumer
    Evidence: .sisyphus/evidence/task-3-no-consumer-import.txt

  Scenario: Metadata sync timer is singleton with unref
    Tool: Bash (grep + read)
    Preconditions: index.ts rewrite complete
    Steps:
      1. Search src/index.ts for setInterval
      2. Verify interval is ~30000ms
      3. Verify .unref() is called on the timer
      4. Verify timer reference is stored for cleanup
    Expected Result: Single setInterval(fn, 30000) with .unref() and stored reference
    Failure Indicators: Multiple timers, no unref(), or timer leaks on plugin reload
    Evidence: .sisyphus/evidence/task-3-timer-singleton.txt
  ```

  **Evidence to Capture:**
  - [ ] task-3-event-routing.txt — hooks.event() handler code showing all event routes
  - [ ] task-3-no-consumer-import.txt — grep output
  - [ ] task-3-timer-singleton.txt — timer code showing singleton + unref

  **Commit**: YES (groups with T4)
  - Message: `refactor(postgres-sync): project bus events through hooks`
  - Files: `src/index.ts`, `src/replication.ts`
  - Pre-commit: `bun test && bun typecheck`

- [x] 4. Update replication.ts — Event Table + Dedup for Hooks Path

  **What to do**:
  - Review `replication_state` table usage and decide its fate for the hooks path:
    - Backfill path: KEEP — backfill still uses replication_state to track SQLite event progress
    - Live hooks path: Determine if replication_state is needed. Since hooks fire once per event (no reconnection/replay like SSE), dedup may not be required.
  - If replay() (new version from T2) still writes to the event table, determine what to put in the `seq` and `id` columns now that bus events don't provide them:
    - Option A: Use Postgres-generated sequence (serial/GENERATED)
    - Option B: Derive from event content (hash of type + properties.sessionID + timestamp)
    - Option C: Mark these columns nullable for the hooks path
  - Update the `source()` function: for the hooks path, machine is always local (options.machine or os.hostname()). Simplify or add a parameter.
  - Ensure backfill.ts still works unchanged — it reads local SQLite EventTable which has its own seq/id. Do NOT change the backfill code path.

  **Must NOT do**:
  - Change the Postgres schema DDL (unless absolutely necessary, document why)
  - Touch backfill.ts
  - Change backfill's use of replication_state

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused changes to one file, mostly decision + small code adjustment
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T3)
  - **Parallel Group**: Wave 3 (with T3)
  - **Blocks**: T5, T6
  - **Blocked By**: T2

  **References**:

  **Pattern References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/replication.ts` — THE file being modified. source() function, replication state tracking.
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/projectors.ts` — How replay() uses seq/id/aggregateID from events

  **API/Type References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/schema.ts` — Event table and replication_state table DDL
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/backfill.ts` — How backfill uses replication_state (DO NOT CHANGE)

  **WHY Each Reference Matters**:
  - replication.ts: The file being changed — need exact source() signature and replication_state usage
  - projectors.ts: Shows how the new replay() (from T2) handles seq/id — determines what replication.ts needs to provide
  - schema.ts: Column constraints determine what's nullable vs required
  - backfill.ts: Must verify backfill still works after replication.ts changes

  **Acceptance Criteria**:
  - [ ] `bun typecheck` -> PASS
  - [ ] `bun test` -> PASS
  - [ ] backfill.ts unchanged (diff shows no changes)
  - [ ] source() function handles hooks path correctly

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: backfill.ts is untouched
    Tool: Bash (jj diff)
    Preconditions: T4 changes complete
    Steps:
      1. Run jj diff --git src/backfill.ts
      2. Expect empty output (no changes)
    Expected Result: backfill.ts has zero modifications
    Failure Indicators: Any diff output for backfill.ts
    Evidence: .sisyphus/evidence/task-4-backfill-unchanged.txt

  Scenario: replication_state still works for backfill
    Tool: Bash (bun test)
    Preconditions: replication.ts changes complete
    Steps:
      1. Run bun test to verify no regressions
      2. Read replication.ts and verify backfill-related functions are preserved
    Expected Result: All tests pass, backfill functions intact
    Failure Indicators: Test failures related to replication state
    Evidence: .sisyphus/evidence/task-4-replication-state.txt
  ```

  **Evidence to Capture:**
  - [ ] task-4-backfill-unchanged.txt — jj diff output
  - [ ] task-4-replication-state.txt — test output

  **Commit**: YES (groups with T3)
  - Message: `refactor(postgres-sync): project bus events through hooks`
  - Files: `src/replication.ts`
  - Pre-commit: `bun test && bun typecheck`

- [x] 5. Delete consumer.ts + Purge SSE/HTTP Artifacts

  **What to do**:
  - Delete `src/consumer.ts`
  - Remove `serverUrl` from PluginOptions handling in index.ts (if not already removed in T3)
  - Remove any remaining references to:
    - `OPENCODE_SERVER_PASSWORD`
    - `OPENCODE_SERVER_USERNAME`
    - `OPENCODE_SHARED_DB`
    - `OPENCODE_SYNC_MACHINE`
    - `input.serverUrl`
    - `server` variable used for SSE URL
  - Remove any HTTP/fetch/SSE-related imports (Response, ReadableStream, etc.)
  - Remove the `open()` function and `parse()` function if they somehow survived
  - Check package.json for any SSE-related dependencies (unlikely but verify)

  **Must NOT do**:
  - Delete any file other than consumer.ts
  - Remove options.url or options.machine (these are NEEDED)
  - Touch test files (tests should already be updated in T2)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward file deletion and grep-driven cleanup
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (solo)
  - **Blocks**: T6, F1-F4
  - **Blocked By**: T3, T4

  **References**:

  **Pattern References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/consumer.ts` — File to delete
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/index.ts` — Check for remaining SSE references after T3

  **WHY Each Reference Matters**:
  - consumer.ts: Must be entirely removed
  - index.ts: Must verify T3 removed all consumer references; clean up any remainders

  **Acceptance Criteria**:
  - [ ] `src/consumer.ts` does not exist
  - [ ] `bun typecheck` -> PASS
  - [ ] `bun test` -> PASS
  - [ ] Zero grep matches for forbidden patterns (see QA scenarios)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: consumer.ts is deleted
    Tool: Bash (ls)
    Preconditions: T5 complete
    Steps:
      1. ls src/consumer.ts
      2. Expect "No such file or directory"
    Expected Result: File does not exist
    Failure Indicators: File still exists
    Evidence: .sisyphus/evidence/task-5-consumer-deleted.txt

  Scenario: No SSE/HTTP references remain in source
    Tool: Bash (grep)
    Preconditions: T5 cleanup complete
    Steps:
      1. grep -rn "serverUrl" src/ — expect 0 matches
      2. grep -rn "OPENCODE_SERVER_PASSWORD" src/ — expect 0 matches
      3. grep -rn "OPENCODE_SERVER_USERNAME" src/ — expect 0 matches
      4. grep -rn "OPENCODE_SHARED_DB" src/ — expect 0 matches
      5. grep -rn "OPENCODE_SYNC_MACHINE" src/ — expect 0 matches
      6. grep -rn "sync-event" src/ — expect 0 matches
      7. grep -rn "consumer" src/ — expect 0 matches in .ts files (excluding node_modules)
    Expected Result: 0 matches for all patterns
    Failure Indicators: Any match found
    Evidence: .sisyphus/evidence/task-5-no-sse-references.txt

  Scenario: Build still passes after deletion
    Tool: Bash (bun)
    Preconditions: consumer.ts deleted, all references removed
    Steps:
      1. Run bun typecheck from /home/ubuntu/opencode/opencode-postgres-sync
      2. Run bun test from /home/ubuntu/opencode/opencode-postgres-sync
    Expected Result: Both exit 0
    Failure Indicators: Type errors referencing consumer, import errors, test failures
    Evidence: .sisyphus/evidence/task-5-build-passes.txt
  ```

  **Evidence to Capture:**
  - [ ] task-5-consumer-deleted.txt — ls output
  - [ ] task-5-no-sse-references.txt — grep outputs
  - [ ] task-5-build-passes.txt — typecheck + test output

  **Commit**: YES
  - Message: `chore(postgres-sync): remove SSE consumer and obsolete config`
  - Files: `src/consumer.ts` (deleted), any remaining cleanup in `src/index.ts`
  - Pre-commit: `bun test && bun typecheck && bun run format`

- [x] 6. Full CI Verification + Dead Code Assertions

  **What to do**:
  - Run the full CI pipeline locally to match what GitHub Actions runs:
    1. `bun typecheck` (tsc --noEmit)
    2. `bun run format` (prettier --check .)
    3. `bun test` (all tests)
  - Verify dead code removal is complete:
    - Zero references to `consumer` in src/*.ts
    - Zero references to `serverUrl` in src/*.ts
    - Zero references to `OPENCODE_SERVER` in src/*.ts
    - Zero references to `sync-event` in src/*.ts
    - `src/consumer.ts` does not exist
  - Run a final read of all source files to ensure nothing was accidentally corrupted
  - Verify the plugin still has correct exports for OpenCode to load it
  - **Runtime verification** (no code changes — use `bun -e` inline): Run an inline script that imports the plugin's default export and verifies no HTTP code paths exist:
    - `bun -e "import p from './src/index.js'; console.log(typeof p.server)"` from the plugin directory — should print 'function' (verifies the module loads without error)
    - `grep -rn 'fetch\|new Request\|ReadableStream\|EventSource' src/` — expect 0 matches (confirms no HTTP code paths remain in source)

  **Must NOT do**:
  - Make code changes or add new files (this is verification only — use `bun -e` for inline checks)
  - Push to remote (just verify locally)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Running commands and checking output — no code changes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 5 (solo, after T5)
  - **Blocks**: F1-F4
  - **Blocked By**: T5

  **References**:

  **Pattern References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/.github/workflows/ci.yml` — CI pipeline definition showing exact commands
  - `/home/ubuntu/opencode/opencode-postgres-sync/package.json` — Script definitions

  **WHY Each Reference Matters**:
  - ci.yml: Must run the EXACT same commands CI runs
  - package.json: Script definitions may differ from raw commands

  **Acceptance Criteria**:
  - [ ] `bun typecheck` -> exit 0
  - [ ] `bun run format` -> exit 0
  - [ ] `bun test` -> all pass, 0 failures
  - [ ] All dead code assertions pass (zero grep matches)
  - [ ] Plugin exports are valid

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full CI pipeline passes locally
    Tool: Bash
    Preconditions: All prior tasks (T1-T5) complete
    Steps:
      1. cd /home/ubuntu/opencode/opencode-postgres-sync
      2. bun typecheck — capture exit code and output
      3. bun run format — capture exit code and output
      4. bun test — capture exit code and output
    Expected Result: All three commands exit 0
    Failure Indicators: Non-zero exit code, type errors, format violations, test failures
    Evidence: .sisyphus/evidence/task-6-ci-pipeline.txt

  Scenario: Dead code fully removed
    Tool: Bash (grep)
    Preconditions: T5 cleanup complete
    Steps:
      1. grep -rn "consumer" src/*.ts — expect 0
      2. grep -rn "serverUrl" src/*.ts — expect 0
      3. grep -rn "OPENCODE_SERVER" src/*.ts — expect 0
      4. grep -rn "sync-event" src/*.ts — expect 0
      5. ls src/consumer.ts — expect "No such file"
    Expected Result: All assertions pass
    Failure Indicators: Any grep match or file exists
    Evidence: .sisyphus/evidence/task-6-dead-code.txt

  Scenario: Plugin loads without HTTP connection attempts (runtime verification)
    Tool: Bash (bun -e)
    Preconditions: All source changes complete, T5 cleanup done, working directory /home/ubuntu/opencode/opencode-postgres-sync
    Steps:
      1. Run: bun -e "import p from './src/index.js'; console.log('server type:', typeof p.server); if (typeof p.server !== 'function') process.exit(1)"
      2. Expect exit 0 and output 'server type: function' (plugin module loads without import errors)
      3. Run: grep -rn 'fetch\|new Request\|ReadableStream\|EventSource' src/ — expect 0 matches (no HTTP code paths exist in source)
    Expected Result: Plugin module loads cleanly, typeof server is 'function', zero HTTP/fetch references in source
    Failure Indicators: Import error, server is not a function, or HTTP/fetch code found in source
    Evidence: .sisyphus/evidence/task-6-runtime-verification.txt
  ```

  **Evidence to Capture:**
  - [ ] task-6-ci-pipeline.txt — Full output of all three CI commands
  - [ ] task-6-dead-code.txt — All grep outputs
  - [ ] task-6-runtime-verification.txt — Plugin load test output + HTTP code grep

  **Commit**: NO (verification only — T5 already committed)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [x] F1. **Plan Compliance Audit** — `oracle`

  **What to do**: Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist. Compare deliverables against plan.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All Must Have items are implemented
    Tool: Bash (grep + read)
    Preconditions: All T1-T6 tasks complete, working directory /home/ubuntu/opencode/opencode-postgres-sync
    Steps:
      1. grep -n "session.created" src/projectors.ts — verify bus event projection exists
      2. grep -n "session.updated" src/projectors.ts — verify bus event projection exists
      3. grep -n "session.deleted" src/projectors.ts — verify bus event projection exists
      4. grep -n "message" src/projectors.ts — verify message event projection exists
      5. grep -n "todo.updated" src/index.ts — verify todo sync in hooks.event()
      6. grep -n "session.status" src/index.ts — verify checkpoint trigger
      7. grep -n "setInterval" src/index.ts — verify 30s metadata timer exists
      8. grep -n "options.url" src/index.ts — verify PluginOptions config usage
      9. Run bun test — verify backfill still works (test suite should pass)
    Expected Result: All 9 grep patterns found, bun test passes
    Failure Indicators: Any Must Have item missing from implementation
    Evidence: .sisyphus/evidence/f1-must-have-audit.txt

  Scenario: All Must NOT Have items are absent
    Tool: Bash (grep)
    Preconditions: Working directory /home/ubuntu/opencode/opencode-postgres-sync
    Steps:
      1. grep -rn "OPENCODE_SERVER_PASSWORD" src/ — expect 0 matches
      2. grep -rn "OPENCODE_SERVER_USERNAME" src/ — expect 0 matches
      3. grep -rn "OPENCODE_SHARED_DB" src/ — expect 0 matches
      4. grep -rn "OPENCODE_SYNC_MACHINE" src/ — expect 0 matches
      5. grep -rn "serverUrl" src/ — expect 0 matches
      6. grep -rn "sync-event" src/ — expect 0 matches
      7. grep -rn "pty\|permission\|question\|lsp\|mcp\|tui" src/projectors.ts — expect 0 matches for unrelated events
      8. ls src/consumer.ts — expect "No such file"
      9. Run from core repo: ls /home/ubuntu/opencode/db/packages/opencode/src/ to verify it exists, then run `jj diff --git` from /home/ubuntu/opencode/db to verify no core files were modified by this work — expect 0 changes in packages/opencode/
    Expected Result: 0 grep matches for all forbidden patterns, no core changes
    Failure Indicators: Any forbidden pattern found
    Evidence: .sisyphus/evidence/f1-must-not-have-audit.txt

  Scenario: All evidence files exist
    Tool: Bash (ls)
    Preconditions: All tasks complete
    Steps:
      1. ls .sisyphus/evidence/task-1-*.md — expect 2 files
      2. ls .sisyphus/evidence/task-2-*.txt — expect 3 files
      3. ls .sisyphus/evidence/task-3-*.txt — expect 3 files
      4. ls .sisyphus/evidence/task-4-*.txt — expect 2 files
      5. ls .sisyphus/evidence/task-5-*.txt — expect 3 files
      6. ls .sisyphus/evidence/task-6-*.txt — expect 3 files
    Expected Result: All 17 evidence files present
    Failure Indicators: Any evidence file missing
    Evidence: .sisyphus/evidence/f1-evidence-audit.txt
  ```

  Output: `Must Have [N/N] | Must NOT Have [N/N] | Evidence [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`

  **What to do**: Run full CI pipeline and review all changed files for quality issues.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CI pipeline passes
    Tool: Bash
    Preconditions: Working directory /home/ubuntu/opencode/opencode-postgres-sync
    Steps:
      1. bun typecheck — capture exit code
      2. bun run format — capture exit code
      3. bun test — capture exit code and test count
    Expected Result: All three exit 0, test count >= 15 (original) + new tests
    Failure Indicators: Non-zero exit code
    Evidence: .sisyphus/evidence/f2-ci-pipeline.txt

  Scenario: No quality anti-patterns in changed files
    Tool: Bash (grep)
    Preconditions: Working directory /home/ubuntu/opencode/opencode-postgres-sync
    Steps:
      1. grep -rn "as any" src/projectors.ts src/index.ts — count matches
      2. grep -rn "@ts-ignore\|@ts-expect-error" src/projectors.ts src/index.ts — expect 0
      3. grep -rn "console\.log\|console\.warn\|console\.error" src/projectors.ts src/index.ts — expect 0 (should use log.ts)
      4. grep -rn "TODO\|FIXME\|HACK" src/projectors.ts src/index.ts — document any found
      5. Read src/projectors.ts and src/index.ts — check for excessive comments, over-abstraction, unused imports
    Expected Result: 0 ts-ignore, 0 console.log, minimal as-any usage
    Failure Indicators: ts-ignore present, console.log in prod code, excessive AI slop
    Evidence: .sisyphus/evidence/f2-quality-review.txt
  ```

  Output: `Build [PASS/FAIL] | Format [PASS/FAIL] | Tests [N pass/N fail] | Quality [CLEAN/N issues] | VERDICT`

- [x] F3. **Real QA Execution** — `unspecified-high`

  **What to do**: Execute every QA scenario from every task, plus cross-task integration and edge cases.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Re-execute all task QA scenarios
    Tool: Bash
    Preconditions: Working directory /home/ubuntu/opencode/opencode-postgres-sync, all T1-T6 complete
    Steps:
      1. Re-run T2 scenario: bun test src/projectors.test.ts — verify all pass
      2. Re-run T2 scenario: grep -n 'created\.1\|updated\.1\|removed\.1\|deleted\.1' src/projectors.ts — expect 0
      3. Re-run T3 scenario: grep -n "consumer" src/index.ts — expect 0
      4. Re-run T5 scenario: ls src/consumer.ts — expect "No such file"
      5. Re-run T5 scenario: grep -rn "serverUrl" src/ — expect 0
      6. Re-run T6 scenario: bun typecheck && bun run format && bun test — all exit 0
    Expected Result: All scenarios reproduce the expected results
    Failure Indicators: Any scenario fails on re-execution
    Evidence: .sisyphus/evidence/f3-scenario-rerun.txt

  Scenario: Cross-task integration — events flow hooks to projectors to Postgres
    Tool: Bash (bun test)
    Preconditions: Plugin code complete
    Steps:
      1. Run bun test — verify integration tests exist that cover hooks.event() calling replay()
      2. Read src/index.ts hooks.event() — verify it imports and calls replay() from projectors.ts
      3. Read src/projectors.ts replay() — verify it handles all required bus event types
      4. Trace data flow: hooks.event() receives { type, properties } -> calls replay() -> replay() switches on type -> projector writes to Postgres
    Expected Result: Complete data flow from bus event to Postgres write with no gaps
    Failure Indicators: Any event type not routed, replay() not called, import missing
    Evidence: .sisyphus/evidence/f3-integration-trace.txt

  Scenario: Edge cases — error handling
    Tool: Bash (grep + read)
    Preconditions: Plugin code complete, working directory /home/ubuntu/opencode/opencode-postgres-sync
    Steps:
      1. grep -n 'try\|catch' src/index.ts — verify try/catch around replay() calls in hooks.event()
      2. Read the hooks.event() handler and verify unknown event types hit a default/else path that returns without throwing
      3. grep -n 'try\|catch' src/index.ts and count — verify existing graceful failure patterns (timeout wrappers, try/catch) are preserved from the original implementation
      4. Verify the plugin init code has try/catch around Postgres connection (this was an existing pattern per the handoff — confirm it's still present)
    Expected Result: try/catch present around replay() calls, unknown events silently ignored, Postgres connection wrapped in try/catch
    Failure Indicators: Missing try/catch around replay(), unknown events throw, Postgres init not wrapped
    Evidence: .sisyphus/evidence/f3-error-handling.txt
  ```

  Output: `Scenarios [N/N pass] | Integration [PASS/FAIL] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`

  **What to do**: Verify each task's implementation matches its spec exactly — nothing missing, nothing extra.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Each task's deliverables match its spec
    Tool: Bash (jj diff + read)
    Preconditions: All tasks complete
    Steps:
      1. Run jj diff --git to see all changes
      2. For T2: verify projectors.ts and projectors.test.ts are the only changed files
      3. For T3: verify index.ts is changed, consumer import removed, hooks.event() routes all events
      4. For T4: verify replication.ts changes if any, backfill.ts unchanged
      5. For T5: verify consumer.ts deleted, no other files unexpectedly deleted
      6. Run from core repo (/home/ubuntu/opencode/db): `jj diff --git -- packages/opencode/` — verify no changes in core (must be untouched)
    Expected Result: All changes match task specs, no unaccounted files
    Failure Indicators: Unexpected file changes, core OpenCode modifications, missing deliverables
    Evidence: .sisyphus/evidence/f4-scope-check.txt

  Scenario: Must NOT do compliance
    Tool: Bash (grep + jj diff)
    Preconditions: All tasks complete
    Steps:
      1. Run from core repo (/home/ubuntu/opencode/db): `jj diff --git -- packages/opencode/` — expect empty (no core changes)
      2. grep -rn "pty\|file\.edited\|permission\|question\|lsp" src/projectors.ts — expect 0 (no unrelated events)
      3. jj diff --git -- src/schema.ts — expect empty (no schema changes, unless T1 documented necessity)
      4. Read package.json diff — expect no new dependencies
    Expected Result: All Must NOT Have constraints respected
    Failure Indicators: Any forbidden change detected
    Evidence: .sisyphus/evidence/f4-must-not-do.txt

  Scenario: No cross-task contamination
    Tool: Bash (jj log + read)
    Preconditions: All commits made per Commit Strategy
    Steps:
      1. Review each commit's changed files against Commit Strategy table
      2. Verify T2 commit only touches projectors.ts + projectors.test.ts
      3. Verify T3+T4 commit only touches index.ts + replication.ts
      4. Verify T5 commit only deletes consumer.ts + minor index.ts cleanup
    Expected Result: Each commit's file scope matches the plan
    Failure Indicators: Task N's commit modifies files belonging to Task M
    Evidence: .sisyphus/evidence/f4-contamination-check.txt
  ```

  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Step        | Message                                                         | Files                                                     | Pre-commit                                    |
| ----------- | --------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| After T2    | `test(postgres-sync): codify bus event projector contract`      | projectors.ts, projectors.test.ts                         | `bun test && bun typecheck`                   |
| After T3+T4 | `refactor(postgres-sync): project bus events through hooks`     | index.ts, replication.ts                                  | `bun test && bun typecheck`                   |
| After T5    | `chore(postgres-sync): remove SSE consumer and obsolete config` | consumer.ts (deleted), index.ts, package.json (if needed) | `bun test && bun typecheck && bun run format` |

All commits use jj:

```
jj describe -m "message"
jj new
```

---

## Success Criteria

### Verification Commands

```bash
# From /home/ubuntu/opencode/opencode-postgres-sync
bun test                    # Expected: all tests pass (existing + new)
bun typecheck               # Expected: exit 0
bun run format              # Expected: exit 0 (prettier check)
grep -r "consumer" src/     # Expected: 0 matches
grep -r "serverUrl" src/    # Expected: 0 matches
grep -r "OPENCODE_SERVER" src/ # Expected: 0 matches
ls src/consumer.ts          # Expected: No such file
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Plugin loads without HTTP connection attempts
- [ ] Backfill still works on startup
- [ ] Metadata sync timer runs on 30s interval
- [ ] Todo sync and checkpoint trigger still work via hooks
