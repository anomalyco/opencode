import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { PlanStore } from "../../src/parallel/plan"
import { SubtaskID, PlanID } from "../../src/parallel/schema"
import { exportDiagnosticsBundle } from "../../src/parallel/diagnostics"
import { tmpdir } from "../fixture/fixture"
import * as fs from "fs/promises"
import * as path from "path"

describe("exportDiagnosticsBundle", () => {
  test("exports plan with error details", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const plan = await PlanStore.create({
          projectID: Instance.project.id,
          sessionID: undefined,
          task: "Test task with error",
          orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
          workerModel: { providerID: "test" as any, modelID: "test-model" as any },
        })

        await PlanStore.update({
          id: plan.id,
          status: "failed",
          error: {
            code: "MERGE_FAILED",
            message: "Failed to merge worker changes",
            stage: "merge",
            at: Date.now(),
          },
        })

        const bundle = await exportDiagnosticsBundle(plan.id)

        expect(bundle.plan.id).toBe(plan.id)
        expect(bundle.plan.status).toBe("failed")
        expect(bundle.error).toBeDefined()
        expect(bundle.error?.code).toBe("MERGE_FAILED")
        expect(bundle.error?.message).toBe("Failed to merge worker changes")
        expect(bundle.error?.stage).toBe("merge")
        expect(bundle.exportedAt).toBeGreaterThan(0)

        return bundle
      },
    })
  })

  test("exports plan with workers in various states", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const plan = await PlanStore.create({
          projectID: Instance.project.id,
          sessionID: undefined,
          task: "Multi-worker task",
          orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
          workerModel: { providerID: "test" as any, modelID: "test-model" as any },
        })

        const subtaskID1 = SubtaskID.ascending()
        const subtaskID2 = SubtaskID.ascending()
        const subtaskID3 = SubtaskID.ascending()

        await PlanStore.update({
          id: plan.id,
          subtasks: [
            {
              id: subtaskID1,
              title: "Subtask 1",
              description: "First subtask",
              fileScope: ["src/a.ts"],
              dependencies: [],
            },
            {
              id: subtaskID2,
              title: "Subtask 2",
              description: "Second subtask",
              fileScope: ["src/b.ts"],
              dependencies: [],
            },
            {
              id: subtaskID3,
              title: "Subtask 3",
              description: "Third subtask",
              fileScope: ["src/c.ts"],
              dependencies: [],
            },
          ],
          workers: [
            { subtaskID: subtaskID1, status: "done", diffStat: { additions: 10, deletions: 2, files: 1 } },
            { subtaskID: subtaskID2, status: "failed", error: "Worker crashed" },
            { subtaskID: subtaskID3, status: "running", worktreeName: "wt-3", branch: "parallel-3" },
          ],
          status: "proposed",
        })

        const bundle = await exportDiagnosticsBundle(plan.id)

        expect(bundle.workers.list).toHaveLength(3)
        expect(bundle.workers.summary.done).toBe(1)
        expect(bundle.workers.summary.failed).toBe(1)
        expect(bundle.workers.summary.running).toBe(1)
        expect(bundle.workers.summary.pending).toBe(0)

        const doneWorker = bundle.workers.list.find((w) => w.status === "done")
        expect(doneWorker?.diffStat).toEqual({ additions: 10, deletions: 2, files: 1 })

        const failedWorker = bundle.workers.list.find((w) => w.status === "failed")
        expect(failedWorker?.error).toBe("Worker crashed")

        const runningWorker = bundle.workers.list.find((w) => w.status === "running")
        expect(runningWorker?.worktreeName).toBe("wt-3")
        expect(runningWorker?.branch).toBe("parallel-3")

        return bundle
      },
    })
  })

  test("validates JSON output format", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const plan = await PlanStore.create({
          projectID: Instance.project.id,
          sessionID: undefined,
          task: "Simple task",
          orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
          workerModel: { providerID: "test" as any, modelID: "test-model" as any },
        })

        const bundle = await exportDiagnosticsBundle(plan.id)
        const json = JSON.stringify(bundle, null, 2)
        const parsed = JSON.parse(json)

        expect(parsed).toHaveProperty("plan")
        expect(parsed).toHaveProperty("workers")
        expect(parsed).toHaveProperty("logs")
        expect(parsed).toHaveProperty("exportedAt")
        expect(parsed.plan).toHaveProperty("id")
        expect(parsed.plan).toHaveProperty("status")
        expect(parsed.plan).toHaveProperty("task")
        expect(parsed.plan).toHaveProperty("subtasks")
        expect(parsed.plan).toHaveProperty("time")
        expect(parsed.workers).toHaveProperty("summary")
        expect(parsed.workers).toHaveProperty("list")

        return parsed
      },
    })
  })

  test("sanitizes secrets in bundle", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const plan = await PlanStore.create({
          projectID: Instance.project.id,
          sessionID: undefined,
          task: "Task with secrets",
          orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
          workerModel: { providerID: "test" as any, modelID: "test-model" as any },
        })

        const subtaskID = SubtaskID.ascending()
        await PlanStore.update({
          id: plan.id,
          subtasks: [
            {
              id: subtaskID,
              title: "Subtask",
              description: "Test",
              fileScope: ["src/a.ts"],
              dependencies: [],
              model: { providerID: "openai" as any, modelID: "gpt-4" as any },
            },
          ],
          workers: [{ subtaskID, status: "failed", error: "API key invalid: sk-abc123xyz789" }],
          status: "failed",
          error: {
            code: "API_ERROR",
            message: "Authentication failed with token: secret_token_123",
            stage: "execution",
            at: Date.now(),
          },
        })

        const bundle = await exportDiagnosticsBundle(plan.id)
        const json = JSON.stringify(bundle)

        expect(json).not.toContain("sk-abc123xyz789")
        expect(json).not.toContain("secret_token_123")
        expect(json).toContain("***REDACTED***")

        return bundle
      },
    })
  })

  test("file output path handling", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const plan = await PlanStore.create({
          projectID: Instance.project.id,
          sessionID: undefined,
          task: "File output test",
          orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
          workerModel: { providerID: "test" as any, modelID: "test-model" as any },
        })

        const outputPath = path.join(tmp.path, "diagnostics.json")
        const bundle = await exportDiagnosticsBundle(plan.id)
        await fs.writeFile(outputPath, JSON.stringify(bundle, null, 2), "utf-8")

        expect(
          await fs
            .access(outputPath)
            .then(() => true)
            .catch(() => false),
        ).toBe(true)

        const content = await fs.readFile(outputPath, "utf-8")
        const parsed = JSON.parse(content)

        expect(parsed.plan.id).toBe(plan.id)
        expect(parsed.exportedAt).toBe(bundle.exportedAt)

        return parsed
      },
    })
  })

  test("handles plan without workers", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const plan = await PlanStore.create({
          projectID: Instance.project.id,
          sessionID: undefined,
          task: "Draft plan",
          orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
          workerModel: { providerID: "test" as any, modelID: "test-model" as any },
        })

        const bundle = await exportDiagnosticsBundle(plan.id)

        expect(bundle.workers.list).toHaveLength(0)
        expect(bundle.workers.summary.pending).toBe(0)
        expect(bundle.workers.summary.done).toBe(0)
        expect(bundle.error).toBeUndefined()

        return bundle
      },
    })
  })

  test("handles plan not found error", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const fakePlanID = PlanID.make("pln_nonexistent123456789")

        let error: Error | undefined
        try {
          await exportDiagnosticsBundle(fakePlanID)
        } catch (err) {
          error = err as Error
        }

        expect(error).toBeDefined()
        expect(error?.message).toContain("NotFoundError")

        return error
      },
    })
  })
})
