import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAIChat } from "../../src/provider/openai-chat"
import { recordedTests } from "../recorded-test"

const model = OpenAIChat.model({
  id: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
})

const request = LLM.request({
  id: "recorded_openai_chat_text",
  model,
  system: "You are concise.",
  prompt: "Say hello in one short sentence.",
  generation: { maxTokens: 20, temperature: 0 },
})

const getWeather = LLM.toolDefinition({
  name: "get_weather",
  description: "Get current weather for a city.",
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string" },
    },
    required: ["city"],
    additionalProperties: false,
  },
})
const toolCallId = "call_weather"

const toolRequest = LLM.request({
  id: "recorded_openai_chat_tool_call",
  model,
  system: "Call tools exactly as requested.",
  prompt: "Call get_weather with city exactly Paris.",
  tools: [getWeather],
  toolChoice: LLM.toolChoice(getWeather),
  generation: { maxTokens: 80, temperature: 0 },
})

const toolResultRequest = LLM.request({
  id: "recorded_openai_chat_tool_result",
  model,
  system: "Answer using only the provided tool result.",
  messages: [
    LLM.user("What is the weather in Paris?"),
    LLM.assistant([LLM.toolCall({ id: toolCallId, name: getWeather.name, input: { city: "Paris" } })]),
    LLM.toolMessage({ id: toolCallId, name: getWeather.name, result: { forecast: "sunny", temperature_c: 22 } }),
  ],
  generation: { maxTokens: 40, temperature: 0 },
})

// Cassettes are deterministic — assert exact stream contents instead of fuzzy
// `length > 0` checks so adapter parsing regressions surface immediately.
// Re-record (`RECORD=true`) only when intentionally refreshing a cassette.
const recorded = recordedTests({
  prefix: "openai-chat",
  provider: "openai",
  protocol: "openai-chat",
  requires: ["OPENAI_API_KEY"],
})
const openai = LLMClient.make({ adapters: [OpenAIChat.adapter] })
const openaiWithUsage = LLMClient.make({ adapters: [OpenAIChat.adapter.withPatches([OpenAIChat.includeUsage])] })

describe("OpenAI Chat recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* openaiWithUsage.generate(request)

      expect(LLM.outputText(response)).toBe("Hello!")
      expect(response.usage).toMatchObject({
        inputTokens: 22,
        outputTokens: 2,
        totalTokens: 24,
        cacheReadInputTokens: 0,
        reasoningTokens: 0,
      })
      expect(response.events.map((event) => event.type)).toEqual([
        "text-delta",
        "text-delta",
        "request-finish",
      ])
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )

  recorded.effect.with("streams tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* openai.generate(toolRequest)

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expect(response.events.find((event) => event.type === "tool-call")).toMatchObject({
        type: "tool-call",
        name: "get_weather",
        input: { city: "Paris" },
      })
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "tool-calls" })
    }),
  )

  recorded.effect.with("continues after tool result", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* openaiWithUsage.generate(toolResultRequest)

      expect(LLM.outputText(response)).toBe("The weather in Paris is sunny with a temperature of 22°C.")
      expect(response.usage).toMatchObject({ inputTokens: 59, outputTokens: 14, totalTokens: 73 })
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )
})
