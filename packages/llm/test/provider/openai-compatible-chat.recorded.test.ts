import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { client } from "../../src/adapter"
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

const recorded = recordedTests({ prefix: "openai-compatible-chat" })
const llm = client({ adapters: [OpenAICompatibleChat.adapter] })

describe("OpenAI-compatible Chat recorded", () => {
  recorded.effect.with("deepseek streams text", { requires: ["DEEPSEEK_API_KEY"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(deepseekRequest)

      expect(LLM.outputText(response)).toMatch(/^Hello!?$/)
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )
})
