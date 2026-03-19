import z from "zod"
import { Tool } from "./tool"
import { PlanStore } from "@/parallel/plan"
import { Orchestrator } from "@/parallel/orchestrator"
import { Instance } from "@/project/instance"

export const ParallelCancelTool = Tool.define("parallel_cancel", {
  description:
    "Cancel a running parallel execution plan. This will abort any active workers and mark the plan as failed.",
  parameters: z.object({
    plan_id: z
      .string()
      .optional()
      .describe("Plan ID to cancel. If omitted, cancels the latest running plan for this project."),
  }),
  async execute(params) {
    let planID = params.plan_id
    const projectID = Instance.project.id

    if (!planID) {
      const plans = await PlanStore.list()
      const running = plans.find(
        (p) => p.projectID === projectID && ["spawning", "running", "merging"].includes(p.status),
      )
      if (!running) {
        return {
          title: "No running plan found",
          output: "No running parallel plans found for this project.",
          metadata: {} as Record<string, never>,
        }
      }
      planID = running.id
    }

    const plan = await PlanStore.get(planID as any)

    // Verify plan belongs to current project
    if (plan.projectID !== projectID) {
      return {
        title: "Plan not found",
        output: "Plan does not belong to this project.",
        metadata: {} as Record<string, never>,
      }
    }

    if (!["spawning", "running", "merging", "approved", "proposed"].includes(plan.status)) {
      return {
        title: "Plan cannot be cancelled",
        output: `Plan is in "${plan.status}" status. Only proposed, approved, spawning, running, or merging plans can be cancelled.`,
        metadata: {} as Record<string, never>,
      }
    }

    await Orchestrator.cancel(planID as any)

    return {
      title: `Plan ${planID} cancelled`,
      output: `Parallel plan ${planID} has been cancelled. All active workers have been stopped.`,
      metadata: {} as Record<string, never>,
    }
  },
})
