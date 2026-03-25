import z from "zod"
import { Tool } from "./tool"
import { ProviderID, ModelID } from "@/provider/schema"
import { WeaveOperator } from "@/session/weave"

const parameters = z.object({
  agent: z.string().describe("Agent to execute each map item."),
  prompt_template: z.string().describe("Template prompt with {{item}} placeholder."),
  items: z.array(z.string()).min(1).max(100),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
})

export const LlmMapTool = Tool.define("llm_map", {
  description: "Run a deterministic LLM map over many items using a shared prompt template.",
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "llm_map",
      patterns: ["*"],
      always: ["*"],
      metadata: { count: params.items.length, agent: params.agent },
    })
    const results = await WeaveOperator.llmMap({
      sessionID: ctx.sessionID,
      agent: params.agent,
      model: params.model,
      items: params.items,
      promptTemplate: params.prompt_template,
    })

    const output = results.map((item, index) => [`## ${index + 1}. ${item.item}`, item.output].join("\n")).join("\n\n")
    return {
      title: "LLM map",
      metadata: { count: params.items.length },
      output,
    }
  },
})
