import z from "zod"
import { Tool } from "./tool"
import { PlanStore } from "@/parallel/plan"
import { Instance } from "@/project/instance"

export const ParallelStatusTool = Tool.define("parallel_status", {
  description: "Check the status of a parallel execution plan and its workers.",
  parameters: z.object({
    plan_id: z.string().optional().describe("Plan ID to check. If omitted, shows the latest plan for this project."),
  }),
  async execute(params, ctx) {
    let plan
    const projectID = Instance.project.id

    if (params.plan_id) {
      plan = await PlanStore.get(params.plan_id as any)
    } else {
      const plans = await PlanStore.list()
      plan = plans.filter((p) => p.projectID === projectID).sort((a, b) => b.time.created - a.time.created)[0]
    }

    if (!plan) {
      return {
        title: "No plan found",
        output: "No parallel plans found for this project.",
        metadata: {} as Record<string, never>,
      }
    }

    // Verify plan belongs to current project when fetched by explicit ID
    if (params.plan_id && plan.projectID !== projectID) {
      return {
        title: "Plan not found",
        output: "Plan does not belong to this project.",
        metadata: {} as Record<string, never>,
      }
    }

    const workerLines = plan.workers.map((w) => {
      const subtask = plan.subtasks.find((st) => st.id === w.subtaskID)
      const title = subtask?.title ?? w.subtaskID
      const stat = w.diffStat ? ` (+${w.diffStat.additions}/-${w.diffStat.deletions}, ${w.diffStat.files} files)` : ""
      const err = w.error ? ` Error: ${w.error}` : ""
      return `  - [${w.status}] ${title}${stat}${err}`
    })

    const done = plan.workers.filter((w) => ["done", "merged"].includes(w.status)).length
    const failed = plan.workers.filter((w) => ["failed", "conflict"].includes(w.status)).length
    const running = plan.workers.filter((w) => w.status === "running").length

    const output = [
      `Plan: ${plan.id}`,
      `Status: ${plan.status}`,
      `Task: ${plan.task}`,
      `Progress: ${done} done, ${running} running, ${failed} failed (${plan.workers.length} total)`,
      ``,
      `Workers:`,
      ...workerLines,
    ].join("\n")

    return {
      title: `Plan ${plan.status} — ${done}/${plan.workers.length} complete`,
      output,
      metadata: {} as Record<string, never>,
    }
  },
})
