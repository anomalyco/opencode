import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { Gemini } from "../../src/provider/gemini"
import { recordedTests } from "../recorded-test"

const model = Gemini.model({
  id: "gemini-2.5-flash",
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture",
})

const request = LLM.request({
  id: "recorded_gemini_text",
  model,
  system: "You are concise.",
  prompt: "Reply with exactly: Hello!",
  generation: { maxTokens: 80, temperature: 0 },
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

const toolRequest = LLM.request({
  id: "recorded_gemini_tool_call",
  model,
  system: "Call tools exactly as requested.",
  prompt: "Call get_weather with city exactly Paris.",
  tools: [getWeather],
  toolChoice: LLM.toolChoice(getWeather),
  generation: { maxTokens: 80, temperature: 0 },
})

const recorded = recordedTests({
  prefix: "gemini",
  provider: "google",
  protocol: "gemini",
  requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
})
const gemini = LLMClient.make({ adapters: [Gemini.adapter] })

describe("Gemini recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* gemini.generate(request)

      expect(LLM.outputText(response)).toMatch(/^Hello!?$/)
      expect(response.usage?.totalTokens).toBeGreaterThan(0)
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )

  recorded.effect.with("streams tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* gemini.generate(toolRequest)

      expect(LLM.outputToolCalls(response)).toEqual([
        { type: "tool-call", id: expect.any(String), name: "get_weather", input: { city: "Paris" } },
      ])
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "tool-calls" })
    }),
  )
})
