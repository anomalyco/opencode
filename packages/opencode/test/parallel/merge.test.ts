import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { PlanStore } from "../../src/parallel/plan"
import { MergePipeline } from "../../src/parallel/merge"
import { SubtaskID } from "../../src/parallel/schema"
import { tmpdir } from "../fixture/fixture"

describe("MergePipeline", () => {
  test("keeps unmerged worktrees for recovery when merge fails", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const subtaskID = SubtaskID.ascending()
        const dir = path.join(tmp.path, ".worktrees", "keep-on-fail")
        await fs.mkdir(dir, { recursive: true })

        const plan = await PlanStore.create({
          projectID: Instance.project.id,
          sessionID: undefined,
          task: "Test merge failure cleanup behavior",
          orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
          workerModel: { providerID: "test" as any, modelID: "test-model" as any },
        })

        await PlanStore.update({
          id: plan.id,
          status: "proposed",
          subtasks: [
            {
              id: subtaskID,
              title: "Missing branch merge",
              description: "Intentionally points to a non-existent branch",
              fileScope: ["src/test.ts"],
              dependencies: [],
            },
          ],
          workers: [
            {
              subtaskID,
              status: "done",
              worktreeDir: dir,
              branch: "opencode/branch-does-not-exist",
            },
          ],
        })
        await PlanStore.transition({ id: plan.id, status: "approved" })
        await PlanStore.transition({ id: plan.id, status: "spawning" })
        await PlanStore.transition({ id: plan.id, status: "running" })
        await PlanStore.transition({ id: plan.id, status: "merging" })

        const ok = await MergePipeline.run(plan.id)
        expect(ok).toBe(false)

        const updated = await PlanStore.get(plan.id)
        expect(updated.workers[0].status).toBe("conflict")

        const kept = await fs
          .stat(dir)
          .then(() => true)
          .catch(() => false)
        expect(kept).toBe(true)
      },
    })
  })
})
