import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMClient, LLMEvent, LLMRequest } from "../../src/index.js"
import { isRetryable } from "../../src/provider-error.js"
import { VercelAIGateway } from "../../src/providers/vercel-ai-gateway.js"
import { recordedTests } from "../recorded-test.js"
import { expectWeatherToolLoop, goldenWeatherToolLoopRequest, runWeatherToolLoop } from "../recorded-scenarios.js"

const gateway = VercelAIGateway.configure({ apiKey: process.env.AI_GATEWAY_API_KEY ?? "fixture" })
const recorded = recordedTests({
  prefix: "vercel-native",
  provider: "vercel-ai-gateway",
  requires: ["AI_GATEWAY_API_KEY"],
})

for (const item of [
  {
    name: "messages Claude",
    model: gateway.messages("anthropic/claude-sonnet-5.5"),
    options: { reasoningEffort: "low" },
    reasoning: false,
  },
  {
    name: "messages Gemini",
    model: gateway.messages("google/gemini-3.8-flash"),
    options: { reasoningEffort: "low" },
    reasoning: true,
  },
  {
    name: "responses GPT",
    model: gateway.model("openai/gpt-6-luna"),
    options: { reasoningEffort: "low" },
    reasoning: false,
  },
  {
    name: "chat Muse",
    model: gateway.model("meta/muse-spark-1.3"),
    options: { reasoningEffort: "low" },
    reasoning: false,
  },
  {
    name: "messages DeepSeek",
    model: gateway.model("deepseek/deepseek-v4.1-flash"),
    options: { reasoningEffort: "high" },
    reasoning: true,
  },
  {
    name: "responses Grok",
    model: gateway.model("spacexai/grok-4.7"),
    options: { reasoningEffort: "low" },
    reasoning: true,
  },
  {
    name: "chat Claude",
    model: gateway.chat("anthropic/claude-sonnet-5.5"),
    options: { reasoningEffort: "low" },
    reasoning: false,
  },
] as const) {
  recorded.effect(
    `continues ${item.name} reasoning and tools`,
    () =>
      Effect.gen(function* () {
        const events = yield* runWeatherToolLoop(
          LLMRequest.update(
            goldenWeatherToolLoopRequest({
              id: item.name,
              model: item.model,
              maxTokens: 2048,
              temperature: false,
            }),
            { providerOptions: item.options },
          ),
        )
        expectWeatherToolLoop(events)
        expect(events.filter(LLMEvent.is.finish).every((event) => event.providerMetadata?.gateway !== undefined)).toBe(
          true,
        )
        if (item.reasoning) expect(events.some(LLMEvent.is.reasoningEnd)).toBe(true)
      }),
    120_000,
  )
}

recorded.effect(
  "rejects invalid credentials without retryable classification",
  () =>
    Effect.gen(function* () {
      const result = yield* LLMClient.generate(
        LLM.request({
          model: VercelAIGateway.configure({ apiKey: "invalid-gateway-key" }).messages("anthropic/claude-sonnet-5.5"),
          prompt: "Hello",
          generation: { maxTokens: 32 },
        }),
      ).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure.reason.http?.status).toBe(401)
        expect(isRetryable(result.failure)).toBe(false)
      }
    }),
  30_000,
)

recorded.effect(
  "automatically caches distinct Claude system blocks",
  () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: gateway.messages("anthropic/claude-sonnet-5.5"),
        system: [
          {
            type: "text",
            text: Array.from(
              { length: 250 },
              (_, i) => `Rule ${i}: Preserve provider reasoning state and keep stable prompt prefixes intact.`,
            ).join("\n"),
          },
          { type: "text", text: "Reply with OK only." },
        ],
        prompt: "Confirm.",
        generation: { maxTokens: 32 },
        providerOptions: { gateway: { only: ["anthropic"] } },
      })
      yield* LLMClient.generate(request)
      const second = yield* LLMClient.generate(request)
      expect(second.usage?.cacheReadInputTokens).toBeGreaterThan(0)
    }),
  60_000,
)
