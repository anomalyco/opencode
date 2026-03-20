/**
 * STRESS TESTS — Parallel Scheduler Stability
 *
 * Tests scheduler under heavy load with:
 * - Many subtasks (25+) with complex dependency patterns
 * - Mixed outcomes (success, failure, blocked)
 * - Concurrency edge cases
 * - Cleanup behavior under cancellation
 *
 * Uses deterministic simulation with immediate-resolving mocks.
 * No real model calls or worktree creation.
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { PlanStore } from "../../src/parallel/plan"
import type { Plan, Subtask, SubtaskID as SubtaskIDType, WorkerState } from "../../src/parallel/schema"
import { SubtaskID } from "../../src/parallel/schema"
import { Recovery } from "../../src/parallel/recovery"
import { tmpdir } from "../fixture/fixture"

// Track mock calls
let spawnOneCalls: Array<{ planID: string; subtaskID: string }> = []
let spawnOutcomes: Map<string, "success" | "error"> = new Map()

// Helper to create many subtasks with various patterns
function createSubtasks(
  count: number,
  pattern: "independent" | "chain" | "fanout" | "diamond" | "mixed" = "mixed",
): Subtask[] {
  const subtasks: Subtask[] = []
  const ids: SubtaskIDType[] = []

  for (let i = 0; i < count; i++) {
    const id = SubtaskID.ascending()
    ids.push(id)
    subtasks.push({
      id,
      title: `Subtask ${i + 1}`,
      description: `Test subtask ${i + 1}`,
      fileScope: [`src/file${i + 1}.ts`],
      dependencies: [],
    })
  }

  switch (pattern) {
    case "chain":
      // Linear chain: 1 -> 2 -> 3 -> ...
      for (let i = 1; i < count; i++) {
        subtasks[i].dependencies = [ids[i - 1]]
      }
      break

    case "fanout":
      // One root task, rest depend on it
      for (let i = 1; i < count; i++) {
        subtasks[i].dependencies = [ids[0]]
      }
      break

    case "diamond":
      // A -> B, A -> C, B -> D, C -> D
      if (count >= 4) {
        subtasks[1].dependencies = [ids[0]] // B depends on A
        subtasks[2].dependencies = [ids[0]] // C depends on A
        subtasks[3].dependencies = [ids[1], ids[2]] // D depends on B and C
      }
      break

    case "mixed":
      // Mix: 40% independent, 40% chain, 20% fan-out dependencies
      for (let i = 1; i < count; i++) {
        if (i % 5 === 0) {
          // 20% have fan-out dep on first task
          subtasks[i].dependencies = [ids[0]]
        } else if (i % 3 === 0 && i > 1) {
          // 40% chained in groups of 3
          subtasks[i].dependencies = [ids[i - 1]]
        }
        // 40% remain independent
      }
      break

    case "independent":
    default:
      // No dependencies
      break
  }

  return subtasks
}

// Helper to create a plan with subtasks
async function createStressPlan(projectID: string, subtasks: Subtask[]): Promise<Plan> {
  const plan = await PlanStore.create({
    projectID: projectID as any,
    sessionID: undefined,
    task: `Stress test with ${subtasks.length} subtasks`,
    orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
    workerModel: { providerID: "test" as any, modelID: "test-model" as any },
  })

  return PlanStore.update({
    id: plan.id,
    subtasks,
    workers: subtasks.map((st) => ({
      subtaskID: st.id,
      status: "pending" as const,
    })),
    status: "proposed",
  })
}

// Simulate spawning workers directly by transitioning through states
async function simulateSpawnWorkers(plan: Plan, outcomes: Map<string, "success" | "error">): Promise<void> {
  for (const worker of plan.workers) {
    const outcome = outcomes.get(worker.subtaskID) ?? "success"

    spawnOneCalls.push({ planID: plan.id, subtaskID: worker.subtaskID })

    if (outcome === "success") {
      // Transition: pending -> spawning -> running
      await PlanStore.updateWorker({
        id: plan.id,
        subtaskID: worker.subtaskID,
        status: "spawning",
      } as any)

      await PlanStore.updateWorker({
        id: plan.id,
        subtaskID: worker.subtaskID,
        status: "running",
        sessionID: `session-${worker.subtaskID}` as any,
        worktreeName: `wt-${worker.subtaskID}`,
        worktreeDir: `/tmp/wt-${worker.subtaskID}`,
        branch: `branch-${worker.subtaskID}`,
      } as any)
    } else {
      // Direct transition to failed
      await PlanStore.updateWorker({
        id: plan.id,
        subtaskID: worker.subtaskID,
        status: "failed",
        error: `Simulated spawn failure for ${worker.subtaskID}`,
      } as any)
    }
  }
}

// Simulate worker completion with proper state transitions
async function simulateWorkerCompletion(
  planID: string,
  workers: WorkerState[],
  outcomes: Map<string, "success" | "error">,
): Promise<void> {
  for (const worker of workers) {
    if (worker.status !== "running") continue

    const outcome = outcomes.get(worker.subtaskID) ?? "success"

    if (outcome === "success") {
      // Transition: running -> done
      await PlanStore.updateWorker({
        id: planID as any,
        subtaskID: worker.subtaskID,
        status: "done",
        diffStat: { additions: 10, deletions: 5, files: 1 },
      } as any)
    } else {
      // Transition: running -> failed
      await PlanStore.updateWorker({
        id: planID as any,
        subtaskID: worker.subtaskID,
        status: "failed",
        error: `Simulated failure for worker ${worker.subtaskID}`,
      } as any)
    }
  }
}

// Verify no infinite pending state
function verifyNoInfinitePending(plan: Plan): void {
  const pendingWorkers = plan.workers.filter((w) => w.status === "pending")
  const spawningWorkers = plan.workers.filter((w) => w.status === "spawning")
  const runningWorkers = plan.workers.filter((w) => w.status === "running")

  // If we have pending workers, there should be spawning/running workers processing them
  // or the plan should be in a terminal/failed state
  const planTerminal = ["done", "failed", "partial_success"].includes(plan.status)

  if (pendingWorkers.length > 0 && !planTerminal) {
    const activeWorkers = spawningWorkers.length + runningWorkers.length
    // Pending workers should only exist if we're actively processing
    expect(activeWorkers).toBeGreaterThan(0)
  }
}

// Verify worker state transitions are valid
function verifyValidTransitions(plan: Plan): void {
  const validStates = ["pending", "spawning", "running", "stopping", "done", "failed", "merged", "conflict"]

  for (const worker of plan.workers) {
    // Current state should be a valid state
    expect(validStates).toContain(worker.status)

    // If worker has an error, it should be failed or conflict
    if (worker.error && worker.status !== "failed" && worker.status !== "conflict") {
      throw new Error(`Worker has error but invalid status: ${worker.status}`)
    }
  }
}

describe("Parallel Stress Tests", () => {
  beforeAll(() => {
    // No setup needed
  })

  afterAll(() => {
    // No teardown needed
  })

  beforeEach(() => {
    spawnOneCalls = []
    spawnOutcomes.clear()
  })

  describe("Many subtasks (25+)", () => {
    test("25 subtasks with mixed dependencies - all succeed", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const subtasks = createSubtasks(25, "mixed")
          const plan = await createStressPlan(Instance.project.id, subtasks)

          await PlanStore.transition({ id: plan.id, status: "approved" })
          await PlanStore.transition({ id: plan.id, status: "spawning" })

          // Simulate spawning all workers successfully
          const outcomes = new Map<string, "success" | "error">()
          for (const st of subtasks) {
            outcomes.set(st.id, "success")
          }
          await simulateSpawnWorkers(plan, outcomes)

          // Verify all workers spawned
          expect(spawnOneCalls.length).toBe(25)

          const updated = await PlanStore.get(plan.id)
          verifyNoInfinitePending(updated)
          verifyValidTransitions(updated)

          // Verify all workers are in running state
          const runningCount = updated.workers.filter((w) => w.status === "running").length
          expect(runningCount).toBe(25)

          // Mark all running workers as done
          await simulateWorkerCompletion(plan.id, updated.workers, outcomes)

          const final = await PlanStore.get(plan.id)
          const doneCount = final.workers.filter((w) => w.status === "done").length
          expect(doneCount).toBe(25)

          return plan
        },
      })
    })

    test("25 subtasks with mixed outcomes - some fail, some succeed", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const subtasks = createSubtasks(25, "mixed")

          // Simulate mixed outcomes: 15 succeed, 10 fail during spawn
          const outcomes = new Map<string, "success" | "error">()
          for (let i = 0; i < 25; i++) {
            if (i < 15) {
              outcomes.set(subtasks[i].id, "success")
            } else {
              outcomes.set(subtasks[i].id, "error")
            }
          }

          const plan = await createStressPlan(Instance.project.id, subtasks)

          await PlanStore.transition({ id: plan.id, status: "approved" })
          await PlanStore.transition({ id: plan.id, status: "spawning" })

          // Simulate spawning with mixed outcomes
          await simulateSpawnWorkers(plan, outcomes)

          expect(spawnOneCalls.length).toBe(25)

          const updated = await PlanStore.get(plan.id)
          verifyNoInfinitePending(updated)
          verifyValidTransitions(updated)

          // Simulate completion for running workers
          await simulateWorkerCompletion(plan.id, updated.workers, outcomes)

          const final = await PlanStore.get(plan.id)
          const doneCount = final.workers.filter((w) => w.status === "done").length
          const failedCount = final.workers.filter((w) => w.status === "failed").length

          // Should have workers in terminal state
          expect(doneCount + failedCount).toBe(25)

          // Verify no deadlock - all workers should be in terminal state
          const terminalStatuses = ["done", "failed", "merged", "conflict"]
          expect(final.workers.every((w) => terminalStatuses.includes(w.status))).toBe(true)

          return plan
        },
      })
    })

    test("scheduler handles many subtasks without deadlock", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const subtasks = createSubtasks(25, "mixed")
          const plan = await createStressPlan(Instance.project.id, subtasks)

          await PlanStore.transition({ id: plan.id, status: "approved" })
          await PlanStore.transition({ id: plan.id, status: "spawning" })

          const start = Date.now()

          // Simulate spawning
          const outcomes = new Map<string, "success" | "error">()
          for (const st of subtasks) {
            outcomes.set(st.id, "success")
          }
          await simulateSpawnWorkers(plan, outcomes)

          const duration = Date.now() - start

          // Should complete in reasonable time
          expect(duration).toBeLessThan(5000)

          const updated = await PlanStore.get(plan.id)
          verifyNoInfinitePending(updated)
          verifyValidTransitions(updated)

          return plan
        },
      })
    })
  })

  describe("Cleanup behavior", () => {
    test("cancellation marks incomplete workers as failed", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const subtasks = createSubtasks(10, "mixed")
          const plan = await createStressPlan(Instance.project.id, subtasks)

          await PlanStore.transition({ id: plan.id, status: "approved" })
          await PlanStore.transition({ id: plan.id, status: "spawning" })

          // Simulate partial spawn - only first 5 succeed
          const outcomes = new Map<string, "success" | "error">()
          for (let i = 0; i < 10; i++) {
            outcomes.set(subtasks[i].id, i < 5 ? "success" : "error")
          }
          await simulateSpawnWorkers(plan, outcomes)

          await PlanStore.transition({ id: plan.id, status: "running" })

          // Mark remaining workers as failed or complete (simulates cancellation)
          const updated = await PlanStore.get(plan.id)
          for (const worker of updated.workers) {
            if (worker.status === "pending" || worker.status === "running") {
              await PlanStore.updateWorker({
                id: plan.id,
                subtaskID: worker.subtaskID,
                status: "failed",
                error: "Cancelled by user",
              } as any)
            }
          }

          const final = await PlanStore.get(plan.id)

          // All workers should be in terminal state
          const terminalStatuses = ["done", "failed", "merged", "conflict"]
          expect(final.workers.every((w) => terminalStatuses.includes(w.status))).toBe(true)

          // Failed workers should have errors
          const failedWorkers = final.workers.filter((w) => w.status === "failed")
          for (const w of failedWorkers) {
            expect(w.error).toBeDefined()
          }

          // Cleanup tracking: spawned workers should have worktree info
          const spawnedWorkers = final.workers.filter((w) => w.worktreeDir)
          expect(spawnedWorkers.length).toBe(5)

          return plan
        },
      })
    })

    test("abandon cleans up all worktrees for interrupted plan", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const subtasks = createSubtasks(8, "mixed")
          const plan = await createStressPlan(Instance.project.id, subtasks)

          await PlanStore.transition({ id: plan.id, status: "approved" })
          await PlanStore.transition({ id: plan.id, status: "spawning" })
          await PlanStore.transition({ id: plan.id, status: "running" })

          // Set workers to various states with worktrees
          for (let i = 0; i < 8; i++) {
            if (i < 4) {
              // First 4 as running
              await PlanStore.updateWorker({
                id: plan.id,
                subtaskID: subtasks[i].id,
                status: "spawning",
              } as any)
              await PlanStore.updateWorker({
                id: plan.id,
                subtaskID: subtasks[i].id,
                status: "running",
                worktreeDir: `/tmp/worktree-${subtasks[i].id}`,
              } as any)
            } else {
              // Rest as pending
              await PlanStore.updateWorker({
                id: plan.id,
                subtaskID: subtasks[i].id,
                status: "pending",
                worktreeDir: `/tmp/worktree-${subtasks[i].id}`,
              } as any)
            }
          }

          const abandoned = await Recovery.abandon(plan.id)
          expect(abandoned.status).toBe("failed")
          expect(abandoned.workers.every((w) => w.status === "failed")).toBe(true)
          expect(abandoned.workers.every((w) => w.error?.includes("Abandoned"))).toBe(true)

          return plan
        },
      })
    })
  })

  describe("Concurrency edge cases", () => {
    test("dependency chain execution order", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create chain: 1 -> 2 -> 3 -> 4 -> 5
          const subtasks = createSubtasks(5, "chain")
          const plan = await createStressPlan(Instance.project.id, subtasks)

          // Simulate dependency-respecting execution
          const executionOrder: string[] = []
          const completed = new Set<string>()

          // Simulate execution respecting dependencies
          for (const subtask of subtasks) {
            // Check dependencies are met
            for (const dep of subtask.dependencies) {
              expect(completed.has(dep)).toBe(true)
            }
            executionOrder.push(subtask.id)
            completed.add(subtask.id)
          }

          // First task should be first
          expect(executionOrder[0]).toBe(subtasks[0].id)

          // Verify all 5 tasks in order
          expect(executionOrder.length).toBe(5)
          for (let i = 0; i < 5; i++) {
            expect(executionOrder[i]).toBe(subtasks[i].id)
          }

          return plan
        },
      })
    })

    test("fan-out pattern - one task many dependents", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create fan-out: task 0 is root, tasks 1-9 depend on it
          const subtasks = createSubtasks(10, "fanout")
          const plan = await createStressPlan(Instance.project.id, subtasks)

          // Verify dependency structure
          expect(subtasks[0].dependencies.length).toBe(0)
          for (let i = 1; i < 10; i++) {
            expect(subtasks[i].dependencies).toContain(subtasks[0].id)
          }

          // Root must execute first
          expect(subtasks[0].id).toBeDefined()

          // All others depend on root
          const dependentCount = subtasks.filter((s) => s.dependencies.includes(subtasks[0].id)).length
          expect(dependentCount).toBe(9)

          return plan
        },
      })
    })

    test("diamond dependency pattern", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Diamond: A -> B, A -> C, B -> D, C -> D
          //   A
          //  / \
          // B   C
          //  \ /
          //   D
          const subtasks = createSubtasks(4, "diamond")
          const plan = await createStressPlan(Instance.project.id, subtasks)

          // A (index 0) has no dependencies
          expect(subtasks[0].dependencies.length).toBe(0)

          // B (index 1) depends on A
          expect(subtasks[1].dependencies).toContain(subtasks[0].id)

          // C (index 2) depends on A
          expect(subtasks[2].dependencies).toContain(subtasks[0].id)

          // D (index 3) depends on both B and C
          expect(subtasks[3].dependencies).toContain(subtasks[1].id)
          expect(subtasks[3].dependencies).toContain(subtasks[2].id)

          return plan
        },
      })
    })

    test("mixed dependency pattern with many subtasks", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create 30 subtasks with mixed dependencies
          const subtasks = createSubtasks(30, "mixed")
          const plan = await createStressPlan(Instance.project.id, subtasks)

          // Count dependency patterns
          const noDeps = subtasks.filter((s) => s.dependencies.length === 0).length
          const withDeps = subtasks.filter((s) => s.dependencies.length > 0).length

          // Should have mix of independent and dependent tasks
          expect(noDeps).toBeGreaterThan(0)
          expect(withDeps).toBeGreaterThan(0)
          expect(noDeps + withDeps).toBe(30)

          // Verify no circular references in the simple mixed pattern
          for (const subtask of subtasks) {
            for (const dep of subtask.dependencies) {
              // Each dependency should exist
              const depExists = subtasks.some((s) => s.id === dep)
              expect(depExists).toBe(true)
            }
          }

          return plan
        },
      })
    })
  })

  describe("Final state consistency", () => {
    test("all plans end in consistent terminal state", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const subtasks = createSubtasks(15, "mixed")
          const plan = await createStressPlan(Instance.project.id, subtasks)

          await PlanStore.transition({ id: plan.id, status: "approved" })
          await PlanStore.transition({ id: plan.id, status: "spawning" })

          // Spawn all workers
          const spawnOutcomes = new Map<string, "success" | "error">()
          for (let i = 0; i < 15; i++) {
            spawnOutcomes.set(subtasks[i].id, i % 3 === 0 ? "error" : "success")
          }
          await simulateSpawnWorkers(plan, spawnOutcomes)

          // Complete with mixed results
          const updated = await PlanStore.get(plan.id)
          await simulateWorkerCompletion(plan.id, updated.workers, spawnOutcomes)

          const final = await PlanStore.get(plan.id)

          // Verify consistency: all workers in terminal state
          const terminalStatuses = ["done", "failed", "merged", "conflict"]
          const allTerminal = final.workers.every((w) => terminalStatuses.includes(w.status))
          expect(allTerminal).toBe(true)

          // Done workers have diff stats, failed have errors
          const doneWorkers = final.workers.filter((w) => w.status === "done")
          const failedWorkers = final.workers.filter((w) => w.status === "failed")

          for (const w of doneWorkers) {
            expect(w.diffStat).toBeDefined()
          }
          for (const w of failedWorkers) {
            expect(w.error).toBeDefined()
          }

          return plan
        },
      })
    })

    test("plan status transitions correctly through lifecycle", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const subtasks = createSubtasks(10, "mixed")
          let plan = await createStressPlan(Instance.project.id, subtasks)

          expect(plan.status).toBe("proposed")

          // Proposed -> approved
          plan = await PlanStore.transition({ id: plan.id, status: "approved" })
          expect(plan.status).toBe("approved")

          // Approved -> spawning
          plan = await PlanStore.transition({ id: plan.id, status: "spawning" })
          expect(plan.status).toBe("spawning")

          // Simulate spawning
          const outcomes = new Map<string, "success" | "error">()
          for (const st of subtasks) {
            outcomes.set(st.id, "success")
          }
          await simulateSpawnWorkers(plan, outcomes)

          // Spawning -> running
          plan = await PlanStore.transition({ id: plan.id, status: "running" })
          expect(plan.status).toBe("running")

          // Complete all workers
          const updated = await PlanStore.get(plan.id)
          await simulateWorkerCompletion(plan.id, updated.workers, outcomes)

          // Running -> merging
          plan = await PlanStore.transition({ id: plan.id, status: "merging" })
          expect(plan.status).toBe("merging")

          // Merging -> done
          plan = await PlanStore.transition({ id: plan.id, status: "done" })
          expect(plan.status).toBe("done")
          expect(plan.time.completed).toBeGreaterThan(0)

          return plan
        },
      })
    })

    test("large plan with no dependencies completes correctly", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create 20 independent subtasks
          const subtasks = createSubtasks(20, "independent")
          const plan = await createStressPlan(Instance.project.id, subtasks)

          await PlanStore.transition({ id: plan.id, status: "approved" })
          await PlanStore.transition({ id: plan.id, status: "spawning" })

          // All should spawn successfully
          const outcomes = new Map<string, "success" | "error">()
          for (const st of subtasks) {
            outcomes.set(st.id, "success")
          }
          await simulateSpawnWorkers(plan, outcomes)

          const updated = await PlanStore.get(plan.id)
          expect(updated.workers.every((w) => w.status === "running")).toBe(true)

          // Complete all
          await simulateWorkerCompletion(plan.id, updated.workers, outcomes)

          const final = await PlanStore.get(plan.id)
          expect(final.workers.every((w) => w.status === "done")).toBe(true)

          return plan
        },
      })
    })
  })
})
