# SQLite DB Sharding v2 — Harden + Write Serializer + Ship

## TL;DR

> **Quick Summary**: The per-session sharding and all 5 council-confirmed bug fixes are already implemented on `feat/session-sharding-resume-hooks`. Remaining work: harden with pragma optimizations and a global DB write serializer (retry + higher timeout), verify routing consistency, load test at 20+ agents, and ship.
>
> **Deliverables**:
>
> - SQLite pragma optimizations (mmap, temp_store, differentiated busy_timeout)
> - Global DB write hardening (SQLITE_BUSY retry with backoff + jitter, higher timeout)
> - Routing consistency test suite (read/write symmetry verification)
> - Concurrency load test proving zero SQLITE_BUSY at 20+ agents
> - WAL health monitoring
> - Sibling repo vendor verification
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 (pragmas) → Task 4 (write serializer) → Task 5 (load test) → F1-F4

---

## Context

### Original Request

Relieve SQLite DB contention at high concurrency (20+ agents). A previous per-session sharding attempt was rolled back due to routing bugs.

### Interview Summary

**Key Discussions**:

- **Contention symptoms**: SQLITE_BUSY errors, slow writes under load, serve endpoint timeouts at 20+ concurrent agents
- **Root cause**: SQLite WAL is single-writer. 20+ agents competing for one write lock on `opencode.db`
- **Previous sharding**: Per-session DBs for message/part/todo data — architecturally correct, reduces per-DB concurrency from 20+ to 2-5

**Research Findings**:

- SQLite single-writer is fundamental — WAL does NOT help with write concurrency
- Per-entity sharding is consensus production pattern (Turso, D1, Cloudflare)
- BEGIN IMMEDIATE is correct (DEFERRED causes SQLITE_BUSY_SNAPSHOT bypassing timeout)
- SQLite 3.51.3 fixes WAL-reset race — must verify version
- Application-level retry with jitter = best strategy for remaining contention

### Metis Review

**Identified Gaps** (addressed):

- Must verify SQLite ≥ 3.51.3 → Task 1
- Write serializer must be staged: FIFO first, coalescing deferred → Task 4
- Synchronous API must be preserved → guardrail
- Missing WAL health criteria → Task 6
- Checkpoint policy: monitoring only, no rewrite → guardrail

### What's Already Done on This Branch (Momus-Verified)

**ALL council fixes are implemented:**

- ✅ Per-session database sharding (`session()`, `hasSession()`, `sessionRoot()`, `resolveSession()`)
- ✅ Event routing (`root()`, `transact()` in sync/index.ts)
- ✅ Read/write routing symmetry (`resolve()` in message-v2.ts and todo.ts)
- ✅ **#2: Parent-chain walking** — `sessionRoot()` walks `parent_id` chain with cycle detection (db.ts:252-276)
- ✅ **#5: Persistent machine-id** — file-backed UUID in `util/machine.ts` with atomic write + cache
- ✅ **#1: Dead replay() deleted** — sibling projectors.ts is clean (547 lines, no dead function)
- ✅ **#4: Upsert refresh** — `INSERT OR REPLACE` + orphan cleanup already in sibling local.ts
- ✅ **#6: Silent catch fixed** — `log.warn` added (db.ts:202-203)
- ✅ Foreign-machine detection (revert.ts)
- ✅ Routing tests (resolve-routing.test.ts — 248 lines)

**NOT DONE** (this plan):

- ❌ SQLite version check + pragma optimization
- ❌ Routing consistency audit (write-then-read symmetry tests)
- ❌ Sibling vendor verification (ensure vendored dist matches source)
- ❌ Global DB write hardening (retry + higher timeout)
- ❌ Concurrency load test at 20+ agents
- ❌ WAL health monitoring

---

## Work Objectives

### Core Objective

Harden the existing per-session sharding with pragma optimizations, a global DB write serializer, and verify under 20+ agent concurrent load.

### Concrete Deliverables

