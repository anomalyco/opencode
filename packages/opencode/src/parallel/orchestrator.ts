import { PlanStore } from "./plan"
import { Decomposition } from "./decomposition"
import { Bus } from "@/bus"
import { ParallelEvent } from "./events"
import { WorkerManager } from "./worker"
import { MergePipeline } from "./merge"
import { Log } from "@/util/log"
import { fn } from "@/util/fn"
import { Session } from "@/session"
import type { Plan, PlanID, ModelRef } from "./schema"
import { Plan as PlanSchema, PlanID as PlanIDSchema, ModelRef as ModelRefSchema } from "./schema"

export namespace Orchestrator {
  const log = Log.create({ service: "orchestrator" })

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

    await PlanStore.transition(planID, { status: "spawning" })
    let plan = await PlanStore.get(planID)

    await WorkerManager.spawnAll(plan, abort)

    await PlanStore.transition(planID, { status: "running" })

    await WorkerManager.waitAll(planID, abort)

    await PlanStore.transition(planID, { status: "merging" })

    const success = await MergePipeline.run(planID)

    await PlanStore.transition(planID, { status: success ? "done" : "failed" })
    if (success) {
      await PlanStore.complete(planID)
    }

    log.info("plan execution complete", { planID, success })
  }

  export const approve = fn(PlanIDSchema.zod, async (planID): Promise<Plan> => {
    const plan = await PlanStore.approve(planID)
    log.info("plan approved", { planID })

    execute(planID, new AbortController().signal).catch((error) => {
      log.error("plan execution failed", { planID, error })
      PlanStore.transition(planID, { status: "failed" }).catch(() => {})
    })

    return plan
  })

  export const cancel = fn(PlanIDSchema.zod, async (planID): Promise<void> => {
    await PlanStore.transition(planID, { status: "failed" })
    log.info("plan cancelled", { planID })
  })

  export async function retry(planID: PlanID): Promise<Plan> {
    const plan = await PlanStore.get(planID)
    if (plan.status !== "failed") {
      throw new Error("Can only retry failed plans")
    }

    await PlanStore.transition(planID, { status: "draft" })

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
