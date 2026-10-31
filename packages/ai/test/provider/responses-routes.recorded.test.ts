import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { ai, LLMEvent, toDefinitions } from "../../src/effect.js"
import { CloudflareWorkersAI, DigitalOcean, Fireworks, Groq, OpenRouter, Venice } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { tool } from "../../src/tool.js"
import {
  expectWeatherToolLoop,
  runWeatherToolLoop,
  weatherTool,
  weatherToolLoopRequest,
} from "../recorded-scenarios.js"
import { recordedTests } from "../recorded-test.js"

const run = toDefinitions([
  tool({
    name: "run",
    description: "Run a Python snippet.",
    parameters: Schema.Struct({ code: Schema.String }),
    success: Schema.String,
    freeform: { type: "text" },
  }),
])

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
  {
    provider: "fireworks",
    env: "FIREWORKS_API_KEY",
    freeform: false,
    model: Fireworks.configure({ apiKey: process.env.FIREWORKS_API_KEY ?? "fixture" }).responses(
      "accounts/fireworks/models/gpt-oss-120b",
    ),
  },
  {
    provider: "groq",
    env: "GROQ_API_KEY",
    freeform: false,
    model: Groq.configure({ apiKey: process.env.GROQ_API_KEY ?? "fixture" }).responses("openai/gpt-oss-20b"),
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
        ai.request({ model: item.model, prompt: "Reply exactly: OK", generation: { maxTokens: 64 } }),
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

  if (item.freeform === false) continue

  recorded.effect.with("calls a freeform text tool", { tags: ["tool", "freeform"] }, () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        ai.request({
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

// Workers AI answers Responses with the complete Response, and its endpoint rejects `function_call_output`
// input, so only a single tool call is covered.
const workers = CloudflareWorkersAI.configure({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
  apiKey: process.env.CLOUDFLARE_API_KEY ?? "fixture",
}).responses("@cf/openai/gpt-oss-20b")
const workersRecorded = recordedTests({
  prefix: "cloudflare-workers-ai-responses",
  provider: "cloudflare-workers-ai",
  protocol: "open-responses",
  requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
  metadata: { model: workers.id },
  options: { redact: { url: (url) => url.replace(/\/accounts\/[^/]+\/ai\//, "/accounts/{account}/ai/") } },
})

workersRecorded.effect.with("generates text", { tags: ["text", "usage"] }, () =>
  Effect.gen(function* () {
    const response = yield* LLMClient.generate(
      ai.request({ model: workers, prompt: "Reply exactly: OK", generation: { maxTokens: 256 } }),
    )
    expect(response.text.trim()).toMatch(/^OK\.?$/)
    expect(response.finishReason.normalized).toBe("stop")
    expect(response.usage.outputTokens).toBeGreaterThan(0)
  }),
)

workersRecorded.effect.with("calls a tool", { tags: ["tool"] }, () =>
  Effect.gen(function* () {
    const response = yield* LLMClient.generate(
      ai.request({
        model: workers,
        system: "Use the get_weather tool.",
        prompt: "What is the weather in Paris?",
        tools: [weatherTool],
        generation: { maxTokens: 256 },
      }),
    )
    expect(response.toolCalls).toMatchObject([{ name: "get_weather", input: { city: "Paris" } }])
    expect(response.finishReason.normalized).toBe("tool-calls")
  }),
)
