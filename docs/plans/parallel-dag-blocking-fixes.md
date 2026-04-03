# Parallel Agents DAG & Blocking Issues — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix the critical bugs in Opencode's parallel agents system where tasks get blocked and the orchestrator incorrectly kills the DAG. Improve robustness, deadlock detection, and recovery.

**Architecture:** 
- The system uses a DAG-based parallel execution with worktrees or task-agents
- Workers are spawned based on dependency graphs and wave scheduling
- The orchestrator tracks worker status and handles integration/merging
- Current issues: tasks blocked waiting on failed dependencies, premature DAG termination, race conditions in spawn/wait

**Tech Stack:** TypeScript, Bun, SQLite (drizzle-orm), Git worktrees

**Key Pain Points Identified:**
1. When a worker fails, its dependents stay "pending" forever (blocked but not marked)
2. The orchestrator kills the DAG when workers are still "running" after wait
3. Wave scheduling doesn't properly cascade failures
4. No deadlock detection for circular waits
5. Recovery doesn't properly handle partial completions

---

## Task 1: Add Blocked Status for Failed Dependencies

**Objective:** When a worker's dependency fails, mark the dependent worker as "blocked" (not "pending") so the orchestrator knows it's intentionally not running.

**Files:**
- Modify: `packages/opencode/src/parallel/worker.ts:946-976` (getReadySubtasks function)
- Modify: `packages/opencode/src/parallel/schema.ts` (WorkerStatus type if needed)
- Test: `packages/opencode/test/tool/parallel-plan.test.ts`

**Step 1: Write failing test**

```typescript
// Add to parallel-plan.test.ts
test("marks dependent workers as blocked when dependency fails", async () => {
  // Create a plan with 2 subtasks where B depends on A
  // Fail subtask A
  // Verify subtask B is marked as "blocked" not "pending"
})
```

**Step 2: Run test to verify failure**

```bash
cd packages/opencode
bun test test/tool/parallel-plan.test.ts -t "marks dependent workers as blocked"
```
Expected: FAIL — workers stay "pending"

**Step 3: Modify getReadySubtasks to track blocked status**

In `worker.ts`, modify the filtering logic to:
1. Check if any dependency has failed
2. If so, update the worker status to "blocked" via updateWorker
3. Return false from getReadySubtasks for blocked workers

**Step 4: Run test to verify pass**

```bash
bun test test/tool/parallel-plan.test.ts -t "marks dependent workers as blocked"
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/parallel/worker.ts packages/opencode/test/tool/parallel-plan.test.ts
git commit -m "feat(parallel): mark workers as blocked when dependencies fail"
```

---

## Task 2: Fix Orchestrator Premature DAG Kill

**Objective:** The orchestrator at line 801-818 kills the plan when workers are "still active" — but this happens because blocked workers aren't being distinguished from truly stuck workers.

**Files:**
- Modify: `packages/opencode/src/parallel/orchestrator.ts:801-818`
- Modify: `packages/opencode/src/parallel/orchestrator.ts:60-66` (unresolved/inflight functions)

**Step 1: Write failing test**

```typescript
// Add test: orchestrator should not kill DAG when workers are blocked (not running)
test("orchestrator continues when workers are blocked, not stuck", async () => {
  // Create plan with failed dependency causing blocked downstream
  // Verify orchestrator doesn't fail the plan with "workers_incomplete"
})
```

**Step 2: Run test to verify failure**

```bash
bun test test/tool/parallel-plan.test.ts -t "orchestrator continues when workers are blocked"
```
Expected: FAIL

**Step 3: Fix orchestrator unresolved() logic**

Modify `unresolved()` function to exclude "blocked" workers:
```typescript
function unresolved(workers: Plan["workers"]) {
  return workers.filter((worker) => !["done", "merged", "failed", "conflict", "blocked"].includes(worker.status))
}
```

Modify the `execute()` function at line 801 to:
1. Separate "running" workers from "blocked" workers
2. Only fail if workers are truly running (not blocked)

**Step 4: Run test to verify pass**

```bash
bun test test/tool/parallel-plan.test.ts -t "orchestrator continues when workers are blocked"
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/parallel/orchestrator.ts
git commit -m "fix(parallel): don't kill DAG when workers are blocked vs running"
```

---

## Task 3: Add Deadlock Detection to spawnAll

**Objective:** Detect when the spawn loop can't make progress because all remaining subtasks have failed dependencies (deadlock).

**Files:**
- Modify: `packages/opencode/src/parallel/worker.ts:1037-1105` (spawnNextBatch loop)

**Step 1: Write failing test**

```typescript
test("detects deadlock when all remaining subtasks have failed dependencies", async () => {
  // Create plan: A -> B -> C (chain)
  // Fail A
  // Verify deadlock is detected and remaining workers marked appropriately
})
```

