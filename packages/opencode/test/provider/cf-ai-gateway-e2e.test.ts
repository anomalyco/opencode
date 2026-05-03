// End-to-end regression test for opencode#24432.
//
// Routes through the actual ai-gateway-provider + @ai-sdk/openai-compatible
// chain that provider.ts:811 builds at runtime, with only the network boundary
// stubbed. Asserts that `reasoning_effort` (and other provider options the
// transform emits) actually land in the body Cloudflare AI Gateway forwards
// upstream — which is the only place the bug was observable.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { generateText } from "ai"
import { createAiGateway } from "ai-gateway-provider"
import { createUnified } from "ai-gateway-provider/providers/unified"
import { ProviderTransform } from "@/provider/transform"

type Captured = { url: string; outerBody: any }

const realFetch = globalThis.fetch
let captured: Captured | null = null

beforeEach(() => {
  captured = null
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith("https://gateway.ai.cloudflare.com/")) {
      const bodyText = init?.body ?? ""
      captured = { url, outerBody: bodyText ? JSON.parse(bodyText) : null }
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "openai/gpt-5.4",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    return realFetch(input, init)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const cfModel = (apiId: string, releaseDate = "2026-03-05"): any => ({
  id: `cloudflare-ai-gateway/${apiId}`,
  providerID: "cloudflare-ai-gateway",
  api: { id: apiId, url: "https://gateway.ai.cloudflare.com/v1/compat", npm: "ai-gateway-provider" },
  capabilities: {
    reasoning: true,
    temperature: false,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: true },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
  limit: { context: 1_000_000, output: 128_000 },
  status: "active",
  options: {},
  headers: {},
  release_date: releaseDate,
})

async function callThroughGateway(apiId: string, providerOptions: Record<string, any>) {
  const aigateway = createAiGateway({ accountId: "test", gateway: "test", apiKey: "test" })
  const unified = createUnified()
  await generateText({ model: aigateway(unified(apiId)), prompt: "hi", providerOptions })
  // ai-gateway-provider sends an array; each entry's `query` is the upstream body.
  return captured?.outerBody?.[0]?.query as Record<string, any> | undefined
}

describe("cf-ai-gateway end-to-end (regression: #24432)", () => {
  test("ProviderTransform.providerOptions output puts reasoning_effort on the wire", async () => {
    // The full chain the runtime exercises:
    //   transform.providerOptions() → openaiCompatible key
    //   → @ai-sdk/openai-compatible reads it as compatibleOptions
    //   → emits body.reasoning_effort
    //   → ai-gateway-provider wraps the body and forwards to gateway.ai.cloudflare.com
    const opts = ProviderTransform.providerOptions(cfModel("openai/gpt-5.4"), { reasoningEffort: "xhigh" })
    expect(opts).toEqual({ openaiCompatible: { reasoningEffort: "xhigh" } })

    const upstream = await callThroughGateway("openai/gpt-5.4", opts)
    expect(upstream?.reasoning_effort).toBe("xhigh")
  })

  test("variants() output for openai/gpt-5.4 lands xhigh on the wire", async () => {
    // The other half of the bug: workflow `variant: xhigh` flows through variants()
    // and must reach the wire. variants() returns the providerOptions payload
    // unwrapped; providerOptions() wraps it under the SDK key.
    const variants = ProviderTransform.variants(cfModel("openai/gpt-5.4"))
    expect(variants.xhigh).toEqual({ reasoningEffort: "xhigh" })

    const opts = ProviderTransform.providerOptions(cfModel("openai/gpt-5.4"), variants.xhigh)
    const upstream = await callThroughGateway("openai/gpt-5.4", opts)
    expect(upstream?.reasoning_effort).toBe("xhigh")
  })

  test("legacy buggy key 'cloudflare-ai-gateway' does NOT reach the wire (proves the bug)", async () => {
    // Sanity: confirms the bug class. If a future change accidentally restores
    // providerID-keyed providerOptions, this test fails before users notice.
    const upstream = await callThroughGateway("openai/gpt-5.4", {
      "cloudflare-ai-gateway": { reasoningEffort: "high" },
    })
    expect(upstream?.reasoning_effort).toBeUndefined()
  })
})
