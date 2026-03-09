import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./task_boundary.txt"
import { Bus } from "../bus"

export namespace TaskBoundaryTool {
  export const Instance = Tool.define("task_boundary", {
    description: DESCRIPTION,
    parameters: z.object({
      name: z.string().describe("Name of the task boundary"),
      status: z.string().describe("Current status of the action in the task"),
      summary: z.string().describe("Concise summary of what has been accomplished"),
      mode: z.enum(["PLANNING", "EXECUTION", "VERIFICATION"]).describe("The current agent focus mode"),
    }),
    async execute(params, ctx) {
      // In oh-my-opencode, we publish a status event that the UI can pick up
      // Similar to how Session.Event.Error or others work
      
      ctx.metadata({
        title: params.name,
        metadata: {
          task_status: params.status,
          task_summary: params.summary,
          mode: params.mode,
        },
      })

      // Publish to the global bus for UI updates
      Bus.publish(Bus.TaskBoundary, {
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        ...params,
      })

      return {
        title: params.name,
        output: `Task Boundary Updated: ${params.name}\nStatus: ${params.status}`,
        metadata: params,
      }
    },
  })
}

export const TaskBoundaryToolDefinition = TaskBoundaryTool.Instance
