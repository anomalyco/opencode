import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, LLMRequest, SystemPart } from "../../src/index.js"
import { Cohere } from "../../src/providers/cohere.js"
import { LLMClient } from "../../src/route.js"
import { expectWeatherToolLoop, goldenWeatherToolLoopRequest, runWeatherToolLoop } from "../recorded-scenarios.js"
import { recordedTests } from "../recorded-test.js"

const recorded = recordedTests({ prefix: "cohere", provider: "cohere", requires: ["COHERE_API_KEY"] })
const cohere = Cohere.configure({ apiKey: process.env.COHERE_API_KEY ?? "fixture" })

recorded.effect(
  "streams native text and usage",
  () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: cohere.model("command-a-03-2025"),
          prompt: "Reply exactly: OK",
          generation: { maxTokens: 64 },
        }),
      )
      expect(response.text.trim()).toMatch(/^OK\.?$/)
      expect(response.usage.inputTokens).toBeGreaterThan(0)
      expect(response.usage.outputTokens).toBeGreaterThan(0)
      expect(response.events.find(LLMEvent.is.finish)?.reason).toEqual({ normalized: "stop", raw: "COMPLETE" })
      expect(response.usage.providerMetadata?.cohere?.billed_units).toBeDefined()
    }),
  60_000,
)

recorded.effect(
  "streams native thinking with a budget",
  () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: cohere.model("command-a-reasoning-08-2025"),
          prompt: "What is 17 times 23? Answer briefly.",
          providerOptions: { thinking: { type: "enabled", tokenBudget: 128 } },
          generation: { maxTokens: 2048 },
        }),
      )
      expect(response.reasoning.length).toBeGreaterThan(0)
      expect(response.text).toContain("391")
      expect(response.usage.reasoningTokens).toBeGreaterThan(0)
      expect(response.usage.reasoningTokens).toBeLessThanOrEqual(128)
      expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
    }),
  60_000,
)

recorded.effect(
  "continues a native tool call",
  () =>
    Effect.gen(function* () {
      const events = yield* runWeatherToolLoop(
        LLMRequest.update(
          goldenWeatherToolLoopRequest({
            id: "cohere-tool-loop",
            model: cohere.model("command-a-plus-05-2026"),
            maxTokens: 2048,
            temperature: false,
          }),
          {
            system: [
              SystemPart.make("Use the get_weather tool exactly once."),
              SystemPart.make("After the tool result, reply exactly: Paris is sunny."),
            ],
          },
        ),
      )
      expectWeatherToolLoop(events)
      expect(events.some(LLMEvent.is.toolInputDelta)).toBe(true)
    }),
  60_000,
)

recorded.effect(
  "streams compatible chat reasoning",
  () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: cohere.chat("command-a-reasoning-08-2025"),
          prompt: "What is 17 times 23? Answer briefly.",
          providerOptions: { reasoningEffort: "high" },
          generation: { maxTokens: 2048 },
        }),
      )
      expect(response.reasoning.length).toBeGreaterThan(0)
      expect(response.text).toContain("391")
      expect(response.events.find(LLMEvent.is.finish)?.reason.normalized).toBe("stop")
      expect(response.usage.inputTokens).toBeGreaterThan(0)
      expect(response.usage.reasoningTokens).toBeGreaterThan(0)
    }),
  60_000,
)
