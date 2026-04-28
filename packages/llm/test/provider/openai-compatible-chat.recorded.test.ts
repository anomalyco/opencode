import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAICompatibleChat } from "../../src/provider/openai-compatible-chat"
import { recordedTests } from "../recorded-test"

const deepseekModel = OpenAICompatibleChat.deepseek({
  id: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY ?? "fixture",
})

const deepseekRequest = LLM.request({
  id: "recorded_deepseek_text",
  model: deepseekModel,
  system: "You are concise.",
  prompt: "Reply with exactly: Hello!",
  generation: { maxTokens: 20, temperature: 0 },
})

const togetherModel = OpenAICompatibleChat.togetherai({
  id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  apiKey: process.env.TOGETHER_AI_API_KEY ?? "fixture",
})

const togetherRequest = LLM.request({
  id: "recorded_togetherai_text",
  model: togetherModel,
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

const togetherToolRequest = LLM.request({
  id: "recorded_togetherai_tool_call",
  model: togetherModel,
  system: "Call tools exactly as requested.",
  prompt: "Call get_weather with city exactly Paris.",
  tools: [getWeather],
  toolChoice: LLM.toolChoice(getWeather),
  generation: { maxTokens: 80, temperature: 0 },
})

const recorded = recordedTests({ prefix: "openai-compatible-chat", protocol: "openai-compatible-chat" })
const llm = LLMClient.make({ adapters: [OpenAICompatibleChat.adapter] })

describe("OpenAI-compatible Chat recorded", () => {
  recorded.effect.with("deepseek streams text", { provider: "deepseek", requires: ["DEEPSEEK_API_KEY"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(deepseekRequest)

      expect(LLM.outputText(response)).toMatch(/^Hello!?$/)
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )

  recorded.effect.with("togetherai streams text", { provider: "togetherai", requires: ["TOGETHER_AI_API_KEY"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(togetherRequest)

      expect(LLM.outputText(response)).toMatch(/^Hello!?$/)
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )

  recorded.effect.with("togetherai streams tool call", { provider: "togetherai", requires: ["TOGETHER_AI_API_KEY"], tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(togetherToolRequest)

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expect(LLM.outputToolCalls(response)).toEqual([
        { type: "tool-call", id: expect.any(String), name: "get_weather", input: { city: "Paris" } },
      ])
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "tool-calls" })
    }),
  )
})
