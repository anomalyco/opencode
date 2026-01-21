import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Provider } from "../provider/provider"
import type { MessageV2 } from "../session/message-v2"
import DESCRIPTION from "./context.txt"

interface ContextToolMetadata {
  status: string
  percentage: number
  tokens: number
  limit: number
  breakdown: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
}

export const ContextTool = Tool.define("context_usage", {
  description: DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx): Promise<{ title: string; output: string; metadata: ContextToolMetadata }> {
    const messages = await Session.messages({ sessionID: ctx.sessionID })
    const last = messages.findLast(
      (m) => m.info.role === "assistant" && m.info.tokens?.output > 0,
    ) as MessageV2.WithParts & { info: MessageV2.Assistant }

    if (!last) {
      return {
        title: "No context data",
        output: "No messages have been processed yet, so context usage is not available.",
        metadata: {
          status: "no_data",
          percentage: 0,
          tokens: 0,
          limit: 0,
          breakdown: {
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
        },
      }
    }

    const model = await Provider.getModel(last.info.providerID, last.info.modelID)

    const total =
      last.info.tokens.input +
      last.info.tokens.output +
      last.info.tokens.reasoning +
      last.info.tokens.cache.read +
      last.info.tokens.cache.write

    const percentage = model.limit.context ? Math.round((total / model.limit.context) * 100) : 0

    const status = percentage > 90 ? "critical" : percentage > 75 ? "warning" : percentage > 50 ? "moderate" : "healthy"

    const breakdown = [
      `Input: ${last.info.tokens.input.toLocaleString()}`,
      `Output: ${last.info.tokens.output.toLocaleString()}`,
      `Reasoning: ${last.info.tokens.reasoning.toLocaleString()}`,
      `Cache read: ${last.info.tokens.cache.read.toLocaleString()}`,
      `Cache write: ${last.info.tokens.cache.write.toLocaleString()}`,
    ].join(", ")

    const output = [
      `Context window usage: ${percentage}%`,
      `Total tokens: ${total.toLocaleString()} / ${model.limit.context.toLocaleString()}`,
      `Status: ${status}`,
      `Breakdown: ${breakdown}`,
    ].join("\n")

    return {
      title: `Context usage: ${percentage}%`,
      output,
      metadata: {
        status,
        percentage,
        tokens: total,
        limit: model.limit.context,
        breakdown: {
          input: last.info.tokens.input,
          output: last.info.tokens.output,
          reasoning: last.info.tokens.reasoning,
          cacheRead: last.info.tokens.cache.read,
          cacheWrite: last.info.tokens.cache.write,
        },
      },
    }
  },
})
