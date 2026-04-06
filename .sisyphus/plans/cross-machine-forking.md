# Cross-Machine Safe Conversation Forking

## TL;DR

> **Quick Summary**: Make conversation revert/unrevert cross-machine safe by persisting machine provenance on every session, detecting foreign sessions, and splitting revert into conversation-only vs conversation+files modes. File/snapshot state remains intentionally local-only.
>
> **Deliverables**:
>
> - Machine provenance (`originMachine`) persisted, migrated, and synced on all sessions
> - Conversation-only revert mode that never touches files
> - Foreign-machine detection that disables file ops on revert/unrevert
> - Defensive unrevert that doesn't clear revert flag on restore failure
> - Route hydration for `/revert` and `/unrevert`
> - Auto-cleanup on foreign-machine prompt continuation
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 (provenance) → Task 3 (conversation-only revert) → Task 5 (foreign detection) → Task 7 (auto-cleanup) → F1-F4

---

## Repository Layout (IMPORTANT)

> **Two repos are involved in this work:**
> 
> 1. **OpenCode core** — this repo at `/home/ubuntu/opencode/db/`
>    - All `packages/opencode/src/...` references are here
>    - `packages/plugin/src/index.ts` — plugin hook type contract
>    - `packages/opencode-postgres-sync/` — **vendored dist-only copy, READ ONLY, do NOT edit**
> 
> 2. **Postgres sync plugin source** — sibling repo at `/home/ubuntu/opencode/opencode-postgres-sync/`
>    - `src/projectors.ts` — session serializer including `replaySession()`
>    - `src/local.ts` — `pullSession()`, `syncMetadata()`, `refreshCheckpoints()`
>    - `src/index.ts` — plugin entry point with `session.ensure.before` hook handler
>    - After editing, rebuild with `bun run build` from that directory
>    - The built output gets vendored into the core repo's `packages/opencode-postgres-sync/dist/`
> 
> All references prefixed with `/home/ubuntu/opencode/opencode-postgres-sync/src/` target the **sibling repo source**.
> References to `packages/opencode-postgres-sync/dist/` are the vendored read-only copy.

## Context

### Original Request

Make all of OpenCode's conversation forking operations cross-machine safe when sessions are synced through the Postgres plugin.

### Interview Summary

**Key Discussions**:

- Exhaustive analysis confirmed the root cause: revert metadata syncs through Postgres but snapshot git objects and worktree file changes are local-only
- User explicitly said: snapshot sync is out of scope, mark as known limitation
- User wants conversation-only revert as a separate option from conversation+files revert
- User wants foreign-machine detection to disable file ops rather than silently fail
- Unrevert only works before cleanup (next prompt hard-deletes reverted tail)
- Foreign-machine prompt continuation should auto-cleanup conversation, skip files (simplest path)
- No legacy session concept — migrate all existing sessions to have originMachine

**Research Findings**:

- Fork, child branch, compact are already cross-machine safe
- Only revert and unrevert are unsafe
- `originMachine` exists on `Session.Info` schema but is not persisted/projected/synced
- Plugin tracks machine via `os.hostname()` / `options.machine`
- `/revert` and `/unrevert` routes don't trigger `session.ensure.before`
- `snap.restore()` doesn't expose success/failure — logs and continues

### Metis Review

**Identified Gaps** (addressed):

- `originMachine` not fully persisted — made Task 1 prerequisite
- Repeated revert while already reverted has undefined semantics — addressed in Task 3
- Cleanup entrypoints beyond routes (prompt, shell, summarize) need guarding — addressed in Task 7
- Unrevert after cleanup is impossible without soft-delete — user confirmed: only before cleanup

---

## Work Objectives

### Core Objective

Make conversation revert/unrevert operations safe to perform and resume across machines connected via the Postgres sync plugin.

### Concrete Deliverables

- `originMachine` field persisted in session schema, projected, and synced through Postgres
- Migration backfills `originMachine` for all existing sessions
- New `mode` parameter on revert: `"conversation"` (no files) vs `"conversation_and_files"` (default, current behavior)
- Foreign-machine detection in revert/unrevert/cleanup paths
- Defensive unrevert that checks restore success
- `session.ensure.before` hooks on `/revert` and `/unrevert` routes
- Tests covering all cross-machine scenarios

