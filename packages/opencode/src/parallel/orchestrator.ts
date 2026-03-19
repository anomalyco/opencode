import { PlanStore } from "./plan"
import { Decomposition } from "./decomposition"
import { WorkerManager } from "./worker"
import { MergePipeline } from "./merge"
import { Log } from "@/util/log"
import { fn } from "@/util/fn"
import type { Plan, PlanID } from "./schema"
import { Plan as PlanSchema, PlanID as PlanIDSchema } from "./schema"

export namespace Orchestrator {
  const log = Log.create({ service: "orchestrator" })

  // Track active abort controllers so cancel() can stop running executions
  const activeExecutions = new Map<PlanID, AbortController>()

  export const create = fn(
    PlanSchema.pick({
      sessionID: true,
      task: true,
      orchestratorModel: true,
      workerModel: true,
    }),
    async (input): Promise<Plan> => {
      const plan = await PlanStore.create(input)

      const subtasks = await Decomposition.decompose({
        task: input.task,
        model: input.orchestratorModel,
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

    log.info("plan execution complete", { planID, success })
  }

  export const approve = fn(PlanIDSchema.zod, async (planID): Promise<Plan> => {
    const plan = await PlanStore.transition({ id: planID, status: "approved" })
    log.info("plan approved", { planID })

    const controller = new AbortController()
    activeExecutions.set(planID, controller)

    execute(planID, controller.signal)
      .catch((error) => {
        log.error("plan execution failed", { planID, error })
        PlanStore.transition({ id: planID, status: "failed" }).catch(() => {})
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
