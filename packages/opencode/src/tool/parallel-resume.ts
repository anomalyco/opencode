import z from "zod"
import { Tool } from "./tool"
import { PlanStore } from "@/parallel/plan"
import { Recovery } from "@/parallel/recovery"
import { Instance } from "@/project/instance"

export const ParallelResumeTool = Tool.define("parallel_resume", {
  description:
    "Resume or abandon an interrupted parallel plan, or clean up failed plans with orphaned worktrees. Use 'scan' to discover plans that need attention.",
  parameters: z.object({
    plan_id: z
      .string()
      .optional()
      .describe("Plan ID to resume or abandon. If omitted, finds the latest plan needing attention."),
    action: z
      .enum(["resume", "abandon", "scan"])
      .describe(
        "Action to take: 'scan' lists plans needing attention, 'resume' recovers completed workers and continues, 'abandon' cleans up worktrees and marks as failed.",
      ),
  }),
  async execute(params, ctx) {
    const projectID = Instance.project.id

    if (params.action === "scan") {
      const found = await Recovery.scan(projectID)
      if (found.length === 0) {
        return {
          title: "No plans found",
          output: "No interrupted or failed plans with orphaned worktrees found for this project.",
          metadata: {} as Record<string, never>,
        }
      }

      const summaries = found.map((ip) => ip.summary).join("\n\n---\n\n")
      const resumeCount = found.filter((f) => f.canResume).length
      const cleanupCount = found.filter((f) => f.needsCleanup).length
      return {
        title: `Found ${found.length} plan(s) needing attention`,
        output: `${summaries}\n\n${resumeCount > 0 ? `${resumeCount} can be resumed. ` : ""}${cleanupCount > 0 ? `${cleanupCount} need cleanup. ` : ""}Use parallel_resume with action "resume" or "abandon" to handle these plans.`,
        metadata: {} as Record<string, never>,
      }
    }

    // Find the plan
    let planID = params.plan_id
    if (!planID) {
      const found = await Recovery.scan(projectID)
      if (found.length === 0) {
        return {
          title: "No plans found",
          output: "No interrupted or failed plans with orphaned worktrees found for this project.",
          metadata: {} as Record<string, never>,
        }
      }
      planID = found[0].plan.id
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