**Step 2: Run test to verify failure**

```bash
bun test test/tool/parallel-plan.test.ts -t "detects deadlock"
```
Expected: FAIL

**Step 3: Add deadlock detection**

In `spawnAll()`, track:
1. `remaining = subtasks - completed - failed - running - blocked`
2. If `ready.length === 0` but `remaining.length > 0` for multiple consecutive checks → deadlock
3. When deadlock detected: mark remaining as "blocked" with reason

Add a counter in the spawn loop that increments when no progress is made, and after threshold (e.g., 3 checks with no new spawns), mark remaining workers appropriately.

**Step 4: Run test to verify pass**

```bash
bun test test/tool/parallel-plan.test.ts -t "detects deadlock"
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/parallel/worker.ts packages/opencode/test/tool/parallel-plan.test.ts
git commit -m "feat(parallel): add deadlock detection for failed dependency chains"
```

---

## Task 4: Improve Wave Scheduling Failure Cascade

**Objective:** When wave scheduling is active and a task in wave N fails, properly handle wave N+1 dependencies.

**Files:**
- Modify: `packages/opencode/src/parallel/scheduler.ts` (add cascade helper)
- Modify: `packages/opencode/src/parallel/worker.ts:963-972` (wave-aware readiness)

**Step 1: Write failing test**

```typescript
test("wave scheduling properly cascades failures to subsequent waves", async () => {
  // Create plan with wave 0 (parallel), wave 1 (depends on wave 0)
  // Fail a task in wave 0
  // Verify wave 1 tasks are marked blocked, not just pending
})
```

**Step 2: Run test to verify failure**

```bash
bun test test/tool/parallel-plan.test.ts -t "wave scheduling properly cascades failures"
```
Expected: FAIL

**Step 3: Fix wave scheduling logic**

In `getReadySubtasks()` at line 957-972, the wave check only verifies earlier waves are "completed or failed" — but it should also mark downstream workers as blocked when earlier waves have failures.

Add logic: if any task in an earlier wave failed, mark all dependents as blocked.

**Step 4: Run test to verify pass**

```bash
bun test test/tool/parallel-plan.test.ts -t "wave scheduling properly cascades failures"
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/parallel/worker.ts packages/opencode/src/parallel/scheduler.ts
git commit -m "fix(parallel): cascade failures properly in wave scheduling"
```

---

## Task 5: Fix Race Condition in spawnAll/waitAll Handoff

**Objective:** There's a potential race where spawnAll completes but workers are still transitioning to "running" when waitAll checks.

**Files:**
- Modify: `packages/opencode/src/parallel/worker.ts:1104-1149` (spawnAll completion)
- Modify: `packages/opencode/src/parallel/orchestrator.ts:786-797` (waitAll check)

**Step 1: Write failing test**

```typescript
test("no race condition between spawnAll completion and waitAll check", async () => {
  // Create plan and verify workers in "spawning" state are properly waited for
})
```

**Step 2: Run test to verify failure**

May be intermittent — run multiple times:
```bash
for i in {1..5}; do bun test test/tool/parallel-plan.test.ts -t "no race condition"; done
```

**Step 3: Add synchronization**

In `spawnAll()`, before returning:
1. Wait for all workers to transition out of "spawning" state
2. Or include "spawning" in the "still running" check in orchestrator

In `orchestrator.ts:787`, change:
```typescript
const stillRunning = afterSpawn.workers.filter((w) => ["running", "spawning"].includes(w.status))
```

**Step 4: Run test to verify pass**

```bash
bun test test/tool/parallel-plan.test.ts -t "no race condition"
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/parallel/worker.ts packages/opencode/src/parallel/orchestrator.ts
git commit -m "fix(parallel): eliminate spawn/wait race condition"
```

---

## Task 6: Add Better Recovery for Partial Failures

**Objective:** When some workers succeed and others fail, recovery should allow continuing from partial state rather than full restart.

**Files:**
- Modify: `packages/opencode/src/parallel/recovery.ts:200-350`
- Modify: `packages/opencode/src/parallel/orchestrator.ts:1023-1080` (retry function)

**Step 1: Write failing test**

```typescript
test("recovery preserves successful workers and only retries failed", async () => {
  // Create plan where 2 workers succeed, 1 fails
  // Retry the plan
  // Verify successful workers are preserved, only failed is retried
})
```

**Step 2: Run test to verify failure**

```bash
bun test test/tool/parallel-plan.test.ts -t "recovery preserves successful workers"
```
Expected: FAIL

**Step 3: Implement selective retry**

Modify `Orchestrator.retry()`:
1. Preserve workers with status "done" or "merged"
2. Only reset "failed" and "conflict" workers to "pending"
3. Update waves based on preserved completions

