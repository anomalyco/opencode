import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Integration } from "../../src/parallel/integration"
import { PlanStore } from "../../src/parallel/plan"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

describe("Parallel Integration", () => {
  test("publish new-branch succeeds when integration branch exists", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const plan = await PlanStore.create({
          projectID: Instance.project.id,
          sessionID: undefined,
          task: "publish test",
          orchestratorModel: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          workerModel: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        })

        const cwd = Instance.worktree
        const base = (await $`git rev-parse --abbrev-ref HEAD`.cwd(cwd).text()).trim()
        const branch = `parallel/${plan.id}`

        await $`git checkout -b ${branch}`.cwd(cwd).quiet()
        await $`git checkout ${base}`.cwd(cwd).quiet()

        const result = await Integration.publish(plan.id, "new-branch")
        expect(result.success).toBe(true)
        expect(result.mode).toBe("new-branch")
        expect(result.branch).toBe(branch)
      },
    })
  })
})
