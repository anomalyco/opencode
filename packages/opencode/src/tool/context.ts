import z from "zod"
import { Tool } from "./tool"
import type { Provider } from "../provider/provider"
import DESCRIPTION from "./context.txt"

export const ContextUsageTool = Tool.define("check_context_usage", {
  description: DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const model = ctx.extra?.model as Provider.Model | undefined
    const last = ctx.messages.filter((msg) => msg.info.role === "assistant" && msg.info.tokens.output > 0).at(-1)

    if (!last || last.info.role !== "assistant") {
      return {
        title: "No usage data",
        metadata: {},
        output: "No context usage data available yet.",
      }
    }

    const tokens = last.info.tokens
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    const limit = model?.limit.context
    const percentage = limit ? Math.round((total / limit) * 100) : null

    return {
      title: percentage !== null ? `${percentage}% used` : `${total.toLocaleString()} tokens`,
      metadata: {
        total,
        limit,
        percentage,
        tokens,
      },
      output:
        percentage !== null
          ? `Context usage: ${total.toLocaleString()} tokens (${percentage}% of ${limit?.toLocaleString()} context limit)`
          : `Context usage: ${total.toLocaleString()} tokens (context limit unknown)`,
    }
  },
})
