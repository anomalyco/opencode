import { expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM, LLMEvent, LLMResponse, Message, ToolChoice, ToolDefinition, type LLMRequest, type Model } from "../src"
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
  readonly model: Model
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
    providerOptions:
      input.model.route.id === "gemini" ? { gemini: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
    generation:
      input.temperature === false
        ? { maxTokens: input.maxTokens ?? 80 }
        : { maxTokens: input.maxTokens ?? 80, temperature: input.temperature ?? 0 },
  })

export const weatherToolRequest = (input: {
  readonly id: string
  readonly model: Model
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
  readonly model: Model
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
  readonly model: Model
  readonly maxTokens?: number
  readonly temperature?: number | false
}) =>
  weatherToolLoopRequest({
    ...input,
    system: "Use the get_weather tool exactly once. After the tool result, reply exactly: Paris is sunny.",
  })

const RESTROOM_IMAGE_TEXT = "jiggling restroom prison"
const restroomImage = () =>
  Effect.promise(() => Bun.file(new URL("./fixtures/media/restroom.png", import.meta.url)).bytes()).pipe(
    Effect.map((bytes) => Buffer.from(bytes).toString("base64")),
  )

export const imageRequest = (input: {
  readonly id: string
  readonly model: Model
  readonly image: string
  readonly maxTokens?: number
  readonly temperature?: number | false
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: "Read images carefully. Reply only with the visible text.",
    messages: [
      Message.user([
        {
          type: "text",
          text: "The image contains exactly three lowercase English words. Read them left to right and reply with only those words.",
        },
        { type: "media", mediaType: "image/png", data: input.image },
      ]),
    ],
    cache: "none",
    generation:
      input.temperature === false
        ? { maxTokens: input.maxTokens ?? 20 }
        : { maxTokens: input.maxTokens ?? 20, temperature: input.temperature ?? 0 },
  })

export const reasoningRequest = (input: {
  readonly id: string
  readonly model: Model
  readonly maxTokens?: number
  readonly temperature?: number | false
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: "Show concise reasoning when the provider supports visible reasoning summaries.",
    prompt: "Think briefly, then reply exactly with: Hello!",
    cache: "none",
    providerOptions: { openai: { reasoningEffort: "low", reasoningSummary: "auto" } },
    generation:
      input.temperature === false
        ? { maxTokens: input.maxTokens ?? 120 }
        : { maxTokens: input.maxTokens ?? 120, temperature: input.temperature ?? 0 },
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
  reason: Extract<LLMEvent, { readonly type: "finish" }>["reason"],
) => expect(events.at(-1)).toMatchObject({ type: "finish", reason })

export const expectWeatherToolCall = (response: LLMResponse) =>
  expect(response.toolCalls).toMatchObject([
    { type: "tool-call", id: expect.any(String), name: weatherToolName, input: { city: "Paris" } },
  ])

export const expectWeatherToolLoop = (events: ReadonlyArray<LLMEvent>) => {
  const finishes = events.filter(LLMEvent.is.finish)
  expect(finishes).toHaveLength(1)
  expect(finishes[0]?.reason).toBe("stop")

  const stepFinishes = events.filter(LLMEvent.is.stepFinish)
  expect(stepFinishes.map((event) => event.reason)).toEqual(["tool-calls", "stop"])

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

export type GoldenScenarioID = "text" | "tool-call" | "tool-loop" | "image" | "reasoning"

export interface GoldenScenarioContext {
  readonly id: string
  readonly model: Model
  readonly maxTokens?: number
  readonly temperature?: number | false
}

const generate = (request: LLMRequest) => LLMClient.generate(request)

const normalizeImageText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()

export const goldenScenarioTags = (id: GoldenScenarioID) => {
  if (id === "text") return ["text", "golden"]
  if (id === "tool-call") return ["tool", "tool-call", "golden"]
  if (id === "image") return ["media", "image", "vision", "golden"]
  if (id === "reasoning") return ["reasoning", "golden"]
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

    if (id === "image") {
      const response = yield* generate(
        imageRequest({
          id: context.id,
          model: context.model,
          image: yield* restroomImage(),
          maxTokens: context.maxTokens ?? 20,
          temperature: context.temperature,
        }),
      )
      expect(normalizeImageText(response.text)).toBe(RESTROOM_IMAGE_TEXT)
      expectFinish(response.events, "stop")
      return
    }

    if (id === "reasoning") {
      const response = yield* generate(
        reasoningRequest({
          id: context.id,
          model: context.model,
          maxTokens: context.maxTokens ?? 120,
          temperature: context.temperature,
        }),
      )
      expect(response.text.trim()).toMatch(/^Hello!?$/)
      expect(response.usage?.reasoningTokens ?? 0).toBeGreaterThan(0)
      expectFinish(response.events, "stop")
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
    last.value = `${typeof last.value === "string" ? last.value : ""}${value}`
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
    if (event.type === "finish") {
      summary.push({ type: "finish", reason: event.reason, usage: usageSummary(event.usage) })
    }
  }
  return summary.map((item) => Object.fromEntries(Object.entries(item).filter((entry) => entry[1] !== undefined)))
}
