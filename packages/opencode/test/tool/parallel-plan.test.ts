import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { ParallelPlanTool } from "../../src/tool/parallel-plan"
import { PlanStore } from "../../src/parallel/plan"
import { Orchestrator } from "../../src/parallel/orchestrator"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Session } from "../../src/session"
import { MessageID } from "../../src/session/schema"
import type { Tool } from "../../src/tool/tool"
import { tmpdir } from "../fixture/fixture"

function ctx(sessionID: Tool.Context["sessionID"]): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.make("msg_parallel-plan-test"),
    callID: "call_parallel-plan-test",
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

describe("tool.parallel_plan", () => {
  test("stores dependency-aware subtasks and plan contracts", async () => {
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
          const session = await Session.create({ title: "parallel plan tool" })
          const agent = {
            name: "orchestrator",
            model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
          }
          const tool = await ParallelPlanTool.init({ agent: agent as any })
          const result = await tool.execute(
            {
              task: "Ship a three-phase DAG",
              subtasks: [
                {
                  title: "Phase 0 scaffold",
                  description: "Create shared foundation",
                  fileScope: ["src/base.ts"],
                  kind: "structural",
                },
                {
                  title: "Phase 1 API",
                  description: "Build API using the shared types",
                  fileScope: ["src/api.ts"],
                  dependencies: [0],
                  constraints: ["Do not touch src/index.ts"],
                  kind: "semantic",
                },
                {
                  title: "Phase 2 wiring",
                  description: "Wire the API after scaffold and API are complete",
                  fileScope: ["src/index.ts"],
                  dependencies: [0, 1],
                },
              ],
              sharedContracts: [
                {
                  name: "Shared API types",
                  description: "Types consumed by the API and wiring tasks",
                  types: "export type Api = { ok: true }",
                  producerIndices: [0],
                  consumerIndices: [1, 2],
                },
              ],
              conventions: {
                auth: "Bearer token",
                timestamps: "UTC in storage",
                other: ["Prefer a single approval for the whole DAG"],
              },
            },
            ctx(session.id),
          )

          expect(models).toHaveBeenCalledWith({
            currentModel: {
              providerID: "test",
              modelID: "glm-5-turbo",
            },
          })

          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(1)

          const plan = plans[0]
          expect(plan.status).toBe("proposed")
          expect(plan.subtasks).toHaveLength(3)
          expect(plan.subtasks[1].dependencies).toEqual([plan.subtasks[0].id])
          expect(plan.subtasks[2].dependencies).toEqual([plan.subtasks[0].id, plan.subtasks[1].id])
          expect(plan.subtasks[1].constraints).toEqual(["Do not touch src/index.ts"])
          expect(plan.subtasks[0].kind).toBe("structural")
          expect(plan.subtasks[1].kind).toBe("semantic")
          expect(plan.sharedContracts).toEqual([
            {
              name: "Shared API types",
              description: "Types consumed by the API and wiring tasks",
              types: "export type Api = { ok: true }",
              producers: [plan.subtasks[0].id],
              consumers: [plan.subtasks[1].id, plan.subtasks[2].id],
            },
          ])
          expect(plan.conventions).toEqual({
            auth: "Bearer token",
            timestamps: "UTC in storage",
            other: ["Prefer a single approval for the whole DAG"],
          })
          expect(plan.executionMode).toBe("worktree")
          expect(result.output).toContain("depends on: 1")
          expect(result.output).toContain("depends on: 1, 2")
          expect(result.output).toContain("Execution mode: worktree")
          expect(result.output).toContain("Shared contracts: 1")
          expect(result.output).toContain("Project conventions: yes")
        },
      })
    } finally {
      models.mockRestore()
    }
  })

  test("rejects invalid dependency indices before saving the plan", async () => {
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
          const session = await Session.create({ title: "parallel plan tool invalid" })
          const tool = await ParallelPlanTool.init({
            agent: {
              name: "orchestrator",
              model: { providerID: "test" as any, modelID: "glm-5-turbo" as any },
            } as any,
          })

          await expect(
            tool.execute(
              {
                task: "Bad DAG",
                subtasks: [
                  {
                    title: "Only subtask",
                    description: "This dependency points past the end",
                    fileScope: ["src/only.ts"],
                    dependencies: [1],
                  },
                ],
              },
              ctx(session.id),
            ),
          ).rejects.toThrow("Invalid subtask dependencies at index 0")

          const plans = await PlanStore.listByProject(Instance.project.id)
          expect(plans).toHaveLength(0)
        },
      })
    } finally {
      models.mockRestore()
    }
  })
})
