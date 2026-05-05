import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import * as OpenAIChat from "../../src/protocols/openai-chat"
import { eventSummary, textRequest, weatherToolName, weatherToolRequest } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = OpenAIChat.model({
  id: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
})

const request = textRequest({ id: "recorded_openai_chat_text", model, prompt: "Say hello in one short sentence." })
const toolCallId = "call_weather"
const toolRequest = weatherToolRequest({ id: "recorded_openai_chat_tool_call", model })

const toolResultRequest = LLM.request({
  id: "recorded_openai_chat_tool_result",
  model,
  system: "Answer using only the provided tool result.",
  messages: [
    LLM.user("What is the weather in Paris?"),
    LLM.assistant([LLM.toolCall({ id: toolCallId, name: weatherToolName, input: { city: "Paris" } })]),
    LLM.toolMessage({ id: toolCallId, name: weatherToolName, result: { forecast: "sunny", temperature_c: 22 } }),
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
const openaiWithUsage = LLMClient.make({ adapters: [OpenAIChat.adapter.withTransforms([OpenAIChat.includeUsage])] })

describe("OpenAI Chat recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* openaiWithUsage.generate(request)

      expect(eventSummary(response.events)).toEqual([
        { type: "text", value: "Hello!" },
        {
          type: "finish",
          reason: "stop",
          usage: {
            inputTokens: 22,
            outputTokens: 2,
            reasoningTokens: 0,
            cacheReadInputTokens: 0,
            totalTokens: 24,
          },
        },
      ])
    }),
  )

  recorded.effect.with("streams tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* openai.generate(toolRequest)

      expect(eventSummary(response.events)).toEqual([
        { type: "tool-call", name: weatherToolName, input: { city: "Paris" } },
        { type: "finish", reason: "tool-calls" },
      ])
    }),
  )

  recorded.effect.with("continues after tool result", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* openaiWithUsage.generate(toolResultRequest)

      expect(eventSummary(response.events)).toEqual([
        { type: "text", value: "The weather in Paris is sunny with a temperature of 22°C." },
        {
          type: "finish",
          reason: "stop",
          usage: { inputTokens: 59, outputTokens: 14, reasoningTokens: 0, cacheReadInputTokens: 0, totalTokens: 73 },
        },
      ])
    }),
  )
})
