import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, LLMEvent, toDefinitions } from "../../src/effect.js"
import { DigitalOcean, OpenRouter, Venice } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { Tool } from "../../src/tool.js"
import { expectWeatherToolLoop, runWeatherToolLoop, weatherToolLoopRequest } from "../recorded-scenarios.js"
import { recordedTests } from "../recorded-test.js"

const run = toDefinitions({
  run: Tool.make({
    description: "Run a Python snippet.",
    parameters: Schema.Struct({ code: Schema.String }),
    success: Schema.String,
    freeform: { type: "text" },
  }),
})

for (const item of [
  {
    provider: "openrouter",
    env: "OPENROUTER_API_KEY",
    model: OpenRouter.configure({ apiKey: process.env.OPENROUTER_API_KEY ?? "fixture" }).responses(
      "openai/gpt-5.4-mini",
    ),
  },
  {
    provider: "digitalocean",
    env: "DIGITAL_OCEAN_OFFICIAL_API_KEY",
    model: DigitalOcean.configure({ apiKey: process.env.DIGITAL_OCEAN_OFFICIAL_API_KEY ?? "fixture" }).responses(
      "openai-gpt-5.4-mini",
    ),
  },
  {
    provider: "venice",
    env: "VENICE_API_KEY",
    model: Venice.configure({ apiKey: process.env.VENICE_API_KEY ?? "fixture" }).responses("openai-gpt-54-mini"),
  },
]) {
  const recorded = recordedTests({
    prefix: `${item.provider}-responses`,
    provider: item.provider,
    protocol: "open-responses",
    requires: [item.env],
    metadata: { model: item.model.id },
  })

  recorded.effect.with("streams text", { tags: ["text", "usage"] }, () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({ model: item.model, prompt: "Reply exactly: OK", generation: { maxTokens: 64 } }),
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
          id: `${item.provider}-responses-tool-loop`,
          model: item.model,
          maxTokens: 256,
          temperature: false,
        }),
      )
      expectWeatherToolLoop(events)
    }),
  )

  recorded.effect.with("calls a freeform text tool", { tags: ["tool", "freeform"] }, () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: item.model,
          prompt: "Use the run tool to execute exactly this code: print(1)",
          tools: run,
          toolChoice: "required",
          generation: { maxTokens: 256 },
        }),
      )
      expect(response.toolCalls).toMatchObject([{ name: "run", input: { code: expect.stringContaining("print(1)") } }])
      expect(response.toolCalls[0]?.providerMetadata).toMatchObject({ [item.provider]: { custom: true } })
      expect(response.finishReason.normalized).toBe("tool-calls")
    }),
  )
}
