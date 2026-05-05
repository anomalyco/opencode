import { Effect, Schema } from "effect"
import { LLM, type LLMEvent, type LLMResponse, type ModelRef } from "../src"
import { tool } from "../src/tool"

export const weatherToolName = "get_weather"

export const weatherTool = LLM.toolDefinition({
  name: weatherToolName,
  description: "Get current weather for a city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false,
  },
})

export const weatherRuntimeTool = tool({
  description: weatherTool.description,
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ temperature: Schema.Number, condition: Schema.String }),
  execute: ({ city }) =>
    Effect.succeed(
      city === "Paris"
        ? { temperature: 22, condition: "sunny" }
        : { temperature: 0, condition: "unknown" },
    ),
})

export const textRequest = (input: {
  readonly id: string
  readonly model: ModelRef
  readonly prompt?: string
  readonly maxTokens?: number
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: "You are concise.",
    prompt: input.prompt ?? "Reply with exactly: Hello!",
    generation: { maxTokens: input.maxTokens ?? 20, temperature: 0 },
  })

export const weatherToolRequest = (input: {
  readonly id: string
  readonly model: ModelRef
  readonly maxTokens?: number
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: "Call tools exactly as requested.",
    prompt: "Call get_weather with city exactly Paris.",
    tools: [weatherTool],
    toolChoice: LLM.toolChoice(weatherTool),
    generation: { maxTokens: input.maxTokens ?? 80, temperature: 0 },
  })

const usageSummary = (usage: LLMResponse["usage"] | undefined) => {
  if (!usage) return undefined
  return Object.fromEntries(
    [
      ["inputTokens", usage.inputTokens],
      ["outputTokens", usage.outputTokens],
      ["reasoningTokens", usage.reasoningTokens],
      ["cacheReadInputTokens", usage.cacheReadInputTokens],
      ["cacheWriteInputTokens", usage.cacheWriteInputTokens],
      ["totalTokens", usage.totalTokens],
    ].filter((entry) => entry[1] !== undefined),
  )
}

const pushText = (summary: Array<Record<string, unknown>>, type: "text" | "reasoning", value: string) => {
  const last = summary.at(-1)
  if (last?.type === type) {
    last.value = `${last.value ?? ""}${value}`
    return
  }
  summary.push({ type, value })
}

export const eventSummary = (events: ReadonlyArray<LLMEvent>) => {
  const summary: Array<Record<string, unknown>> = []
  for (const event of events) {
    if (event.type === "text-delta") {
      pushText(summary, "text", event.text)
      continue
    }
    if (event.type === "reasoning-delta") {
      pushText(summary, "reasoning", event.text)
      continue
    }
    if (event.type === "tool-call") {
      summary.push({
        type: "tool-call",
        name: event.name,
        input: event.input,
        providerExecuted: event.providerExecuted,
      })
      continue
    }
    if (event.type === "tool-result") {
      summary.push({
        type: "tool-result",
        name: event.name,
        result: event.result,
        providerExecuted: event.providerExecuted,
      })
      continue
    }
    if (event.type === "tool-error") {
      summary.push({ type: "tool-error", name: event.name, message: event.message })
      continue
    }
    if (event.type === "request-finish") {
      summary.push({ type: "finish", reason: event.reason, usage: usageSummary(event.usage) })
    }
  }
  return summary.map((item) => Object.fromEntries(Object.entries(item).filter((entry) => entry[1] !== undefined)))
}
