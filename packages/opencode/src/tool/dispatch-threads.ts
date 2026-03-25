import z from "zod"
import { Tool } from "./tool"
import { DispatchThreadTool } from "./dispatch-thread"

const parameters = z.object({
  subagent_type: z.string().describe("Subagent type for all thread items."),
  items: z
    .array(
      z.object({
        description: z.string(),
        prompt: z.string(),
        delegated_scope: z.string().optional(),
      }),
    )
    .min(1)
    .max(50)
    .describe("List of thread dispatch inputs."),
})

export const DispatchThreadsTool = Tool.define("dispatch_threads", {
  description: "Dispatch multiple Weave threads sequentially with deterministic progress output.",
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "dispatch_threads",
      patterns: [params.subagent_type],
      always: ["*"],
      metadata: { count: params.items.length },
    })

    const tool = await DispatchThreadTool.init()
    const lines: string[] = []
    for (let index = 0; index < params.items.length; index++) {
      const item = params.items[index]
      const result = await tool.execute(
        {
          description: item.description,
          prompt: item.prompt,
          subagent_type: params.subagent_type,
          delegated_scope: item.delegated_scope,
        },
        ctx,
      )
      lines.push(`## item ${index + 1}`)
      lines.push(result.output)
      lines.push("")
    }

    return {
      title: "Batch thread dispatch",
      metadata: { count: params.items.length },
      output: lines.join("\n").trim(),
    }
  },
})
