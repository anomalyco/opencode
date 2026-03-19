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
import type { Plan, PlanID, ModelRef, SubtaskID } from "./schema"
import { Plan as PlanSchema, PlanID as PlanIDSchema, SubtaskID as SubtaskIDSchema } from "./schema"
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

  export async function checkPlanLimit(projectID: Plan["projectID"]): Promise<void> {
    const cfg = await Config.get()
    const limit = cfg.parallel?.max_plans_per_project ?? 5
    const active = await PlanStore.listActiveByProject(projectID)
    if (active.length >= limit) {
      throw new Error(
        `Parallel plan limit reached for project: ${active.length} active plans (max ${limit}). ` +
          "Cancel or complete existing plans before creating new ones.",
      )
    }
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
      await checkPlanLimit(input.projectID)

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

      const codebaseContext = await Decomposition.gatherCodebaseContext(Instance.directory)
      const formattedContext = Decomposition.formatCodebaseContext(codebaseContext)

      const subtasks = await Decomposition.decompose({
        task: input.task,
        model: models.orchestratorModel,
        codebaseContext: formattedContext,
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

      const cfg = await Config.get()
      const autoApprove = cfg.parallel?.require_approval === false
      if (autoApprove) {
        await approve(updated.id)
      }

      log.info("plan created", { planID: plan.id, subtaskCount: subtasks.length, autoApprove })
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

    // Preserve existing model overrides from current subtasks
    const modelOverrides = new Map<string, ModelRef>()
    for (const st of plan.subtasks) {
      if (st.model) {
        // Index by title since IDs change on regeneration
        modelOverrides.set(st.title, st.model)
      }
    }

    const codebaseContext = await Decomposition.gatherCodebaseContext(Instance.directory)
    const formattedContext = Decomposition.formatCodebaseContext(codebaseContext)

    const subtasks = await Decomposition.decompose({
      task: plan.task,
      model: plan.orchestratorModel,
      codebaseContext: formattedContext,
    })

    // Restore model overrides where titles match
    const restoredSubtasks = subtasks.map((st) => {
      const override = modelOverrides.get(st.title)
      return override ? { ...st, model: override } : st
    })

    return PlanStore.update({
      id: planID,
      subtasks: restoredSubtasks,
      workers: restoredSubtasks.map((st) => ({
        subtaskID: st.id,
        status: "pending" as const,
      })),
      status: "proposed",
    })
  }

  export const retryWorker = fn(
    z.object({
      planID: PlanIDSchema.zod,
      subtaskID: SubtaskIDSchema.zod,
    }),
    async ({ planID, subtaskID }): Promise<Plan> => {
      const plan = await PlanStore.get(planID)
      const worker = plan.workers.find((w) => w.subtaskID === subtaskID)

      if (!worker) {
        throw new Error(`Worker not found for subtask: ${subtaskID}`)
      }

      if (worker.status !== "failed") {
        throw new Error(`Cannot retry worker with status '${worker.status}'. Only failed workers can be retried.`)
      }

      const subtask = plan.subtasks.find((st) => st.id === subtaskID)
      if (!subtask) {
        throw new Error(`Subtask not found: ${subtaskID}`)
      }

      await PlanStore.updateWorker({
        id: planID,
        subtaskID,
        status: "pending",
        error: undefined,
        sessionID: undefined,
        worktreeName: undefined,
        worktreeDir: undefined,
        branch: undefined,
        diffStat: undefined,
      })

      const controller = new AbortController()

      WorkerManager.spawnOne(plan, subtask, controller.signal)
        .then(async () => {
          await WorkerManager.waitAll(planID, controller.signal)

          const updated = await PlanStore.get(planID)
          const allDone = updated.workers.every((w) => w.status === "done" || w.status === "merged")
          const hasFailures = updated.workers.some((w) => w.status === "failed")

          if (allDone && !hasFailures && updated.status === "running") {
            await PlanStore.transition({ id: planID, status: "merging" })
            const success = await MergePipeline.run(planID)
            await PlanStore.transition({ id: planID, status: success ? "done" : "failed" })
            if (!success) {
              const finalPlan = await PlanStore.get(planID)
              await Recovery.cleanupWorktrees(finalPlan)
            }
          }
        })
        .catch(async (error) => {
          log.error("worker retry failed", { planID, subtaskID, error })
          await PlanStore.updateWorker({
            id: planID,
            subtaskID,
            status: "failed",
            error: error instanceof Error ? error.message : "Retry failed",
          }).catch(() => {})
        })

      log.info("worker retry initiated", { planID, subtaskID })
      return PlanStore.get(planID)
    },
  )
}
