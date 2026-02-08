import z from "zod"
import { Tool } from "./tool"
import { CoordSummary, CoordTask } from "@/coord"

const parameters = z.object({
  action: z.enum(["create", "list", "get", "claim", "complete", "update"]).describe("Task action"),
  team_id: z.string().describe("Team ID"),
  task_id: z.string().describe("Task ID").optional(),
  subject: z.string().describe("Task subject").optional(),
  description: z.string().describe("Task description").optional(),
  active_form: z.string().describe("Active form").optional(),
  blocked_by: z.string().describe("Comma-separated blocking task IDs").optional(),
  status: z.enum(["pending", "in_progress", "completed", "deleted"]).optional(),
  owner: z.string().describe("Task owner").optional(),
})

export const CoordTaskTool = Tool.define("coord_task", {
  description: "Manage coordination task board.",
  parameters,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: { tasks: CoordTask.TaskSummary[]; task: CoordTask.Task | undefined } }> {
    await ctx.ask({
      permission: "coord_task",
      patterns: [params.action],
      always: ["*"],
      metadata: {
        action: params.action,
        team_id: params.team_id,
        task_id: params.task_id,
      },
    })

    if (params.action === "list") {
      const tasks = await CoordTask.listTasks(params.team_id)
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `${tasks.length} tasks`,
        output: JSON.stringify(tasks, null, 2),
        metadata: { tasks, task: undefined },
      }
    }

    if (params.action === "create") {
      if (!params.subject) throw new Error("subject is required")
      const blocked = params.blocked_by ? params.blocked_by.split(",").map((item) => item.trim()) : undefined
      const task = await CoordTask.createTask({
        teamID: params.team_id,
        subject: params.subject,
        description: params.description,
        activeForm: params.active_form,
        blockedBy: blocked,
      })
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Task ${task.id} created`,
        output: JSON.stringify(task, null, 2),
        metadata: { task, tasks: [] },
      }
    }

    if (!params.task_id) throw new Error("task_id is required")

    if (params.action === "get") {
      const task = await CoordTask.getTask(params.team_id, params.task_id)
      if (!task) throw new Error(`Task ${params.task_id} not found`)
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Task ${task.id}`,
        output: JSON.stringify(task, null, 2),
        metadata: { task, tasks: [] },
      }
    }

    if (params.action === "claim") {
      if (!params.owner) throw new Error("owner is required")
      const result = await CoordTask.claimTask(params.team_id, params.task_id, params.owner)
      if ("error" in result) throw new Error(result.error)
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Task ${params.task_id} claimed`,
        output: JSON.stringify(result, null, 2),
        metadata: { task: result, tasks: [] },
      }
    }

    if (params.action === "complete") {
      const task = await CoordTask.completeTask(params.team_id, params.task_id)
      if (!task) throw new Error(`Task ${params.task_id} not found`)
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Task ${params.task_id} completed`,
        output: JSON.stringify(task, null, 2),
        metadata: { task, tasks: [] },
      }
    }

    if (params.action === "update") {
      const task = await CoordTask.updateTask(params.team_id, params.task_id, {
        status: params.status,
        owner: params.owner,
        subject: params.subject,
        description: params.description,
      })
      if (!task) throw new Error(`Task ${params.task_id} not found`)
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Task ${params.task_id} updated`,
        output: JSON.stringify(task, null, 2),
        metadata: { task, tasks: [] },
      }
    }

    throw new Error("Unsupported action")
  },
})
