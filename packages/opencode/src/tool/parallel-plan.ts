import z from "zod"
import { Tool } from "./tool"
import { PlanStore } from "@/parallel/plan"
import { Orchestrator } from "@/parallel/orchestrator"
import { SubtaskID } from "@/parallel/schema"
import type { Subtask } from "@/parallel/schema"

export const ParallelPlanTool = Tool.define("parallel_plan", {
  description:
    "Create or update a parallel execution plan. Call this to propose subtasks that will run in parallel across isolated git worktrees. If a plan already exists for this session, it will be updated. Each subtask must have a distinct set of files (no overlap).",
  parameters: z.object({
    task: z.string().describe("Overall task description"),
    subtasks: z
      .array(
        z.object({
          title: z.string().describe("Short title for this subtask"),
          description: z.string().describe("Detailed instructions for the worker agent"),
          fileScope: z.array(z.string()).describe("Files this subtask will create or modify. Must not overlap with other subtasks."),
        }),
      )
      .describe("List of independent subtasks to execute in parallel"),
  }),
  async execute(params, ctx) {
    const models = await Orchestrator.resolveModels()

    // Find existing draft/proposed plan for this session
    const plans = await PlanStore.list()
    const existing = plans.find(
      (p) => p.sessionID === ctx.sessionID && (p.status === "draft" || p.status === "proposed"),
    )

    const subtasks: Subtask[] = params.subtasks.map((st) => ({
      id: SubtaskID.ascending(),
      title: st.title,
      description: st.description,
      fileScope: st.fileScope,
      dependencies: [],
    }))

    const workers = subtasks.map((st) => ({
      subtaskID: st.id,
      status: "pending" as const,
    }))

    let plan
    if (existing) {
      plan = await PlanStore.update({
        id: existing.id,
        subtasks,
        workers,
        ...(existing.status === "draft" ? { status: "proposed" } : {}),
      })
    } else {
      const created = await PlanStore.create({
        sessionID: ctx.sessionID,
        task: params.task,
        ...models,
      })
      plan = await PlanStore.update({
        id: created.id,
        subtasks,
        workers,
        status: "proposed",
      })
    }

    const summary = subtasks
      .map((st, i) => `${i + 1}. **${st.title}** — ${st.fileScope.length} file(s): ${st.fileScope.join(", ")}`)
      .join("\n")

    return {
      title: `Plan ${existing ? "updated" : "created"} with ${subtasks.length} subtasks`,
      output: `Plan ID: ${plan.id}\nStatus: ${plan.status}\n\n${summary}\n\nThe user can now review and refine. When ready, call parallel_execute to launch workers.`,
      metadata: { planID: plan.id },
    }
  },
})
