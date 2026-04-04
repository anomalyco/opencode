import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { ParallelPlanTool } from "../../src/tool/parallel-plan"
import { PlanStore } from "../../src/parallel/plan"
import { Orchestrator } from "../../src/parallel/orchestrator"
import { Decomposition } from "../../src/parallel/decomposition"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Session } from "../../src/session"
import { MessageID } from "../../src/session/schema"
import type { Tool } from "../../src/tool/tool"
import { tmpdir } from "../fixture/fixture"

function ctx(sessionID: Tool.Context["sessionID"]): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.make("msg_complex-dag-test"),
    callID: "call_complex-dag-test",
    agent: "orchestrator",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.parallel_plan complex DAG scenarios", () => {
  test("diamond DAG with partial failure blocks downstream", async () => {
    await using tmp = await tmpdir({ git: true })

    const models = spyOn(Orchestrator, "resolveModels").mockResolvedValue({
      orchestratorModel: { providerID: "test" as any, modelID: "orchestrator" as any },
      workerModel: { providerID: "test" as any, modelID: "worker" as any },
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create a diamond DAG:
          //     A (succeeds)
          //    / \
          //   B   C (fails)
          //    \ /
          //     D (should be blocked - depends on both B and C)
          const session = await Session.create({ title: "diamond dag test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          const result = await tool.execute(
            {
              task: "Diamond DAG with partial failure",
              subtasks: [
                {
                  title: "Task A",
                  description: "Root task that succeeds",
                  fileScope: ["src/a.ts"],
                },
                {
                  title: "Task B",
                  description: "Left branch that succeeds",
                  fileScope: ["src/b.ts"],
                  dependencies: [0], // depends on A
                },
                {
                  title: "Task C",
                  description: "Right branch that will fail",
                  fileScope: ["src/c.ts"],
                  dependencies: [0], // depends on A
                },
                {
                  title: "Task D",
                  description: "Merge task that depends on both B and C",
                  fileScope: ["src/d.ts"],
                  dependencies: [1, 2], // depends on B and C
                },
              ],
            },
            ctx(session.id),
          )

          expect(result.output).toContain("depends on: 1")
          expect(result.output).toContain("depends on: 2, 3")

          // Get the created plan
          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)
          const plan = plans[0]

          // Verify workers were created
          expect(plan.workers).toHaveLength(4)

          // Get workers
          const workerA = plan.workers.find((w) => w.subtaskID === plan.subtasks[0].id)
          const workerB = plan.workers.find((w) => w.subtaskID === plan.subtasks[1].id)
          const workerC = plan.workers.find((w) => w.subtaskID === plan.subtasks[2].id)
          const workerD = plan.workers.find((w) => w.subtaskID === plan.subtasks[3].id)
          expect(workerA).toBeDefined()
          expect(workerB).toBeDefined()
          expect(workerC).toBeDefined()
          expect(workerD).toBeDefined()

          // Simulate execution outcome:
          // A succeeds, B succeeds, C fails, D should be blocked
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerA!.subtaskID,
            status: "done",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerB!.subtaskID,
            status: "done",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerC!.subtaskID,
            status: "failed",
            error: "Task C failed",
          })
          // D should be blocked because C failed
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerD!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency failed",
          })

          // Verify final states
          const updatedPlan = await PlanStore.get(plan.id)
          const updatedA = updatedPlan.workers.find((w) => w.subtaskID === plan.subtasks[0].id)
          const updatedB = updatedPlan.workers.find((w) => w.subtaskID === plan.subtasks[1].id)
          const updatedC = updatedPlan.workers.find((w) => w.subtaskID === plan.subtasks[2].id)
          const updatedD = updatedPlan.workers.find((w) => w.subtaskID === plan.subtasks[3].id)

          expect(updatedA!.status).toBe("done")
          expect(updatedB!.status).toBe("done")
          expect(updatedC!.status).toBe("failed")
          expect(updatedD!.status).toBe("blocked")
          expect(updatedD!.error).toContain("dependency")
        },
      })
    } finally {
      models.mockRestore()
    }
  })

  test("deep chain creates deadlock cascade when root fails", async () => {
    await using tmp = await tmpdir({ git: true })

    const models = spyOn(Orchestrator, "resolveModels").mockResolvedValue({
      orchestratorModel: { providerID: "test" as any, modelID: "orchestrator" as any },
      workerModel: { providerID: "test" as any, modelID: "worker" as any },
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create a deep chain: A -> B -> C -> D -> E
          // If A fails, B should be blocked (dep failed)
          // C should be deadlocked (dep B blocked)
          // D should be deadlocked (dep C blocked)
          // E should be deadlocked (dep D blocked)
          const session = await Session.create({ title: "deep chain deadlock test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          const result = await tool.execute(
            {
              task: "Deep chain with cascade failure",
              subtasks: [
                {
                  title: "Task A",
                  description: "First task that will fail",
                  fileScope: ["src/a.ts"],
                },
                {
                  title: "Task B",
                  description: "Depends on A",
                  fileScope: ["src/b.ts"],
                  dependencies: [0],
                },
                {
                  title: "Task C",
                  description: "Depends on B",
                  fileScope: ["src/c.ts"],
                  dependencies: [1],
                },
                {
                  title: "Task D",
                  description: "Depends on C",
                  fileScope: ["src/d.ts"],
                  dependencies: [2],
                },
                {
                  title: "Task E",
                  description: "Depends on D",
                  fileScope: ["src/e.ts"],
                  dependencies: [3],
                },
              ],
            },
            ctx(session.id),
          )

          // Verify dependency output
          for (let i = 1; i <= 4; i++) {
            expect(result.output).toContain(`depends on: ${i}`)
          }

          // Get the created plan
          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)
          const plan = plans[0]
          expect(plan.workers).toHaveLength(5)

          // Get workers
          const workers = plan.subtasks.map((st) =>
            plan.workers.find((w) => w.subtaskID === st.id),
          )
          expect(workers.every((w) => w !== undefined)).toBe(true)

          // Simulate cascade failure:
          // A fails -> B blocked (direct dep failure)
          // C deadlocked (dep B blocked)
          // D deadlocked (dep C blocked)
          // E deadlocked (dep D blocked)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[0]!.subtaskID,
            status: "failed",
            error: "Root task A failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[1]!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[2]!.subtaskID,
            status: "blocked",
            error: "Deadlock: dependency chain failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[3]!.subtaskID,
            status: "blocked",
            error: "Deadlock: dependency chain failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[4]!.subtaskID,
            status: "blocked",
            error: "Deadlock: dependency chain failed",
          })

          // Verify cascade
          const updatedPlan = await PlanStore.get(plan.id)
          const updatedWorkers = plan.subtasks.map((st) =>
            updatedPlan.workers.find((w) => w.subtaskID === st.id),
          )

          expect(updatedWorkers[0]!.status).toBe("failed")
          expect(updatedWorkers[1]!.status).toBe("blocked")
          expect(updatedWorkers[2]!.status).toBe("blocked")
          expect(updatedWorkers[3]!.status).toBe("blocked")
          expect(updatedWorkers[4]!.status).toBe("blocked")

          // Verify deadlock messages cascade properly
          expect(updatedWorkers[1]!.error).toContain("dependency")
          expect(updatedWorkers[2]!.error).toContain("Deadlock")
          expect(updatedWorkers[3]!.error).toContain("Deadlock")
          expect(updatedWorkers[4]!.error).toContain("Deadlock")
        },
      })
    } finally {
      models.mockRestore()
    }
  })

  test("multi-wave cascade failure blocks downstream waves", async () => {
    await using tmp = await tmpdir({ git: true })

    const models = spyOn(Orchestrator, "resolveModels").mockResolvedValue({
      orchestratorModel: { providerID: "test" as any, modelID: "orchestrator" as any },
      workerModel: { providerID: "test" as any, modelID: "worker" as any },
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create multi-wave plan:
          // Wave 0: A, B (parallel, no deps)
          // Wave 1: C (depends on A), D (depends on B)
          // Wave 2: E (depends on C and D)
          // Scenario: A fails, B succeeds
          // Result: C blocked (A failed), D done (B succeeded), E blocked (C failed)
          const session = await Session.create({ title: "multi-wave cascade test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          const result = await tool.execute(
            {
              task: "Multi-wave cascade failure",
              subtasks: [
                {
                  title: "Wave 0 Task A",
                  description: "First wave task that will fail",
                  fileScope: ["src/a.ts"],
                  // No dependencies - wave 0
                },
                {
                  title: "Wave 0 Task B",
                  description: "First wave task that succeeds",
                  fileScope: ["src/b.ts"],
                  // No dependencies - wave 0
                },
                {
                  title: "Wave 1 Task C",
                  description: "Second wave task that depends on A",
                  fileScope: ["src/c.ts"],
                  dependencies: [0], // depends on A
                },
                {
                  title: "Wave 1 Task D",
                  description: "Second wave task that depends on B",
                  fileScope: ["src/d.ts"],
                  dependencies: [1], // depends on B
                },
                {
                  title: "Wave 2 Task E",
                  description: "Third wave task that depends on C and D",
                  fileScope: ["src/e.ts"],
                  dependencies: [2, 3], // depends on C and D
                },
              ],
            },
            ctx(session.id),
          )

          // Get the created plan
          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)
          const plan = plans[0]
          expect(plan.workers).toHaveLength(5)

          // Get workers
          const workers = plan.subtasks.map((st) =>
            plan.workers.find((w) => w.subtaskID === st.id),
          )

          // Simulate execution:
          // Wave 0: A fails, B succeeds
          // Wave 1: C blocked (A failed), D succeeds (B succeeded)
          // Wave 2: E blocked (C failed)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[0]!.subtaskID,
            status: "failed",
            error: "Task A failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[1]!.subtaskID,
            status: "done",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[2]!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[3]!.subtaskID,
            status: "done",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[4]!.subtaskID,
            status: "blocked",
            error: "Wave dependency failed",
          })

          // Verify states
          const updatedPlan = await PlanStore.get(plan.id)
          const updatedWorkers = plan.subtasks.map((st) =>
            updatedPlan.workers.find((w) => w.subtaskID === st.id),
          )

          expect(updatedWorkers[0]!.status).toBe("failed")
          expect(updatedWorkers[1]!.status).toBe("done")
          expect(updatedWorkers[2]!.status).toBe("blocked")
          expect(updatedWorkers[3]!.status).toBe("done")
          expect(updatedWorkers[4]!.status).toBe("blocked")

          // Verify resolution outcome
          const outcome = Orchestrator.resolveDirectOutcome(updatedPlan.workers)
          expect(outcome.status).toBe("partial_success")
          expect(outcome.done).toBe(2) // B and D done
          expect(outcome.failed).toBe(1) // Only A counts as failed (blocked is different)
          expect(outcome.unresolved).toBe(0) // Blocked workers are not unresolved
        },
      })
    } finally {
      models.mockRestore()
    }
  })

  test("retry preserves successful workers and resets failed/blocked", async () => {
    await using tmp = await tmpdir({ git: true })

    const models = spyOn(Orchestrator, "resolveModels").mockResolvedValue({
      orchestratorModel: { providerID: "test" as any, modelID: "orchestrator" as any },
      workerModel: { providerID: "test" as any, modelID: "worker" as any },
    })

    // Mock decomposition to avoid needing real provider during retry
    const decompose = spyOn(Decomposition, "decompose").mockResolvedValue({
      subtasks: [
        { id: "sub_0", title: "Task A", description: "First task", fileScope: ["src/a.ts"] },
        { id: "sub_1", title: "Task B", description: "Second task", fileScope: ["src/b.ts"] },
        { id: "sub_2", title: "Task C", description: "Third task", fileScope: ["src/c.ts"] },
        { id: "sub_3", title: "Task D", description: "Fourth task", fileScope: ["src/d.ts"] },
      ],
      sharedContracts: [],
      conventions: {},
    } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create a plan that simulates a complex execution with mixed outcomes
          // Then verify that retry() preserves successful workers and resets others
          const session = await Session.create({ title: "retry preservation test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          const result = await tool.execute(
            {
              task: "Retry preservation test",
              subtasks: [
                {
                  title: "Task A",
                  description: "Successful task",
                  fileScope: ["src/a.ts"],
                },
                {
                  title: "Task B",
                  description: "Merged task",
                  fileScope: ["src/b.ts"],
                },
                {
                  title: "Task C",
                  description: "Failed task",
                  fileScope: ["src/c.ts"],
                },
                {
                  title: "Task D",
                  description: "Blocked task",
                  fileScope: ["src/d.ts"],
                },
              ],
            },
            ctx(session.id),
          )

          // Get the created plan
          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)
          const plan = plans[0]
          expect(plan.workers).toHaveLength(4)

          // Get workers
          const workers = plan.subtasks.map((st) =>
            plan.workers.find((w) => w.subtaskID === st.id),
          )

          // Mark plan as failed and set up mixed worker states
          await PlanStore.transition({ id: plan.id, status: "failed" })

          // Task A: done (preserved)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[0]!.subtaskID,
            status: "done",
            worktreeName: "worker-a",
            worktreeDir: "/tmp/worker-a",
            diffStat: { files: 5, additions: 100, deletions: 20 },
          })

          // Task B: merged (preserved)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[1]!.subtaskID,
            status: "merged",
            worktreeName: "worker-b",
            worktreeDir: "/tmp/worker-b",
            diffStat: { files: 3, additions: 50, deletions: 10 },
          })

          // Task C: failed (reset to pending)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[2]!.subtaskID,
            status: "failed",
            error: "Task C execution failed",
            worktreeName: "worker-c",
            worktreeDir: "/tmp/worker-c",
          })

          // Task D: blocked (reset to pending)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[3]!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency failed",
          })

          // Verify initial states
          const planBeforeRetry = await PlanStore.get(plan.id)
          expect(planBeforeRetry.status).toBe("failed")

          // Now retry the plan
          const retriedPlan = await Orchestrator.retry(plan.id)

          // Verify retried plan status
          expect(retriedPlan.status).toBe("proposed")
          expect(retriedPlan.workers).toHaveLength(4)

          // Get retried workers by matching titles (IDs change during retry)
          const retriedWorkers = retriedPlan.subtasks.map((st) =>
            retriedPlan.workers.find((w) => w.subtaskID === st.id),
          )

          // Key assertions: successful workers should be preserved
          const taskAWorker = retriedWorkers.find((w) => {
            const st = retriedPlan.subtasks.find((s) => s.id === w!.subtaskID)
            return st?.title === "Task A"
          })
          const taskBWorker = retriedWorkers.find((w) => {
            const st = retriedPlan.subtasks.find((s) => s.id === w!.subtaskID)
            return st?.title === "Task B"
          })
          const taskCWorker = retriedWorkers.find((w) => {
            const st = retriedPlan.subtasks.find((s) => s.id === w!.subtaskID)
            return st?.title === "Task C"
          })
          const taskDWorker = retriedWorkers.find((w) => {
            const st = retriedPlan.subtasks.find((s) => s.id === w!.subtaskID)
            return st?.title === "Task D"
          })

          // Task A (done) should be preserved with all metadata
          expect(taskAWorker!.status).toBe("done")
          expect(taskAWorker!.worktreeName).toBe("worker-a")
          expect(taskAWorker!.worktreeDir).toBe("/tmp/worker-a")
          expect(taskAWorker!.diffStat).toEqual({ files: 5, additions: 100, deletions: 20 })

          // Task B (merged) should be preserved with all metadata
          expect(taskBWorker!.status).toBe("merged")
          expect(taskBWorker!.worktreeName).toBe("worker-b")
          expect(taskBWorker!.worktreeDir).toBe("/tmp/worker-b")
          expect(taskBWorker!.diffStat).toEqual({ files: 3, additions: 50, deletions: 10 })

          // Task C (failed) should be reset to pending
          expect(taskCWorker!.status).toBe("pending")
          expect(taskCWorker!.error).toBeUndefined()
          expect(taskCWorker!.worktreeName).toBeUndefined()
          expect(taskCWorker!.worktreeDir).toBeUndefined()

          // Task D (blocked) should be reset to pending
          expect(taskDWorker!.status).toBe("pending")
          expect(taskDWorker!.error).toBeUndefined()
        },
      })
    } finally {
      models.mockRestore()
      decompose.mockRestore()
    }
  })

  test("resolveDirectOutcome correctly handles mixed terminal states", () => {
    // Test resolveDirectOutcome with various combinations of statuses

    function mockWorker(status: string, id: string) {
      return {
        id,
        subtaskID: id as any,
        status: status as any,
        branch: "main",
        worktreePath: "/tmp",
        spawnedAt: Date.now(),
      }
    }

    // Scenario 1: All done -> done
    const allDone = Orchestrator.resolveDirectOutcome([
      mockWorker("done", "task1"),
      mockWorker("done", "task2"),
      mockWorker("done", "task3"),
    ])
    expect(allDone.status).toBe("done")
    expect(allDone.done).toBe(3)
    expect(allDone.failed).toBe(0)
    expect(allDone.unresolved).toBe(0)

    // Scenario 2: All merged -> done
    const allMerged = Orchestrator.resolveDirectOutcome([
      mockWorker("merged", "task1"),
      mockWorker("merged", "task2"),
    ])
    expect(allMerged.status).toBe("done")
    expect(allMerged.done).toBe(2)
    expect(allMerged.failed).toBe(0)
    expect(allMerged.unresolved).toBe(0)

    // Scenario 3: Mix of done and merged -> done
    const mixedSuccess = Orchestrator.resolveDirectOutcome([
      mockWorker("done", "task1"),
      mockWorker("merged", "task2"),
      mockWorker("done", "task3"),
    ])
    expect(mixedSuccess.status).toBe("done")
    expect(mixedSuccess.done).toBe(3)

    // Scenario 4: Some done, some failed -> partial_success
    const partialWithFailed = Orchestrator.resolveDirectOutcome([
      mockWorker("done", "task1"),
      mockWorker("done", "task2"),
      mockWorker("failed", "task3"),
    ])
    expect(partialWithFailed.status).toBe("partial_success")
    expect(partialWithFailed.done).toBe(2)
    expect(partialWithFailed.failed).toBe(1)
    expect(partialWithFailed.unresolved).toBe(0)

    // Scenario 5: Some done, some blocked -> partial_success
    // Blocked workers should NOT count as unresolved (they're terminal)
    const partialWithBlocked = Orchestrator.resolveDirectOutcome([
      mockWorker("done", "task1"),
      mockWorker("blocked", "task2"),
      mockWorker("blocked", "task3"),
    ])
    expect(partialWithBlocked.status).toBe("partial_success")
    expect(partialWithBlocked.done).toBe(1)
    expect(partialWithBlocked.failed).toBe(0) // blocked is not failed
    expect(partialWithBlocked.unresolved).toBe(0) // blocked is terminal

    // Scenario 6: Mix of done, failed, conflict, blocked -> partial_success
    const complexPartial = Orchestrator.resolveDirectOutcome([
      mockWorker("done", "task1"),
      mockWorker("merged", "task2"),
      mockWorker("failed", "task3"),
      mockWorker("conflict", "task4"),
      mockWorker("blocked", "task5"),
    ])
    expect(complexPartial.status).toBe("partial_success")
    expect(complexPartial.done).toBe(2) // done + merged
    expect(complexPartial.failed).toBe(2) // failed + conflict
    expect(complexPartial.unresolved).toBe(0) // blocked is terminal

    // Scenario 7: All failed -> failed
    const allFailed = Orchestrator.resolveDirectOutcome([
      mockWorker("failed", "task1"),
      mockWorker("failed", "task2"),
    ])
    expect(allFailed.status).toBe("failed")
    expect(allFailed.done).toBe(0)
    expect(allFailed.failed).toBe(2)

    // Scenario 8: All blocked -> failed (no successful work)
    const allBlocked = Orchestrator.resolveDirectOutcome([
      mockWorker("blocked", "task1"),
      mockWorker("blocked", "task2"),
    ])
    expect(allBlocked.status).toBe("failed")
    expect(allBlocked.done).toBe(0)
    expect(allBlocked.failed).toBe(0) // blocked != failed
    expect(allBlocked.unresolved).toBe(0) // all terminal (blocked)

    // Scenario 9: Pending workers present -> failed (unresolved)
    const withPending = Orchestrator.resolveDirectOutcome([
      mockWorker("done", "task1"),
      mockWorker("pending", "task2"),
    ])
    expect(withPending.status).toBe("failed")
    expect(withPending.done).toBe(1)
    expect(withPending.unresolved).toBe(1)

    // Scenario 10: Running workers present -> failed (unresolved)
    const withRunning = Orchestrator.resolveDirectOutcome([
      mockWorker("done", "task1"),
      mockWorker("running", "task2"),
    ])
    expect(withRunning.status).toBe("failed")
    expect(withRunning.done).toBe(1)
    expect(withRunning.unresolved).toBe(1)
  })

  test("complex DAG with multiple branches and converging dependencies", async () => {
    await using tmp = await tmpdir({ git: true })

    const models = spyOn(Orchestrator, "resolveModels").mockResolvedValue({
      orchestratorModel: { providerID: "test" as any, modelID: "orchestrator" as any },
      workerModel: { providerID: "test" as any, modelID: "worker" as any },
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create a complex DAG:
          //       A
          //      / \
          //     B   C
          //    / \   \
          //   D   E   F
          //    \  |  /
          //     \ | /
          //       G
          //
          // A: root
          // B, C: depend on A
          // D, E: depend on B
          // F: depends on C
          // G: depends on D, E, F
          const session = await Session.create({ title: "complex branching dag test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          const result = await tool.execute(
            {
              task: "Complex branching DAG",
              subtasks: [
                { title: "A", description: "Root", fileScope: ["src/a.ts"] },
                { title: "B", description: "Branch 1", fileScope: ["src/b.ts"], dependencies: [0] },
                { title: "C", description: "Branch 2", fileScope: ["src/c.ts"], dependencies: [0] },
                { title: "D", description: "Sub-branch 1a", fileScope: ["src/d.ts"], dependencies: [1] },
                { title: "E", description: "Sub-branch 1b", fileScope: ["src/e.ts"], dependencies: [1] },
                { title: "F", description: "Sub-branch 2a", fileScope: ["src/f.ts"], dependencies: [2] },
                { title: "G", description: "Merge all", fileScope: ["src/g.ts"], dependencies: [3, 4, 5] },
              ],
            },
            ctx(session.id),
          )

          expect(result.output).toContain("Plan ID:")

          // Get the created plan
          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)
          const plan = plans[0]
          expect(plan.workers).toHaveLength(7)

          // Get workers by title for easier reference
          const workersByTitle = new Map(
            plan.subtasks.map((st) => {
              const w = plan.workers.find((worker) => worker.subtaskID === st.id)
              return [st.title, w]
            }),
          )

          // Simulate partial failure scenario:
          // A: done
          // B: done
          // C: failed (this blocks F and G)
          // D: done
          // E: done
          // F: blocked (C failed)
          // G: blocked (F is a dependency, and C failed)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workersByTitle.get("A")!.subtaskID,
            status: "done",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workersByTitle.get("B")!.subtaskID,
            status: "done",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workersByTitle.get("C")!.subtaskID,
            status: "failed",
            error: "Branch C failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workersByTitle.get("D")!.subtaskID,
            status: "done",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workersByTitle.get("E")!.subtaskID,
            status: "done",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workersByTitle.get("F")!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workersByTitle.get("G")!.subtaskID,
            status: "blocked",
            error: "Deadlock: dependency chain failed",
          })

          // Verify final states
          const updatedPlan = await PlanStore.get(plan.id)
          const updatedByTitle = new Map(
            updatedPlan.subtasks.map((st) => {
              const w = updatedPlan.workers.find((worker) => worker.subtaskID === st.id)
              return [st.title, w]
            }),
          )

          expect(updatedByTitle.get("A")!.status).toBe("done")
          expect(updatedByTitle.get("B")!.status).toBe("done")
          expect(updatedByTitle.get("C")!.status).toBe("failed")
          expect(updatedByTitle.get("D")!.status).toBe("done")
          expect(updatedByTitle.get("E")!.status).toBe("done")
          expect(updatedByTitle.get("F")!.status).toBe("blocked")
          expect(updatedByTitle.get("G")!.status).toBe("blocked")

          // Verify outcome resolution
          const outcome = Orchestrator.resolveDirectOutcome(updatedPlan.workers)
          expect(outcome.status).toBe("partial_success")
          expect(outcome.done).toBe(4) // A, B, D, E
          expect(outcome.failed).toBe(1) // C
          expect(outcome.unresolved).toBe(0) // F and G are blocked (terminal)
        },
      })
    } finally {
      models.mockRestore()
    }
  })

  test("blocked workers do not count as unresolved in resolveDirectOutcome", async () => {
    await using tmp = await tmpdir({ git: true })

    const models = spyOn(Orchestrator, "resolveModels").mockResolvedValue({
      orchestratorModel: { providerID: "test" as any, modelID: "orchestrator" as any },
      workerModel: { providerID: "test" as any, modelID: "worker" as any },
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create a simple chain: A -> B -> C
          // When A fails, B and C should be blocked
          // All should be terminal, unresolved should be 0
          const session = await Session.create({ title: "blocked terminal test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          await tool.execute(
            {
              task: "Blocked terminal state test",
              subtasks: [
                {
                  title: "Task A",
                  description: "Root task that fails",
                  fileScope: ["src/a.ts"],
                },
                {
                  title: "Task B",
                  description: "Depends on A",
                  fileScope: ["src/b.ts"],
                  dependencies: [0],
                },
                {
                  title: "Task C",
                  description: "Depends on B",
                  fileScope: ["src/c.ts"],
                  dependencies: [1],
                },
              ],
            },
            ctx(session.id),
          )

          const plans = await PlanStore.listByProject(Instance.project.id)
          const plan = plans[0]

          // Mark all as terminal states: 1 failed, 2 blocked
          const workers = plan.subtasks.map((st) =>
            plan.workers.find((w) => w.subtaskID === st.id),
          )

          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[0]!.subtaskID,
            status: "failed",
            error: "Root failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[1]!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workers[2]!.subtaskID,
            status: "blocked",
            error: "Deadlock: dependency chain failed",
          })

          const updatedPlan = await PlanStore.get(plan.id)

          // Verify all workers are in terminal states
          const terminalStatuses = ["done", "merged", "failed", "conflict", "blocked"]
          for (const worker of updatedPlan.workers) {
            expect(terminalStatuses).toContain(worker.status)
          }

          // Verify resolveDirectOutcome returns 0 unresolved
          const outcome = Orchestrator.resolveDirectOutcome(updatedPlan.workers)
          expect(outcome.unresolved).toBe(0)
          expect(outcome.done).toBe(0)
          expect(outcome.failed).toBe(1) // only A is failed

          // Status should be "failed" because no successful work was done
          expect(outcome.status).toBe("failed")
        },
      })
    } finally {
      models.mockRestore()
    }
  })
})
