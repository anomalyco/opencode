import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAICompatibleChat } from "../../src/provider/openai-compatible-chat"
import { eventSummary, textRequest, weatherToolName, weatherToolRequest } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const deepseekModel = OpenAICompatibleChat.deepseek({
  id: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY ?? "fixture",
})

const deepseekRequest = textRequest({ id: "recorded_deepseek_text", model: deepseekModel })

const togetherModel = OpenAICompatibleChat.togetherai({
  id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  apiKey: process.env.TOGETHER_AI_API_KEY ?? "fixture",
})

const togetherRequest = textRequest({ id: "recorded_togetherai_text", model: togetherModel })
const togetherToolRequest = weatherToolRequest({ id: "recorded_togetherai_tool_call", model: togetherModel })

const recorded = recordedTests({ prefix: "openai-compatible-chat", protocol: "openai-compatible-chat" })
const llm = LLMClient.make({ adapters: [OpenAICompatibleChat.adapter] })

describe("OpenAI-compatible Chat recorded", () => {
  recorded.effect.with("deepseek streams text", { provider: "deepseek", requires: ["DEEPSEEK_API_KEY"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(deepseekRequest)

      expect(eventSummary(response.events)).toEqual([
        { type: "text", value: "Hello!" },
        {
          type: "finish",
          reason: "stop",
          usage: { inputTokens: 14, outputTokens: 2, cacheReadInputTokens: 0, totalTokens: 16 },
        },
      ])
    }),
  )

  recorded.effect.with("togetherai streams text", { provider: "togetherai", requires: ["TOGETHER_AI_API_KEY"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(togetherRequest)

      expect(eventSummary(response.events)).toEqual([
        { type: "text", value: "Hello!" },
        { type: "finish", reason: "stop", usage: { inputTokens: 45, outputTokens: 3, totalTokens: 48 } },
      ])
    }),
  )

  recorded.effect.with("togetherai streams tool call", { provider: "togetherai", requires: ["TOGETHER_AI_API_KEY"], tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(togetherToolRequest)

      expect(eventSummary(response.events)).toEqual([
        { type: "tool-call", name: weatherToolName, input: { city: "Paris" } },
        { type: "finish", reason: "tool-calls", usage: { inputTokens: 194, outputTokens: 19, totalTokens: 213 } },
      ])
    }),
  )
})