### Definition of Done

- [ ] `bun typecheck` passes in `packages/opencode`
- [ ] `bun test test/session/resolve-routing.test.ts` passes (existing)
- [ ] `bun test test/session/revert-compact.test.ts` passes (existing + new)
- [ ] New test file for cross-machine revert scenarios passes
- [ ] Manual QA: conversation-only revert on local session skips files
- [ ] Manual QA: foreign-machine resume with pending revert auto-cleans conversation

### Must Have

- Machine provenance persisted and synced on all sessions
- Conversation-only revert that never calls snapshot APIs
- Foreign-machine file-op disabling with graceful conversation fallback
- Defensive unrevert (don't clear flag on restore failure)
- Route hydration for revert/unrevert

### Must NOT Have (Guardrails)

- No snapshot object sync across machines — explicitly out of scope
- No soft-delete / message archival for post-cleanup unrevert
- No changes to fork, child branch, or compact (already safe)
- No full undo-tree or stacked revert history
- No UI redesign beyond minimal mode choice and disabled-state messaging
- Same-machine default behavior must remain unchanged

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: YES (TDD)
- **Framework**: bun test
- **If TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend**: Use Bash (bun test, curl) - Run tests, assert status + response fields
- **Build**: Use Bash (bun typecheck, bun run script/build.ts) - Verify compilation

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation):
├── Task 1: Persist originMachine on sessions [deep]
├── Task 2: Add session.ensure.before to revert/unrevert routes [quick]

Wave 2 (After Wave 1 - core features):
├── Task 3: Add conversation-only revert mode (depends: 1) [deep]
├── Task 4: Defensive unrevert - check restore success (depends: 2) [unspecified-high]

Wave 3 (After Wave 2 - cross-machine integration):
├── Task 5: Foreign-machine detection in revert/unrevert (depends: 1, 3) [deep]
├── Task 6: Foreign-machine detection in unrevert (depends: 1, 4) [unspecified-high]
├── Task 7: Guard cleanup entrypoints for foreign sessions (depends: 5) [unspecified-high]

Wave FINAL (After ALL tasks):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks  | Wave |
| ---- | ---------- | ------- | ---- |
| 1    | -          | 3, 5, 6 | 1    |
| 2    | -          | 4       | 1    |
| 3    | 1          | 5       | 2    |
| 4    | 2          | 6       | 2    |
| 5    | 1, 3       | 7       | 3    |
| 6    | 1, 4       | -       | 3    |
| 7    | 5          | -       | 3    |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `deep`, T2 → `quick`
- **Wave 2**: 2 tasks — T3 → `deep`, T4 → `unspecified-high`
- **Wave 3**: 3 tasks — T5 → `deep`, T6 → `unspecified-high`, T7 → `unspecified-high`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

---

