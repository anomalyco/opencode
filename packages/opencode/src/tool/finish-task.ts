import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./finish-task.txt"

export const FinishTaskTool = Tool.define("finish_task", {
  description: DESCRIPTION,
  parameters: z.object({
    summary: z.string().describe("Structured summary of task completion"),
    status: z.enum(["completed", "blocked", "deferred"]).default("completed").describe("Task completion status"),
    learnings: z.array(z.string()).optional().describe("Key learnings or decisions made during task"),
  }),
  async execute(params, _ctx) {
    // Build structured output for parent session to parse
    const learningsText = params.learnings?.length
      ? `\n\n**Learnings:**\n${params.learnings.map((l) => `- ${l}`).join("\n")}`
      : ""

    // Return structured summary - the session loop will exit naturally
    // after this tool completes since model will respond with finish="stop"
    return {
      title: "Task Complete",
      output: `## Task Summary\n\n**Status:** ${params.status}\n\n${params.summary}${learningsText}`,
      metadata: {
        finished: true,
        status: params.status,
        summary: params.summary,
        learnings: params.learnings,
      },
    }
  },
})
