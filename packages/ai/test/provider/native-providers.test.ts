import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { ai, Message, ToolDefinition } from "../../src/effect.js"
import {
  amazonBedrock,
  amazonBedrockMantle,
  anthropic,
  anthropicCompatible,
  azure,
  baseten,
  cerebras,
  cloudflareAIGateway,
  cloudflareWorkersAI,
  deepinfra,
  deepseek,
  fireworks,
  google,
  googleVertex,
  googleVertexChat,
  googleVertexMessages,
  googleVertexResponses,
  groq,
  openai,
  openaiCompatible,
  openaiCompatibleResponses,
  openrouter,
  togetherai,
  xai,
} from "../../src/providers/index.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

describe("native OpenAI-compatible providers", () => {
  test("assigns provider-owned metadata namespaces across native routes", () => {
    const vertex = { project: "project", accessToken: "token" }
    const providers = [
      [openai.configure({ apiKey: "test" }).chat("model"), "openai"],
      [openai.configure({ apiKey: "test" }).responses("model"), "openai"],
      [azure.configure({ resourceName: "resource", apiKey: "test" }).chat("model"), "azure"],
      [azure.configure({ resourceName: "resource", apiKey: "test" }).responses("model"), "azure"],
      [amazonBedrock.configure({ apiKey: "test" })("model"), "bedrock"],
      [amazonBedrockMantle.configure({ apiKey: "test" }).chat("model"), "mantle"],
      [amazonBedrockMantle.configure({ apiKey: "test" }).messages("model"), "mantle"],
      [amazonBedrockMantle.configure({ apiKey: "test" }).responses("model"), "mantle"],
      [google.configure({ apiKey: "test" })("model"), "google"],
      [googleVertex.configure(vertex)("model"), "vertex"],
      [googleVertexChat.configure(vertex)("model"), "vertex"],
      [googleVertexResponses.configure(vertex)("model"), "vertex"],
      [googleVertexMessages.configure(vertex)("model"), "vertex"],
      [anthropic.configure({ apiKey: "test" })("model"), "anthropic"],
      [anthropicCompatible.configure({ baseURL: "https://example.test/v1", provider: "minimax" })("model"), "minimax"],
      [openaiCompatible.configure({ baseURL: "https://example.test/v1", provider: "custom" })("model"), "custom"],
      [
        openaiCompatibleResponses.configure({ baseURL: "https://example.test/v1", provider: "custom" })("model"),
        "custom",
      ],
      [cerebras.configure({ apiKey: "test" })("model"), "cerebras"],
      [baseten.configure({ apiKey: "test" })("model"), "baseten"],
      [deepseek.configure({ apiKey: "test" })("model"), "deepseek"],
      [fireworks.configure({ apiKey: "test" })("model"), "fireworks"],
      [deepinfra.configure({ apiKey: "test" })("model"), "deepinfra"],
      [groq.configure({ apiKey: "test" })("model"), "groq"],
      [togetherai.configure({ apiKey: "test" })("model"), "togetherai"],
      [cloudflareAIGateway.configure({ accountId: "account" })("model"), "cloudflare-ai-gateway"],
      [cloudflareWorkersAI.configure({ accountId: "account" })("model"), "cloudflare-workers-ai"],
      [openrouter.configure({ apiKey: "test" })("model"), "openrouter"],
      [xai.configure({ apiKey: "test" }).chat("model"), "xai"],
      [xai.configure({ apiKey: "test" }).responses("model"), "xai"],
    ] as const

    for (const [model, key] of providers) expect(model.route.providerMetadataKey).toBe(key)
  })

  test("preserves native Together AI and Cerebras provider and route identities", () => {
    const together = togetherai.configure({ apiKey: "fixture" })("meta-llama/Llama-3.3-70B")
    const cerebrasModel = cerebras.configure({ apiKey: "fixture" })("qwen-3-235b-a22b")

    expect(together).toMatchObject({
      provider: "togetherai",
      compatibility: { maxTokensField: "max_tokens", supportsStrictMode: false },
      route: { id: "togetherai-chat", protocol: "openai-chat" },
    })
    expect(together.route.endpoint.baseURL).toBe("https://api.together.xyz/v1")
    expect(cerebrasModel).toMatchObject({
      provider: "cerebras",
      compatibility: { maxTokensField: "max_tokens", reasoningField: "reasoning" },
      route: { id: "cerebras-chat", protocol: "openai-chat" },
    })
    expect(cerebrasModel.route.endpoint.baseURL).toBe("https://api.cerebras.ai/v1")
  })

  it.effect("preserves extracted providers' Chat requests and identity through custom endpoints", () =>
    Effect.gen(function* () {
      for (const provider of [baseten, deepseek, fireworks]) {
        const settings = {
          apiKey: "fixture",
          baseURL: "https://gateway.example/v1",
          reasoningEffort: "high",
        }
        const selected = provider.configure(settings)("test-model")
        expect(selected.provider).toBe(provider.id)
        expect(selected.route.id).toBe(`${provider.id}-chat`)
        expect(selected.route.protocol).toBe("openai-chat")
        expect(selected.route.endpoint.baseURL).toBe(settings.baseURL)
        const input = {
          prompt: "Use a tool.",
          generation: { maxTokens: 48 },
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }
        const native = yield* compileRequest(ai.request({ ...input, model: selected }))
        const generic = yield* compileRequest(
          ai.request({
            ...input,
            model: openaiCompatible.configure({ ...settings, provider: provider.id })("test-model"),
          }),
        )
        expect(native.body).toEqual(generic.body)
      }
    }),
  )

  test("preserves native DeepInfra provider and route identity", () => {
    const deepinfraModel = deepinfra.configure({ apiKey: "fixture" })("google/gemma-3-27b-it")
    expect(deepinfraModel).toMatchObject({
      provider: "deepinfra",
      compatibility: { maxTokensField: "max_tokens", reasoningField: "reasoning_content" },
      route: { id: "deepinfra-chat", protocol: "openai-chat" },
    })
    expect(deepinfraModel.route.endpoint.baseURL).toBe("https://api.deepinfra.com/v1/openai")
  })

  it.effect("applies native provider request defaults even with a custom gateway URL", () =>
    Effect.gen(function* () {
      const together = yield* compileRequest(
        ai.request({
          model: togetherai.configure({ apiKey: "fixture", baseURL: "https://gateway.example/v1" })("llama"),
          prompt: "Use a tool.",
          generation: { maxTokens: 32 },
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

      const cerebrasRequest = yield* compileRequest(
        ai.request({
          model: cerebras.configure({ apiKey: "fixture", baseURL: "https://gateway.example/v1" })("qwen"),
          generation: { maxTokens: 48 },
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

      expect(cerebrasRequest.body).toMatchObject({
        max_tokens: 48,
        messages: [
          { role: "user", content: "Think first." },
          { role: "assistant", content: "An answer.", reasoning: "A deliberate thought." },
          { role: "user", content: "Continue." },
        ],
      })
      expect(cerebrasRequest.body).not.toHaveProperty("max_completion_tokens")
      expect(cerebrasRequest.body).not.toHaveProperty("store")
      expect(cerebrasRequest.body.messages[1]).not.toHaveProperty("reasoning_content")
    }),
  )

  test("normalizes DeepInfra API roots without duplicating the OpenAI path", () => {
    for (const baseURL of [
      "https://gateway.example/v1",
      "https://gateway.example/v1/",
      "https://gateway.example/v1/openai",
      "https://gateway.example/v1/openai/",
    ]) {
      expect(deepinfra.configure({ apiKey: "fixture", baseURL })("gemma").route.endpoint.baseURL).toBe(
        "https://gateway.example/v1/openai",
      )
    }
  })

  test("maps package settings onto native executable models", async () => {
    const entrypoints = await Promise.all([
      import("../../src/providers/baseten.js"),
      import("../../src/providers/cerebras.js"),
      import("../../src/providers/deepseek.js"),
      import("../../src/providers/fireworks.js"),
      import("../../src/providers/togetherai.js"),
    ])
    for (const native of entrypoints) {
      const selected = native.model("provider-model", {
        apiKey: "fixture",
        baseURL: "https://gateway.example/v1",
        headers: { "x-application": "opencode" },
        body: { service_tier: "priority" },
        reasoningEffort: "high",
      })

      expect(selected.route.endpoint.baseURL).toBe("https://gateway.example/v1")
      expect(selected.route.defaults.headers).toEqual({ "x-application": "opencode" })
      expect(selected.route.defaults.http?.body).toEqual({ service_tier: "priority" })
      expect(selected.route.defaults.providerOptions).toEqual({ reasoningEffort: "high" })
    }
  })

  it.effect("resolves provider environment credentials and preserves deprecated Together credentials", () =>
    Effect.gen(function* () {
      const scenarios = [
        {
          model: baseten.configure()("model"),
          env: { BASETEN_API_KEY: "baseten-secret" },
          token: "baseten-secret",
          url: "https://inference.baseten.co/v1/chat/completions",
        },
        {
          model: deepseek.configure()("deepseek-chat"),
          env: { DEEPSEEK_API_KEY: "deepseek-secret" },
          token: "deepseek-secret",
          url: "https://api.deepseek.com/v1/chat/completions",
        },
        {
          model: fireworks.configure()("model"),
          env: { FIREWORKS_API_KEY: "fireworks-secret" },
          token: "fireworks-secret",
          url: "https://api.fireworks.ai/inference/v1/chat/completions",
        },
        {
          model: togetherai.configure()("llama"),
          env: { TOGETHER_API_KEY: "together-primary", TOGETHER_AI_API_KEY: "together-legacy" },
          token: "together-primary",
          url: "https://api.together.xyz/v1/chat/completions",
        },
        {
          model: togetherai.configure()("llama"),
          env: { TOGETHER_AI_API_KEY: "together-legacy" },
          token: "together-legacy",
          url: "https://api.together.xyz/v1/chat/completions",
        },
        {
          model: cerebras.configure()("qwen"),
          env: { CEREBRAS_API_KEY: "cerebras-secret" },
          token: "cerebras-secret",
          url: "https://api.cerebras.ai/v1/chat/completions",
        },
        {
          model: deepinfra.configure()("gemma"),
          env: { DEEPINFRA_API_KEY: "deepinfra-secret" },
          token: "deepinfra-secret",
          url: "https://api.deepinfra.com/v1/openai/chat/completions",
        },
        {
          model: groq.configure()("llama"),
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
