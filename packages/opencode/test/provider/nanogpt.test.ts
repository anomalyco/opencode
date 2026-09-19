import { expect, test } from "bun:test"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, streamText } from "ai"
import { Effect } from "effect"
import { Usage } from "@opencode-ai/llm"
import { NanoGPT } from "@/provider/nanogpt"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { LLMAISDK } from "@/session/llm/ai-sdk"

const model = {
  id: "test-model",
  providerID: "nano-gpt",
  cost: { input: 2, output: 10, cache: { read: 0.2, write: 2.5 } },
} as Provider.Model
const usage = {
  prompt_tokens: 1000,
  completion_tokens: 20,
  total_tokens: 1020,
  cache_creation_input_tokens: 800,
  prompt_tokens_details: { cached_tokens: 100 },
}
const terminal = (extra: Record<string, unknown> = {}) => ({
  id: "test-response",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  usage,
  ...extra,
})
async function account(frames: unknown[]) {
  const sdk = createOpenAICompatible({
    name: "nano-gpt",
    baseURL: "https://example.invalid/v1",
    metadataExtractor: NanoGPT.metadataExtractor,
    fetch: Object.assign(
      async () =>
        new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
      { preconnect() {} },
    ),
  })
  const result = streamText({ model: sdk("test-model"), prompt: "Hello", maxRetries: 0 })
  const state = LLMAISDK.adapterState()
  for await (const part of result.fullStream) {
    for (const event of await Effect.runPromise(LLMAISDK.toLLMEvents(state, part))) {
      if (event.type !== "step-finish") continue
      return Session.getUsage({ model, usage: event.usage!, metadata: event.providerMetadata })
    }
  }
  throw new Error("Missing step-finish")
}
test("accounts for streamed writes and settled USD cost through the SDK adapter", async () => {
  const result = await account([terminal(), { choices: [], x_nanogpt_pricing: { amount: 0.0123, currency: "USD" } }])
  expect(result.tokens).toMatchObject({ input: 100, output: 20, cache: { read: 100, write: 800 } })
  expect(result.cost).toBe(0.0123)
})
test("extracts non-streaming metadata through the compatible SDK", async () => {
  const sdk = createOpenAICompatible({
    name: "nano-gpt",
    baseURL: "https://example.invalid/v1",
    metadataExtractor: NanoGPT.metadataExtractor,
    fetch: Object.assign(
      async () =>
        Response.json({
          id: "test-response",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
          usage,
          x_nanogpt_pricing: { amount: 0, currency: "USD" },
        }),
      { preconnect() {} },
    ),
  })
  const result = await generateText({ model: sdk("test-model"), prompt: "Hello", maxRetries: 0 })
  expect(result.providerMetadata?.nanogpt).toEqual({ cacheCreationInputTokens: 800, costUSD: 0 })
  expect(
    Session.getUsage({
      model,
      usage: new Usage({ inputTokens: 1000, outputTokens: 20, cacheReadInputTokens: 100 }),
      metadata: result.providerMetadata,
    }).cost,
  ).toBe(0)
})
test("preserves zero, ignores malformed metadata, and isolates streams", () => {
  const first = NanoGPT.metadataExtractor.createStreamExtractor()
  const second = NanoGPT.metadataExtractor.createStreamExtractor()
  first.processChunk(terminal({ x_nanogpt_pricing: { amount: 0.5, currency: "USD" } }))
  first.processChunk({ usage: { cache_creation_input_tokens: 0 }, x_nanogpt_pricing: { amount: 0, currency: "USD" } })
  for (const invalid of [-1, Infinity, NaN, "12", null, {}, []])
    first.processChunk({
      usage: { cache_creation_input_tokens: invalid },
      x_nanogpt_pricing: { amount: invalid, currency: "USD" },
    })
  first.processChunk({
    usage: { cache_creation_input_tokens: 1.5 },
    x_nanogpt_pricing: { amount: 10, currency: "NANO" },
  })
  expect(first.buildMetadata()).toEqual({ nanogpt: { cacheCreationInputTokens: 0, costUSD: 0 } })
  expect(second.buildMetadata()).toEqual({ nanogpt: {} })
})
test("falls back to configured rates when settled USD cost is unavailable", async () => {
  const result = await account([terminal({ x_nanogpt_pricing: { amount: 1, currency: "NANO" } })])
  expect(result.cost).toBeCloseTo(0.00242, 10)
})
test("scopes metadata to NanoGPT and rejects inconsistent cache counts", () => {
  const input = new Usage({ inputTokens: 1000, outputTokens: 20, cacheReadInputTokens: 100, cacheWriteInputTokens: 0 })
  const metadata = { nanogpt: { cacheCreationInputTokens: 800, costUSD: 0 } }
  expect(Session.getUsage({ model, usage: input, metadata }).tokens.cache.write).toBe(800)
  const other = Session.getUsage({ model: { ...model, providerID: "other" } as Provider.Model, usage: input, metadata })
  expect(other.tokens.cache.write).toBe(0)
  expect(other.cost).toBeCloseTo(0.00202, 10)
  for (const invalid of [901, -1, Infinity, NaN, "800", 1.5]) {
    const result = Session.getUsage({
      model,
      usage: input,
      metadata: { nanogpt: { cacheCreationInputTokens: invalid, costUSD: -1 } },
    })
    expect(result.tokens.cache.write).toBe(0)
    expect(result.cost).toBeCloseTo(0.00202, 10)
  }
})
