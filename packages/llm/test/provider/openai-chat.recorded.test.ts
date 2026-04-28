import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAIChat } from "../../src/provider/openai-chat"
import { expectFinish, textRequest, weatherTool, weatherToolName, weatherToolRequest } from "../recorded-scenarios"
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
      expectFinish(response.events, "stop")
    }),
  )

  recorded.effect.with("streams tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* openai.generate(toolRequest)

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expect(response.events.find((event) => event.type === "tool-call")).toMatchObject({
        type: "tool-call",
        name: weatherTool.name,
        input: { city: "Paris" },
      })
      expectFinish(response.events, "tool-calls")
    }),
  )

  recorded.effect.with("continues after tool result", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* openaiWithUsage.generate(toolResultRequest)

      expect(LLM.outputText(response)).toBe("The weather in Paris is sunny with a temperature of 22°C.")
      expect(response.usage).toMatchObject({ inputTokens: 59, outputTokens: 14, totalTokens: 73 })
      expectFinish(response.events, "stop")
    }),
  )
})
