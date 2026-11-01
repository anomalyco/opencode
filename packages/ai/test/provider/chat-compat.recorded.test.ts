import { model as anthropicChat } from "@opencode/ai/providers/anthropic/chat"
import { model as googleChat } from "@opencode/ai/providers/google/chat"
import { model as xaiChat } from "@opencode/ai/providers/xai/chat"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, LLMEvent } from "../../src/effect.js"
import { LLMClient } from "../../src/route.js"
import { expectWeatherToolLoop, goldenWeatherToolLoopRequest, runWeatherToolLoop } from "../recorded-scenarios.js"
import { recordedTests } from "../recorded-test.js"

for (const item of [
  {
    name: "Anthropic",
    provider: "anthropic",
    env: "ANTHROPIC_API_KEY",
    model: anthropicChat("claude-haiku-4-5", { apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture" }),
    maxTokens: 256,
  },
  {
    name: "Google",
    provider: "google",
    env: "GEMINI_API_KEY",
    model: googleChat("gemini-3.5-flash-lite", { apiKey: process.env.GEMINI_API_KEY ?? "fixture" }),
    maxTokens: 1024,
  },
  {
    name: "xAI",
    provider: "xai",
    env: "XAI_API_KEY",
    model: xaiChat("grok-4.20-0309-non-reasoning", { apiKey: process.env.XAI_API_KEY ?? "fixture" }),
    maxTokens: 256,
  },
] as const) {
  const recorded = recordedTests({
    prefix: `${item.provider}-chat`,
    provider: item.provider,
    protocol: "openai-chat",
    requires: [item.env],
  })

  describe(`${item.name} Chat recorded`, () => {
    recorded.effect.with("streams text", { tags: ["text", "usage"], metadata: { model: item.model.id } }, () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          ai.request({
            model: item.model,
            prompt: "Reply with exactly one word: hello",
            generation: { maxTokens: item.maxTokens },
          }),
        )
        expect(response.text.toLowerCase()).toContain("hello")
        expect(response.events.some(LLMEvent.is.textDelta)).toBe(true)
        expect(response.usage?.outputTokens).toBeGreaterThan(0)
      }),
    )

    recorded.effect.with(
      "continues a tool call",
      { tags: ["tool", "tool-loop"], metadata: { model: item.model.id } },
      () =>
        Effect.gen(function* () {
          const events = yield* runWeatherToolLoop(
            goldenWeatherToolLoopRequest({
              id: `${item.provider}-chat-tool-loop`,
              model: item.model,
              maxTokens: item.maxTokens,
              temperature: false,
            }),
          )
          expectWeatherToolLoop(events)
        }),
      60_000,
    )
  })
}
