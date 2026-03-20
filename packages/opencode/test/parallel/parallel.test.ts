import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { PlanStore } from "../../src/parallel/plan"
import { Orchestrator } from "../../src/parallel/orchestrator"
import { SubtaskID } from "../../src/parallel/schema"
import type { WorkerState } from "../../src/parallel/schema"
import { tmpdir } from "../fixture/fixture"

describe("Parallel Infrastructure", () => {
  describe("PlanStore", () => {
    test("creates a plan with draft status", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const plan = await PlanStore.create({
            projectID: Instance.project.id,
            sessionID: undefined,
            task: "Test task",
            orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
            workerModel: { providerID: "test" as any, modelID: "test-model" as any },
          })

          expect(plan.id).toBeDefined()
          expect(plan.status).toBe("draft")
          expect(plan.task).toBe("Test task")
          expect(plan.subtasks).toEqual([])
          expect(plan.workers).toEqual([])
          expect(plan.time.created).toBeGreaterThan(0)

          return plan
        },
      })
    })

    test("persists publish metadata", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const plan = await PlanStore.create({
            projectID: Instance.project.id,
            sessionID: undefined,
            task: "Test task",
            orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
            workerModel: { providerID: "test" as any, modelID: "test-model" as any },
            publishMode: "direct",
          })

          expect(plan.publishMode).toBe("direct")

          const updated = await PlanStore.update({
            id: plan.id,
            integrationBranch: `parallel/${plan.id}`,
            publishMode: "unstaged",
          })

          expect(updated.integrationBranch).toBe(`parallel/${plan.id}`)
          expect(updated.publishMode).toBe("unstaged")

          return updated
        },
      })
    })

    test("updates plan with subtasks and workers", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const plan = await PlanStore.create({
            projectID: Instance.project.id,
            sessionID: undefined,
            task: "Test task",
            orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
            workerModel: { providerID: "test" as any, modelID: "test-model" as any },
          })

          const subtaskID = SubtaskID.ascending()
          const updated = await PlanStore.update({
            id: plan.id,
            subtasks: [
              {
                id: subtaskID,
                title: "Subtask 1",
                description: "Do something",
                fileScope: ["src/a.ts"],
                dependencies: [],
              },
            ],
            workers: [{ subtaskID, status: "pending" }],
            status: "proposed",
          })

          expect(updated.status).toBe("proposed")
          expect(updated.subtasks).toHaveLength(1)
          expect(updated.subtasks[0].title).toBe("Subtask 1")
          expect(updated.workers).toHaveLength(1)
          expect(updated.workers[0].status).toBe("pending")

          return updated
        },
      })
    })

    test("transitions through valid states", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const plan = await PlanStore.create({
            projectID: Instance.project.id,
            sessionID: undefined,
            task: "Test task",
            orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
            workerModel: { providerID: "test" as any, modelID: "test-model" as any },
          })

          // draft -> proposed
          const proposed = await PlanStore.transition({ id: plan.id, status: "proposed" })
          expect(proposed.status).toBe("proposed")

          // proposed -> approved
          const approved = await PlanStore.transition({ id: plan.id, status: "approved" })
          expect(approved.status).toBe("approved")
          expect(approved.time.approved).toBeGreaterThan(0)

          // approved -> spawning
          const spawning = await PlanStore.transition({ id: plan.id, status: "spawning" })
          expect(spawning.status).toBe("spawning")

          // spawning -> running
          const running = await PlanStore.transition({ id: plan.id, status: "running" })
          expect(running.status).toBe("running")

          // running -> merging
          const merging = await PlanStore.transition({ id: plan.id, status: "merging" })
          expect(merging.status).toBe("merging")

          // merging -> integrating -> integrated -> publishing -> done
          const integrating = await PlanStore.transition({ id: plan.id, status: "integrating" })
          expect(integrating.status).toBe("integrating")

          const integrated = await PlanStore.transition({ id: plan.id, status: "integrated" })
          expect(integrated.status).toBe("integrated")

          const publishing = await PlanStore.transition({ id: plan.id, status: "publishing" })
          expect(publishing.status).toBe("publishing")

          const done = await PlanStore.transition({ id: plan.id, status: "done" })
          expect(done.status).toBe("done")
          expect(done.time.completed).toBeGreaterThan(0)

          return done
        },
      })
    })

    test("rejects invalid state transitions", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const plan = await PlanStore.create({
            projectID: Instance.project.id,
            sessionID: undefined,
            task: "Test task",
            orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
            workerModel: { providerID: "test" as any, modelID: "test-model" as any },
          })

          // draft -> running is invalid (must go through proposed, approved, spawning)
          expect(async () => {
            await PlanStore.transition({ id: plan.id, status: "running" })
          }).toThrow()

          return plan
        },
      })
    })

    test("updates worker state", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const plan = await PlanStore.create({
            projectID: Instance.project.id,
            sessionID: undefined,
            task: "Test task",
            orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
            workerModel: { providerID: "test" as any, modelID: "test-model" as any },
          })

          const subtaskID = SubtaskID.ascending()
          await PlanStore.update({
            id: plan.id,
            subtasks: [
              {
                id: subtaskID,
                title: "Subtask 1",
                description: "Do something",
                fileScope: ["src/a.ts"],
                dependencies: [],
              },
            ],
            workers: [{ subtaskID, status: "pending" }],
            status: "proposed",
          })

          // Update worker to spawning
          const spawning = await PlanStore.updateWorker({
            id: plan.id,
            subtaskID,
            status: "spawning",
          })
          expect(spawning.workers[0].status).toBe("spawning")

          // Update worker to running with session and worktree info
          const running = await PlanStore.updateWorker({
            id: plan.id,
            subtaskID,
            status: "running",
            sessionID: undefined,
            worktreeName: "parallel-test",
            worktreeDir: "/tmp/test-worktree",
            branch: "parallel-test-branch",
          })
          expect(running.workers[0].status).toBe("running")
          expect(running.workers[0].worktreeName).toBe("parallel-test")
          expect(running.workers[0].branch).toBe("parallel-test-branch")

          // Update worker to done with diff stat
          const done = await PlanStore.updateWorker({
            id: plan.id,
            subtaskID,
            status: "done",
            diffStat: { additions: 10, deletions: 5, files: 2 },
          })
          expect(done.workers[0].status).toBe("done")
          expect(done.workers[0].diffStat).toEqual({ additions: 10, deletions: 5, files: 2 })

          return done
        },
      })
    })

    test("lists plans", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          // Create multiple plans
          const plan1 = await PlanStore.create({
            projectID: Instance.project.id,
            sessionID: undefined,
            task: "Task 1",
            orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
            workerModel: { providerID: "test" as any, modelID: "test-model" as any },
          })

          const plan2 = await PlanStore.create({
            projectID: Instance.project.id,
            sessionID: undefined,
            task: "Task 2",
            orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
            workerModel: { providerID: "test" as any, modelID: "test-model" as any },
          })

          const plans = await PlanStore.list()
          expect(plans.length).toBeGreaterThanOrEqual(2)
          expect(plans.map((p) => p.id)).toContain(plan1.id)
          expect(plans.map((p) => p.id)).toContain(plan2.id)

          return plans
        },
      })
    })

    test("removes a plan", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const plan = await PlanStore.create({
            projectID: Instance.project.id,
            sessionID: undefined,
            task: "Task to remove",
            orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
            workerModel: { providerID: "test" as any, modelID: "test-model" as any },
          })

          await PlanStore.remove(plan.id)

          const plans = await PlanStore.list()
          expect(plans.map((p) => p.id)).not.toContain(plan.id)

          return plan
        },
      })
    })
  })

  describe("Orchestrator.resolveModels", () => {
    test("resolves models with defaults", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const models = await Orchestrator.resolveModels()
          expect(models.orchestratorModel).toBeDefined()
          expect(models.workerModel).toBeDefined()
          expect(models.orchestratorModel.providerID).toBeDefined()
          expect(models.orchestratorModel.modelID).toBeDefined()
          return models
        },
      })
    })
  })

  describe("Orchestrator.resolveOutcome", () => {
    function worker(status: WorkerState["status"]): WorkerState {
      return {
        subtaskID: SubtaskID.ascending(),
        status,
      }
    }

    test("fails when unresolved workers remain", () => {
      const result = Orchestrator.resolveOutcome({
        workers: [worker("merged"), worker("running"), worker("running")],
        integrationSuccess: true,
        publishSuccess: true,
      })

      expect(result.status).toBe("failed")
      expect(result.unresolved).toBe(2)
    })

    test("marks done only when all workers are merged", () => {
      const result = Orchestrator.resolveOutcome({
        workers: [worker("merged"), worker("merged"), worker("merged")],
        integrationSuccess: true,
        publishSuccess: true,
      })

      expect(result.status).toBe("done")
      expect(result.unresolved).toBe(0)
      expect(result.merged).toBe(3)
    })

    test("marks partial success when terminal but some workers failed", () => {
      const result = Orchestrator.resolveOutcome({
        workers: [worker("merged"), worker("conflict"), worker("failed")],
        integrationSuccess: true,
        publishSuccess: true,
      })

      expect(result.status).toBe("partial_success")
      expect(result.failed).toBe(2)
    })
  })
})
