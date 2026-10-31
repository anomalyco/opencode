import { expect } from "bun:test"
import { Effect } from "effect"
import { ai, LLMEvent } from "../../src/effect.js"
import { ZAI } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { expectWeatherToolLoop, runWeatherToolLoop, weatherToolLoopRequest } from "../recorded-scenarios.js"
import { recordedTests } from "../recorded-test.js"

const zai = ZAI.configure({ apiKey: process.env.ZAI_API_KEY ?? "fixture" })

for (const item of [
  { api: "messages", protocol: "zai-messages", model: zai.messages("glm-4.5-flash") },
  { api: "responses", protocol: "open-responses", model: zai.responses("glm-4.5-flash") },
]) {
  const recorded = recordedTests({
    prefix: `zai-${item.api}`,
    provider: "zai",
    protocol: item.protocol,
    requires: ["ZAI_API_KEY"],
    metadata: { model: item.model.id },
  })

  recorded.effect.with(
    "streams text",
    { tags: ["text", "usage"] },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          ai.request({ model: item.model, prompt: "Reply exactly: OK", generation: { maxTokens: 1024 } }),
        )
        expect(response.text.trim()).toMatch(/^OK\.?$/)
        expect(response.events.some(LLMEvent.is.textDelta)).toBe(true)
        expect(response.finishReason.normalized).toBe("stop")
        expect(response.usage.outputTokens).toBeGreaterThan(0)
      }),
    60_000,
  )

  recorded.effect.with(
    "continues a tool call",
    { tags: ["tool", "tool-loop"] },
    () =>
      Effect.gen(function* () {
        const events = yield* runWeatherToolLoop(
          weatherToolLoopRequest({
            id: `zai-${item.api}-tool-loop`,
            model: item.model,
            maxTokens: 2048,
            temperature: false,
          }),
        )
        expectWeatherToolLoop(events)
      }),
    120_000,
  )
}
