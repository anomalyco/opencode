import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as OpenRouter from "../../src/providers/openrouter"
import { it } from "../lib/effect"

describe("OpenRouter", () => {
  it.effect("prepares OpenRouter models through the OpenAI-compatible Chat route", () =>
    Effect.gen(function* () {
      const model = OpenRouter.configure({ apiKey: "test-key" }).model("openai/gpt-4o-mini")

      expect(model).toMatchObject({
        id: "openai/gpt-4o-mini",
        provider: "openrouter",
        route: { id: "openrouter" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://openrouter.ai/api/v1")

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("openrouter")
      expect(prepared.body).toMatchObject({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
      expect(prepared.body).not.toHaveProperty("cache_control")
    }),
  )

  it.effect("applies OpenRouter payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: {
              openrouter: {
                usage: true,
                reasoning: { effort: "high" },
                promptCacheKey: "session_123",
                cacheControl: { type: "ephemeral", ttl: "1h" },
              },
            },
          }).model("anthropic/claude-3.7-sonnet:thinking"),
          prompt: "Think briefly.",
        }),
      )

      expect(prepared.body).toMatchObject({
        usage: { include: true },
        reasoning: { effort: "high" },
        prompt_cache_key: "session_123",
        cache_control: { type: "ephemeral", ttl: "1h" },
      })
    }),
  )

  it.effect("enables automatic prompt caching for Anthropic models", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-opus-4.8"),
          prompt: "Say hello.",
        }),
      )

      expect(prepared.body).toMatchObject({
        cache_control: { type: "ephemeral" },
      })

      const disabled = yield* LLMClient.prepare(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-opus-4.8"),
          prompt: "Say hello.",
          cache: "none",
        }),
      )
      expect(disabled.body).not.toHaveProperty("cache_control")

      const hourly = yield* LLMClient.prepare(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-opus-4.8"),
          prompt: "Say hello.",
          cache: { system: true, ttlSeconds: 3600 },
        }),
      )
      expect(hourly.body).toMatchObject({ cache_control: { type: "ephemeral", ttl: "1h" } })
    }),
  )

  it.effect("enables automatic prompt caching for tilde-prefixed Anthropic aliases", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("~anthropic/claude-opus-latest"),
          prompt: "Say hello.",
        }),
      )

      expect(prepared.body).toMatchObject({
        cache_control: { type: "ephemeral" },
      })
    }),
  )
})
