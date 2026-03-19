import { PlanStore } from "./plan"
import { Decomposition } from "./decomposition"
import { WorkerManager } from "./worker"
import { MergePipeline } from "./merge"
import { Recovery } from "./recovery"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { fn } from "@/util/fn"
import type { Plan, PlanID, ModelRef } from "./schema"
import { Plan as PlanSchema, PlanID as PlanIDSchema } from "./schema"
import z from "zod"

export namespace Orchestrator {
  const log = Log.create({ service: "orchestrator" })

  // Track active abort controllers so cancel() can stop running executions
  const activeExecutions = new Map<PlanID, AbortController>()

  /**
   * Resolve model defaults from config.
   * Priority: explicit input > config.parallel > project default model
   */
  export async function resolveModels(input?: {
    orchestratorModel?: ModelRef
    workerModel?: ModelRef
  }): Promise<{ orchestratorModel: ModelRef; workerModel: ModelRef }> {
    const cfg = await Config.get()
    const defaultModel = await Provider.defaultModel()

    function parseConfigModel(modelStr?: string): ModelRef | undefined {
      if (!modelStr) return undefined
      const parsed = Provider.parseModel(modelStr)
      if (!parsed) return undefined
      return { providerID: parsed.providerID, modelID: parsed.modelID }
    }

    const orchestratorModel = input?.orchestratorModel ??
      parseConfigModel(cfg.parallel?.orchestrator_model) ?? {
        providerID: defaultModel.providerID,
        modelID: defaultModel.modelID,
      }

    const workerModel = input?.workerModel ??
      parseConfigModel(cfg.parallel?.worker_model) ?? {
        providerID: defaultModel.providerID,
        modelID: defaultModel.modelID,
      }

    return { orchestratorModel, workerModel }
  }

  export const create = fn(
    z.object({
      projectID: PlanSchema.shape.projectID,
      sessionID: PlanSchema.shape.sessionID,
      task: PlanSchema.shape.task,
      orchestratorModel: PlanSchema.shape.orchestratorModel.optional(),
      workerModel: PlanSchema.shape.workerModel.optional(),
    }),
    async (input): Promise<Plan> => {
      const models = await resolveModels({
        orchestratorModel: input.orchestratorModel,
        workerModel: input.workerModel,
      })

      const plan = await PlanStore.create({
        projectID: input.projectID,
        sessionID: input.sessionID,
        task: input.task,
        ...models,
      })

      const subtasks = await Decomposition.decompose({
        task: input.task,
        model: models.orchestratorModel,
      })

      const updated = await PlanStore.update({
        id: plan.id,
        subtasks,
        workers: subtasks.map((st) => ({
          subtaskID: st.id,
          status: "pending" as const,
        })),
        status: "proposed",
      })

      log.info("plan created", { planID: plan.id, subtaskCount: subtasks.length })
      return updated
    },
  )

  export async function execute(planID: PlanID, abort: AbortSignal): Promise<void> {
    log.info("executing plan", { planID })

    await PlanStore.transition({ id: planID, status: "spawning" })
    const plan = await PlanStore.get(planID)

    await WorkerManager.spawnAll(plan, abort)

    await PlanStore.transition({ id: planID, status: "running" })

    await WorkerManager.waitAll(planID, abort)

    await PlanStore.transition({ id: planID, status: "merging" })

    const success = await MergePipeline.run(planID)

    await PlanStore.transition({ id: planID, status: success ? "done" : "failed" })

    if (!success) {
      const finalPlan = await PlanStore.get(planID)
      await Recovery.cleanupWorktrees(finalPlan)
    }

    log.info("plan execution complete", { planID, success })
  }

  export const approve = fn(PlanIDSchema.zod, async (planID): Promise<Plan> => {
    const plan = await PlanStore.transition({ id: planID, status: "approved" })
    log.info("plan approved", { planID })

    const controller = new AbortController()
    activeExecutions.set(planID, controller)

    execute(planID, controller.signal)
      .catch(async (error) => {
        log.error("plan execution failed", { planID, error })
        try {
          const plan = await PlanStore.get(planID)
          await Recovery.cleanupWorktrees(plan)
        } catch {}
        await PlanStore.transition({ id: planID, status: "failed" }).catch(() => {})
      })
      .finally(() => {
        activeExecutions.delete(planID)
      })

    return plan
  })

  export const cancel = fn(PlanIDSchema.zod, async (planID): Promise<void> => {
    const controller = activeExecutions.get(planID)
    if (controller) {
      controller.abort()
      activeExecutions.delete(planID)
    }
    await PlanStore.transition({ id: planID, status: "failed" })
    const plan = await PlanStore.get(planID)
    await Recovery.cleanupWorktrees(plan)
    log.info("plan cancelled", { planID })
  })

  export async function retry(planID: PlanID): Promise<Plan> {
    const plan = await PlanStore.get(planID)
    if (plan.status !== "failed") {
      throw new Error("Can only retry failed plans")
    }

    await PlanStore.transition({ id: planID, status: "draft" })

    const subtasks = await Decomposition.decompose({
      task: plan.task,
      model: plan.orchestratorModel,
    })

    return PlanStore.update({
      id: planID,
      subtasks,
      workers: subtasks.map((st) => ({
        subtaskID: st.id,
        status: "pending" as const,
      })),
      status: "proposed",
    })
  }
}
