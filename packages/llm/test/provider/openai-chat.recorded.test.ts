import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { client } from "../../src/adapter"
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

const recorded = recordedTests({ prefix: "openai-chat", requires: ["OPENAI_API_KEY"] })
const openai = client({ adapter: OpenAIChat.adapter })
const openaiWithUsage = client({ adapter: OpenAIChat.adapter.withPatches([OpenAIChat.includeUsage]) })

describe("OpenAI Chat recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* openaiWithUsage.generate(request)
      const text = LLM.outputText(response)

      expect(text.length).toBeGreaterThan(0)
      expect(response.usage?.totalTokens).toBeGreaterThan(0)
      expect(response.events.at(-1)?.type).toBe("request-finish")
    }),
  )

  recorded.effect("streams tool call", () =>
    Effect.gen(function* () {
      const response = yield* openai.generate(toolRequest)
      const toolCall = response.events.find((event) => event.type === "tool-call")

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expect(toolCall).toMatchObject({ type: "tool-call", name: "get_weather", input: { city: "Paris" } })
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "tool-calls" })
    }),
  )

  recorded.effect("continues after tool result", () =>
    Effect.gen(function* () {
      const response = yield* openaiWithUsage.generate(toolResultRequest)
      const text = LLM.outputText(response)

      expect(text.toLowerCase()).toContain("sunny")
      expect(response.usage?.totalTokens).toBeGreaterThan(0)
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )
})
