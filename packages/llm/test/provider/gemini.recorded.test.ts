import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { Gemini } from "../../src/provider/gemini"
import { expectFinish, expectWeatherToolCall, textRequest, weatherToolRequest } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = Gemini.model({
  id: "gemini-2.5-flash",
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture",
})

const request = textRequest({ id: "recorded_gemini_text", model, maxTokens: 80 })
const toolRequest = weatherToolRequest({ id: "recorded_gemini_tool_call", model })

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
      expectFinish(response.events, "stop")
    }),
  )

  recorded.effect.with("streams tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* gemini.generate(toolRequest)

      expectWeatherToolCall(response)
      expectFinish(response.events, "tool-calls")
    }),
  )
})