- Optimized SQLite pragmas (mmap, temp_store, differentiated busy_timeout)
- SQLITE_BUSY retry with exponential backoff + jitter for global DB
- Routing consistency test suite
- Load test proving zero SQLITE_BUSY at 20+ concurrent agents
- WAL health monitoring
- Verified vendor of sibling repo

### Definition of Done

- [ ] `bun test` passes in `packages/opencode` — zero failures
- [ ] `bun test` passes in sibling repo — zero failures
- [ ] Load test: 20+ concurrent agents, zero SQLITE_BUSY errors over 5 minutes
- [ ] WAL file stays below 100MB during load test
- [ ] `bun typecheck` passes in `packages/opencode`

### Must Have

- SQLite ≥ 3.51.3 verified at startup (WAL-reset race fix)
- Global DB `busy_timeout` higher than shard DBs
- Application-level SQLITE_BUSY retry with backoff + jitter
- Every read/write path pair verified in routing consistency tests
- Load test at 20+ concurrent agents with zero SQLITE_BUSY
- WAL size monitoring with warning threshold

### Must NOT Have (Guardrails)

- **No async API changes** — `Database.transaction()` and `Database.use()` remain synchronous
- **No write coalescing/batching** — stage 2 optimization, not in this plan
- **No checkpoint subsystem rewrite** — monitoring only
- **No per-shard write queues** — shards have low enough concurrency (2-5)
- **No generic async job runtime**
- **No changes to existing routing logic** — it's verified working; this plan adds tests and hardening only

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision

- **Infrastructure exists**: YES (`bun:test`)
- **Automated tests**: TDD
- **Framework**: `bun:test`

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — 3 parallel tasks, start immediately):
├── Task 1: SQLite version check + pragma optimization [quick]
├── Task 2: Routing consistency audit + gap tests [deep]
├── Task 3: Verify sibling vendor matches source [quick]

Wave 2 (Write Serializer — after Wave 1):
├── Task 4: Global DB write hardening (retry + higher timeout) [deep] (depends: 1)

Wave 3 (Load Test + Monitoring — after Wave 2):
├── Task 5: Concurrency load test at 20+ agents [deep] (depends: 2, 4)
├── Task 6: WAL health monitoring + metrics [quick] (depends: 4)

