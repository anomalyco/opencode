import { expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM, LLMEvent, LLMResponse, ToolChoice, ToolDefinition, type LLMRequest, type ModelRef } from "../src"
import { LLMClient } from "../src/route"
import { tool } from "../src/tool"

export const weatherToolName = "get_weather"

// A deterministic system prompt long enough to clear every supported provider's
// minimum cacheable-prefix threshold (Anthropic Haiku 3.5: 2048 tokens; Anthropic
// Opus/Haiku 4.5: 4096 tokens; OpenAI/Gemini/Bedrock: lower). Built by repeating
// a fixed sentence — the cassette replays bit-for-bit, so the exact text matters
// only when re-recording with `RECORD=true`.
export const LARGE_CACHEABLE_SYSTEM = (() => {
  const sentence = "You are a concise, factual assistant. Answer precisely and avoid filler. Cite numbers when known. "
  // ~100 chars per sentence × 250 repeats ≈ 25,000 chars ≈ 5k+ tokens, safely
  // above every provider's threshold.
  return sentence.repeat(250)
})()

export const weatherTool = ToolDefinition.make({
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
      city === "Paris" ? { temperature: 22, condition: "sunny" } : { temperature: 0, condition: "unknown" },
    ),
})

export const textRequest = (input: {
  readonly id: string
  readonly model: ModelRef
  readonly prompt?: string
  readonly maxTokens?: number
  readonly temperature?: number | false
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: "You are concise.",
    prompt: input.prompt ?? "Reply with exactly: Hello!",
    cache: "none",
    generation:
      input.temperature === false
        ? { maxTokens: input.maxTokens ?? 20 }
        : { maxTokens: input.maxTokens ?? 20, temperature: input.temperature ?? 0 },
  })

export const weatherToolRequest = (input: {
  readonly id: string
  readonly model: ModelRef
  readonly maxTokens?: number
  readonly temperature?: number | false
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: "Call tools exactly as requested.",
    prompt: "Call get_weather with city exactly Paris.",
    tools: [weatherTool],
    toolChoice: ToolChoice.make(weatherTool),
    cache: "none",
    generation:
      input.temperature === false
        ? { maxTokens: input.maxTokens ?? 80 }
        : { maxTokens: input.maxTokens ?? 80, temperature: input.temperature ?? 0 },
  })

export const weatherToolLoopRequest = (input: {
  readonly id: string
  readonly model: ModelRef
  readonly system?: string
  readonly maxTokens?: number
  readonly temperature?: number | false
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: input.system ?? "Use the get_weather tool, then answer in one short sentence.",
    prompt: "What is the weather in Paris?",
    cache: "none",
    generation:
      input.temperature === false
        ? { maxTokens: input.maxTokens ?? 80 }
        : { maxTokens: input.maxTokens ?? 80, temperature: input.temperature ?? 0 },
  })

export const goldenWeatherToolLoopRequest = (input: {
  readonly id: string
  readonly model: ModelRef
  readonly maxTokens?: number
  readonly temperature?: number | false
}) =>
  weatherToolLoopRequest({
    ...input,
    system: "Use the get_weather tool exactly once. After the tool result, reply exactly: Paris is sunny.",
  })

export const runWeatherToolLoop = (request: LLMRequest) =>
  LLMClient.stream({
    request,
    tools: { [weatherToolName]: weatherRuntimeTool },
    stopWhen: LLMClient.stepCountIs(10),
  }).pipe(
    Stream.runCollect,
    Effect.map((events) => Array.from(events)),
  )

export const expectFinish = (
  events: ReadonlyArray<LLMEvent>,
  reason: Extract<LLMEvent, { readonly type: "request-finish" }>["reason"],
) => expect(events.at(-1)).toMatchObject({ type: "request-finish", reason })

export const expectWeatherToolCall = (response: LLMResponse) =>
  expect(response.toolCalls).toMatchObject([
    { type: "tool-call", id: expect.any(String), name: weatherToolName, input: { city: "Paris" } },
  ])

export const expectWeatherToolLoop = (events: ReadonlyArray<LLMEvent>) => {
  const finishes = events.filter(LLMEvent.is.requestFinish)
  expect(finishes).toHaveLength(2)
  expect(finishes[0]?.reason).toBe("tool-calls")
  expect(finishes.at(-1)?.reason).toBe("stop")

  const toolCalls = events.filter(LLMEvent.is.toolCall)
  expect(toolCalls).toHaveLength(1)
  expect(toolCalls[0]).toMatchObject({ type: "tool-call", name: weatherToolName, input: { city: "Paris" } })

  const toolResults = events.filter(LLMEvent.is.toolResult)
  expect(toolResults).toHaveLength(1)
  expect(toolResults[0]).toMatchObject({
    type: "tool-result",
    name: weatherToolName,
    result: { type: "json", value: { temperature: 22, condition: "sunny" } },
  })

  const output = LLMResponse.text({ events })
  expect(output).toContain("Paris")
  expect(output.trim().length).toBeGreaterThan(0)
}

export const expectGoldenWeatherToolLoop = (events: ReadonlyArray<LLMEvent>) => {
  expectWeatherToolLoop(events)
  expect(LLMResponse.text({ events }).trim()).toMatch(/^Paris is sunny\.?$/)
}

export type GoldenScenarioID = "text" | "tool-call" | "tool-loop"

export interface GoldenScenarioContext {
  readonly id: string
  readonly model: ModelRef
  readonly maxTokens?: number
  readonly temperature?: number | false
}

const generate = (request: LLMRequest) => LLMClient.generate(request)

export const goldenScenarioTags = (id: GoldenScenarioID) => {
  if (id === "text") return ["text", "golden"]
  if (id === "tool-call") return ["tool", "tool-call", "golden"]
  return ["tool", "tool-loop", "golden"]
}

export const runGoldenScenario = (id: GoldenScenarioID, context: GoldenScenarioContext) =>
  Effect.gen(function* () {
    if (id === "text") {
      const response = yield* generate(
        textRequest({
          id: context.id,
          model: context.model,
          prompt: "Reply exactly with: Hello!",
          maxTokens: context.maxTokens ?? 40,
          temperature: context.temperature,
        }),
      )
      expect(response.text.trim()).toMatch(/^Hello!?$/)
      expectFinish(response.events, "stop")
      return
    }

    if (id === "tool-call") {
      const response = yield* generate(
        weatherToolRequest({
          id: context.id,
          model: context.model,
          maxTokens: context.maxTokens ?? 80,
          temperature: context.temperature,
        }),
      )
      expectWeatherToolCall(response)
      expectFinish(response.events, "tool-calls")
      return
    }

    expectGoldenWeatherToolLoop(
      yield* runWeatherToolLoop(
        goldenWeatherToolLoopRequest({
          id: context.id,
          model: context.model,
          maxTokens: context.maxTokens ?? 80,
          temperature: context.temperature,
        }),
      ),
    )
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