- [ ] 1. Persist `originMachine` on sessions

  **What to do**:
  - Add `origin_machine` column to `SessionTable` in `packages/opencode/src/session/session.sql.ts`
  - Generate a migration: `bun run db generate --name add-origin-machine` from `packages/opencode`
  - Set `originMachine` in `Session.create()` (`packages/opencode/src/session/index.ts:380-430`) using `os.hostname()`
  - Add `originMachine` to the session projector's `toPartialRow()` and `toRow()` (`packages/opencode/src/session/projectors.ts:38-62`)
  - Add `originMachine` to `Session.fromRow()` (`packages/opencode/src/session/index.ts:92-137`)
  - Ensure the Postgres plugin's `replaySession()` and `pullSession()` carry `origin_machine`. The plugin source is in a **sibling repo** at `/home/ubuntu/opencode/opencode-postgres-sync/src/` (outside this repo). Key files: `projectors.ts` (session serializer, `replaySession()`), `local.ts` (`pullSession()`, `syncMetadata()`), `index.ts` (hook handler). The plugin's hook contract type is defined in `packages/plugin/src/index.ts`
  - Write a migration backfill: UPDATE session SET origin_machine = 'unknown' WHERE origin_machine IS NULL

  **Must NOT do**:
  - Do not change any revert/unrevert logic yet
  - Do not add machine comparison logic yet

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 3, 5, 6
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/session/session.sql.ts:14-44` — SessionTable schema
  - `packages/opencode/src/session/index.ts:92-169` — Session.Info schema and fromRow/toRow
  - `packages/opencode/src/session/index.ts:380-430` — Session.create()
  - `packages/opencode/src/session/projectors.ts:38-78` — toPartialRow and projectors
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/projectors.ts:81-102,250-336` — session() helper and replaySession() (sibling repo)
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/local.ts:161-240,292-393` — syncMetadata() and pullSession() (sibling repo)
  - `packages/plugin/src/index.ts` — plugin hook type contract

  **Acceptance Criteria**:
  - [ ] `bun typecheck` passes
  - [ ] Migration file generated in `packages/opencode/migration/`
  - [ ] New session has `originMachine` set to hostname after create
  - [ ] Session round-trips through Postgres sync (create → sync → pull → get returns originMachine)

  **QA Scenarios:**
  ```
  Scenario: New session gets originMachine
    Tool: Bash (bun test)
    Steps:
      1. Create a session via Session.create({})
      2. Read session back via Session.get(id)
      3. Assert session.originMachine === os.hostname()
    Expected: originMachine matches current hostname
    Evidence: .sisyphus/evidence/task-1-origin-machine-create.txt

  Scenario: Existing sessions get backfilled
    Tool: Bash (bun test)
    Steps:
      1. Insert a session row with origin_machine = NULL
      2. Run migration
      3. Read session back
      4. Assert session.originMachine === 'unknown'
    Expected: Backfilled to 'unknown'
    Evidence: .sisyphus/evidence/task-1-origin-machine-backfill.txt
  ```

  **Commit**: YES
  - Message: `feat(session): persist machine provenance on sessions`
  - Pre-commit: `bun test && bun typecheck`

- [ ] 2. Add `session.ensure.before` to revert/unrevert routes

  **What to do**:
  - Add `Plugin.trigger("session.ensure.before", { sessionID, mode: "revert" }, {})` before the revert handler in `packages/opencode/src/server/routes/session.ts:967`
  - Add `Plugin.trigger("session.ensure.before", { sessionID, mode: "unrevert" }, {})` before the unrevert handler in `packages/opencode/src/server/routes/session.ts:1002`
  - Follow the exact pattern used by other routes (e.g., line 128, 827)

  **Must NOT do**:
  - Do not change revert/unrevert logic itself
  - Do not add new modes to the plugin hook beyond the string identifiers

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/server/routes/session.ts:128` — pattern for session.ensure.before
  - `packages/opencode/src/server/routes/session.ts:943-1005` — revert and unrevert routes
  - `/home/ubuntu/opencode/opencode-postgres-sync/src/index.ts:231-236` — session.ensure.before hook handler (sibling repo)
  - `packages/plugin/src/index.ts:202-205` — plugin hook type contract (add "revert" and "unrevert" to mode union)

  **Acceptance Criteria**:
  - [ ] `bun typecheck` passes
  - [ ] Plugin's ensure hook fires before revert route handler
  - [ ] Plugin's ensure hook fires before unrevert route handler

  **QA Scenarios:**
  ```
  Scenario: Revert route hydrates session first
    Tool: Bash (bun test)
    Steps:
      1. Call POST /:sessionID/revert
      2. Verify session.ensure.before was triggered with mode: "revert"
    Expected: Hook fires before revert logic executes
    Evidence: .sisyphus/evidence/task-2-revert-hydration.txt
  ```

  **Commit**: YES
  - Message: `fix(server): hydrate revert and unrevert routes`
  - Pre-commit: `bun test && bun typecheck`