**Step 4: Run test to verify pass**

```bash
bun test test/tool/parallel-plan.test.ts -t "recovery preserves successful workers"
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/parallel/recovery.ts packages/opencode/src/parallel/orchestrator.ts
git commit -m "feat(parallel): selective retry preserves successful workers"
```

---

## Task 7: Improve Logging and Observability

**Objective:** Add detailed logging at key decision points to make debugging blocking issues easier.

**Files:**
- Modify: `packages/opencode/src/parallel/worker.ts:978-985` (spawn logging)
- Modify: `packages/opencode/src/parallel/orchestrator.ts:801-818` (kill decision logging)

**Step 1: Add detailed logging**

In `spawnAll()`, add logging that shows:
- Why each subtask is NOT ready (dependency missing, blocked, wave not ready)
- Current state of dependency graph
- Wave scheduling decisions

In `orchestrator.execute()`, before killing the plan:
- Log the state of each "active" worker
- Explain why they are considered "active"
- Show blocked vs running distinction

**Step 2: Verify logging works**

```bash
cd packages/opencode
bun run src/parallel/worker.ts 2>&1 | head -50
```

**Step 3: Commit**

```bash
git add packages/opencode/src/parallel/worker.ts packages/opencode/src/parallel/orchestrator.ts
git commit -m "feat(parallel): add detailed logging for debugging blocking issues"
```

---

## Task 8: Run Full Test Suite

**Objective:** Ensure all changes work together and don't break existing functionality.

**Files:**
- All parallel-related tests

**Step 1: Run all parallel tests**

```bash
cd packages/opencode
bun test test/tool/parallel-plan.test.ts
bun test test/tool/task.test.ts
```

**Step 2: Run full test suite**

```bash
bun test
```

**Step 3: Fix any regressions**

If any tests fail, debug and fix.

**Step 4: Commit**

```bash
git add -A
git commit -m "test(parallel): all tests pass after blocking/deadlock fixes"
```

---

## Task 9: Create Integration Test for Complex DAG

**Objective:** Create a comprehensive test that exercises the full DAG with failures, blocks, and recovery.

**Files:**
- Create: `packages/opencode/test/tool/parallel-dag-complex.test.ts`

**Step 1: Write complex DAG test**

```typescript
// Complex DAG:
// Wave 0: A, B (parallel, no deps)
// Wave 1: C (depends on A), D (depends on B)
// Wave 2: E (depends on C, D)
// 
// Scenario: A succeeds, B fails
// Expected: C blocked (A done, but B failed so D blocked, so E blocked)
```

**Step 2: Run and verify**

```bash
bun test test/tool/parallel-dag-complex.test.ts
```

**Step 3: Commit**

```bash
git add packages/opencode/test/tool/parallel-dag-complex.test.ts
git commit -m "test(parallel): add complex DAG integration test"
```

---

## Task 10: Final Review and PR Creation

**Objective:** Review all changes and create PR.

**Step 1: Review all commits**

```bash
git log --oneline feat/parallel-blocking-fixes..HEAD
```

**Step 2: Verify clean working tree**

```bash
git status
```

**Step 3: Run final tests**

```bash
cd packages/opencode
bun test
```

**Step 4: Create PR to feature/power-agents**

```bash
gh pr create \
  --title "fix(parallel): resolve DAG blocking and orchestrator kill issues" \
  --body "## Summary
Fixes critical bugs in parallel execution where:
- Tasks blocked on failed dependencies stayed 'pending' forever
- Orchestrator prematurely killed DAGs when workers were blocked (not running)
- No deadlock detection for failed dependency chains
- Wave scheduling didn't properly cascade failures

## Changes
- Added 'blocked' status for workers with failed dependencies
- Fixed orchestrator to distinguish blocked vs running workers
- Added deadlock detection in spawn loop
- Improved wave scheduling failure cascade
- Fixed spawn/wait race condition
- Added selective retry (preserve successful workers)
- Added detailed logging for debugging

## Test Plan
- [x] All new tests pass
- [x] Existing parallel-plan tests pass
- [x] Complex DAG integration test passes
- [x] Full test suite passes

Closes #[issue if applicable]"
```

---

## Summary

This plan addresses the core issues:
1. **Blocked status** — Properly track when workers can't run due to failed deps
2. **Orchestrator kill** — Don't kill DAG for blocked workers
3. **Deadlock detection** — Detect and handle impossible-to-complete plans
4. **Wave cascade** — Properly propagate failures through waves
5. **Race condition** — Ensure spawn/wait handoff is clean
6. **Selective retry** — Don't throw away successful work on retry
7. **Observability** — Make debugging these issues easier next time

Total: 10 tasks, estimated 2-4 hours of work with subagent-driven-development.