Wave FINAL (4 parallel reviews, then user okay):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real QA — full scenario execution (unspecified-high)
├── F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
| ---- | ---------- | ------ | ---- |
| 1    | —          | 4      | 1    |
| 2    | —          | 5      | 1    |
| 3    | —          | —      | 1    |
| 4    | 1          | 5, 6   | 2    |
| 5    | 2, 4       | F1-F4  | 3    |
| 6    | 4          | F1-F4  | 3    |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks — T1 → `quick`, T2 → `deep`, T3 → `quick`
- **Wave 2**: 1 task — T4 → `deep`
- **Wave 3**: 2 tasks — T5 → `deep`, T6 → `quick`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. SQLite Version Check + Pragma Optimization

  **What to do**:
  - Check the Bun-bundled SQLite version: run `bun -e "import {Database} from 'bun:sqlite'; const db = new Database(':memory:'); console.log(db.query('SELECT sqlite_version()').get())"` and verify ≥ 3.51.3
  - If < 3.51.3, add a startup warning: `log.warn("SQLite < 3.51.3 — WAL-reset race possible")`
  - Audit current pragmas in `Database.pragma()` (db.ts:144-151). Current: WAL, synchronous=NORMAL, busy_timeout=5000, cache_size=-64000, foreign_keys=ON, wal_checkpoint(PASSIVE)
  - Add `PRAGMA mmap_size = 134217728` (128MB memory-mapped I/O — reduces syscalls)
  - Add `PRAGMA temp_store = MEMORY` (temp tables in memory)
  - Write a test that asserts pragma values match expected configuration
  - **Differentiate global vs shard pragmas**: Create a separate `pragma` call for global DB with `busy_timeout = 10000` (10s), keep shards at 5000 (5s). Global session events are less latency-critical; higher timeout prevents SQLITE_BUSY under contention.

  **Must NOT do**:
  - Do NOT change `synchronous` mode
  - Do NOT disable `foreign_keys`
  - Do NOT change transaction behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/storage/db.ts:144-151` — current `pragma()` function
  - `packages/opencode/src/storage/db.ts:175-207` — `Client()` initialization (global DB)
  - `packages/opencode/src/storage/db.ts:211-232` — `session()` initialization (shard DBs)

  **Acceptance Criteria**:
  - [ ] SQLite version checked and logged at startup
  - [ ] `mmap_size` and `temp_store` pragmas added
  - [ ] Global DB `busy_timeout = 10000`, shard DBs `busy_timeout = 5000`
  - [ ] Pragma test verifies all expected values
  - [ ] `bun test` passes

  **QA Scenarios:**

  ```
  Scenario: Differentiated busy_timeout
    Tool: Bash (bun test)
    Steps:
      1. Open global DB via Database.Client()
      2. Query PRAGMA busy_timeout — assert 10000
      3. Open shard DB via Database.session("test-session")
      4. Query PRAGMA busy_timeout — assert 5000
    Expected Result: Different timeouts for global vs shard
    Evidence: .sisyphus/evidence/task-1-pragma-check.txt

  Scenario: SQLite version check
    Tool: Bash
    Steps:
      1. Run bun -e to get sqlite_version()
      2. Assert >= 3.51.3 (or warning logged)
    Expected Result: Version confirmed or warning emitted
    Evidence: .sisyphus/evidence/task-1-sqlite-version.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `fix(db): pragma optimizations and differentiated busy_timeout`
  - Files: `packages/opencode/src/storage/db.ts`, new pragma test

---

- [ ] 2. Routing Consistency Audit + Gap Tests

  **What to do**:
  - Audit ALL read and write paths to verify they resolve to the same DB for the same session
  - Read paths: `resolve()` in message-v2.ts, `resolve()` in todo.ts, any `Database.resolveSession()` call
  - Write paths: `root()` in sync/index.ts:105, `transact()` in sync/index.ts:133
  - For each event type, trace: does the write go to the same DB the read queries?
  - Add tests for each pair:
    - Write message via `SyncEvent.run(MessageV2.Event.Updated, ...)` → read via `MessageV2.get({ sessionID, messageID })` → assert same data
    - Write todo via `Todo.update(sessionID, todos)` → read via `Todo.get(sessionID)` → assert consistency
  - Add test for cold-cache: close all DB connections (`Database.close()`), re-read — verify data found
  - Add test for non-sharded session: verify both read and write use global DB
  - Add test for the exact scenario that caused the infinite loop: write to sharded session, immediately read back

  **Must NOT do**:
  - Do NOT modify any routing logic (verification-only task)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/session/message-v2.ts` — read `resolve()` (search for `resolveSession`)
  - `packages/opencode/src/session/todo.ts` — read `resolve()` (search for `resolveSession`)
  - `packages/opencode/src/sync/index.ts:105-113` — write `root()`
  - `packages/opencode/src/sync/index.ts:133-144` — write `transact()`
  - `packages/opencode/test/session/resolve-routing.test.ts` — existing tests to extend

  **Acceptance Criteria**:
  - [ ] Every read/write path pair verified in tests
  - [ ] Cold-cache re-resolution test passes
  - [ ] Non-sharded session test passes
  - [ ] Write-then-immediate-read test passes (the infinite-loop scenario)
  - [ ] `bun test test/session/resolve-routing.test.ts` passes

  **QA Scenarios:**

  ```
  Scenario: Write-then-read consistency for sharded session
    Tool: Bash (bun test)
    Steps:
      1. Create session with shard via Database.session(id)
      2. Write message via SyncEvent.run(MessageV2.Event.Updated, {sessionID: id, ...})
      3. Read via MessageV2.get({ sessionID: id, messageID })
      4. Assert message data matches what was written
    Expected Result: Read returns what was written (same DB)
    Evidence: .sisyphus/evidence/task-2-write-read-consistency.txt

  Scenario: Todo write-then-read consistency
    Tool: Bash (bun test)
    Steps:
      1. Create session with shard
      2. Write todos via Todo.update(sessionID, todos)
      3. Read via Todo.get(sessionID)
      4. Assert todos match what was written
    Expected Result: Todos roundtrip through same shard DB
    Evidence: .sisyphus/evidence/task-2-todo-consistency.txt

  Scenario: Non-sharded session uses global DB
    Tool: Bash (bun test)
    Steps:
      1. Create session WITHOUT shard (no sessions/{id}.db file)
      2. Write message via SyncEvent.run(MessageV2.Event.Updated, ...)
      3. Read via MessageV2.get({ sessionID, messageID })
      4. Assert both operations used global DB (data roundtrips)
    Expected Result: Non-sharded sessions unaffected by sharding code
    Evidence: .sisyphus/evidence/task-2-non-sharded-consistency.txt

  Scenario: Cold-cache recovery
    Tool: Bash (bun test)
    Steps:
      1. Write data to sharded session
      2. Call Database.close() to clear all caches
      3. Read data back via MessageV2.get({ sessionID, messageID })
      4. Assert data found (shard re-discovered from disk)
    Expected Result: Data survives cache eviction
    Evidence: .sisyphus/evidence/task-2-cold-cache.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `test(db): routing consistency audit for read/write symmetry`
  - Files: `packages/opencode/test/session/resolve-routing.test.ts`

