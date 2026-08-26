import { describe, expect } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, Message, ToolDefinition } from "../../src/index.js"
import { Cerebras, DeepInfra, TogetherAI } from "../../src/providers/index.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

describe("native OpenAI-compatible providers", () => {
  it.effect("preserves native Together AI and Cerebras provider and route identities", () =>
    Effect.gen(function* () {
      const together = TogetherAI.configure({ apiKey: "fixture" }).model("meta-llama/Llama-3.3-70B")
      const cerebras = Cerebras.configure({ apiKey: "fixture" }).model("qwen-3-235b-a22b")

      expect(together).toMatchObject({
        provider: "togetherai",
        compatibility: { maxTokensField: "max_tokens", supportsStore: false, supportsStrictMode: false },
        route: { id: "togetherai-chat", protocol: "openai-chat" },
      })
      expect(together.route.endpoint.baseURL).toBe("https://api.together.xyz/v1")
      expect(cerebras).toMatchObject({
        provider: "cerebras",
        compatibility: { maxTokensField: "max_tokens", reasoningField: "reasoning", supportsStore: false },
        route: { id: "cerebras-chat", protocol: "openai-chat" },
      })
      expect(cerebras.route.endpoint.baseURL).toBe("https://api.cerebras.ai/v1")
    }),
  )

  it.effect("preserves native DeepInfra provider and route identity", () =>
    Effect.gen(function* () {
      const deepinfra = DeepInfra.configure({ apiKey: "fixture" }).model("google/gemma-3-27b-it")
      expect(deepinfra).toMatchObject({
        provider: "deepinfra",
        compatibility: { maxTokensField: "max_tokens", reasoningField: "reasoning_content", supportsStore: false },
        route: { id: "deepinfra-chat", protocol: "openai-chat" },
      })
      expect(deepinfra.route.endpoint.baseURL).toBe("https://api.deepinfra.com/v1/openai")
    }),
  )

  it.effect("applies native provider request defaults even with a custom gateway URL", () =>
    Effect.gen(function* () {
      const together = yield* compileRequest(
        LLM.request({
          model: TogetherAI.configure({ apiKey: "fixture", baseURL: "https://gateway.example/v1" }).model("llama"),
          prompt: "Use a tool.",
          generation: { maxTokens: 32 },
          tools: [
            ToolDefinition.make({ name: "lookup", description: "Look up data", inputSchema: { type: "object" } }),
          ],
          providerOptions: { store: true },
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
        LLM.request({
          model: Cerebras.configure({ apiKey: "fixture", baseURL: "https://gateway.example/v1" }).model("qwen"),
          generation: { maxTokens: 48 },
          messages: [
            Message.user("Think first."),
            Message.assistant([
              { type: "reasoning", text: "A deliberate thought." },
              { type: "text", text: "An answer." },
            ]),
            Message.user("Continue."),
          ],
          providerOptions: { store: true },
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

  it.effect("normalizes DeepInfra API roots without duplicating the OpenAI path", () =>
    Effect.gen(function* () {
      for (const baseURL of [
        "https://gateway.example/v1",
        "https://gateway.example/v1/",
        "https://gateway.example/v1/openai",
        "https://gateway.example/v1/openai/",
      ]) {
        expect(DeepInfra.configure({ apiKey: "fixture", baseURL }).model("gemma").route.endpoint.baseURL).toBe(
          "https://gateway.example/v1/openai",
        )
      }
    }),
  )

  it.effect("maps package settings onto native executable models", () =>
    Effect.gen(function* () {
      for (const native of [TogetherAI, Cerebras]) {
        const selected = native.model("provider-model", {
          apiKey: "fixture",
          baseURL: "https://gateway.example/v1",
          headers: { "x-application": "opencode" },
          body: { service_tier: "priority" },
          providerOptions: { reasoningEffort: "high" },
        })

        expect(selected.route.endpoint.baseURL).toBe("https://gateway.example/v1")
        expect(selected.route.defaults.headers).toEqual({ "x-application": "opencode" })
        expect(selected.route.defaults.http?.body).toEqual({ service_tier: "priority" })
        expect(selected.route.defaults.providerOptions).toEqual({ reasoningEffort: "high" })
      }
    }),
  )

  it.effect("resolves provider environment credentials and preserves deprecated Together credentials", () =>
    Effect.gen(function* () {
      const scenarios = [
        {
          model: TogetherAI.configure().model("llama"),
          env: { TOGETHER_API_KEY: "together-primary", TOGETHER_AI_API_KEY: "together-legacy" },
          token: "together-primary",
          url: "https://api.together.xyz/v1/chat/completions",
        },
        {
          model: TogetherAI.configure().model("llama"),
          env: { TOGETHER_AI_API_KEY: "together-legacy" },
          token: "together-legacy",
          url: "https://api.together.xyz/v1/chat/completions",
        },
        {
          model: Cerebras.configure().model("qwen"),
          env: { CEREBRAS_API_KEY: "cerebras-secret" },
          token: "cerebras-secret",
          url: "https://api.cerebras.ai/v1/chat/completions",
        },
        {
          model: DeepInfra.configure().model("gemma"),
          env: { DEEPINFRA_API_KEY: "deepinfra-secret" },
          token: "deepinfra-secret",
          url: "https://api.deepinfra.com/v1/openai/chat/completions",
        },
      ]

      yield* Effect.forEach(scenarios, (scenario) =>
        LLM.generate(LLM.request({ model: scenario.model, prompt: "Say hello." })).pipe(
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
