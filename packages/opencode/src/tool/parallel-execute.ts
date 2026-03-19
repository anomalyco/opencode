import z from "zod"
import { Tool } from "./tool"
import { PlanStore } from "@/parallel/plan"
import { Orchestrator } from "@/parallel/orchestrator"

export const ParallelExecuteTool = Tool.define("parallel_execute", {
  description:
    "Approve and launch a parallel execution plan. Workers will spawn in isolated git worktrees and execute subtasks in parallel. Call this when the user confirms the plan is ready.",
  parameters: z.object({
    plan_id: z.string().optional().describe("Plan ID to execute. If omitted, uses the latest proposed plan for this session."),
  }),
  async execute(params, ctx) {
    let planID = params.plan_id

    if (!planID) {
      const plans = await PlanStore.list()
      const proposed = plans.find((p) => p.sessionID === ctx.sessionID && p.status === "proposed")
      if (!proposed) {
        return {
          title: "No plan found",
          output: "No proposed plan found for this session. Create a plan first with parallel_plan.",
          metadata: {} as Record<string, never>,
        }
      }
      planID = proposed.id
    }

    const plan = await PlanStore.get(planID as any)

    if (plan.status !== "proposed") {
      return {
        title: "Plan not ready",
        output: `Plan is in "${plan.status}" status. Only proposed plans can be executed.`,
        metadata: {} as Record<string, never>,
      }
    }

    await Orchestrator.approve(planID as any)

    return {
      title: `Launched ${plan.subtasks.length} parallel workers`,
      output: `Plan ${planID} approved and execution started.\n${plan.subtasks.length} workers are spawning in isolated git worktrees.\n\nThe user can monitor progress with the /workers command in the command palette.`,
      metadata: {} as Record<string, never>,
    }
  },
})
