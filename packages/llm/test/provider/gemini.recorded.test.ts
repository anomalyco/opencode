import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, type LLMRequest } from "../../src"
import { LLMClient } from "../../src/adapter"
import * as Gemini from "../../src/protocols/gemini"
import { eventSummary, textRequest, weatherToolName, weatherToolRequest } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"
import * as TestLLMClient from "../lib/llm-client"

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
const generate = (request: LLMRequest) =>
  Effect.gen(function* () {
    return yield* TestLLMClient.generate(request)
  })

describe("Gemini recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* generate(request)

      expect(eventSummary(response.events)).toEqual([
        { type: "text", value: expect.stringMatching(/^Hello!?$/) },
        { type: "finish", reason: "stop", usage: expect.objectContaining({ totalTokens: expect.any(Number) }) },
      ])
    }),
  )

  recorded.effect.with("streams tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* generate(toolRequest)

      expect(eventSummary(response.events)).toEqual([
        { type: "tool-call", name: weatherToolName, input: { city: "Paris" } },
        { type: "finish", reason: "tool-calls", usage: expect.objectContaining({ totalTokens: expect.any(Number) }) },
      ])
    }),
  )
})
