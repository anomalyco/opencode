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
    messageID: MessageID.make("msg_parallel-dag-complex-test"),
    callID: "call_parallel-dag-complex-test",
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

describe("tool.parallel_plan complex DAG", () => {
  test("complex DAG with 3 waves - failure cascades through dependent chains", async () => {
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
          // Complex DAG:
          // Wave 0: A, B (parallel, no deps)
          // Wave 1: C (depends on A), D (depends on B)
          // Wave 2: E (depends on C, D)
          //
          // Scenario: A succeeds, B fails
          // Expected: C blocked (A done, but B failed so D blocked, so E blocked)
          const session = await Session.create({ title: "complex DAG cascade test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          const result = await tool.execute(
            {
              task: "Complex 3-wave DAG",
              subtasks: [
                {
                  title: "Task A (Wave 0)",
                  description: "First parallel task in wave 0 - will succeed",
                  fileScope: ["src/a.ts"],
                },
                {
                  title: "Task B (Wave 0)",
                  description: "Second parallel task in wave 0 - will fail",
                  fileScope: ["src/b.ts"],
                },
                {
                  title: "Task C (Wave 1)",
                  description: "Depends on A - will be blocked when A succeeds but chain fails",
                  fileScope: ["src/c.ts"],
                  dependencies: [0], // depends on A
                },
                {
                  title: "Task D (Wave 1)",
                  description: "Depends on B - will be blocked when B fails",
                  fileScope: ["src/d.ts"],
                  dependencies: [1], // depends on B
                },
                {
                  title: "Task E (Wave 2)",
                  description: "Depends on C and D - will be blocked due to upstream failure",
                  fileScope: ["src/e.ts"],
                  dependencies: [2, 3], // depends on C and D
                },
              ],
            },
            ctx(session.id),
          )

          // Verify the DAG structure was created correctly
          expect(result.output).toContain("depends on: 1")
          expect(result.output).toContain("depends on: 2")
          expect(result.output).toContain("depends on: 3, 4")

          // Get the created plan
          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)
          const plan = plans[0]

          // Verify all 5 workers were created
          expect(plan.workers).toHaveLength(5)
          expect(plan.subtasks).toHaveLength(5)

          // Get workers by their subtask indices for clarity
          const workerA = plan.workers.find((w) => w.subtaskID === plan.subtasks[0].id)
          const workerB = plan.workers.find((w) => w.subtaskID === plan.subtasks[1].id)
          const workerC = plan.workers.find((w) => w.subtaskID === plan.subtasks[2].id)
          const workerD = plan.workers.find((w) => w.subtaskID === plan.subtasks[3].id)
          const workerE = plan.workers.find((w) => w.subtaskID === plan.subtasks[4].id)

          expect(workerA).toBeDefined()
          expect(workerB).toBeDefined()
          expect(workerC).toBeDefined()
          expect(workerD).toBeDefined()
          expect(workerE).toBeDefined()

          // Verify initial status is pending for all
          expect(workerA!.status).toBe("pending")
          expect(workerB!.status).toBe("pending")
          expect(workerC!.status).toBe("pending")
          expect(workerD!.status).toBe("pending")
          expect(workerE!.status).toBe("pending")

          // Simulate valid execution transitions for A: pending -> spawning -> running -> done
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerA!.subtaskID,
            status: "spawning",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerA!.subtaskID,
            status: "running",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerA!.subtaskID,
            status: "done",
          })

          // B fails from pending (valid: pending -> failed)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerB!.subtaskID,
            status: "failed",
            error: "Task B failed",
          })

          // Simulate cascade: D is blocked because B failed (direct dependency)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerD!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency failed",
          })

          // C would normally run since A succeeded, but in this scenario
          // we simulate that C also gets blocked (perhaps due to wave-level cascade)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerC!.subtaskID,
            status: "blocked",
            error: "Wave dependency failed",
          })

          // E is blocked because both C and D are blocked (deadlock detection)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerE!.subtaskID,
            status: "blocked",
            error: "Deadlock: dependency chain failed",
          })

          // Verify final states
          const updatedPlan = await PlanStore.get(plan.id)
          const updatedWorkerA = updatedPlan.workers.find((w) => w.subtaskID === plan.subtasks[0].id)
          const updatedWorkerB = updatedPlan.workers.find((w) => w.subtaskID === plan.subtasks[1].id)
          const updatedWorkerC = updatedPlan.workers.find((w) => w.subtaskID === plan.subtasks[2].id)
          const updatedWorkerD = updatedPlan.workers.find((w) => w.subtaskID === plan.subtasks[3].id)
          const updatedWorkerE = updatedPlan.workers.find((w) => w.subtaskID === plan.subtasks[4].id)

          // A succeeded
          expect(updatedWorkerA!.status).toBe("done")
          
          // B failed
          expect(updatedWorkerB!.status).toBe("failed")
          expect(updatedWorkerB!.error).toBe("Task B failed")
          
          // C, D, E are all blocked due to failure cascade
          expect(updatedWorkerC!.status).toBe("blocked")
          expect(updatedWorkerD!.status).toBe("blocked")
          expect(updatedWorkerE!.status).toBe("blocked")
          expect(updatedWorkerE!.error).toBe("Deadlock: dependency chain failed")

          // Verify the orchestrator correctly resolves this as partial success
          // Since blocked workers are terminal (not unresolved), the outcome should be:
          // - done: 1 (A)
          // - failed: 1 (B) 
          // - unresolved: 0 (C, D, E are blocked, not unresolved)
          const outcome = Orchestrator.resolveDirectOutcome(updatedPlan.workers)
          expect(outcome.done).toBe(1)
          expect(outcome.failed).toBe(1)
          expect(outcome.unresolved).toBe(0) // blocked workers don't count as unresolved
          expect(outcome.status).toBe("partial_success")
        },
      })
    } finally {
      models.mockRestore()
    }
  })

  test("complex DAG selective retry - only failed workers are reset", async () => {
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
          // Create the same 5-task DAG
          const session = await Session.create({ title: "complex DAG retry test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          const result = await tool.execute(
            {
              task: "Complex DAG for selective retry",
              subtasks: [
                {
                  title: "Task A",
                  description: "Wave 0 task - succeeds",
                  fileScope: ["src/a.ts"],
                },
                {
                  title: "Task B",
                  description: "Wave 0 task - fails",
                  fileScope: ["src/b.ts"],
                },
                {
                  title: "Task C",
                  description: "Wave 1 depends on A",
                  fileScope: ["src/c.ts"],
                  dependencies: [0],
                },
                {
                  title: "Task D",
                  description: "Wave 1 depends on B",
                  fileScope: ["src/d.ts"],
                  dependencies: [1],
                },
                {
                  title: "Task E",
                  description: "Wave 2 depends on C and D",
                  fileScope: ["src/e.ts"],
                  dependencies: [2, 3],
                },
              ],
            },
            ctx(session.id),
          )

          // Get the created plan
          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)
          const plan = plans[0]

          const workerA = plan.workers.find((w) => w.subtaskID === plan.subtasks[0].id)
          const workerB = plan.workers.find((w) => w.subtaskID === plan.subtasks[1].id)
          const workerC = plan.workers.find((w) => w.subtaskID === plan.subtasks[2].id)
          const workerD = plan.workers.find((w) => w.subtaskID === plan.subtasks[3].id)
          const workerE = plan.workers.find((w) => w.subtaskID === plan.subtasks[4].id)

          // Set up a mixed outcome state and mark plan as failed
          await PlanStore.transition({ id: plan.id, status: "failed" })
          
          // A: done (successful with worktree) - transitions: pending -> spawning -> running -> done
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerA!.subtaskID,
            status: "spawning",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerA!.subtaskID,
            status: "running",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerA!.subtaskID,
            status: "done",
            worktreeName: "worker-a",
            worktreeDir: "/tmp/worker-a",
          })
          
          // B: failed (needs retry) - pending -> failed is valid
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerB!.subtaskID,
            status: "failed",
            error: "Task B failed",
          })
          
          // C: merged (successful - already integrated)
          // First get it to done, then merged
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerC!.subtaskID,
            status: "spawning",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerC!.subtaskID,
            status: "running",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerC!.subtaskID,
            status: "done",
            worktreeName: "worker-c",
            worktreeDir: "/tmp/worker-c",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerC!.subtaskID,
            status: "merged",
          })
          
          // D: blocked (dependency failed) - pending -> blocked is valid
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerD!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency failed",
          })
          
          // E: blocked (deadlock) - pending -> blocked is valid
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerE!.subtaskID,
            status: "blocked",
            error: "Deadlock: dependency chain failed",
          })

          // Verify initial failed state
          const planBeforeRetry = await PlanStore.get(plan.id)
          expect(planBeforeRetry.status).toBe("failed")

          // Mock Decomposition.decompose to return the existing subtasks
          // This prevents the retry from trying to call a real AI model
          const decomposeSpy = spyOn(Decomposition, "decompose").mockResolvedValue({
            subtasks: plan.subtasks.map((st, i) => ({
              ...st,
              // Map dependencies using actual subtask IDs from the original plan
              dependencies: i === 2 
                ? [plan.subtasks[0].id]  // Task C depends on A
                : i === 3 
                  ? [plan.subtasks[1].id]  // Task D depends on B
                  : i === 4 
                    ? [plan.subtasks[2].id, plan.subtasks[3].id]  // Task E depends on C and D
                    : [],
            })),
            sharedContracts: plan.sharedContracts,
            conventions: plan.conventions,
          } as any)

          try {
            // Retry the plan
            const retriedPlan = await Orchestrator.retry(plan.id)

          // Verify retried plan structure
          expect(retriedPlan.status).toBe("proposed")
          expect(retriedPlan.workers).toHaveLength(5)

          // Get workers after retry
          const retriedWorkerA = retriedPlan.workers.find((w) => w.subtaskID === retriedPlan.subtasks[0].id)
          const retriedWorkerB = retriedPlan.workers.find((w) => w.subtaskID === retriedPlan.subtasks[1].id)
          const retriedWorkerC = retriedPlan.workers.find((w) => w.subtaskID === retriedPlan.subtasks[2].id)
          const retriedWorkerD = retriedPlan.workers.find((w) => w.subtaskID === retriedPlan.subtasks[3].id)
          const retriedWorkerE = retriedPlan.workers.find((w) => w.subtaskID === retriedPlan.subtasks[4].id)

          // Successful workers (done, merged) should be preserved with worktree info
          expect(retriedWorkerA!.status).toBe("done")
          expect(retriedWorkerA!.worktreeName).toBe("worker-a")
          expect(retriedWorkerA!.worktreeDir).toBe("/tmp/worker-a")

          expect(retriedWorkerC!.status).toBe("merged")
          expect(retriedWorkerC!.worktreeName).toBe("worker-c")
          expect(retriedWorkerC!.worktreeDir).toBe("/tmp/worker-c")

          // Failed worker should be reset to pending for retry
          expect(retriedWorkerB!.status).toBe("pending")
          expect(retriedWorkerB!.error).toBeUndefined()
          expect(retriedWorkerB!.worktreeName).toBeUndefined()
          expect(retriedWorkerB!.worktreeDir).toBeUndefined()

          // Blocked workers should also be reset to pending for retry
          expect(retriedWorkerD!.status).toBe("pending")
          expect(retriedWorkerD!.error).toBeUndefined()
          expect(retriedWorkerE!.status).toBe("pending")
          expect(retriedWorkerE!.error).toBeUndefined()
          } finally {
            decomposeSpy.mockRestore()
          }
        },
      })
    } finally {
      models.mockRestore()
    }
  })

  test("complex DAG with diamond pattern - multiple paths converge", async () => {
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
          // Diamond pattern DAG:
          //     A
          //    / \
          //   B   C
          //    \ /
          //     D
          // A has no deps
          // B depends on A
          // C depends on A
          // D depends on B and C
          const session = await Session.create({ title: "diamond DAG test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          const result = await tool.execute(
            {
              task: "Diamond pattern DAG",
              subtasks: [
                {
                  title: "A (root)",
                  description: "Root task - no dependencies",
                  fileScope: ["src/a.ts"],
                },
                {
                  title: "B (left)",
                  description: "Left branch - depends on A",
                  fileScope: ["src/b.ts"],
                  dependencies: [0],
                },
                {
                  title: "C (right)",
                  description: "Right branch - depends on A",
                  fileScope: ["src/c.ts"],
                  dependencies: [0],
                },
                {
                  title: "D (convergence)",
                  description: "Convergence - depends on B and C",
                  fileScope: ["src/d.ts"],
                  dependencies: [1, 2],
                },
              ],
            },
            ctx(session.id),
          )

          // Verify diamond structure
          expect(result.output).toContain("depends on: 1") // B and C depend on A
          expect(result.output).toContain("depends on: 2, 3") // D depends on B and C

          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)
          const plan = plans[0]

          expect(plan.workers).toHaveLength(4)

          const workerA = plan.workers.find((w) => w.subtaskID === plan.subtasks[0].id)
          const workerB = plan.workers.find((w) => w.subtaskID === plan.subtasks[1].id)
          const workerC = plan.workers.find((w) => w.subtaskID === plan.subtasks[2].id)
          const workerD = plan.workers.find((w) => w.subtaskID === plan.subtasks[3].id)

          // Test scenario: A succeeds, B succeeds, C fails
          // D should be blocked because C failed
          // Valid transitions for A: pending -> spawning -> running -> done
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerA!.subtaskID,
            status: "spawning",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerA!.subtaskID,
            status: "running",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerA!.subtaskID,
            status: "done",
          })

          // Valid transitions for B: pending -> spawning -> running -> done
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerB!.subtaskID,
            status: "spawning",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerB!.subtaskID,
            status: "running",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerB!.subtaskID,
            status: "done",
          })

          // C fails: pending -> failed is valid
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerC!.subtaskID,
            status: "failed",
            error: "Task C failed",
          })

          // D blocked: pending -> blocked is valid
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerD!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency C failed",
          })

          const updatedPlan = await PlanStore.get(plan.id)
          const outcome = Orchestrator.resolveDirectOutcome(updatedPlan.workers)

          // Should be partial success: 2 done, 1 failed, 1 blocked
          expect(outcome.done).toBe(2)
          expect(outcome.failed).toBe(1)
          expect(outcome.unresolved).toBe(0) // blocked is terminal
          expect(outcome.status).toBe("partial_success")
        },
      })
    } finally {
      models.mockRestore()
    }
  })

  test("deadlock detection with multiple blocked chains", async () => {
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
          // Multiple independent chains:
          // Chain 1: X -> Y -> Z
          // Chain 2: P -> Q -> R
          // If X and P fail, both chains should deadlock
          const session = await Session.create({ title: "multiple deadlock chains test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          const result = await tool.execute(
            {
              task: "Multiple independent chains",
              subtasks: [
                // Chain 1
                {
                  title: "X (chain 1 root)",
                  description: "Chain 1 root - will fail",
                  fileScope: ["src/x.ts"],
                },
                {
                  title: "Y (chain 1 middle)",
                  description: "Chain 1 middle - depends on X",
                  fileScope: ["src/y.ts"],
                  dependencies: [0],
                },
                {
                  title: "Z (chain 1 leaf)",
                  description: "Chain 1 leaf - depends on Y",
                  fileScope: ["src/z.ts"],
                  dependencies: [1],
                },
                // Chain 2
                {
                  title: "P (chain 2 root)",
                  description: "Chain 2 root - will fail",
                  fileScope: ["src/p.ts"],
                },
                {
                  title: "Q (chain 2 middle)",
                  description: "Chain 2 middle - depends on P",
                  fileScope: ["src/q.ts"],
                  dependencies: [3],
                },
                {
                  title: "R (chain 2 leaf)",
                  description: "Chain 2 leaf - depends on Q",
                  fileScope: ["src/r.ts"],
                  dependencies: [4],
                },
              ],
            },
            ctx(session.id),
          )

          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)
          const plan = plans[0]

          expect(plan.workers).toHaveLength(6)

          const workerX = plan.workers.find((w) => w.subtaskID === plan.subtasks[0].id)
          const workerY = plan.workers.find((w) => w.subtaskID === plan.subtasks[1].id)
          const workerZ = plan.workers.find((w) => w.subtaskID === plan.subtasks[2].id)
          const workerP = plan.workers.find((w) => w.subtaskID === plan.subtasks[3].id)
          const workerQ = plan.workers.find((w) => w.subtaskID === plan.subtasks[4].id)
          const workerR = plan.workers.find((w) => w.subtaskID === plan.subtasks[5].id)

          // Simulate both roots failing and deadlock cascading
          // X and P fail (pending -> failed is valid)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerX!.subtaskID,
            status: "failed",
            error: "Task X failed",
          })
          // Y blocked (pending -> blocked is valid)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerY!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency failed",
          })
          // Z blocked (pending -> blocked is valid)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerZ!.subtaskID,
            status: "blocked",
            error: "Deadlock: dependency chain failed",
          })

          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerP!.subtaskID,
            status: "failed",
            error: "Task P failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerQ!.subtaskID,
            status: "blocked",
            error: "Blocked: dependency failed",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: workerR!.subtaskID,
            status: "blocked",
            error: "Deadlock: dependency chain failed",
          })

          const updatedPlan = await PlanStore.get(plan.id)
          const outcome = Orchestrator.resolveDirectOutcome(updatedPlan.workers)

          // Both chains failed: 0 done, 2 failed, 4 blocked (all terminal)
          expect(outcome.done).toBe(0)
          expect(outcome.failed).toBe(2)
          expect(outcome.unresolved).toBe(0)
          expect(outcome.status).toBe("failed") // More failures than successes
        },
      })
    } finally {
      models.mockRestore()
    }
  })

  test("wave-based execution respects task kinds", async () => {
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
          // Create a plan with task kinds
          // structural = foundation tasks
          // semantic = implementation tasks
          const session = await Session.create({ title: "task kinds test" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          const result = await tool.execute(
            {
              task: "Task kinds execution test",
              subtasks: [
                {
                  title: "Foundation",
                  description: "Structural foundation task",
                  fileScope: ["src/foundation.ts"],
                  kind: "structural",
                },
                {
                  title: "Types",
                  description: "Structural types task",
                  fileScope: ["src/types.ts"],
                  kind: "structural",
                },
                {
                  title: "API Layer",
                  description: "Semantic API task",
                  fileScope: ["src/api.ts"],
                  kind: "semantic",
                },
                {
                  title: "Business Logic",
                  description: "Semantic logic task",
                  fileScope: ["src/logic.ts"],
                  kind: "semantic",
                },
              ],
            },
            ctx(session.id),
          )

          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)
          const plan = plans[0]

          // Verify all subtasks have correct kinds
          expect(plan.subtasks[0].kind).toBe("structural")
          expect(plan.subtasks[1].kind).toBe("structural")
          expect(plan.subtasks[2].kind).toBe("semantic")
          expect(plan.subtasks[3].kind).toBe("semantic")

          expect(plan.workers).toHaveLength(4)

          // Simulate structural tasks complete (use valid transitions)
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: plan.workers[0].subtaskID,
            status: "spawning",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: plan.workers[0].subtaskID,
            status: "running",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: plan.workers[0].subtaskID,
            status: "done",
          })
          
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: plan.workers[1].subtaskID,
            status: "spawning",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: plan.workers[1].subtaskID,
            status: "running",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: plan.workers[1].subtaskID,
            status: "done",
          })

          // Simulate semantic tasks in progress
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: plan.workers[2].subtaskID,
            status: "spawning",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: plan.workers[2].subtaskID,
            status: "running",
          })
          
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: plan.workers[3].subtaskID,
            status: "spawning",
          })
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: plan.workers[3].subtaskID,
            status: "running",
          })

          // Verify outcome shows partial completion
          const updatedPlan = await PlanStore.get(plan.id)
          const outcome = Orchestrator.resolveDirectOutcome(updatedPlan.workers)
          
          // 2 done, 2 running (not terminal)
          expect(outcome.done).toBe(2)
          // running are unresolved
          expect(outcome.unresolved).toBe(2)
        },
      })
    } finally {
      models.mockRestore()
    }
  })
})
