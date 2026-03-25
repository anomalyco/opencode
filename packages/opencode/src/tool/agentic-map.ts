import z from "zod"
import { Tool } from "./tool"
import { DispatchThreadTool } from "./dispatch-thread"

const parameters = z.object({
  subagent_type: z.string().describe("Subagent used for each item."),
  description_template: z.string().describe("Description template with {{item}} placeholder."),
  prompt_template: z.string().describe("Prompt template with {{item}} placeholder."),
  items: z.array(z.string()).min(1).max(50),
})

export const AgenticMapTool = Tool.define("agentic_map", {
  description: "Dispatch agent-backed map tasks where each item runs as a typed Weave thread.",
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "agentic_map",
      patterns: [params.subagent_type],
      always: ["*"],
      metadata: { count: params.items.length },
    })

    const dispatch = await DispatchThreadTool.init()
    const output: string[] = []
    for (const [index, item] of params.items.entries()) {
      const result = await dispatch.execute(
        {
          subagent_type: params.subagent_type,
          description: params.description_template.replaceAll("{{item}}", item),
          prompt: params.prompt_template.replaceAll("{{item}}", item),
        },
        ctx,
      )
      output.push(`## ${index + 1}. ${item}`)
      output.push(result.output)
      output.push("")
    }

    return {
      title: "Agentic map",
      metadata: { count: params.items.length },
      output: output.join("\n").trim(),
    }
  },
})
