import z from "zod"
import { Tool } from "./tool"
import { Team } from "../team"
import { TeamTask } from "../team/task"
import { TeamID, TeamTaskID } from "../team/schema"
import DESCRIPTION from "./team-task.txt"

const params = z.object({
  operation: z.enum(["create", "update", "get", "list"]).describe("The operation to perform"),
  team_id: z.string().describe("The team ID"),
  task_id: z.string().optional().describe("The task ID (required for get/update)"),
  subject: z.string().optional().describe("Task subject (required for create)"),
  description: z.string().optional().describe("Task description"),
  owner: z.string().optional().describe("Agent name that owns this task"),
  status: z.enum(["pending", "in_progress", "completed", "failed"]).optional().describe("Task status (for update)"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Arbitrary metadata"),
})

export const TeamTaskTool = Tool.define("team_task", {
  description: DESCRIPTION,
  parameters: params,
  async execute(args, ctx) {
    await ctx.ask({
      permission: "team_task",
      patterns: [args.operation],
      always: ["*"],
      metadata: {},
    })

    const teamID = TeamID.make(args.team_id)
    const team = Team.get(teamID)
    if (!team) throw new Error(`Team not found: ${args.team_id}`)
    if (team.status === "disbanded") throw new Error(`Team has been disbanded: ${args.team_id}`)

    if (args.operation === "create") {
      if (!args.subject) throw new Error("subject is required for create operation")
      const task = TeamTask.create({
        teamID,
        subject: args.subject,
        description: args.description,
        owner: args.owner,
        metadata: args.metadata,
      })
      return {
        title: `Task created: ${task.subject}`,
        output: JSON.stringify(task, null, 2),
        metadata: { task },
      }
    }

    if (args.operation === "update") {
      if (!args.task_id) throw new Error("task_id is required for update operation")
      const id = TeamTaskID.make(args.task_id)
      const task = TeamTask.update(id, {
        status: args.status,
        owner: args.owner,
        description: args.description,
        metadata: args.metadata,
      })
      if (!task) throw new Error(`Task not found: ${args.task_id}`)
      return {
        title: `Task updated: ${task.subject}`,
        output: JSON.stringify(task, null, 2),
        metadata: { task },
      }
    }

    if (args.operation === "get") {
      if (!args.task_id) throw new Error("task_id is required for get operation")
      const task = TeamTask.get(TeamTaskID.make(args.task_id))
      if (!task) throw new Error(`Task not found: ${args.task_id}`)
      return {
        title: `Task: ${task.subject}`,
        output: JSON.stringify(task, null, 2),
        metadata: { task },
      }
    }

    // list
    const tasks = TeamTask.list(teamID)
    return {
      title: `${tasks.length} tasks`,
      output: JSON.stringify(tasks, null, 2),
      metadata: { tasks },
    }
  },
})
