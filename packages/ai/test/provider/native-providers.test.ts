import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { ai, Message, ToolDefinition } from "../../src/effect.js"
import {
  AmazonBedrock,
  AmazonBedrockMantle,
  Anthropic,
  AnthropicCompatible,
  Azure,
  Baseten,
  Cerebras,
  CloudflareAIGateway,
  CloudflareWorkersAI,
  DeepInfra,
  DeepSeek,
  Fireworks,
  Google,
  GoogleVertex,
  GoogleVertexChat,
  GoogleVertexMessages,
  GoogleVertexResponses,
  Groq,
  OpenAI,
  OpenAICompatible,
  OpenAICompatibleResponses,
  OpenRouter,
  TogetherAI,
  XAI,
} from "../../src/providers/index.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

describe("native OpenAI-compatible providers", () => {
  test("assigns provider-owned metadata namespaces across native routes", () => {
    const vertex = { project: "project", accessToken: "token" }
    const providers = [
      [OpenAI.openai.with({ apiKey: "test" }).model("model", { api: "chat-completions" }), "openai"],
      [OpenAI.openai.with({ apiKey: "test" }).model("model"), "openai"],
      [Azure.chatModel("model", { resourceName: "resource", apiKey: "test" }), "azure"],
      [Azure.model("model", { resourceName: "resource", apiKey: "test" }), "azure"],
      [AmazonBedrock.model("model", { apiKey: "test" }), "bedrock"],
      [AmazonBedrockMantle.chatModel("model", { apiKey: "test" }), "mantle"],
      [AmazonBedrockMantle.messagesModel("model", { apiKey: "test" }), "mantle"],
      [AmazonBedrockMantle.model("model", { apiKey: "test" }), "mantle"],
      [Google.model("model", { apiKey: "test" }), "google"],
      [GoogleVertex.model("model", vertex), "vertex"],
      [GoogleVertexChat.model("model", vertex), "vertex"],
      [GoogleVertexResponses.model("model", vertex), "vertex"],
      [GoogleVertexMessages.model("model", vertex), "vertex"],
      [Anthropic.model("model", { apiKey: "test" }), "anthropic"],
      [AnthropicCompatible.model("model", { baseURL: "https://example.test/v1", provider: "minimax" }), "minimax"],
      [OpenAICompatible.model("model", { baseURL: "https://example.test/v1", provider: "custom" }), "custom"],
      [OpenAICompatibleResponses.model("model", { baseURL: "https://example.test/v1", provider: "custom" }), "custom"],
      [Cerebras.model("model", { apiKey: "test" }), "cerebras"],
      [Baseten.model("model", { apiKey: "test" }), "baseten"],
      [DeepSeek.model("model", { apiKey: "test" }), "deepseek"],
      [Fireworks.model("model", { apiKey: "test" }), "fireworks"],
      [DeepInfra.model("model", { apiKey: "test" }), "deepinfra"],
      [Groq.model("model", { apiKey: "test" }), "groq"],
      [TogetherAI.model("model", { apiKey: "test" }), "togetherai"],
      [CloudflareAIGateway.model("model", { accountId: "account" }), "cloudflare-ai-gateway"],
      [CloudflareWorkersAI.model("model", { accountId: "account" }), "cloudflare-workers-ai"],
      [OpenRouter.model("model", { apiKey: "test" }), "openrouter"],
      [XAI.xai.with({ apiKey: "test" }).model("model", { api: "chat-completions" }), "xai"],
      [XAI.model("model", { apiKey: "test" }), "xai"],
    ] as const

    for (const [model, key] of providers) expect(model.metadataKey).toBe(key)
  })

  test("preserves native Together AI and Cerebras provider and route identities", () => {
    const together = TogetherAI.model("meta-llama/Llama-3.3-70B", { apiKey: "fixture" })
    const cerebras = Cerebras.model("qwen-3-235b-a22b", { apiKey: "fixture" })

    expect(together).toMatchObject({
      provider: "togetherai",
      baseURL: "https://api.together.xyz/v1",
      capabilities: { output: { maxTokensField: "max_tokens" }, tools: { strict: false } },
      api: { id: "togetherai-chat", protocol: { id: "openai-chat" } },
    })
    expect(cerebras).toMatchObject({
      provider: "cerebras",
      baseURL: "https://api.cerebras.ai/v1",
      capabilities: { output: { maxTokensField: "max_tokens" }, reasoning: { field: "reasoning" } },
      api: { id: "cerebras-chat", protocol: { id: "openai-chat" } },
    })
  })

  it.effect("preserves extracted providers' Chat requests and identity through custom endpoints", () =>
    Effect.gen(function* () {
      for (const provider of [Baseten, DeepSeek, Fireworks]) {
        const settings = {
          apiKey: "fixture",
          baseURL: "https://gateway.example/v1",
          reasoningEffort: "high",
        }
        const selected = provider.model("test-model", settings)
        expect(selected.api.id).toBe(`${selected.provider}-chat`)
        expect(selected.api.protocol.id).toBe("openai-chat")
        expect(selected.baseURL).toBe(settings.baseURL)
        const input = {
          prompt: "Use a tool.",
          maxTokens: 48,
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }
        const native = yield* compileRequest(ai.request({ ...input, model: selected }))
        const generic = yield* compileRequest(
          ai.request({
            ...input,
            model: OpenAICompatible.model("test-model", { ...settings, provider: selected.provider }),
          }),
        )
        expect(native.body).toEqual(generic.body)
      }
    }),
  )

  test("preserves native DeepInfra provider and route identity", () => {
    const deepinfra = DeepInfra.model("google/gemma-3-27b-it", { apiKey: "fixture" })
    expect(deepinfra).toMatchObject({
      provider: "deepinfra",
      baseURL: "https://api.deepinfra.com/v1/openai",
      capabilities: { output: { maxTokensField: "max_tokens" }, reasoning: { field: "reasoning_content" } },
      api: { id: "deepinfra-chat", protocol: { id: "openai-chat" } },
    })
  })

  it.effect("applies native provider request defaults even with a custom gateway URL", () =>
    Effect.gen(function* () {
      const together = yield* compileRequest(
        ai.request({
          model: TogetherAI.model("llama", { apiKey: "fixture", baseURL: "https://gateway.example/v1" }),
          prompt: "Use a tool.",
          maxTokens: 32,
          tools: [
            ToolDefinition.make({ name: "lookup", description: "Look up data", inputSchema: { type: "object" } }),
          ],
          store: true,
        }),
      )

      expect(together.body).toMatchObject({
        max_tokens: 32,
        stream_options: { include_usage: true },
        tools: [{ function: { name: "lookup" } }],
      })
      expect(together.body).not.toHaveProperty("max_completion_tokens")
      expect(together.body).not.toHaveProperty("store")
      expect(together.body.tools?.[0]?.function).not.toHaveProperty("strict")

      const cerebras = yield* compileRequest(
        ai.request({
          model: Cerebras.model("qwen", { apiKey: "fixture", baseURL: "https://gateway.example/v1" }),
          maxTokens: 48,
          messages: [
            Message.user("Think first."),
            Message.assistant([
              { type: "reasoning", text: "A deliberate thought." },
              { type: "text", text: "An answer." },
            ]),
            Message.user("Continue."),
          ],
          store: true,
        }),
      )

      expect(cerebras.body).toMatchObject({
        max_tokens: 48,
        messages: [
          { role: "user", content: "Think first." },
          { role: "assistant", content: "An answer.", reasoning: "A deliberate thought." },
          { role: "user", content: "Continue." },
        ],
      })
      expect(cerebras.body).not.toHaveProperty("max_completion_tokens")
      expect(cerebras.body).not.toHaveProperty("store")
      expect(cerebras.body.messages[1]).not.toHaveProperty("reasoning_content")
    }),
  )

  test("normalizes DeepInfra API roots without duplicating the OpenAI path", () => {
    for (const baseURL of [
      "https://gateway.example/v1",
      "https://gateway.example/v1/",
      "https://gateway.example/v1/openai",
      "https://gateway.example/v1/openai/",
    ]) {
      expect(DeepInfra.model("gemma", { apiKey: "fixture", baseURL }).baseURL).toBe("https://gateway.example/v1/openai")
    }
  })

  test("maps package settings onto native executable models", () => {
    for (const native of [Baseten, Cerebras, DeepSeek, Fireworks, TogetherAI]) {
      const selected = native.model("provider-model", {
        apiKey: "fixture",
        baseURL: "https://gateway.example/v1",
        headers: { "x-application": "opencode" },
        body: { service_tier: "priority" },
        reasoningEffort: "high",
      })

      expect(selected.baseURL).toBe("https://gateway.example/v1")
      expect(selected.options?.headers).toEqual({ "x-application": "opencode" })
      expect(selected.options?.http?.body).toEqual({ service_tier: "priority" })
      expect(selected.options?.providerOptions).toEqual({ reasoningEffort: "high" })
    }
  })

  it.effect("resolves provider environment credentials and preserves deprecated Together credentials", () =>
    Effect.gen(function* () {
      const scenarios = [
        {
          model: Baseten.model("model"),
          env: { BASETEN_API_KEY: "baseten-secret" },
          token: "baseten-secret",
          url: "https://inference.baseten.co/v1/chat/completions",
        },
        {
          model: DeepSeek.model("deepseek-chat"),
          env: { DEEPSEEK_API_KEY: "deepseek-secret" },
          token: "deepseek-secret",
          url: "https://api.deepseek.com/v1/chat/completions",
        },
        {
          model: Fireworks.model("model"),
          env: { FIREWORKS_API_KEY: "fireworks-secret" },
          token: "fireworks-secret",
          url: "https://api.fireworks.ai/inference/v1/chat/completions",
        },
        {
          model: TogetherAI.model("llama"),
          env: { TOGETHER_API_KEY: "together-primary", TOGETHER_AI_API_KEY: "together-legacy" },
          token: "together-primary",
          url: "https://api.together.xyz/v1/chat/completions",
        },
        {
          model: TogetherAI.model("llama"),
          env: { TOGETHER_AI_API_KEY: "together-legacy" },
          token: "together-legacy",
          url: "https://api.together.xyz/v1/chat/completions",
        },
        {
          model: Cerebras.model("qwen"),
          env: { CEREBRAS_API_KEY: "cerebras-secret" },
          token: "cerebras-secret",
          url: "https://api.cerebras.ai/v1/chat/completions",
        },
        {
          model: DeepInfra.model("gemma"),
          env: { DEEPINFRA_API_KEY: "deepinfra-secret" },
          token: "deepinfra-secret",
          url: "https://api.deepinfra.com/v1/openai/chat/completions",
        },
        {
          model: Groq.model("llama"),
          env: { GROQ_API_KEY: "groq-secret" },
          token: "groq-secret",
          url: "https://api.groq.com/openai/v1/chat/completions",
        },
      ]

      yield* Effect.forEach(scenarios, (scenario) =>
        ai.generate(ai.request({ model: scenario.model, prompt: "Say hello." })).pipe(
          Effect.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.url).toBe(scenario.url)
                expect(request.headers.get("authorization")).toBe(`Bearer ${scenario.token}`)
                return input.respond(
                  sseEvents(
                    { id: "chatcmpl_fixture", choices: [{ delta: { content: "Hello" }, finish_reason: null }] },
                    { id: "chatcmpl_fixture", choices: [{ delta: {}, finish_reason: "stop" }] },
                  ),
                  { headers: { "content-type": "text/event-stream" } },
                )
              }),
            ),
          ),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: scenario.env }))),
          Effect.tap((response) => Effect.sync(() => expect(response.text).toBe("Hello"))),
        ),
      )
    }),
  )
})
