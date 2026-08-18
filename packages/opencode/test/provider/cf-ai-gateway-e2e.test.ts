// End-to-end regression tests for opencode#24432 and opencode#32051/#32052.
//
// Routes through the actual ai-gateway-provider chain that provider.ts builds at
// runtime, with only the network boundary stubbed:
//   - openai/*    -> native OpenAI passthrough (Responses API)
//   - anthropic/* -> native Anthropic passthrough (Messages API)
//   - everything else -> unified /compat (openai-compatible chat completions)
// Asserts what actually lands in the envelope body Cloudflare AI Gateway
// forwards upstream, which is the only place these bugs were observable.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { JSONValue } from "ai"
import { generateText } from "ai"
import { createAiGateway } from "ai-gateway-provider"
import { createUnified } from "ai-gateway-provider/providers/unified"
import { createOpenAI } from "ai-gateway-provider/providers/openai"
import { createAnthropic } from "ai-gateway-provider/providers/anthropic"
import { ProviderTransform } from "@/provider/transform"
import type * as Provider from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

type Captured = { url: string; outerBody: unknown; headers: Record<string, string> }
type ProviderOptions = Record<string, Record<string, JSONValue>>

const realFetch = globalThis.fetch
let captured: Captured | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// The gateway returns the upstream provider's response body verbatim, so the
// mock must answer in the wire format of the step's target provider.
function upstreamResponseBody(provider: string | undefined) {
  if (provider === "openai")
    return {
      id: "resp_test",
      object: "response",
      created_at: 0,
      model: "gpt-5.4",
      status: "completed",
      error: null,
      incomplete_details: null,
      output: [
        {
          type: "message",
          role: "assistant",
          id: "msg_1",
          status: "completed",
          content: [{ type: "output_text", text: "ok", annotations: [] }],
        },
      ],
      usage: {
        input_tokens: 1,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 1,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 2,
      },
    }
  if (provider === "anthropic")
    return {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "test",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
}

beforeEach(() => {
  captured = null
  const handle = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith("https://gateway.ai.cloudflare.com/")) {
      const bodyText = typeof init?.body === "string" ? init.body : ""
      const outerBody = bodyText ? JSON.parse(bodyText) : null
      captured = {
        url,
        outerBody,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      }
      const provider =
        Array.isArray(outerBody) && isRecord(outerBody[0]) && typeof outerBody[0].provider === "string"
          ? outerBody[0].provider
          : undefined
      return new Response(JSON.stringify(upstreamResponseBody(provider)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    return realFetch(input, init)
  }
  // `typeof fetch` includes Bun's `preconnect` method; preserve it from realFetch.
  const stubFetch: typeof fetch = Object.assign(handle, { preconnect: realFetch.preconnect.bind(realFetch) })
  globalThis.fetch = stubFetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

// Mirrors the runtime npm rewrite in provider.ts: openai/anthropic models carry
// their native SDK package so transforms key provider options correctly.
const cfNpm = (apiId: string) => {
  if (apiId.startsWith("openai/")) return "@ai-sdk/openai"
  if (apiId.startsWith("anthropic/")) return "@ai-sdk/anthropic"
  return "ai-gateway-provider"
}

const cfModel = (apiId: string, releaseDate = "2026-03-05"): Provider.Model => ({
  id: ModelV2.ID.make(`cloudflare-ai-gateway/${apiId}`),
  providerID: ProviderV2.ID.make("cloudflare-ai-gateway"),
  name: apiId,
  api: { id: apiId, url: "https://gateway.ai.cloudflare.com/v1/compat", npm: cfNpm(apiId) },
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

// ai-gateway-provider sends an array of step descriptors; each entry's `query`
// is the body forwarded to the upstream provider.
function firstStep(body: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(body) || body.length === 0) return undefined
  const first = body[0]
  return isRecord(first) ? first : undefined
}

function extractUpstreamQuery(body: unknown): Record<string, unknown> | undefined {
  const query = firstStep(body)?.query
  return isRecord(query) ? query : undefined
}

// Each step descriptor also carries the `headers` forwarded to the upstream provider.
function extractUpstreamHeaders(body: unknown): Record<string, unknown> | undefined {
  const headers = firstStep(body)?.headers
  return isRecord(headers) ? headers : undefined
}

// Mirrors the runtime routing in provider.ts getModel.
function gatewayModel(apiId: string, gatewayToken = "test") {
  const aigateway = createAiGateway({ accountId: "test", gateway: "test", apiKey: gatewayToken })
  if (apiId.startsWith("openai/")) return aigateway(createOpenAI()(apiId.slice("openai/".length)))
  if (apiId.startsWith("anthropic/")) return aigateway(createAnthropic()(apiId.slice("anthropic/".length)))
  const isWorkersAi = apiId.startsWith("workers-ai/") || apiId.startsWith("@cf/")
  const unified = createUnified(isWorkersAi ? { apiKey: gatewayToken } : {})
  return aigateway(unified(apiId))
}

async function callThroughGateway(apiId: string, providerOptions: ProviderOptions, gatewayToken = "test") {
  await generateText({ model: gatewayModel(apiId, gatewayToken), prompt: "hi", providerOptions })
  return extractUpstreamQuery(captured?.outerBody)
}

describe("cf-ai-gateway routing", () => {
  test("openai/* rides the native OpenAI passthrough on the Responses API", async () => {
    await callThroughGateway("openai/gpt-5.4", {})
    const step = firstStep(captured?.outerBody)
    expect(step?.provider).toBe("openai")
    expect(step?.endpoint).toBe("v1/responses")
    const upstream = extractUpstreamQuery(captured?.outerBody)
    expect(upstream?.model).toBe("gpt-5.4")
  })

  test("anthropic/* rides the native Anthropic passthrough on the Messages API", async () => {
    await callThroughGateway("anthropic/claude-sonnet-4-6", {})
    const step = firstStep(captured?.outerBody)
    expect(step?.provider).toBe("anthropic")
    expect(step?.endpoint).toBe("v1/messages")
    const upstream = extractUpstreamQuery(captured?.outerBody)
    expect(upstream?.model).toBe("claude-sonnet-4-6")
  })

  test("workers-ai models stay on the unified /compat route", async () => {
    await callThroughGateway("workers-ai/@cf/moonshotai/kimi-k2.6", {})
    const step = firstStep(captured?.outerBody)
    expect(step?.provider).toBe("compat")
    expect(step?.endpoint).toBe("chat/completions")
    const upstream = extractUpstreamQuery(captured?.outerBody)
    expect(upstream?.model).toBe("workers-ai/@cf/moonshotai/kimi-k2.6")
  })
})

describe("cf-ai-gateway end-to-end (regression: #24432)", () => {
  test("ProviderTransform.providerOptions output puts reasoning effort on the Responses wire", async () => {
    // The full chain the runtime exercises for OpenAI models:
    //   transform.providerOptions() -> "openai" key (npm rewritten to @ai-sdk/openai)
    //   -> OpenAIResponsesLanguageModel emits body.reasoning.effort
    //   -> ai-gateway-provider wraps the body and forwards to gateway.ai.cloudflare.com
    const opts = ProviderTransform.providerOptions(cfModel("openai/gpt-5.4"), { reasoningEffort: "xhigh" })
    expect(Object.keys(opts)).toEqual(["openai"])
    expect(opts.openai.reasoningEffort).toBe("xhigh")

    const upstream = await callThroughGateway("openai/gpt-5.4", opts)
    expect((upstream?.reasoning as Record<string, unknown> | undefined)?.effort).toBe("xhigh")
  })

  test("variants() output for openai/gpt-5.4 lands xhigh on the wire", async () => {
    // fromModelsDevModel resolves the native npm before computing variants, so
    // OpenAI models get full Responses-flavored payloads (summary + encrypted
    // reasoning include for stateless multi-turn reasoning).
    const variants = ProviderTransform.variants(cfModel("openai/gpt-5.4"))
    expect(variants.xhigh).toEqual({
      reasoningEffort: "xhigh",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    })

    const opts = ProviderTransform.providerOptions(cfModel("openai/gpt-5.4"), variants.xhigh)
    const upstream = await callThroughGateway("openai/gpt-5.4", opts)
    const reasoning = upstream?.reasoning as Record<string, unknown> | undefined
    expect(reasoning?.effort).toBe("xhigh")
    expect(reasoning?.summary).toBe("auto")
  })

  test("reasoning effort variants for anthropic models land as native adaptive thinking", async () => {
    // Mirrors the runtime catalog path: models.dev reasoning_options -> reasoningVariants
    // computed on the native @ai-sdk/anthropic npm -> adaptive thinking + output_config.effort.
    const model = cfModel("anthropic/claude-sonnet-4-6")
    const variants = ProviderTransform.reasoningVariants(
      { reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }] } as never,
      model,
    )
    expect(variants?.high).toMatchObject({ effort: "high" })

    const opts = ProviderTransform.providerOptions(model, variants!.high)
    expect(Object.keys(opts)).toEqual(["anthropic"])

    const upstream = await callThroughGateway("anthropic/claude-sonnet-4-6", opts)
    expect((upstream?.thinking as Record<string, unknown> | undefined)?.type).toBe("adaptive")
    expect((upstream?.output_config as Record<string, unknown> | undefined)?.effort).toBe("high")
  })

  test("reasoning_effort still reaches the /compat wire for workers-ai models", async () => {
    const model = cfModel("workers-ai/@cf/moonshotai/kimi-k2.6")
    const opts = ProviderTransform.providerOptions(model, { reasoningEffort: "high" })
    expect(opts).toEqual({ openaiCompatible: { reasoningEffort: "high" } })

    const upstream = await callThroughGateway("workers-ai/@cf/moonshotai/kimi-k2.6", opts)
    expect(upstream?.reasoning_effort).toBe("high")
  })

  test("legacy buggy key 'cloudflare-ai-gateway' does NOT reach the wire (proves the bug)", async () => {
    // Sanity: confirms the bug class. If a future change accidentally restores
    // providerID-keyed providerOptions, this test fails before users notice.
    const upstream = await callThroughGateway("workers-ai/@cf/moonshotai/kimi-k2.6", {
      "cloudflare-ai-gateway": { reasoningEffort: "high" },
    })
    expect(upstream?.reasoning_effort).toBeUndefined()
  })
})

describe("cf-ai-gateway token scoping (regression: #32051/#32052)", () => {
  test("openai passthrough does NOT forward the Cloudflare token upstream", async () => {
    await callThroughGateway("openai/gpt-5.4", {}, "cf-gateway-secret")

    expect(captured?.headers["cf-aig-authorization"]).toBe("Bearer cf-gateway-secret")
    // Security invariant: the Cloudflare token must never become the upstream provider's Authorization.
    expect(extractUpstreamHeaders(captured?.outerBody)?.["authorization"]).toBeUndefined()
    expect(JSON.stringify(captured?.outerBody)).not.toContain("cf-gateway-secret")
  })

  test("anthropic passthrough does NOT forward the Cloudflare token upstream", async () => {
    await callThroughGateway("anthropic/claude-sonnet-4-6", {}, "cf-gateway-secret")

    expect(captured?.headers["cf-aig-authorization"]).toBe("Bearer cf-gateway-secret")
    expect(extractUpstreamHeaders(captured?.outerBody)?.["x-api-key"]).toBeUndefined()
    expect(JSON.stringify(captured?.outerBody)).not.toContain("cf-gateway-secret")
  })

  test("workers-ai models DO forward the Cloudflare token upstream", async () => {
    await callThroughGateway("workers-ai/@cf/google/gemma-4-26b-a4b-it", {}, "cf-gateway-secret")

    expect(captured?.headers["cf-aig-authorization"]).toBe("Bearer cf-gateway-secret")
    expect(extractUpstreamHeaders(captured?.outerBody)?.["authorization"]).toBe("Bearer cf-gateway-secret")
  })

  test("bare @cf/ Workers AI models DO forward the Cloudflare token upstream", async () => {
    await callThroughGateway("@cf/meta/llama-3.1-8b-instruct", {}, "cf-gateway-secret")

    expect(captured?.headers["cf-aig-authorization"]).toBe("Bearer cf-gateway-secret")
    expect(extractUpstreamHeaders(captured?.outerBody)?.["authorization"]).toBe("Bearer cf-gateway-secret")
  })
})
