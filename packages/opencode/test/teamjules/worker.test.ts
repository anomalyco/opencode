import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createWorker } from "@/teamjules/worker"
import type { TeamJules, WorkerID } from "@opencode-ai/core/teamjules"

describe("TeamJules Worker", () => {
  test("worker starts, claims tasks, heartbeats, and stops cleanly", async () => {
    let heartbeats = 0
    let registeredWorkerId: WorkerID | null = null
    let deregisteredWorkerId: WorkerID | null = null
    const claimedTasks: string[] = []

    const mockWorkerId = "w_test_worker_123" as WorkerID

    const mockService = {
      registerWorker: () =>
        Effect.sync(() => {
          registeredWorkerId = mockWorkerId
          return { id: mockWorkerId, status: "idle" } as any
        }),
      deregisterWorker: (id: any) =>
        Effect.sync(() => {
          deregisteredWorkerId = id
        }),
      heartbeat: (id: any) =>
        Effect.sync(() => {
          heartbeats++
        }),
      claimTask: (workerId: any) =>
        Effect.sync(() => {
          if (claimedTasks.length === 0) {
            claimedTasks.push("tj_mock_1")
            return {
              id: "tj_mock_1",
              type: "manual",
              status: "running",
              repo: "test/repo",
              branch: "main",
              prompt: "test task",
              attempt_count: 1,
              max_attempts: 3,
            } as any
          }
          return undefined
        }),
      completeTask: () => Effect.void,
      failTask: () => Effect.void,
    } as unknown as TeamJules.Interface

    const mockRunner = {
      run: async () => ({ commit_sha: "mock_sha_123" }),
    }

    const worker = createWorker(mockService, {
      pollIntervalMs: 20,
      runner: mockRunner,
    })

    await worker.start()
    expect(registeredWorkerId as WorkerID | null).toBe(mockWorkerId)

    // Wait a brief period for poll and heartbeat
    await new Promise((r) => setTimeout(r, 60))

    expect(heartbeats).toBeGreaterThanOrEqual(1)
    expect(claimedTasks).toContain("tj_mock_1")

    await worker.stop()
    expect(deregisteredWorkerId as WorkerID | null).toBe(mockWorkerId)
  })

  test("maintains periodic heartbeats during prolonged task processing", async () => {
    let heartbeats = 0
    const mockWorkerId = "w_prolonged_worker" as WorkerID

    const mockService = {
      registerWorker: () =>
        Effect.sync(() => ({ id: mockWorkerId, status: "idle" } as any)),
      deregisterWorker: () => Effect.void,
      heartbeat: () =>
        Effect.sync(() => {
          heartbeats++
        }),
      claimTask: () =>
        Effect.sync(() => ({
          id: "tj_long_1",
          type: "manual",
          status: "running",
          repo: "test/repo",
          branch: "main",
          prompt: "long task",
          attempt_count: 1,
          max_attempts: 3,
        } as any)),
      completeTask: () => Effect.void,
      failTask: () => Effect.void,
    } as unknown as TeamJules.Interface

    // Runner simulates a task that takes 80ms
    const slowRunner = {
      run: async () => {
        await new Promise((r) => setTimeout(r, 80))
        return { commit_sha: "slow_sha" }
      },
    }

    const worker = createWorker(mockService, {
      pollIntervalMs: 500,
      heartbeatIntervalMs: 20,
      runner: slowRunner,
    })

    await worker.start()

    // Wait 70ms while task is executing
    await new Promise((r) => setTimeout(r, 70))
    // Task should have triggered several heartbeats via activeHeartbeat
    expect(heartbeats).toBeGreaterThanOrEqual(2)

    await worker.stop()
  })
})
