import z from "zod"
import { Tool } from "./tool"
import { PlanStore } from "@/parallel/plan"
import { Recovery } from "@/parallel/recovery"
import { Instance } from "@/project/instance"

export const ParallelResumeTool = Tool.define("parallel_resume", {
  description:
    "Resume or abandon an interrupted parallel plan. Use this when a plan was interrupted (server crash, terminal closed) and you want to recover completed work or clean up.",
  parameters: z.object({
    plan_id: z
      .string()
      .optional()
      .describe("Plan ID to resume. If omitted, finds the latest interrupted plan for this project."),
    action: z
      .enum(["resume", "abandon", "scan"])
      .describe(
        "Action to take: 'scan' lists interrupted plans, 'resume' recovers completed workers and continues, 'abandon' marks as failed and cleans up worktrees.",
      ),
  }),
  async execute(params, ctx) {
    const projectID = Instance.project.id

    if (params.action === "scan") {
      const interrupted = await Recovery.scan(projectID)
      if (interrupted.length === 0) {
        return {
          title: "No interrupted plans",
          output: "No interrupted parallel plans found for this project.",
          metadata: {} as Record<string, never>,
        }
      }

      const summaries = interrupted.map((ip) => ip.summary).join("\n\n---\n\n")
      return {
        title: `Found ${interrupted.length} interrupted plan(s)`,
        output: `${summaries}\n\nUse parallel_resume with action "resume" or "abandon" to handle these plans.`,
        metadata: {} as Record<string, never>,
      }
    }

    // Find the plan
    let planID = params.plan_id
    if (!planID) {
      const interrupted = await Recovery.scan(projectID)
      if (interrupted.length === 0) {
        return {
          title: "No interrupted plans",
          output: "No interrupted parallel plans found for this project.",
          metadata: {} as Record<string, never>,
        }
      }
      planID = interrupted[0].plan.id
    }

    const plan = await PlanStore.get(planID as any)

    // Verify project ownership
    if (plan.projectID !== projectID) {
      return {
        title: "Plan not found",
        output: "Plan does not belong to this project.",
        metadata: {} as Record<string, never>,
      }
    }

    if (params.action === "resume") {
      const resumed = await Recovery.resume(planID as any)

      const done = resumed.workers.filter((w) => w.status === "done" || w.status === "merged").length
      const failed = resumed.workers.filter((w) => w.status === "failed").length

      return {
        title: `Plan resumed — ${done}/${resumed.workers.length} workers recovered`,
        output: [
          `Plan: ${resumed.id}`,
          `Status: ${resumed.status}`,
          `Task: ${resumed.task}`,
          ``,
          `Workers:`,
          ...resumed.workers.map((w) => {
            const subtask = resumed.subtasks.find((st) => st.id === w.subtaskID)
            return `  - [${w.status}] ${subtask?.title ?? w.subtaskID}${w.error ? ` (${w.error})` : ""}`
          }),
          ``,
          resumed.status === "done"
            ? "All workers recovered and merged successfully!"
            : resumed.status === "failed"
              ? "Plan could not be recovered — all workers failed."
              : `${failed} worker(s) failed during recovery. You can create a new plan to handle the remaining work.`,
        ].join("\n"),
        metadata: {} as Record<string, never>,
      }
    }

    if (params.action === "abandon") {
      const abandoned = await Recovery.abandon(planID as any)

      return {
        title: "Plan abandoned",
        output: [
          `Plan ${abandoned.id} has been marked as failed.`,
          `Worktrees have been cleaned up.`,
          ``,
          `You can start a new plan with parallel_plan if needed.`,
        ].join("\n"),
        metadata: {} as Record<string, never>,
      }
    }

    return {
      title: "Unknown action",
      output: `Unknown action: ${params.action}. Use "scan", "resume", or "abandon".`,
      metadata: {} as Record<string, never>,
    }
  },
})