- [ ] 3. Add conversation-only revert mode

  **What to do**:
  - Add `mode?: "conversation" | "conversation_and_files"` to `SessionRevert.RevertInput` in `packages/opencode/src/session/revert.ts:18-22`
  - Default to `"conversation_and_files"` to preserve current behavior
  - In `SessionRevert.revert()`, when `mode === "conversation"`: skip `snap.track()`, `snap.revert(patches)`, `snap.diff()` — set `rev.snapshot = undefined`, `rev.diff = undefined`
  - Store the mode on `session.revert` so cleanup and unrevert know which mode was used
  - Add `mode` to the `Session.Info.revert` schema: `mode: z.enum(["conversation", "conversation_and_files"]).optional()`
  - Update `session.sql.ts` revert type to include mode
  - Wire the mode through the API route in `packages/opencode/src/server/routes/session.ts:966`
  - Update TUI revert command to offer the mode choice or add a separate slash command (`/undo-conversation`)

  **Must NOT do**:
  - Do not change unrevert behavior yet (Task 4/6 handle that)
  - Do not change cleanup behavior yet (Task 7 handles that)
  - Do not touch fork or compact

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:
  - `packages/opencode/src/session/revert.ts:18-90` — RevertInput and revert()
  - `packages/opencode/src/session/index.ts:157-164` — Session.Info.revert schema
  - `packages/opencode/src/session/session.sql.ts:33` — revert column type
  - `packages/opencode/src/server/routes/session.ts:943-975` — revert route
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:490-526` — TUI undo command
  - `packages/opencode/src/cli/cmd/tui/routes/session/dialog-message.tsx:24-53` — message action revert

  **Acceptance Criteria**:
  - [ ] `bun typecheck` passes
  - [ ] Conversation-only revert sets revert marker without calling any Snapshot API
  - [ ] Default mode revert still calls Snapshot APIs (backward compatible)
  - [ ] Mode is persisted on session.revert and readable after round-trip

  **QA Scenarios:**
  ```
  Scenario: Conversation-only revert skips snapshot
    Tool: Bash (bun test)
    Steps:
      1. Create session, send messages
      2. Call revert with mode: "conversation"
      3. Assert session.revert.mode === "conversation"
      4. Assert session.revert.snapshot === undefined
      5. Assert messages after revert point are still present (cleanup hasn't run)
    Expected: Revert marker set, no snapshot tracked, no files changed
    Evidence: .sisyphus/evidence/task-3-conversation-only-revert.txt

  Scenario: Default mode revert still tracks snapshot
    Tool: Bash (bun test)
    Steps:
      1. Create session, send messages
      2. Call revert with mode: "conversation_and_files" (or omit mode)
      3. Assert session.revert.snapshot is defined
    Expected: Backward-compatible behavior preserved
    Evidence: .sisyphus/evidence/task-3-default-mode-revert.txt
  ```

  **Commit**: YES
  - Message: `feat(session): add conversation-only revert mode`
  - Pre-commit: `bun test && bun typecheck`

- [ ] 4. Defensive unrevert — check restore success before clearing flag

  **What to do**:
  - In `SessionRevert.unrevert()` (`packages/opencode/src/session/revert.ts:93-101`), capture the result of `snap.restore()`
  - `Snapshot.restore()` currently logs errors but doesn't throw (`packages/opencode/src/snapshot/index.ts:276-300`). Either:
    - Make `restore()` return a boolean success indicator, OR
    - Wrap in try/catch and treat any error as failure
  - If restore fails AND `session.revert.mode !== "conversation"`, do NOT call `sessions.clearRevert()` — leave the revert marker in place
  - If `mode === "conversation"`, restore is irrelevant — always clear the revert flag

  **Must NOT do**:
  - Do not change the revert logic itself
  - Do not add foreign-machine detection yet (Task 6)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Task 6
  - **Blocked By**: Task 2

  **References**:
  - `packages/opencode/src/session/revert.ts:93-101` — unrevert()
  - `packages/opencode/src/snapshot/index.ts:276-300` — Snapshot.restore()

  **Acceptance Criteria**:
  - [ ] `bun typecheck` passes
  - [ ] Unrevert with working snapshot: clears revert flag, restores files
  - [ ] Unrevert with broken/missing snapshot: does NOT clear revert flag
  - [ ] Conversation-only unrevert: always clears flag regardless of snapshot

  **QA Scenarios:**
  ```
  Scenario: Failed restore keeps revert flag
    Tool: Bash (bun test)
    Steps:
      1. Revert a session with mode conversation_and_files
      2. Delete/corrupt the snapshot git object store
      3. Call unrevert
      4. Assert session.revert is still set (not cleared)
    Expected: Revert flag preserved on restore failure
    Evidence: .sisyphus/evidence/task-4-failed-restore-keeps-flag.txt

  Scenario: Conversation-only unrevert always clears
    Tool: Bash (bun test)
    Steps:
      1. Revert with mode: "conversation"
      2. Call unrevert
      3. Assert session.revert is null
    Expected: Flag cleared regardless of snapshot state
    Evidence: .sisyphus/evidence/task-4-conversation-unrevert-clears.txt
  ```

  **Commit**: YES
  - Message: `fix(session): make unrevert restore-safe`
  - Pre-commit: `bun test && bun typecheck`

- [ ] 5. Foreign-machine detection on revert

  **What to do**:
  - In `SessionRevert.revert()`, compare `session.originMachine` with current machine (`os.hostname()`)
  - If foreign AND mode is not explicitly `"conversation"`: force mode to `"conversation"` automatically
  - This means foreign-machine revert always skips file operations unless you explicitly asked for conversation-only (which already skips them)
  - Log a warning when auto-downgrading: `"Skipping file revert: session originated on different machine"`

  **Must NOT do**:
  - Do not block the revert entirely — conversation-level revert should always work
  - Do not change same-machine behavior

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 6, 7)
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 1, 3

  **References**:
  - `packages/opencode/src/session/revert.ts:42-90` — revert()
  - `packages/opencode/src/session/index.ts:156` — originMachine field

  **Acceptance Criteria**:
  - [ ] `bun typecheck` passes
  - [ ] Foreign-machine revert auto-downgrades to conversation mode
  - [ ] Same-machine revert with default mode still uses files
  - [ ] Warning logged on auto-downgrade

  **QA Scenarios:**
  ```
  Scenario: Foreign session auto-downgrades to conversation-only
    Tool: Bash (bun test)
    Steps:
      1. Create session with originMachine = "machine-a"
      2. Set current hostname to "machine-b" (or mock)
      3. Call revert without explicit mode
      4. Assert session.revert.mode === "conversation"
      5. Assert session.revert.snapshot === undefined
    Expected: File ops skipped, conversation revert proceeds
    Evidence: .sisyphus/evidence/task-5-foreign-revert-downgrade.txt
  ```

  **Commit**: YES
  - Message: `feat(session): detect foreign machine on revert`
  - Pre-commit: `bun test && bun typecheck`

- [ ] 6. Foreign-machine detection on unrevert

  **What to do**:
  - In `SessionRevert.unrevert()`, if session is foreign machine AND `session.revert.mode !== "conversation"`: treat as restore-failure path (don't attempt snap.restore, don't clear flag)
  - If `session.revert.mode === "conversation"`: clear flag normally (no files to restore)
  - Log warning when skipping restore on foreign machine

  **Must NOT do**:
  - Do not change same-machine unrevert behavior

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 5, 7)
  - **Blocks**: None
  - **Blocked By**: Tasks 1, 4

  **References**:
  - `packages/opencode/src/session/revert.ts:93-101` — unrevert()
  - `packages/opencode/src/session/index.ts:156` — originMachine field

  **Acceptance Criteria**:
  - [ ] `bun typecheck` passes
  - [ ] Foreign-machine unrevert of conversation_and_files revert: does NOT attempt restore, does NOT clear flag
  - [ ] Foreign-machine unrevert of conversation revert: clears flag normally

  **QA Scenarios:**
  ```
  Scenario: Foreign unrevert of file revert is blocked
    Tool: Bash (bun test)
    Steps:
      1. Create session with originMachine = "machine-a" and revert (conversation_and_files)
      2. On "machine-b", call unrevert
      3. Assert session.revert is still set
    Expected: Cannot unrevert file-backed revert on foreign machine
    Evidence: .sisyphus/evidence/task-6-foreign-unrevert-blocked.txt
  ```

  **Commit**: YES
  - Message: `feat(session): detect foreign machine on unrevert`
  - Pre-commit: `bun test && bun typecheck`

- [ ] 7. Guard cleanup entrypoints for foreign sessions

  **What to do**:
  - In `SessionRevert.cleanup()` (`packages/opencode/src/session/revert.ts:103-144`): before deleting messages, check if this is a foreign machine with `conversation_and_files` revert
  - If foreign + file-backed revert: auto-downgrade to conversation-only mode first (set `session.revert.mode = "conversation"`, persist), then proceed with message cleanup normally
  - This ensures that prompt continuation on a foreign machine cleans conversation but doesn't silently skip file state it can't undo
  - Guard all cleanup call sites in `packages/opencode/src/session/prompt.ts:746-748` and `1305-1309`

  **Must NOT do**:
  - Do not block prompt continuation — conversation cleanup should always proceed
  - Do not attempt file rollback on foreign machine

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 5, 6)
  - **Blocks**: None
  - **Blocked By**: Task 5

  **References**:
  - `packages/opencode/src/session/revert.ts:103-144` — cleanup()
  - `packages/opencode/src/session/prompt.ts:746-748,1305-1309` — cleanup trigger sites

  **Acceptance Criteria**:
  - [ ] `bun typecheck` passes
  - [ ] Foreign-machine prompt after file-backed revert: conversation cleaned, mode auto-set to conversation
  - [ ] Same-machine prompt after revert: existing behavior unchanged

  **QA Scenarios:**
  ```
  Scenario: Foreign prompt auto-cleans conversation only
    Tool: Bash (bun test)
    Steps:
      1. Create session with originMachine = "machine-a", revert with conversation_and_files mode
      2. On "machine-b", simulate prompt continuation
      3. Assert reverted messages are removed (conversation cleanup happened)
      4. Assert session.revert is cleared
      5. Assert no Snapshot API calls were made
    Expected: Conversation cleaned, files untouched, revert cleared
    Evidence: .sisyphus/evidence/task-7-foreign-cleanup.txt
  ```

  **Commit**: YES
  - Message: `fix(session): guard cleanup for foreign sessions`
  - Pre-commit: `bun test && bun typecheck`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `bun typecheck` from `packages/opencode`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
      Build binary. Test: (1) local session revert with files, (2) local conversation-only revert without files, (3) foreign-machine resume with pending revert auto-cleans, (4) unrevert after failed restore keeps flag. Save evidence.
      Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual diff. Verify 1:1. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
      Output: `Tasks [N/N compliant] | VERDICT`

---

## Commit Strategy

| Task | Commit Message                                          | Pre-commit                  |
| ---- | ------------------------------------------------------- | --------------------------- |
| 1    | `feat(session): persist machine provenance on sessions` | `bun test && bun typecheck` |
| 2    | `fix(server): hydrate revert and unrevert routes`       | `bun test && bun typecheck` |
| 3    | `feat(session): add conversation-only revert mode`      | `bun test && bun typecheck` |
| 4    | `fix(session): make unrevert restore-safe`              | `bun test && bun typecheck` |
| 5    | `feat(session): detect foreign machine on revert`       | `bun test && bun typecheck` |
| 6    | `feat(session): detect foreign machine on unrevert`     | `bun test && bun typecheck` |
| 7    | `fix(session): guard cleanup for foreign sessions`      | `bun test && bun typecheck` |

---

## Success Criteria

### Verification Commands

```bash
# From packages/opencode:
bun typecheck                                    # Expected: exit 0
bun test test/session/resolve-routing.test.ts    # Expected: all pass
bun test test/session/revert-compact.test.ts     # Expected: all pass
bun test test/session/cross-machine-revert.test.ts  # Expected: all pass (new)
OPENCODE_VERSION="0.0.0-local" bun run script/build.ts  # Expected: exit 0
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] originMachine persisted, projected, synced, migrated
- [ ] Conversation-only revert works without touching snapshot
- [ ] Foreign sessions disable file ops
- [ ] Unrevert doesn't clear flag on restore failure
- [ ] Same-machine behavior unchanged
