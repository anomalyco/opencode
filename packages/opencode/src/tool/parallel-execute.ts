import z from "zod"
import { Tool } from "./tool"
import { PlanStore } from "@/parallel/plan"
import { Orchestrator } from "@/parallel/orchestrator"
import { Instance } from "@/project/instance"

const params = z.object({
  plan_id: z
    .string()
    .optional()
    .describe("Plan ID to execute. If omitted, uses the latest proposed plan for this project."),
  live: z
    .boolean()
    .optional()
    .describe("Enable live worker status reporting in the orchestrator thread (default: true)."),
})

type Meta = {
  planID?: string
  live?: boolean
  status?: string
  total?: number
  done?: number
  running?: number
  failed?: number
}

export const ParallelExecuteTool = Tool.define<typeof params, Meta>("parallel_execute", {
  description:
    "Approve and launch a parallel execution plan. Workers will spawn in isolated git worktrees and execute subtasks in parallel. Call this when the user confirms the plan is ready.",
  parameters: params,
  async execute(params, ctx) {
    let planID = params.plan_id
    const projectID = Instance.project.id
    const live = params.live ?? true

    if (!planID) {
      const plans = await PlanStore.list()
      const proposed = plans.find((p) => p.projectID === projectID && p.status === "proposed")
      if (!proposed) {
        return {
          title: "No plan found",
          output: "No proposed plan found for this project. Create a plan first with parallel_plan.",
          metadata: {},
        }
      }
      planID = proposed.id
    }

    const plan = await PlanStore.get(planID as any)

    // Verify plan belongs to current project
    if (plan.projectID !== projectID) {
      return {
        title: "Plan not found",
        output: "Plan does not belong to this project.",
        metadata: {},
      }
    }

    if (plan.status !== "proposed") {
      return {
        title: "Plan not ready",
        output: `Plan is in "${plan.status}" status. Only proposed plans can be executed.`,
        metadata: {},
      }
    }

    ctx.metadata({
      title: `Launching ${plan.subtasks.length} parallel workers`,
      metadata: {
        planID,
        live,
        status: "approved",
        total: plan.workers.length,
        done: 0,
        running: 0,
        failed: 0,
      },
    })

    await Orchestrator.approve(planID as any)
    const launched = await PlanStore.get(planID as any)
    const done = launched.workers.filter((x) => x.status === "done" || x.status === "merged").length
    const running = launched.workers.filter((x) => x.status === "running" || x.status === "spawning").length
    const failed = launched.workers.filter((x) => x.status === "failed" || x.status === "conflict").length

    return {
      title: `Launched ${plan.subtasks.length} parallel workers`,
      output: [
        `Plan ${planID} approved and execution started.`,
        `${plan.subtasks.length} workers are spawning in isolated git worktrees.`,
        ``,
        live
          ? `Live worker status is now reported by default in this orchestrator thread.`
          : `Live reporting is disabled for this run (live=false).`,
        `You can also monitor in the /parallel-workers command.`,
      ].join("\n"),
      metadata: {
        planID,
        live,
        status: launched.status,
        total: launched.workers.length,
        done,
        running,
        failed,
      },
    }
  },
})
