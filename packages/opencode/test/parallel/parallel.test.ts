import { describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { PlanStore } from "../../src/parallel/plan"
import { Orchestrator } from "../../src/parallel/orchestrator"
import { Recovery } from "../../src/parallel/recovery"
import { WorkerManager } from "../../src/parallel/worker"
import { Provider } from "../../src/provider/provider"
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
            approvalMode: "phase",
            executionMode: "task-agent",
          })

          expect(plan.publishMode).toBe("direct")
          expect(plan.approvalMode).toBe("phase")
          expect(plan.executionMode).toBe("task-agent")

          const updated = await PlanStore.update({
            id: plan.id,
            integrationBranch: `parallel/${plan.id}`,
            publishMode: "unstaged",
            approvalMode: "manual",
            executionMode: "worktree",
          })

          expect(updated.integrationBranch).toBe(`parallel/${plan.id}`)
          expect(updated.publishMode).toBe("unstaged")
          expect(updated.approvalMode).toBe("manual")
          expect(updated.executionMode).toBe("worktree")

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

    test("ignores no-op status updates", async () => {
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

          const proposed = await PlanStore.update({
            id: plan.id,
            status: "proposed",
          })

          const same = await PlanStore.update({
            id: proposed.id,
            status: "proposed",
          })

          expect(same.status).toBe("proposed")
          return same
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

          // running -> paused -> approved
          const paused = await PlanStore.transition({ id: plan.id, status: "paused" })
          expect(paused.status).toBe("paused")

          const resumed = await PlanStore.transition({ id: plan.id, status: "approved" })
          expect(resumed.status).toBe("approved")

          // approved -> spawning -> running -> merging
          const respawning = await PlanStore.transition({ id: plan.id, status: "spawning" })
          expect(respawning.status).toBe("spawning")

          const rerunning = await PlanStore.transition({ id: plan.id, status: "running" })
          expect(rerunning.status).toBe("running")

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
          const def = spyOn(Provider, "defaultModel").mockResolvedValue({
            providerID: "test" as any,
            modelID: "recent-model" as any,
          })
          const current = {
            providerID: "test" as any,
            modelID: "current-model" as any,
          }

          try {
            const models = await Orchestrator.resolveModels({
              currentModel: current,
            })

            expect(models.orchestratorModel).toEqual(current)
            expect(models.workerModel).toEqual(current)
            expect(def).toHaveBeenCalled()
            return models
          } finally {
            def.mockRestore()
          }
        },
      })
    })
  })

  describe("Orchestrator.execute", () => {
    test("cleans up worktrees when workers remain active after wait", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const spawned = spyOn(WorkerManager, "spawnAll").mockResolvedValue(undefined)
          const waited = spyOn(WorkerManager, "waitAll").mockResolvedValue(undefined)
          const cleaned = spyOn(Recovery, "cleanupWorktrees").mockResolvedValue(undefined)

          try {
            const plan = await PlanStore.create({
              projectID: Instance.project.id,
              sessionID: undefined,
              task: "Test task",
              orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
              workerModel: { providerID: "test" as any, modelID: "test-model" as any },
              executionMode: "worktree",
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
            await PlanStore.transition({ id: plan.id, status: "approved" })

            await Orchestrator.execute(plan.id, new AbortController().signal)

            const failed = await PlanStore.get(plan.id)
            expect(failed.status).toBe("failed")
            expect(failed.error?.code).toBe("workers_incomplete")
            expect(cleaned).toHaveBeenCalledTimes(1)
            expect(spawned).toHaveBeenCalledTimes(1)
            expect(waited).not.toHaveBeenCalled()
          } finally {
            spawned.mockRestore()
            waited.mockRestore()
            cleaned.mockRestore()
          }
        },
      })
    })
  })

  describe("Orchestrator.cancel", () => {
    test("marks in-flight workers as failed before plan cleanup", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const cleaned = spyOn(Recovery, "cleanupWorktrees").mockResolvedValue(undefined)

          try {
            const a = SubtaskID.ascending()
            const b = SubtaskID.ascending()
            const c = SubtaskID.ascending()
            const plan = await PlanStore.create({
              projectID: Instance.project.id,
              sessionID: undefined,
              task: "Cancel test",
              orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
              workerModel: { providerID: "test" as any, modelID: "test-model" as any },
              executionMode: "worktree",
            })

            await PlanStore.update({
              id: plan.id,
              subtasks: [
                { id: a, title: "A", description: "A", fileScope: ["src/a.ts"], dependencies: [] },
                { id: b, title: "B", description: "B", fileScope: ["src/b.ts"], dependencies: [] },
                { id: c, title: "C", description: "C", fileScope: ["src/c.ts"], dependencies: [] },
              ],
              workers: [
                { subtaskID: a, status: "running" },
                { subtaskID: b, status: "pending" },
                { subtaskID: c, status: "done" },
              ],
              status: "proposed",
            })
            await PlanStore.transition({ id: plan.id, status: "approved" })
            await PlanStore.transition({ id: plan.id, status: "spawning" })
            await PlanStore.transition({ id: plan.id, status: "running" })

            await Orchestrator.cancel(plan.id)

            const stopped = await PlanStore.get(plan.id)
            expect(stopped.status).toBe("failed")
            expect(stopped.workers.map((worker) => worker.status)).toEqual(["failed", "failed", "done"])
            expect(stopped.workers[0].error).toBe("Cancelled by user")
            expect(stopped.workers[1].error).toBe("Cancelled by user")
            expect(cleaned).toHaveBeenCalledTimes(1)
          } finally {
            cleaned.mockRestore()
          }
        },
      })
    })
  })

  describe("Recovery.abandon", () => {
    test("works outside instance context", async () => {
      await using tmp = await tmpdir({ git: true })

      const id = await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const subtaskID = SubtaskID.ascending()
          const plan = await PlanStore.create({
            projectID: Instance.project.id,
            sessionID: undefined,
            task: "Headless abandon",
            orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
            workerModel: { providerID: "test" as any, modelID: "test-model" as any },
            executionMode: "worktree",
          })

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

          return plan.id
        },
      })

      const plan = await Recovery.abandon(id)
      expect(plan.status).toBe("failed")
      expect(plan.workers[0]?.status).toBe("failed")
      expect(plan.workers[0]?.error).toBe("Abandoned by user - plan cleanup requested")
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

    test("treats done workers as terminal in direct execution", () => {
      const result = Orchestrator.resolveDirectOutcome([worker("done"), worker("done")])

      expect(result.status).toBe("done")
      expect(result.unresolved).toBe(0)
    })
  })

  describe("Artifact Analyzer Integration", () => {
    test("detects implicit import dependency in preflight", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const { analyze } = await import("../../src/parallel/artifact")

          const subtasks = [
            {
              id: SubtaskID.make("producer"),
              title: "Create library",
              description: "Build shared library",
              fileScope: ["src/lib.ts"],
              dependencies: [],
            },
            {
              id: SubtaskID.make("consumer"),
              title: "Use library",
              description: "Imports from lib",
              fileScope: ["src/feature.ts"],
              dependencies: [],
            },
          ]

          const report = analyze(subtasks)

          expect(report.edges.length).toBeGreaterThan(0)
          expect(report.missingDependencies.size).toBeGreaterThan(0)

          return report
        },
      })
    })

    test("auto mode adds missing edges deterministically", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const { analyze, rewrite } = await import("../../src/parallel/artifact")

          const subtasks = [
            {
              id: SubtaskID.make("1"),
              title: "Create types",
              description: "Define types",
              fileScope: ["src/types.ts"],
              dependencies: [],
            },
            {
              id: SubtaskID.make("2"),
              title: "Implement API",
              description: "Uses types",
              fileScope: ["src/api.ts"],
              dependencies: [],
            },
          ]

          const report = analyze(subtasks)
          const { rewritten, addedDeps } = rewrite(subtasks, report)

          expect(addedDeps).toBeGreaterThan(0)
          expect(rewritten[1].dependencies).toContain(subtasks[0].id)

          // Deterministic - same result on re-analysis
          const report2 = analyze(rewritten)
          expect(report2.missingDependencies.size).toBe(0)

          return { rewritten, addedDeps }
        },
      })
    })

    test("strict mode blocks unsafe plan", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const { validate } = await import("../../src/parallel/artifact")

          const subtasks = [
            {
              id: SubtaskID.make("1"),
              title: "Create base",
              description: "Base module",
              fileScope: ["src/base.ts"],
              dependencies: [],
            },
            {
              id: SubtaskID.make("2"),
              title: "Extend",
              description: "Uses base",
              fileScope: ["src/ext.ts"],
              dependencies: [],
            },
          ]

          const result = validate(subtasks, "strict")

          expect(result.valid).toBe(false)
          expect(result.error).toBeDefined()

          return result
        },
      })
    })

    test("no false positives on disjoint subtasks", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const { analyze, validate } = await import("../../src/parallel/artifact")

          const subtasks = [
            {
              id: SubtaskID.make("1"),
              title: "Frontend",
              description: "UI work",
              fileScope: ["src/ui.tsx"],
              dependencies: [],
            },
            {
              id: SubtaskID.make("2"),
              title: "Backend",
              description: "API work",
              fileScope: ["src/api.ts"],
              dependencies: [],
            },
          ]

          const report = analyze(subtasks)
          const result = validate(subtasks, "strict")

          // No implicit dependencies between disjoint subtasks
          expect(report.diagnostics).toHaveLength(0)
          expect(report.missingDependencies.size).toBe(0)
          expect(result.valid).toBe(true)

          return report
        },
      })
    })
  })
})
