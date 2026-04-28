import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { AnthropicMessages } from "../../src/provider/anthropic-messages"
import { recordedTests } from "../recorded-test"

const model = AnthropicMessages.model({
  id: "claude-haiku-4-5-20251001",
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
})

const request = LLM.request({
  id: "recorded_anthropic_messages_text",
  model,
  system: "You are concise.",
  prompt: "Reply with exactly: Hello!",
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

const toolRequest = LLM.request({
  id: "recorded_anthropic_messages_tool_call",
  model,
  system: "Call tools exactly as requested.",
  prompt: "Call get_weather with city exactly Paris.",
  tools: [getWeather],
  toolChoice: LLM.toolChoice(getWeather),
  generation: { maxTokens: 80, temperature: 0 },
})

const recorded = recordedTests({
  prefix: "anthropic-messages",
  provider: "anthropic",
  protocol: "anthropic-messages",
  requires: ["ANTHROPIC_API_KEY"],
  options: { requestHeaders: ["content-type", "anthropic-version"] },
})
const anthropic = LLMClient.make({ adapters: [AnthropicMessages.adapter] })

describe("Anthropic Messages recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* anthropic.generate(request)

      expect(LLM.outputText(response)).toBe("Hello!")
      expect(response.usage?.totalTokens).toBeGreaterThan(0)
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )

  recorded.effect.with("streams tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* anthropic.generate(toolRequest)

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expect(LLM.outputToolCalls(response)).toEqual([
        { type: "tool-call", id: expect.any(String), name: "get_weather", input: { city: "Paris" } },
      ])
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "tool-calls" })
    }),
  )
})
