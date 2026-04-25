import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { client } from "../../src/adapter"
import { OpenAIChat } from "../../src/provider/openai-chat"
import { recordedTests } from "../recorded-test"

const request = LLM.request({
  id: "recorded_openai_chat_text",
  model: OpenAIChat.model({
    id: "gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY ?? "fixture",
  }),
  system: "You are concise.",
  prompt: "Say hello in one short sentence.",
  generation: { maxTokens: 20, temperature: 0 },
})

const getWeather = LLM.tool({
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

const toolRequest = LLM.request({
  id: "recorded_openai_chat_tool_call",
  model: OpenAIChat.model({
    id: "gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY ?? "fixture",
  }),
  system: "Call tools exactly as requested.",
  prompt: "Call get_weather with city exactly Paris.",
  tools: [getWeather],
  toolChoice: LLM.toolChoice(getWeather),
  generation: { maxTokens: 80, temperature: 0 },
})

const recorded = recordedTests({ prefix: "openai-chat", requires: ["OPENAI_API_KEY"] })

describe("OpenAI Chat recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* client({ adapter: OpenAIChat.adapter.withPatches([OpenAIChat.includeUsage]) }).generate(request)
      const text = response.events.filter((event) => event.type === "text-delta").map((event) => event.text).join("")

      expect(text.length).toBeGreaterThan(0)
      expect(response.events.at(-1)?.type).toBe("request-finish")
    }),
  )

  recorded.effect("streams tool call", () =>
    Effect.gen(function* () {
      const response = yield* client({ adapter: OpenAIChat.adapter }).generate(toolRequest)
      const toolCall = response.events.find((event) => event.type === "tool-call")

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expect(toolCall).toMatchObject({ type: "tool-call", name: "get_weather", input: { city: "Paris" } })
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "tool-calls" })
    }),
  )
})
