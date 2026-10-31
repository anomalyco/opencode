import { expect } from "bun:test"
import { Effect } from "effect"
import { ai, LLMEvent } from "../../src/effect.js"
import { Baseten, DeepSeek, DigitalOcean, Fireworks, OpenRouter } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { expectWeatherToolLoop, runWeatherToolLoop, weatherToolLoopRequest } from "../recorded-scenarios.js"
import { recordedTests } from "../recorded-test.js"

for (const item of [
  {
    provider: "openrouter",
    env: "OPENROUTER_API_KEY",
    model: OpenRouter.configure({ apiKey: process.env.OPENROUTER_API_KEY ?? "fixture" }).messages(
      "anthropic/claude-haiku-4.5",
    ),
  },
  {
    provider: "digitalocean",
    env: "DIGITAL_OCEAN_OFFICIAL_API_KEY",
    model: DigitalOcean.configure({ apiKey: process.env.DIGITAL_OCEAN_OFFICIAL_API_KEY ?? "fixture" }).messages(
      "anthropic-claude-haiku-4.5",
    ),
  },
  {
    provider: "fireworks",
    env: "FIREWORKS_API_KEY",
    model: Fireworks.configure({ apiKey: process.env.FIREWORKS_API_KEY ?? "fixture" }).messages(
      "accounts/fireworks/models/deepseek-v4p1-flash-1017",
    ),
  },
  {
    provider: "baseten",
    env: "BASETEN_API_KEY",
    model: Baseten.configure({ apiKey: process.env.BASETEN_API_KEY ?? "fixture" }).messages(
      "deepseek-ai/DeepSeek-V4-Flash-0731",
    ),
  },
  {
    provider: "deepseek",
    env: "DEEPSEEK_API_KEY",
    model: DeepSeek.configure({ apiKey: process.env.DEEPSEEK_API_KEY ?? "fixture" }).messages("deepseek-v4-flash"),
  },
]) {
  const recorded = recordedTests({
    prefix: `${item.provider}-messages`,
    provider: item.provider,
    protocol: "anthropic-messages",
    requires: [item.env],
    metadata: { model: item.model.id },
  })

  recorded.effect.with("streams text", { tags: ["text", "usage"] }, () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        ai.request({ model: item.model, prompt: "Reply exactly: OK", generation: { maxTokens: 1024 } }),
      )
      expect(response.text.trim()).toMatch(/^OK\.?$/)
      expect(response.events.some(LLMEvent.is.textDelta)).toBe(true)
      expect(response.finishReason.normalized).toBe("stop")
      expect(response.usage.outputTokens).toBeGreaterThan(0)
    }),
  )

  recorded.effect.with("continues a tool call", { tags: ["tool", "tool-loop"] }, () =>
    Effect.gen(function* () {
      const events = yield* runWeatherToolLoop(
        weatherToolLoopRequest({
          id: `${item.provider}-messages-tool-loop`,
          model: item.model,
          maxTokens: 1024,
          temperature: false,
        }),
      )
      expectWeatherToolLoop(events)
    }),
  )
}