---

- [ ] 3. Verify Sibling Vendor Matches Source

  **What to do**:
  - Compare the vendored dist (`packages/opencode-postgres-sync/dist/`) against a fresh build of the sibling source (`/home/ubuntu/opencode/opencode-postgres-sync/`)
  - Steps:
    1. `bun test` in sibling repo — verify all pass
    2. `bun run build` in sibling repo — fresh build
    3. Diff the fresh build against the vendored dist
    4. If different: copy fresh dist to vendor location
    5. If same: no changes needed (mark as verified)
  - This ensures the vendored plugin matches all the fixes already applied to the sibling source

  **Must NOT do**:
  - Do NOT manually publish to npm
  - Do NOT edit the vendored dist directly
  - Do NOT make source changes (source is already fixed)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/` — sibling repo root
  - `packages/opencode-postgres-sync/dist/` — vendored output
  - `.sisyphus/plans/cross-machine-forking.md:22-39` — repository layout

  **Acceptance Criteria**:
  - [ ] `bun test` passes in sibling repo
  - [ ] `bun run build` succeeds in sibling repo
  - [ ] Vendored dist matches fresh build (or updated to match)

  **QA Scenarios:**

  ```
  Scenario: Vendor verification
    Tool: Bash
    Steps:
      1. Run bun test in sibling repo
      2. Run bun run build in sibling repo
      3. Diff fresh build against packages/opencode-postgres-sync/dist/
      4. If diff: copy and report. If same: report "vendor current"
    Expected Result: Vendor matches source or is updated
    Evidence: .sisyphus/evidence/task-3-vendor-verify.txt
  ```

  **Commit**: YES (only if vendor updated)
  - Message: `chore(vendor): rebuild postgres-sync plugin`
  - Files: `packages/opencode-postgres-sync/dist/*`

---

- [ ] 4. Global DB Write Hardening (Retry + Higher Timeout)

  **What to do**:
  - The global DB still receives session.created/updated/deleted events from 20+ agents
  - Per-session sharding eliminated 90%+ of contention, but session events still serialize on global
  - Add application-level SQLITE_BUSY retry with exponential backoff + jitter:
    - Wrap the `transact()` call in sync/index.ts (or `Database.transaction()` in db.ts) with retry logic
    - Max 3 retries: 50ms, 200ms, 800ms base delays with ±25% jitter
    - Log each retry with `log.warn("sqlite.busy.retry", { attempt, delay, type, aggregate })`
    - If all retries exhausted: throw original error (let caller handle)
  - The global DB already gets `busy_timeout = 10000` from Task 1, so SQLite itself retries for 10s. The application-level retry catches cases where SQLite's retry is insufficient or returns SQLITE_BUSY_SNAPSHOT.
  - Add metrics: counter for global writes, retries, exhausted retries
  - **Where to add retry**: In `Database.transaction()` — add a wrapper that detects SQLITE_BUSY errors and retries. Only for the global DB path (not for shards, which use the same function but through `Database.session(id).transaction()`).

  **Must NOT do**:
  - Do NOT make `Database.transaction()` or `Database.use()` async
  - Do NOT implement write coalescing/batching (stage 2)
  - Do NOT add per-shard retry (shards have 2-5 concurrent writers — not needed)
  - Do NOT change checkpoint behavior
  - Do NOT build a generic queue/scheduler

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1 for pragma context)
  - **Parallel Group**: Wave 2 (solo)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: Task 1

  **References**:
  - `packages/opencode/src/storage/db.ts:330-348` — `Database.transaction()` current implementation
  - `packages/opencode/src/storage/db.ts:305-317` — `Database.use()` current implementation
  - `packages/opencode/src/sync/index.ts:133-144` — `transact()` routes to global or shard
  - `packages/opencode/src/sync/index.ts:198-203` — `process()` calls `transact` then `Database.effect`
  - Librarian research: exponential backoff with jitter is canonical for SQLITE_BUSY

  **Acceptance Criteria**:
  - [ ] SQLITE_BUSY retry logic added to global DB write path
  - [ ] Retry uses exponential backoff (50ms, 200ms, 800ms) with ±25% jitter
  - [ ] Each retry logged with `log.warn`
  - [ ] Exhausted retries re-throw original error
  - [ ] Global write counter and retry counter tracked
  - [ ] Test: simulated SQLITE_BUSY triggers retry and eventual success
  - [ ] `bun test` passes

  **QA Scenarios:**

  ```
  Scenario: SQLITE_BUSY retry with backoff
    Tool: Bash (bun test)
    Steps:
      1. Acquire exclusive lock on global DB from separate SQLite connection (BEGIN EXCLUSIVE)
      2. Attempt write via Database.transaction() in a short-timeout test
      3. Assert retries occur (check for log.warn output)
      4. Release lock, verify write eventually succeeds on retry
    Expected Result: Retries with backoff, eventual success after lock release
    Evidence: .sisyphus/evidence/task-4-retry-backoff.txt

  Scenario: Shard writes do NOT retry (no overhead)
    Tool: Bash (bun test)
    Steps:
      1. Write to a shard DB
      2. Verify no retry wrapper is invoked (shard path skips retry)
    Expected Result: Shard writes go directly without retry overhead
    Evidence: .sisyphus/evidence/task-4-shard-no-retry.txt
  ```

  **Commit**: YES (Wave 2)
  - Message: `feat(db): SQLITE_BUSY retry with backoff for global DB writes`
  - Files: `packages/opencode/src/storage/db.ts`

---

- [ ] 5. Concurrency Load Test at 20+ Agents

  **What to do**:
  - Write a load test simulating 20+ concurrent agents writing simultaneously
  - **Concurrency mechanism**: Use `Bun.spawn()` to launch 20+ separate worker processes, each running a test script that performs DB operations. This creates real cross-process SQLite contention (the actual production failure mode). A single-process `Promise.all` would NOT create contention because JS is single-threaded and sync SQLite calls serialize naturally.
  - Alternatively, use `worker_threads` (Bun supports them) to create genuine parallel SQLite access within one test process
  - Each agent/worker should:
    1. Open the same global DB and its own session shard
    2. Create a session (global DB write — `SyncEvent.run(Session.Event.Created, ...)`)
    3. Write 50+ messages with parts to the shard
    4. Update session metadata 10 times (global DB write — `SyncEvent.run(Session.Event.Updated, ...)`)
  - Collect results from all workers (exit codes, error counts, timing)
  - Assert: zero SQLITE_BUSY errors across all workers
  - Assert: WAL file stays below 100MB
  - Measure and log: p50, p95, p99 write latency
  - Test two scenarios:
    a. 20 workers, each with own session (sharded — should be fast)
    b. 20 workers all firing session.updated on global DB (stress remaining contention)

  **Must NOT do**:
  - Do NOT use mocks — test against real SQLite files
  - Do NOT run from repo root
  - Do NOT set artificial timeouts shorter than busy_timeout

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 3, parallel with Task 6)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 2, 4

  **References**:
  - `packages/opencode/src/storage/db.ts` — Database API under test
  - `packages/opencode/src/sync/index.ts` — SyncEvent.run() for writes
  - `packages/opencode/src/session/message-v2.ts` — MessageV2 events
  - `packages/opencode/test/session/resolve-routing.test.ts` — pattern for test setup

  **Acceptance Criteria**:
  - [ ] 20+ concurrent agents simulated
  - [ ] Zero SQLITE_BUSY errors across all agents
  - [ ] Zero SQLITE_BUSY_SNAPSHOT errors
  - [ ] WAL file < 100MB during test
  - [ ] p99 write latency < 5000ms for shard writes
  - [ ] p99 write latency < 10000ms for global writes
  - [ ] Throughput numbers logged

  **QA Scenarios:**

  ```
  Scenario: 20 worker processes, sharded, zero SQLITE_BUSY
    Tool: Bash (bun test)
    Steps:
      1. Spawn 20 child processes via Bun.spawn() or worker_threads
      2. Each worker opens global DB + its own session shard
      3. Each creates a session (global write) and writes 50 messages (shard writes)
      4. Parent collects exit codes and stderr from all workers
      5. Assert zero SQLITE_BUSY in any worker output
    Expected Result: All 20 workers complete with exit code 0, no SQLITE_BUSY
    Failure Indicators: Any worker exits non-zero or stderr contains SQLITE_BUSY
    Evidence: .sisyphus/evidence/task-5-load-test-sharded.txt

  Scenario: 20 worker processes hammering global DB with session.updated
    Tool: Bash (bun test)
    Steps:
      1. Spawn 20 child processes, all targeting the same global DB
      2. Each worker fires 100 SyncEvent.run(Session.Event.Updated) on global DB
      3. Parent collects timing data (write latency per event) and error counts
      4. Assert zero SQLITE_BUSY (retries should absorb all contention)
      5. Parse timing data, compute p50/p95/p99
      6. Assert p99 < 10000ms (within global busy_timeout)
    Expected Result: All writes succeed (via retry), p99 < 10s
    Failure Indicators: Any SQLITE_BUSY after retry exhaustion, p99 > 10s
    Evidence: .sisyphus/evidence/task-5-load-test-global.txt
  ```

  **Commit**: YES (Wave 3)
  - Message: `test(db): concurrency load test proving zero SQLITE_BUSY at 20+ agents`
  - Files: `packages/opencode/test/session/concurrency-load.test.ts`

---

- [ ] 6. WAL Health Monitoring + Metrics

  **What to do**:
  - Add WAL file size monitoring: check WAL size periodically and log if > 50MB
  - Piggyback on existing idle sweep timer (db.ts:164-173) — add WAL size check every 60s
  - Monitor checkpoint return values: after `PRAGMA wal_checkpoint(PASSIVE)`, check (blocked, wal_pages, checkpointed_pages)
  - If checkpoint incomplete (checkpointed < wal), log warning
  - Add global write metrics to the retry wrapper from Task 4:
    - `db.global.writes`: total count
    - `db.global.retries`: SQLITE_BUSY retry count
    - `db.global.busy_errors`: retries exhausted (should be 0)
  - Emit these as `log.info("db.metrics", { ... })` periodically

  **Must NOT do**:
  - Do NOT rewrite checkpoint subsystem
  - Do NOT add a metrics collection framework
  - Do NOT change checkpoint frequency or mode
  - Do NOT add per-shard monitoring

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 3, parallel with Task 5)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Task 4

  **References**:
  - `packages/opencode/src/storage/db.ts:144-151` — pragma() where checkpoint runs
  - `packages/opencode/src/storage/db.ts:163-173` — idle sweep timer
  - SQLite docs: PRAGMA wal_checkpoint return values

  **Acceptance Criteria**:
  - [ ] WAL size logged periodically
  - [ ] Checkpoint return values checked and warned on issues
  - [ ] Global write/retry metrics logged
  - [ ] `bun test` passes

  **QA Scenarios:**

  ```
  Scenario: WAL size monitoring active
    Tool: Bash (bun test)
    Steps:
      1. Create global DB, write enough data to grow WAL (100+ events)
      2. Trigger the monitoring timer callback
      3. Capture log output
      4. Assert log contains "wal.size" with a bytes value > 0
    Expected Result: WAL size logged with numeric bytes
    Evidence: .sisyphus/evidence/task-6-wal-monitoring.txt

  Scenario: Checkpoint return values logged and warned
    Tool: Bash (bun test)
    Steps:
      1. Create global DB with active WAL (write data)
      2. Trigger checkpoint via PRAGMA wal_checkpoint(PASSIVE)
      3. Capture return values (blocked, wal_pages, checkpointed_pages)
      4. If wal_pages > checkpointed_pages, assert log.warn emitted
      5. If checkpoint complete, assert log.info with success metrics
    Expected Result: Checkpoint results inspected and logged appropriately
    Evidence: .sisyphus/evidence/task-6-checkpoint-monitoring.txt

  Scenario: Global write metrics emitted
    Tool: Bash (bun test)
    Steps:
      1. Perform 10 global DB writes via Database.transaction()
      2. Trigger metrics emission
      3. Assert log output contains db.global.writes >= 10
      4. Assert log output contains db.global.retries (value >= 0)
      5. Assert log output contains db.global.busy_errors = 0
    Expected Result: All three metric counters present in log output
    Evidence: .sisyphus/evidence/task-6-write-metrics.txt
  ```

  **Commit**: YES (Wave 3)
  - Message: `feat(db): WAL health monitoring and global write metrics`
  - Files: `packages/opencode/src/storage/db.ts`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `bun typecheck` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
      Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
      Start from clean state. Execute EVERY QA scenario from EVERY task. Test cross-task integration. Test edge cases: empty state, invalid input, concurrent access. Save to `.sisyphus/evidence/final-qa/`.
      Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual diff (`jj diff`). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Flag unaccounted changes.
      Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

Uses jj (not git). Each wave gets a describe + new:

- Wave 1: `jj describe -m "fix(db): pragma optimizations, routing tests, vendor verify"` then `jj new`
- Wave 2: `jj describe -m "feat(db): SQLITE_BUSY retry with backoff for global writes"` then `jj new`
- Wave 3: `jj describe -m "test(db): load test + WAL monitoring"` then `jj new`

---

## Success Criteria

### Verification Commands

```bash
# From packages/opencode:
bun test                          # All tests pass
bun typecheck                     # No type errors

# From sibling repo:
bun test                          # All tests pass
bun run build                     # Clean build

# Load test:
bun test test/session/concurrency-load.test.ts  # 20+ concurrent, zero SQLITE_BUSY
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass in both repos
- [ ] Load test: zero SQLITE_BUSY at 20+ concurrent agents
- [ ] WAL file stable under load (< 100MB)
