import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMRequest } from "../../src/index.js"
import { DigitalOcean } from "../../src/providers/digitalocean.js"
import { LLMClient } from "../../src/route.js"
import {
  LARGE_CACHEABLE_SYSTEM,
  expectWeatherToolLoop,
  goldenWeatherToolLoopRequest,
  runWeatherToolLoop,
} from "../recorded-scenarios.js"
import { recordedTests } from "../recorded-test.js"

const recorded = recordedTests({
  prefix: "digitalocean-chat",
  provider: "digitalocean",
  protocol: "digitalocean-chat",
  requires: ["DIGITAL_OCEAN_OFFICIAL_API_KEY"],
})

for (const item of [
  { id: "anthropic-claude-haiku-4.5", name: "Haiku", maxTokens: 128, providerOptions: undefined },
  { id: "openai-gpt-5-nano", name: "GPT Nano", maxTokens: 1024, providerOptions: { reasoningEffort: "minimal" } },
] as const) {
  const model = DigitalOcean.configure({
    apiKey: process.env.DIGITAL_OCEAN_OFFICIAL_API_KEY ?? "fixture",
    providerOptions: item.providerOptions,
  }).model(item.id)

  describe(`DigitalOcean ${item.name} recorded`, () => {
    recorded.effect.with(
      `${item.name} reuses a cached prompt`,
      { tags: ["cache", "usage"], metadata: { model: item.id } },
      () =>
        Effect.gen(function* () {
          const request = LLM.request({
            model,
            system: LARGE_CACHEABLE_SYSTEM,
            prompt: "Reply exactly: OK",
            promptCacheKey: `digitalocean-recorded-${item.id}`,
            generation: { maxTokens: item.maxTokens },
          })
          const first = yield* LLMClient.generate(request)
          const second = yield* LLMClient.generate(request)

          expect(first.text.trim()).toMatch(/^OK\.?$/)
          expect(second.text.trim()).toMatch(/^OK\.?$/)
          expect(second.usage.cacheReadInputTokens).toBeGreaterThan(0)
          for (const response of [first, second]) {
            expect(response.usage.inputTokens).toBeGreaterThan(4096)
            expect(response.usage.inputTokens).toBe(
              (response.usage.nonCachedInputTokens ?? 0) +
                (response.usage.cacheReadInputTokens ?? 0) +
                (response.usage.cacheWriteInputTokens ?? 0),
            )
          }
        }),
      60_000,
    )

    recorded.effect.with(
      `${item.name} continues a tool call with cache markers`,
      { tags: ["cache", "tool", "tool-loop"], metadata: { model: item.id } },
      () =>
        Effect.gen(function* () {
          const request = goldenWeatherToolLoopRequest({
            id: `digitalocean-${item.id}-tool-loop`,
            model,
            maxTokens: item.maxTokens,
            temperature: false,
          })
          const events = yield* runWeatherToolLoop(LLMRequest.update(request, { cache: "auto" }))
          expectWeatherToolLoop(events)
        }),
      60_000,
    )
  })
}
