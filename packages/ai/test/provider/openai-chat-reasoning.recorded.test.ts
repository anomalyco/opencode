import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent } from "../../src"
import * as OpenAICompatible from "../../src/providers/openai-compatible"
import * as OpenRouter from "../../src/providers/openrouter"
import { LLMClient } from "../../src/route"
import { recordedTests } from "../recorded-test"

const cases = [
  {
    name: "OpenRouter",
    model: OpenRouter.configure({
      apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
      providerOptions: { openrouter: { reasoning: { max_tokens: 1024 } } },
    }).model("anthropic/claude-sonnet-4.6"),
    requires: ["OPENROUTER_API_KEY"],
    cassette: "openrouter-reasoning",
  },
  {
    name: "Vercel AI Gateway",
    model: OpenAICompatible.configure({
      provider: "vercel-ai-gateway",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      apiKey: process.env.AI_GATEWAY_API_KEY ?? "fixture",
      http: { body: { reasoning: { enabled: true, max_tokens: 1024 } } },
    }).model("anthropic/claude-sonnet-4.6"),
    requires: ["AI_GATEWAY_API_KEY"],
    cassette: "vercel-ai-gateway-reasoning",
  },
] as const

for (const item of cases) {
  const recorded = recordedTests({
    prefix: "openai-compatible-chat",
    provider: item.model.provider,
    protocol: "openai-chat",
    requires: item.requires,
    tags: ["reasoning"],
    metadata: { model: item.model.id },
  })

  describe(`${item.name} reasoning recorded`, () => {
    recorded.effect.with(
      "streams scalar reasoning",
      { cassette: item.cassette },
      () =>
        Effect.gen(function* () {
          const response = yield* LLMClient.generate(
            LLM.request({
              model: item.model,
              system: "Think through the arithmetic, then reply with only the final integer.",
              prompt: "What is 173 multiplied by 219?",
              generation: { maxTokens: 1536, temperature: 0 },
            }),
          )

          expect(response.text.replaceAll(",", "").trim()).toBe("37887")
          expect(response.reasoning.length).toBeGreaterThan(0)
          expect(response.events.some(LLMEvent.is.reasoningDelta)).toBe(true)
          expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
            openai: { reasoningField: "reasoning" },
          })
        }),
      30_000,
    )
  })
}
