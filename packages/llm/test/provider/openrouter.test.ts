import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenRouter } from "../../src/providers/openrouter"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

describe("OpenRouter", () => {
  it.effect("prepares OpenRouter models through the OpenAI-compatible Chat route", () =>
    Effect.gen(function* () {
      const model = OpenRouter.model("openai/gpt-4o-mini", { apiKey: "test-key" })

      expect(model).toMatchObject({
        id: "openai/gpt-4o-mini",
        provider: "openrouter",
        protocol: "openai-compatible-chat",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: "test-key",
      })

      const prepared = yield* LLMClient.make({ adapters: OpenRouter.adapters }).prepare(
        LLM.request({ model, prompt: "Say hello." }),
      )

      expect(prepared.adapter).toBe("openai-compatible-chat")
      expect(prepared.payload).toMatchObject({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("applies OpenRouter payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({ adapters: OpenRouter.adapters }).prepare(
        LLM.request({
          model: OpenRouter.model("anthropic/claude-3.7-sonnet:thinking", {
            usage: true,
            reasoning: { effort: "high" },
            promptCacheKey: "session_123",
          }),
          prompt: "Think briefly.",
        }),
      )

      expect(prepared.payload).toMatchObject({
        usage: { include: true },
        reasoning: { effort: "high" },
        prompt_cache_key: "session_123",
      })
      expect(prepared.patchTrace.map((item) => item.id)).toContain("payload.openrouter.options")
    }),
  )
})
