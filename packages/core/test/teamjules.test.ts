import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { TeamJules } from "@opencode-ai/core/teamjules"
import { TeamJulesTaskTable, TeamJulesWorkerTable } from "@opencode-ai/core/teamjules/sql"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([TeamJules.node, Database.node])))

describe("TeamJules", () => {
  it.live("creates, gets, and cancels tasks", () =>
    Effect.gen(function* () {
      const teamjules = yield* TeamJules.Service

      const task = yield* teamjules.createTask({
        type: "issue",
        repo: "anomalyco/opencode",
        branch: "dev",
        prompt: "Fix issue with tests",
      })

      expect(task.id).toBeDefined()
      expect(task.status).toBe("pending")
      expect(task.repo).toBe("anomalyco/opencode")
      expect(task.branch).toBe("dev")
      expect(task.prompt).toBe("Fix issue with tests")
      expect(task.attempt_count).toBe(0)

      const fetched = yield* teamjules.getTask(task.id)
      expect(fetched).toBeDefined()
      expect(fetched?.id).toBe(task.id)

      yield* teamjules.cancelTask(task.id)
      const cancelled = yield* teamjules.getTask(task.id)
      expect(cancelled?.status).toBe("cancelled")
    }),
  )

  it.live("filters tasks by single condition and multi-conditions (status and repo)", () =>
    Effect.gen(function* () {
      const teamjules = yield* TeamJules.Service
      const uniqueRepo = `test-repo-${Date.now()}`

      const t1 = yield* teamjules.createTask({
        type: "manual",
        repo: uniqueRepo,
        branch: "main",
        prompt: "Task 1",
      })

      const t2 = yield* teamjules.createTask({
        type: "manual",
        repo: uniqueRepo,
        branch: "main",
        prompt: "Task 2",
      })

      yield* teamjules.cancelTask(t1.id)

      // Filter by repo only
      const byRepo = yield* teamjules.listTasks({ repo: uniqueRepo })
      expect(byRepo.length).toBe(2)

      // Filter by both repo AND status (pending)
      const pendingInRepo = yield* teamjules.listTasks({ repo: uniqueRepo, status: "pending" })
      expect(pendingInRepo.length).toBe(1)
      expect(pendingInRepo[0]?.id).toBe(t2.id)

      // Filter by both repo AND status (cancelled)
      const cancelledInRepo = yield* teamjules.listTasks({ repo: uniqueRepo, status: "cancelled" })
      expect(cancelledInRepo.length).toBe(1)
      expect(cancelledInRepo[0]?.id).toBe(t1.id)
    }),
  )

  it.live("claims tasks atomically and completes or fails them", () =>
    Effect.gen(function* () {
      const teamjules = yield* TeamJules.Service

      const worker = yield* teamjules.registerWorker()
      expect(worker.id).toBeDefined()
      expect(worker.status).toBe("idle")

      const task = yield* teamjules.createTask({
        type: "pr",
        repo: "anomalyco/opencode",
        branch: "main",
        prompt: "Review PR #42",
      })

      const claimed = yield* teamjules.claimTask(worker.id)
      expect(claimed).toBeDefined()
      expect(claimed?.id).toBe(task.id)
      expect(claimed?.status).toBe("running")
      expect(claimed?.worker_id).toBe(worker.id)
      expect(claimed?.attempt_count).toBe(1)

      // No second claim should get this task
      const secondClaim = yield* teamjules.claimTask(worker.id)
      expect(secondClaim?.id).not.toBe(task.id)

      // Complete task
      yield* teamjules.completeTask(task.id, { commit_sha: "abc1234" })
      const completed = yield* teamjules.getTask(task.id)
      expect(completed?.status).toBe("completed")
      expect(completed?.result?.commit_sha).toBe("abc1234")
    }),
  )

  it.live("recovers expired running tasks (zombie task recovery)", () =>
    Effect.gen(function* () {
      const teamjules = yield* TeamJules.Service
      const { db } = yield* Database.Service

      const worker1 = yield* teamjules.registerWorker()
      const worker2 = yield* teamjules.registerWorker()

      const task = yield* teamjules.createTask({
        type: "manual",
        repo: "anomalyco/opencode",
        branch: "main",
        prompt: "Zombie recovery test",
      })

      // Worker 1 claims it
      const claimed = yield* teamjules.claimTask(worker1.id)
      expect(claimed?.id).toBe(task.id)

      // Simulate lease expiration by setting time_updated to 60 seconds ago
      yield* db
        .update(TeamJulesTaskTable)
        .set({ time_updated: Date.now() - 60_000 })
        .where(eq(TeamJulesTaskTable.id, task.id))
        .run()
        .pipe(Effect.orDie)

      // Worker 2 should now be able to reclaim the expired task
      const reclaimed = yield* teamjules.claimTask(worker2.id)
      expect(reclaimed).toBeDefined()
      expect(reclaimed?.id).toBe(task.id)
      expect(reclaimed?.worker_id).toBe(worker2.id)
      expect(reclaimed?.attempt_count).toBe(2)

      yield* teamjules.deregisterWorker(worker1.id)
      yield* teamjules.deregisterWorker(worker2.id)
    }),
  )

  it.live("handles heartbeat and active lease renewal", () =>
    Effect.gen(function* () {
      const teamjules = yield* TeamJules.Service
      const worker = yield* teamjules.registerWorker()

      const task = yield* teamjules.createTask({
        type: "manual",
        repo: "anomalyco/opencode",
        branch: "main",
        prompt: "Heartbeat lease test",
      })

      yield* teamjules.claimTask(worker.id)
      yield* teamjules.heartbeat(worker.id)

      const updatedTask = yield* teamjules.getTask(task.id)
      expect(updatedTask?.time_updated).toBeGreaterThanOrEqual(Date.now() - 1000)

      yield* teamjules.deregisterWorker(worker.id)
    }),
  )

  it.live("retries failed tasks up to max_attempts", () =>
    Effect.gen(function* () {
      const teamjules = yield* TeamJules.Service
      const worker = yield* teamjules.registerWorker()

      const task = yield* teamjules.createTask({
        type: "manual",
        repo: "anomalyco/opencode",
        branch: "main",
        prompt: "Retry test",
      })

      yield* teamjules.claimTask(worker.id)
      yield* teamjules.failTask(task.id, "Attempt 1 failed")

      // Since attempt 1 < max_attempts 3, status resets to pending
      const retrying = yield* teamjules.getTask(task.id)
      expect(retrying?.status).toBe("pending")

      // Manual retryTask resets attempt count
      yield* teamjules.retryTask(task.id)
      const retried = yield* teamjules.getTask(task.id)
      expect(retried?.status).toBe("pending")
      expect(retried?.attempt_count).toBe(0)

      yield* teamjules.deregisterWorker(worker.id)
    }),
  )

  it.live("tracks worker busy/idle status transition on task claim, complete, and fail", () =>
    Effect.gen(function* () {
      const teamjules = yield* TeamJules.Service
      const { db } = yield* Database.Service
      const worker = yield* teamjules.registerWorker()

      const getWorker = () =>
        db
          .select()
          .from(TeamJulesWorkerTable)
          .where(eq(TeamJulesWorkerTable.id, worker.id))
          .get()
          .pipe(Effect.orDie)

      const initialWorker = yield* getWorker()
      expect(initialWorker?.status).toBe("idle")

      const task = yield* teamjules.createTask({
        type: "manual",
        repo: "anomalyco/opencode",
        branch: "main",
        prompt: "Worker status transition test",
      })

      // Claim sets worker to busy
      const claimed = yield* teamjules.claimTask(worker.id)
      expect(claimed?.id).toBe(task.id)
      const busyWorker = yield* getWorker()
      expect(busyWorker?.status).toBe("busy")

      // Complete resets worker to idle
      yield* teamjules.completeTask(task.id, { commit_sha: "test_sha" })
      const idleWorker = yield* getWorker()
      expect(idleWorker?.status).toBe("idle")

      // Next task: Fail also resets worker to idle
      const task2 = yield* teamjules.createTask({
        type: "manual",
        repo: "anomalyco/opencode",
        branch: "main",
        prompt: "Worker status fail test",
      })
      yield* teamjules.claimTask(worker.id)
      expect((yield* getWorker())?.status).toBe("busy")

      yield* teamjules.failTask(task2.id, "Fatal task error")
      expect((yield* getWorker())?.status).toBe("idle")

      yield* teamjules.deregisterWorker(worker.id)
    }),
  )
})
