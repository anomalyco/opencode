# Cross-Machine Forking Audit — Fix 5 Council-Confirmed Findings

## TL;DR

> **Quick Summary**: Fix 5 findings from the council-reviewed cross-machine forking audit. Spans two repos: core (`packages/opencode`) and sibling (`opencode-postgres-sync`). Fixes range from a 1-line log.warn to teaching sessionRoot() to walk parent chains.
>
> **Deliverables**:
>
> - Dead `replay()` function deleted from sibling repo
> - `sessionRoot()` resolves child sessions through parent_id chain
> - Shard refresh uses INSERT OR REPLACE instead of DELETE+INSERT
> - Persistent machine UUID replaces os.hostname() for origin_machine
> - Empty catch block logs warnings instead of swallowing errors
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 4 workers in Wave 1, 2 in Wave 2, 1 in Wave 3
> **Critical Path**: Wave 1 (parallel) → Wave 2 (#2 + vendor) → Wave 3 (verify) → Final Review

---

## Context

### Original Request

Fix 5 council-confirmed findings from the cross-machine forking audit. Council synthesis at `.sisyphus/athena/council-cross-machine-forking-review-357e48b939d036e8/synthesis.md`.

### Findings Summary

| #   | Severity           | Council Vote  | Repo    | Description                               |
| --- | ------------------ | ------------- | ------- | ----------------------------------------- |
| 1   | Critical → trivial | Unanimous 3/3 | sibling | Dead `replay()` with broken SQL           |
| 2   | High               | Majority 2/3  | core    | `sessionRoot()` doesn't walk parent chain |
| 4   | Low-Medium         | Majority 2/3  | sibling | DELETE+INSERT race in shard refresh       |
| 5   | Low-Medium         | Unanimous 3/3 | core    | `os.hostname()` brittle in containers     |
| 6   | Low                | Solo 1/3      | core    | Empty catch swallows migration errors     |

### Research Findings

- **#1**: `replay()` at `projectors.ts:559-576` is exported but never imported. SQL has 7 values for 6 columns (duplicate `${data.raw}`). Safe to delete.
- **#2**: `sessionRoot()` at `db.ts:236-239` only checks `${id}.db` existence. Session schema has `parent_id` column with index. No parent chain traversal exists anywhere.
- **#4**: INSERT OR REPLACE statements already prepared at `local.ts:403-411`. Five DELETE statements at lines 412-416 are the actual problem. Fix is simpler than expected.
- **#5**: `os.hostname()` used at `index.ts:402` and `revert.ts:19-22`. XDG data dir already available via `Global.Path.data`. No machine-id helper exists.
- **#6**: Empty `catch {}` at `db.ts:186-188`. Log module already imported as `const log = Log.create({ service: "db" })`.

### Metis Review — Addressed Gaps

- **File conflict**: #2 and #6 both touch `db.ts` — sequenced: #6 in Wave 1, #2 in Wave 2
- **Broken parent chain behavior**: Default to fall-back-to-self (preserves current behavior for edge cases)
- **Cycle protection**: Cap at 100 hops, warn and fall back to self
- **Machine-id atomicity**: Use temp-file + rename pattern
- **Machine-id corruption**: Regenerate and overwrite if file contains invalid UUID
- **Legacy origin_machine values**: Leave existing hostname values untouched (no migration backfill)
- **Schema safety for #4**: Shard tables are standalone SQLite files with simple PKs, no triggers/FK cascades found
- **Scope locks applied** (see Guardrails below)

---

## Work Objectives

### Core Objective

Resolve all 5 council-confirmed findings to make cross-machine session forking robust and observable.

### Concrete Deliverables

- `opencode-postgres-sync/src/projectors.ts` — `replay()` function deleted
- `opencode-postgres-sync/src/local.ts` — shard refresh uses upsert + stale-row cleanup
- `packages/opencode/src/storage/db.ts` — `sessionRoot()` walks parent chain; empty catch logs warnings
- `packages/opencode/src/session/index.ts` — `Session.create()` uses persistent machine UUID
- `packages/opencode/src/session/revert.ts` — `foreign()` uses persistent machine UUID
- New helper: `machineId()` function using XDG data dir
- New test: session root resolution through parent chain
- Vendored dist updated after sibling fixes

### Definition of Done

- [x] All 5 findings addressed with passing tests
- [ ] `bun typecheck` passes in `packages/opencode`
- [x] `bun test` passes in `packages/opencode`
- [x] `bun test` passes in `opencode-postgres-sync`
- [x] `bun run build` passes in `opencode-postgres-sync`
- [x] Vendored dist updated in `packages/opencode-postgres-sync/dist/`
- [x] `OPENCODE_VERSION="0.0.0-audit" bun run script/build.ts` passes in `packages/opencode`

### Must Have

- Parent chain resolution for pulled child sessions
- Persistent machine identity surviving container restarts
- Idempotent shard refresh (upsert, not delete+insert)
- Observable migration failures (logged, not swallowed)
- Dead code removed

### Must NOT Have (Guardrails)

- No sync protocol redesign while fixing sessionRoot()
- No historical origin_machine migration/backfill to UUID
- No generic machine identity abstraction across platforms
- No logging framework cleanup beyond the targeted catch block
- No opportunistic SQL modernization beyond the audited shard refresh
- No sibling/core packaging workflow redesign
- No touching core `SyncEvent.replay()` (different from sibling's dead `replay()`)
- No expanding shard refresh scope to tables beyond message/part/todo/event/event_sequence
- No npm publishing

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES (both repos use bun:test)
- **Automated tests**: TDD for #2, tests-after for #5, verification-only for #1/#4/#6
- **Framework**: bun:test in both repos

### QA Policy

Every task includes agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Core repo tests**: Run from `packages/opencode/` with `bun test --timeout 30000`
- **Sibling repo tests**: Run from `/home/ubuntu/opencode/opencode-postgres-sync/` with `bun test`
- **Type checking**: `bun typecheck` from `packages/opencode/`
- **Building**: `bun run build` from sibling, `OPENCODE_VERSION="0.0.0-audit" bun run script/build.ts` from `packages/opencode/`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 4 parallel workers, independent repos/files):
├── Task 1: Log.warn in empty catch (#6)          [quick]  — core db.ts:186-188
├── Task 2: Persistent machineId() helper (#5)     [quick]  — core session/, util/
├── Task 3: Shard refresh upsert (#4)              [unspecified-high] — sibling local.ts
└── Task 4: Delete dead replay() (#1)              [quick]  — sibling projectors.ts

Wave 2 (After Wave 1 — 2 parallel workers):
├── Task 5: sessionRoot() parent chain (#2)        [deep]   — core db.ts (depends: T1, same file)
└── Task 6: Rebuild sibling + vendor dist          [quick]  — both repos (depends: T3, T4)

Wave 3 (After Wave 2 — integration gate):
└── Task 7: Full integration verification          [quick]  — both repos (depends: T5, T6)

Wave FINAL (After ALL — 4 parallel reviews, then user okay):
├── F1: Plan compliance audit                      [oracle]
├── F2: Code quality review                        [unspecified-high]
├── F3: Real QA execution                          [unspecified-high]
└── F4: Scope fidelity check                       [deep]
→ Present results → Get explicit user okay
```

### Dependency Matrix

| Task                | Depends On | Blocks | Wave |
| ------------------- | ---------- | ------ | ---- |
| T1 (#6 log.warn)    | —          | T5     | 1    |
| T2 (#5 machine-id)  | —          | T7     | 1    |
| T3 (#4 upsert)      | —          | T6     | 1    |
| T4 (#1 replay)      | —          | T6     | 1    |
| T5 (#2 sessionRoot) | T1         | T7     | 2    |
| T6 (vendor)         | T3, T4     | T7     | 2    |
| T7 (verify)         | T5, T6     | F1-F4  | 3    |

### Agent Dispatch Summary

- **Wave 1**: **4** — T1 → `quick`, T2 → `quick`, T3 → `unspecified-high`, T4 → `quick`
- **Wave 2**: **2** — T5 → `deep`, T6 → `quick`
- **Wave 3**: **1** — T7 → `quick`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Add log.warn to empty catch in origin_machine backfill (#6)

  **What to do**:
  - In `packages/opencode/src/storage/db.ts` lines 186-188, replace the empty `catch {}` with `catch (err) { log.warn("origin_machine backfill failed", { error: err }) }`
  - The log module is already imported: `const log = Log.create({ service: "db" })` at line 28
  - Keep the failure non-fatal — warn only, do not throw

  **Must NOT do**:
  - Do not refactor the surrounding try block or the UPDATE SQL
  - Do not add logging to any other catch blocks
  - Do not change the log module import or configuration

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-line change in a known location with clear pattern
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `systematic-debugging`: Not debugging, just adding observability

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Task 5 (shares db.ts)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `packages/opencode/src/storage/db.ts:186-188` — The empty catch block to fix
  - `packages/opencode/src/storage/db.ts:28` — Log module import: `const log = Log.create({ service: "db" })`
  - `packages/opencode/src/storage/db.ts:162` — Existing log pattern: `log.info("opening database", { path: Path })`

  **API/Type References**:
  - `packages/opencode/src/util/log.ts:25-39` — Logger type with `warn(message?: any, extra?: Record<string, any>): void`

  **Acceptance Criteria**:
  - [ ] `catch (err) { log.warn(...) }` replaces empty `catch {}`
  - [ ] `bun typecheck` passes from `packages/opencode/`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Catch block now logs on failure
    Tool: Bash (grep)
    Steps:
      1. grep -n 'catch.*{.*}' packages/opencode/src/storage/db.ts around line 186-188
      2. Verify the catch block contains log.warn with error context
      3. Verify no empty catch {} remains at that location
    Expected Result: catch block contains `log.warn` call with `{ error: err }` context
    Failure Indicators: Empty catch block still present, or catch without log.warn
    Evidence: .sisyphus/evidence/task-1-catch-logging.txt

  Scenario: Typecheck still passes
    Tool: Bash
    Preconditions: Working directory is packages/opencode/
    Steps:
      1. Run `bun typecheck`
      2. Verify exit code 0
    Expected Result: No type errors
    Evidence: .sisyphus/evidence/task-1-typecheck.txt
  ```

  **Commit**: YES
  - Message: `fix(db): warn on origin_machine migration failure`
  - Files: `packages/opencode/src/storage/db.ts`
  - Pre-commit: `bun typecheck` from `packages/opencode/`

- [x] 2. Create persistent machineId() helper and update call sites (#5)

  **What to do**:
  - Create a `machineId()` helper that:
    - Reads UUID from `${Global.Path.data}/machine-id` if file exists and contains a valid UUID
    - If file missing or contains invalid content: generate `crypto.randomUUID()`, write atomically (temp file + rename in same dir), return the new UUID
    - Place helper in `packages/opencode/src/util/machine.ts` or alongside `packages/opencode/src/storage/db.ts` — prefer `src/util/` for reusability
    - Cache the value in a module-level variable after first read (no repeated disk I/O)
  - Update `packages/opencode/src/session/index.ts` line 402: replace `os.hostname()` with `machineId()`
  - Update `packages/opencode/src/session/revert.ts` lines 19-22: replace `os.hostname()` comparison in `foreign()` with `machineId()`
  - The XDG data dir is available as `Global.Path.data` from `packages/opencode/src/global/index.ts`

  **Must NOT do**:
  - Do not backfill existing sessions that have hostname values for origin_machine
  - Do not create a generic machine identity abstraction — just a simple read/write helper
  - Do not add platform-specific logic (Docker detection, etc.)
  - Do not change the session schema or migration

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: New small helper file + two call site updates, all straightforward
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `test-driven-development`: Tests-after is sufficient for this helper

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Task 7 (integration verification)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `packages/opencode/src/session/index.ts:402` — Current: `originMachine: os.hostname()`
  - `packages/opencode/src/session/revert.ts:19-22` — Current: `foreign()` uses `os.hostname()`
  - `packages/opencode/src/global/index.ts:9-26` — `Global.Path.data` for XDG data dir

  **API/Type References**:
  - `packages/opencode/src/session/session.sql.ts:24` — `origin_machine: text()` column definition
  - `packages/opencode/src/session/index.ts:139-175` — `Session.Info` type with `originMachine: z.string().optional()`

  **External References**:
  - Node.js `crypto.randomUUID()` — generates RFC 4122 v4 UUID
  - Node.js `fs.renameSync()` — atomic file move for write safety

  **WHY Each Reference Matters**:
  - `index.ts:402` and `revert.ts:19-22` are the two exact call sites to update
  - `Global.Path.data` is the canonical XDG path to store persistent data — use this, don't invent a new path
  - `session.sql.ts:24` confirms `origin_machine` is a plain text column with no length/format constraints

  **Acceptance Criteria**:
  - [ ] New `machineId()` helper exists and returns a UUID string
  - [ ] `Session.create()` uses `machineId()` instead of `os.hostname()`
  - [ ] `foreign()` uses `machineId()` instead of `os.hostname()`
  - [ ] Machine-id file created at `${Global.Path.data}/machine-id` on first call
  - [ ] Second call returns same UUID without regenerating
  - [ ] Invalid/corrupt file content triggers regeneration
  - [ ] `bun typecheck` passes from `packages/opencode/`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: machineId() creates and persists UUID
    Tool: Bash (bun REPL)
    Preconditions: Set XDG_DATA_HOME to a temp directory before importing the helper (follow the pattern in packages/opencode/test/preload.ts:9-35 which sets XDG env vars before imports)
    Steps:
      1. Create a temp dir for XDG_DATA_HOME
      2. Run a bun script that imports machineId, calls it twice
      3. Verify both calls return the same UUID string
      4. Verify the UUID matches RFC 4122 format (8-4-4-4-12 hex)
      5. Verify the file exists at the expected path
    Expected Result: Same valid UUID returned twice, file persisted
    Failure Indicators: Different UUIDs, invalid format, no file created
    Evidence: .sisyphus/evidence/task-2-machine-id-persist.txt

  Scenario: machineId() recovers from corrupt file
    Tool: Bash (bun REPL)
    Preconditions: Write "not-a-uuid" to the machine-id file path
    Steps:
      1. Create machine-id file with junk content
      2. Call machineId()
      3. Verify it returns a valid UUID (not the junk)
      4. Verify the file now contains the valid UUID
    Expected Result: New valid UUID generated and persisted, replacing corrupt content
    Failure Indicators: Returns junk string, throws error, or doesn't overwrite
    Evidence: .sisyphus/evidence/task-2-machine-id-corrupt.txt

  Scenario: Session.create() no longer uses os.hostname()
    Tool: Bash (grep)
    Steps:
      1. grep for os.hostname in packages/opencode/src/session/index.ts
      2. grep for os.hostname in packages/opencode/src/session/revert.ts
      3. Verify machineId import exists in both files
    Expected Result: No os.hostname() calls remain in session/index.ts or session/revert.ts
    Failure Indicators: os.hostname() still present in either file
    Evidence: .sisyphus/evidence/task-2-no-hostname.txt
  ```

  **Commit**: YES
  - Message: `feat(session): persist machine identity in XDG data dir`
  - Files: `packages/opencode/src/util/machine.ts` (new), `packages/opencode/src/session/index.ts`, `packages/opencode/src/session/revert.ts`
  - Pre-commit: `bun typecheck` from `packages/opencode/`

- [x] 3. Switch shard refresh from DELETE+INSERT to upsert with stale-row cleanup (#4)

  **What to do**:
  - In `/home/ubuntu/opencode/opencode-postgres-sync/src/local.ts`, the `pullSession()` function (line 295) has a shard transaction (lines 412-462) that DELETEs all rows from message/part/todo/event/event_sequence then re-INSERTs
  - The INSERT OR REPLACE prepared statements already exist at lines 403-411 — they're correct
  - **Remove the 5 DELETE statements** at lines 412-416:
    ```
    shard.query("DELETE FROM message").run()   // REMOVE
    shard.query("DELETE FROM part").run()      // REMOVE
    shard.query("DELETE FROM todo").run()      // REMOVE
    shard.query("DELETE FROM event").run()     // REMOVE
    shard.query("DELETE FROM event_sequence").run() // REMOVE
    ```
  - Keep the INSERT OR REPLACE loops exactly as they are
  - **Add post-upsert cleanup** after all inserts complete (still inside the transaction):
    - For message: DELETE rows where `id NOT IN (...)` the set of IDs from the remote `messages` array
    - For part: DELETE rows where `id NOT IN (...)` the set from remote `parts` array
    - For todo: DELETE rows where `(session_id, position) NOT IN (...)` the set from remote `todos` array
    - For event: DELETE rows where `id NOT IN (...)` the set from remote events (if events are populated in this transaction — verify first)
    - For event_sequence: Same pattern if populated here
  - This handles remote deletions while avoiding the full-wipe race window
  - Keep the outer `shard.transaction(() => { ... })` wrapper for atomicity

  **Must NOT do**:
  - Do not change the INSERT OR REPLACE prepared statement SQL (lines 403-411)
  - Do not change how data is fetched from Postgres
  - Do not change the data transformation logic (parse/normalize/strip fields)
  - Do not restructure the transaction beyond removing DELETEs and adding cleanup
  - Do not touch any other function in local.ts

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: SQL logic change in a critical sync path, needs careful attention to correctness
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `systematic-debugging`: Not debugging, implementing a known fix

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 6 (sibling rebuild)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/local.ts:403-411` — INSERT OR REPLACE prepared statements (already correct, keep as-is)
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/local.ts:412-416` — Five DELETE statements to remove
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/local.ts:417-462` — INSERT loops for message/part/todo (keep as-is)

  **API/Type References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/schema.ts:108-120` — message table: PK is `id` (TEXT)
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/schema.ts:121-137` — part table: PK is `id` (TEXT)
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/schema.ts:138-148` — todo table: PK is `(session_id, position)` composite
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/schema.ts:153-160` — event table: PK is `id` (TEXT)

  **WHY Each Reference Matters**:
  - Lines 403-411 prove INSERT OR REPLACE is already prepared — no SQL authoring needed
  - Lines 412-416 are the exact lines to delete
  - Schema references confirm all tables have PKs that support INSERT OR REPLACE semantics

  **Acceptance Criteria**:
  - [ ] No `DELETE FROM message/part/todo/event/event_sequence` statements remain in the shard transaction
  - [ ] INSERT OR REPLACE loops still populate all tables
  - [ ] Post-upsert cleanup deletes rows not in the remote set
  - [ ] Transaction wrapper preserved
  - [ ] `bun test` passes in `opencode-postgres-sync`
  - [ ] `bun run build` succeeds in `opencode-postgres-sync`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Shard refresh no longer bulk-deletes
    Tool: Bash (grep)
    Steps:
      1. grep for 'DELETE FROM message' in /home/ubuntu/opencode/opencode-postgres-sync/src/local.ts
      2. grep for 'DELETE FROM part' in /home/ubuntu/opencode/opencode-postgres-sync/src/local.ts
      3. grep for 'DELETE FROM todo' in /home/ubuntu/opencode/opencode-postgres-sync/src/local.ts
      4. Verify none of these appear as standalone delete-all statements
      5. Verify cleanup DELETEs exist with NOT IN clause
    Expected Result: No bare DELETE FROM statements; only DELETE WHERE ... NOT IN cleanup
    Failure Indicators: Bare DELETE FROM still present
    Evidence: .sisyphus/evidence/task-3-no-bulk-delete.txt

  Scenario: Build succeeds after changes
    Tool: Bash
    Preconditions: Working directory is /home/ubuntu/opencode/opencode-postgres-sync/
    Steps:
      1. Run `bun run build`
      2. Verify exit code 0
      3. Verify dist/ files are generated
    Expected Result: tsc compiles without errors
    Evidence: .sisyphus/evidence/task-3-build.txt

  Scenario: Tests pass
    Tool: Bash
    Preconditions: Working directory is /home/ubuntu/opencode/opencode-postgres-sync/
    Steps:
      1. Run `bun test`
      2. Verify exit code 0
    Expected Result: All existing tests pass
    Evidence: .sisyphus/evidence/task-3-tests.txt
  ```

  **Commit**: YES
  - Message: `fix(local): upsert shard refresh rows and clean stale state`
  - Files: `/home/ubuntu/opencode/opencode-postgres-sync/src/local.ts`
  - Pre-commit: `bun test && bun run build` from `opencode-postgres-sync`

- [x] 4. Delete dead replay() function (#1)

  **What to do**:
  - In `/home/ubuntu/opencode/opencode-postgres-sync/src/projectors.ts` lines 559-576, delete the entire `export async function replay(...)` function
  - This function is exported but **never imported or called anywhere** — confirmed via reference search
  - It has a broken SQL INSERT: 6 columns (`id, aggregate_id, seq, type, data, data_raw`) but 7 values (duplicate `${data.raw}`)
  - Before deleting, use `lsp_find_references` or grep to confirm no callers exist (safety check)
  - **Do NOT confuse with core `SyncEvent.replay()`** which is a different function in a different repo

  **Must NOT do**:
  - Do not touch any other function in projectors.ts
  - Do not touch core repo's `SyncEvent.replay()` or `replayBus`
  - Do not fix the SQL — just delete the whole function (it's dead code)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure deletion of a single function, no logic to write
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 6 (sibling rebuild)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/projectors.ts:559-576` — The dead `replay()` function to delete
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/index.ts:15` — Only `replayBus` is imported from projectors, NOT `replay`

  **API/Type References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/schema.ts:153-160` — event table schema showing 6 columns (confirms the SQL bug)

  **WHY Each Reference Matters**:
  - Lines 559-576 are the exact extent of the dead function
  - index.ts:15 proves the function is not imported (only `replayBus` is)

  **Acceptance Criteria**:
  - [ ] `replay()` function no longer exists in projectors.ts
  - [ ] `replayBus` and all other exports are untouched
  - [ ] No references to the deleted function remain in the sibling repo
  - [ ] `bun run build` succeeds
  - [ ] `bun test` passes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: replay() function is fully removed
    Tool: Bash (grep)
    Steps:
      1. grep for 'export async function replay' in /home/ubuntu/opencode/opencode-postgres-sync/src/projectors.ts
      2. grep for 'function replay' in /home/ubuntu/opencode/opencode-postgres-sync/src/projectors.ts
      3. Verify zero matches
    Expected Result: No replay function definition exists
    Failure Indicators: Any match for replay function definition
    Evidence: .sisyphus/evidence/task-4-replay-removed.txt

  Scenario: No dangling references to deleted function
    Tool: Bash (grep)
    Steps:
      1. grep -r 'import.*replay[^B]' in /home/ubuntu/opencode/opencode-postgres-sync/src/ (exclude replayBus)
      2. grep -r 'replay(' in /home/ubuntu/opencode/opencode-postgres-sync/src/ (exclude replayBus calls)
      3. Verify no orphaned imports or calls
    Expected Result: No imports or calls to the deleted replay function
    Failure Indicators: Any import or call referencing the deleted function
    Evidence: .sisyphus/evidence/task-4-no-dangling-refs.txt

  Scenario: Build and tests still pass
    Tool: Bash
    Preconditions: Working directory is /home/ubuntu/opencode/opencode-postgres-sync/
    Steps:
      1. Run `bun run build`
      2. Run `bun test`
      3. Verify both exit code 0
    Expected Result: Clean build and passing tests
    Evidence: .sisyphus/evidence/task-4-build-test.txt
  ```

  **Commit**: YES
  - Message: `chore(projectors): remove dead replay function`
  - Files: `/home/ubuntu/opencode/opencode-postgres-sync/src/projectors.ts`
  - Pre-commit: `bun test && bun run build` from `opencode-postgres-sync`

- [x] 5. Teach sessionRoot() to walk parent chain for pulled child sessions (#2)

  **What to do**:
  - In `packages/opencode/src/storage/db.ts`, rewrite `sessionRoot()` (lines 236-239) to walk the parent chain:
    1. First check: if `${id}.db` shard exists (current behavior), return `id` immediately
    2. If no local shard: query the global database for the session's `parent_id`
    3. Walk up the parent chain (following `parent_id` links) until finding a session whose shard file exists
    4. Return that ancestor's ID as the root, or `undefined` if no shard found at any level
  - **Cycle protection**: Cap at 100 hops. If exceeded, `log.warn("parent chain cycle detected", { id })` and return `undefined`
  - **Broken chain**: If `parent_id` points to a non-existent session row, stop walking and return `undefined`
  - **Null parent_id**: Session with null parent_id IS a root — if its shard doesn't exist, return `undefined`
  - Update `resolveSession()` if needed to work with the new `sessionRoot()` behavior
  - **Write a TDD-style integration test** in `packages/opencode/test/storage/` that:
    - Creates a root session in the global DB
    - Creates a child session with `parent_id` pointing to the root
    - Creates only the root's shard file (simulating pullSession behavior)
    - Verifies `sessionRoot(childID)` returns the root's ID
    - Verifies `sessionRoot(rootID)` returns the root's ID (existing behavior preserved)
    - Tests broken chain returns `undefined`
    - Tests cycle protection caps out and warns

  **Must NOT do**:
  - Do not redesign the sync protocol or sharding strategy
  - Do not change how `pullSession()` writes shards (that's sibling repo)
  - Do not add caching of parent chain resolution (keep it simple)
  - Do not change the `hasSession()` function signature (only `sessionRoot()` and `resolveSession()`)
  - Do not modify session creation or storage patterns

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Most complex finding — requires understanding session tree model, writing SQL queries against global DB, TDD test creation, and careful edge case handling
  - **Skills**: `["test-driven-development"]`
    - `test-driven-development`: Failing test first for parent chain resolution, then implementation
  - **Skills Evaluated but Omitted**:
    - `systematic-debugging`: Not debugging existing code, building new functionality

  **Parallelization**:
  - **Can Run In Parallel**: NO (shares db.ts with Task 1)
  - **Parallel Group**: Wave 2 (parallel with Task 6)
  - **Blocks**: Task 7 (integration verification)
  - **Blocked By**: Task 1 (same file: db.ts)

  **References**:

  **Pattern References**:
  - `packages/opencode/src/storage/db.ts:236-239` — Current `sessionRoot()`: only checks if shard file exists
  - `packages/opencode/src/storage/db.ts:218-234` — `hasSession()`: checks shard file + validates table structure
  - `packages/opencode/src/storage/db.ts:241-244` — `resolveSession()`: uses `sessionRoot()` to decide local vs client
  - `packages/opencode/src/storage/db.ts:28` — Log module: `const log = Log.create({ service: "db" })`
  - `packages/opencode/src/storage/db.ts:162` — Example log usage pattern

  **API/Type References**:
  - `packages/opencode/src/session/session.sql.ts:25` — `parent_id: text().$type<SessionID>()` column
  - `packages/opencode/src/session/session.sql.ts:44` — `index("session_parent_idx").on(table.parent_id)` for efficient queries
  - `packages/opencode/src/session/index.ts:139-175` — `Session.Info` type with `parentID` field

  **Test References**:
  - `packages/opencode/test/storage/db.test.ts` — Existing DB test pattern using describe/test/expect
  - `packages/opencode/test/storage/storage.test.ts` — Pattern using tmpdir fixture and Effect.gen
  - `packages/opencode/test/fixture/fixture.ts` — `tmpdir()` helper for isolated test directories

  **WHY Each Reference Matters**:
  - `db.ts:236-239` is the exact function to rewrite — understand current behavior first
  - `session.sql.ts:25` confirms `parent_id` exists and is indexed — efficient to query
  - `db.test.ts` shows the test pattern to follow (bun:test, describe blocks)
  - `storage.test.ts` shows how to set up isolated test environments with tmpdir

  **Acceptance Criteria**:
  - [ ] `sessionRoot(childID)` returns root ID when child's parent has a shard
  - [ ] `sessionRoot(rootID)` still returns root ID (no regression)
  - [ ] `sessionRoot(unknownID)` returns `undefined`
  - [ ] Broken parent chain (missing parent row) returns `undefined`
  - [ ] Cycle in parent chain caps at 100 hops, logs warning, returns `undefined`
  - [ ] Integration test covers all above scenarios
  - [ ] `bun typecheck` passes
  - [ ] `bun test --timeout 30000` passes (including new test)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Child session resolves to root through parent chain
    Tool: Bash (bun test)
    Preconditions: New test file exists in packages/opencode/test/storage/
    Steps:
      1. Run `bun test test/storage/` from packages/opencode/ (relative path, not absolute)
      2. Verify the parent chain resolution test passes
      3. Check test covers: root self-resolve, child→root, unknown→undefined
    Expected Result: All session root resolution tests pass
    Failure Indicators: Test failures for parent chain walking
    Evidence: .sisyphus/evidence/task-5-session-root-test.txt

  Scenario: Cycle protection prevents infinite loop
    Tool: Bash (bun test)
    Steps:
      1. Verify test creates a cyclic parent chain (A→B→A)
      2. Run the cycle test specifically
      3. Verify it returns undefined without hanging
    Expected Result: Returns undefined, logs warning, completes in < 1 second
    Failure Indicators: Test hangs, no warning logged, or returns wrong value
    Evidence: .sisyphus/evidence/task-5-cycle-protection.txt

  Scenario: Typecheck and full test suite pass
    Tool: Bash
    Preconditions: Working directory is packages/opencode/
    Steps:
      1. Run `bun typecheck`
      2. Run `bun test --timeout 30000`
      3. Verify both exit code 0
    Expected Result: No type errors, all tests pass
    Evidence: .sisyphus/evidence/task-5-typecheck-tests.txt
  ```

  **Commit**: YES
  - Message: `fix(db): resolve session roots through parent chain`
  - Files: `packages/opencode/src/storage/db.ts`, `packages/opencode/test/storage/session-root.test.ts` (new)
  - Pre-commit: `bun typecheck && bun test --timeout 30000` from `packages/opencode/`

- [x] 6. Rebuild sibling repo and vendor dist into core

  **What to do**:
  - From `/home/ubuntu/opencode/opencode-postgres-sync/`:
    1. Run `bun run build` to compile TypeScript → `dist/`
    2. Verify `dist/` contains updated `.js` and `.d.ts` files
  - Copy the built `dist/` contents into `packages/opencode-postgres-sync/dist/` in the core repo
  - Verify the vendor step didn't break core imports

  **Must NOT do**:
  - Do not modify any source files in either repo
  - Do not npm publish
  - Do not change the build configuration

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical build + copy, no logic
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Task 5)
  - **Parallel Group**: Wave 2 (with Task 5)
  - **Blocks**: Task 7 (integration verification)
  - **Blocked By**: Tasks 3, 4 (sibling source changes)

  **References**:

  **Pattern References**:
  - `/home/ubuntu/opencode/opencode-postgres-sync/package.json` — Build script: `"build": "tsc"`
  - `/home/ubuntu/opencode/opencode-postgres-sync/dist/` — Build output directory
  - `/home/ubuntu/opencode/db/packages/opencode-postgres-sync/dist/` — Vendor destination in core repo

  **Acceptance Criteria**:
  - [ ] `bun run build` succeeds in sibling repo
  - [ ] `dist/` files in core vendor match sibling build output
  - [ ] No stale `.js`/`.d.ts` files from deleted exports (replay)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Sibling build succeeds and dist is current
    Tool: Bash
    Steps:
      1. Run `bun run build` in /home/ubuntu/opencode/opencode-postgres-sync/
      2. Verify exit code 0
      3. Compare dist/ timestamps are fresh (newer than source changes)
    Expected Result: Clean build, dist/ populated
    Evidence: .sisyphus/evidence/task-6-sibling-build.txt

  Scenario: Vendored dist matches sibling output
    Tool: Bash
    Steps:
      1. diff -r /home/ubuntu/opencode/opencode-postgres-sync/dist/ packages/opencode-postgres-sync/dist/
      2. Verify no differences
    Expected Result: Identical dist contents in both locations
    Evidence: .sisyphus/evidence/task-6-vendor-diff.txt
  ```

  **Commit**: YES
  - Message: `chore: vendor updated postgres-sync dist`
  - Files: `packages/opencode-postgres-sync/dist/*`
  - Pre-commit: `bun typecheck` from `packages/opencode/`

- [ ] 7. Full integration verification

  **What to do**:
  - Run complete verification across both repos to confirm all changes integrate cleanly:
    1. `bun typecheck` from `packages/opencode/`
    2. `bun test --timeout 30000` from `packages/opencode/`
    3. `bun test` from `/home/ubuntu/opencode/opencode-postgres-sync/`
    4. `OPENCODE_VERSION="0.0.0-audit" bun run script/build.ts` from `packages/opencode/`
  - Capture all output as evidence
  - If any step fails, identify which task's changes caused it and report back

  **Must NOT do**:
  - Do not fix failures — report them for the responsible task to address
  - Do not modify any source files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Run commands and capture output, no implementation
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (integration gate)
  - **Parallel Group**: Wave 3 (sequential)
  - **Blocks**: F1-F4 (final verification)
  - **Blocked By**: Tasks 5, 6

  **Acceptance Criteria**:
  - [ ] All 4 verification commands pass with exit code 0
  - [ ] Evidence captured for each command

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Core typecheck
    Tool: Bash
    Preconditions: packages/opencode/
    Steps:
      1. Run `bun typecheck`
    Expected Result: Exit 0, no errors
    Evidence: .sisyphus/evidence/task-7-core-typecheck.txt

  Scenario: Core tests
    Tool: Bash
    Preconditions: packages/opencode/
    Steps:
      1. Run `bun test --timeout 30000`
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-7-core-tests.txt

  Scenario: Sibling tests
    Tool: Bash
    Preconditions: /home/ubuntu/opencode/opencode-postgres-sync/
    Steps:
      1. Run `bun test`
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-7-sibling-tests.txt

  Scenario: Core package build
    Tool: Bash
    Preconditions: packages/opencode/
    Steps:
      1. Run `OPENCODE_VERSION="0.0.0-audit" bun run script/build.ts`
    Expected Result: Build succeeds
    Evidence: .sisyphus/evidence/task-7-core-build.txt
  ```

  **Commit**: NO (verification only)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [x] F1. **Plan Compliance Audit** — `oracle`
      Read `.sisyphus/plans/cross-machine-forking-fixes.md` end-to-end. For each "Must Have": verify implementation exists (read files, check functions). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
      Run `bun typecheck` in `packages/opencode`. Run `bun test` in both repos. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify style guide compliance (single-word names, const over let, no destructuring, no else).
      Output: `Typecheck [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real QA Execution** — `unspecified-high`
      Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (machine-id used in session creation, sessionRoot resolves pulled children, shard refresh is idempotent). Save to `.sisyphus/evidence/final-qa/`.
      Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual changes (`jj diff --git`). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes. Verify no core `SyncEvent.replay()` was touched.
      Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy (jj)

| Order | Repo    | Message                                                       | Depends On |
| ----- | ------- | ------------------------------------------------------------- | ---------- |
| 1     | core    | `fix(db): warn on origin_machine migration failure`           | —          |
| 2     | core    | `feat(session): persist machine identity in XDG data dir`     | —          |
| 3     | sibling | `fix(local): upsert shard refresh rows and clean stale state` | —          |
| 4     | sibling | `chore(projectors): remove dead replay function`              | —          |
| 5     | core    | `fix(db): resolve session roots through parent chain`         | 1          |
| 6     | core    | `chore: vendor updated postgres-sync dist`                    | 3, 4       |

Each commit: `jj describe -m "message"` then `jj new`.

---

## Success Criteria

### Verification Commands

```bash
# From packages/opencode/
bun typecheck                                          # Expected: no errors
bun test --timeout 30000                               # Expected: all pass
OPENCODE_VERSION="0.0.0-audit" bun run script/build.ts # Expected: build succeeds

# From /home/ubuntu/opencode/opencode-postgres-sync/
bun test                                               # Expected: all pass
bun run build                                          # Expected: tsc succeeds
```

### Final Checklist

- [x] All 5 findings addressed
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] All tests pass in both repos
- [x] Vendored dist updated
- [x] Package build succeeds
- [ ] Each finding has its own jj change
