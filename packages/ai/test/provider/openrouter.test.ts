import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, Message } from "../../src/index.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import * as OpenRouter from "../../src/providers/openrouter.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

describe("OpenRouter", () => {
  it.effect("prepares OpenRouter models through the OpenAI-compatible Chat route", () =>
    Effect.gen(function* () {
      const model = OpenRouter.configure({ apiKey: "test-key" }).model("openai/gpt-4o-mini")

      expect(model).toMatchObject({
        id: "openai/gpt-4o-mini",
        provider: "openrouter",
        route: { id: "openrouter" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://openrouter.ai/api/v1")

      const prepared = yield* compileRequest(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("openrouter")
      expect(prepared.body).toMatchObject({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
        usage: { include: true },
      })
    }),
  )

  it.effect("lowers the native cache policy to OpenRouter cache controls", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          system: [
            { type: "text", text: "Base agent", cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3_600 }) },
            { type: "text", text: "Project instructions" },
          ],
          tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} } }],
          prompt: "Hello",
          cache: { tools: true, system: true, messages: { tail: 1 } },
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "system",
            content: [
              { text: "Base agent", cache_control: { type: "ephemeral", ttl: "1h" } },
              { text: "Project instructions", cache_control: { type: "ephemeral" } },
            ],
          },
          {
            role: "user",
            content: [{ text: "Hello", cache_control: { type: "ephemeral" } }],
          },
        ],
      })
    }),
  )

  it.effect("lowers manual assistant and tool-result cache hints", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          cache: "none",
          messages: [
            Message.user("Call the tool"),
            Message.assistant([
              { type: "text", text: "Calling", cache: new CacheHint({ type: "ephemeral" }) },
              { type: "tool-call", id: "call_1", name: "lookup", input: {} },
            ]),
            Message.tool({
              id: "call_1",
              name: "lookup",
              result: "Done",
              cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3_600 }),
            }),
          ],
        }),
      )

      expect(prepared.body.messages).toMatchObject([
        { role: "user", content: "Call the tool" },
        { role: "assistant", content: "Calling", cache_control: { type: "ephemeral" } },
        { role: "tool", content: '"Done"', cache_control: { type: "ephemeral", ttl: "1h" } },
      ])
    }),
  )

  it.effect("caps manual cache controls at four breakpoints", () =>
    Effect.gen(function* () {
      const cache = new CacheHint({ type: "ephemeral" })
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          cache: "none",
          system: [1, 2, 3, 4, 5].map((index) => ({ type: "text" as const, text: `System ${index}`, cache })),
          prompt: "Hello",
        }),
      )

      const system = prepared.body.messages[0]
      expect(system?.role).toBe("system")
      expect(
        system && Array.isArray(system.content)
          ? system.content.filter((part) => "cache_control" in part && part.cache_control !== undefined)
          : [],
      ).toHaveLength(4)
    }),
  )

  it.effect("preserves cache policy hints on reasoning-only assistant messages", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          cache: { messages: "latest-assistant" },
          messages: [Message.user("Think"), Message.assistant([{ type: "reasoning", text: "Reasoning" }])],
        }),
      )

      expect(prepared.body.messages).toMatchObject([
        { role: "user", content: "Think" },
        { role: "assistant", cache_control: { type: "ephemeral" } },
      ])
    }),
  )

  it.effect("allows usage accounting to be disabled explicitly", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: { openrouter: { usage: false } },
          }).model("openai/gpt-4o-mini"),
          cache: "none",
          prompt: "Hello",
        }),
      )

      expect(prepared.body.usage).toEqual({ include: false })
    }),
  )

  it.effect("applies OpenRouter payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: {
              openrouter: {
                usage: true,
                reasoning: { effort: "high" },
                models: ["anthropic/claude-sonnet-4.6", "google/gemini-3.1-pro"],
                provider: { order: ["anthropic", "google"], require_parameters: true },
                plugins: [{ id: "response-healing" }],
                web_search_options: { engine: "native", max_results: 3 },
                debug: { echo_upstream_body: true },
                user: "user_123",
                future_option: { enabled: true },
              },
            },
          }).model("anthropic/claude-3.7-sonnet:thinking"),
          prompt: "Think briefly.",
          promptCacheKey: "session_123",
        }),
      )

      expect(prepared.body).toMatchObject({
        usage: { include: true },
        reasoning: { effort: "high" },
        prompt_cache_key: "session_123",
        models: ["anthropic/claude-sonnet-4.6", "google/gemini-3.1-pro"],
        provider: { order: ["anthropic", "google"], require_parameters: true },
        plugins: [{ id: "response-healing" }],
        web_search_options: { engine: "native", max_results: 3 },
        debug: { echo_upstream_body: true },
        user: "user_123",
        future_option: { enabled: true },
      })
    }),
  )

  it.effect("filters invalid known OpenRouter options while preserving extensions", () =>
    Effect.gen(function* () {
      const invalid: Record<string, unknown> = {
        usage: "yes",
        models: "anthropic/claude-sonnet-4.6",
        provider: [],
        plugins: {},
        web_search_options: [],
        debug: [],
        user: 123,
        reasoning: [],
        promptCacheKey: 123,
        future_option: { enabled: true },
      }
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: { openrouter: invalid },
          }).model("openai/gpt-4o-mini"),
          prompt: "Hello",
        }),
      )

      expect(prepared.body).toMatchObject({ future_option: { enabled: true } })
      expect(prepared.body).not.toHaveProperty("usage")
      expect(prepared.body).not.toHaveProperty("models")
      expect(prepared.body).not.toHaveProperty("provider")
      expect(prepared.body).not.toHaveProperty("plugins")
      expect(prepared.body).not.toHaveProperty("web_search_options")
      expect(prepared.body).not.toHaveProperty("debug")
      expect(prepared.body).not.toHaveProperty("user")
      expect(prepared.body).not.toHaveProperty("reasoning")
      expect(prepared.body).not.toHaveProperty("prompt_cache_key")
    }),
  )

  it.effect("preserves the upstream provider finish reason", () =>
    Effect.gen(function* () {
      const model = OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              choices: [{ delta: { content: "Hello" }, finish_reason: "stop", native_finish_reason: "end_turn" }],
            }),
          ),
        ),
      )

      expect(response.finishReason).toEqual({ normalized: "stop", raw: "end_turn" })
    }),
  )

  it.effect("reports OpenRouter's streamed USD cost", () =>
    Effect.gen(function* () {
      const model = OpenRouter.configure({ apiKey: "test-key" }).model("openai/gpt-4o-mini")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.00123 },
            }),
          ),
        ),
      )

      expect(response.usage?.cost).toBe(0.00123)
    }),
  )

  it.effect("fails on a mid-stream provider error", () =>
    Effect.gen(function* () {
      const model = OpenRouter.configure({ apiKey: "test-key" }).model("openai/gpt-4o-mini")
      const error = yield* LLMClient.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              error: { code: 502, message: "Provider disconnected" },
            }),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "ProviderInternal" })
      expect(error.message).toContain("Provider disconnected")
    }),
  )

  it.effect("preserves manually supplied reasoning details", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", text: "Think", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", text: "ing", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", signature: "signed", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.encrypted", data: "opaque", format: "openai-responses-v1", index: 1 },
      ]
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          cache: "none",
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "Thinking",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        {
          role: "assistant",
          content: null,
          reasoning: "Thinking",
          reasoning_details: details,
        },
      ])
    }),
  )

  it.effect("preserves opaque and duplicate continuation details", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.future", format: "provider-v2", state: { opaque: true } },
        { type: "reasoning.encrypted", id: "state", data: "opaque" },
        { type: "reasoning.encrypted", id: "state", data: "opaque" },
      ]
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          cache: "none",
          messages: [
            Message.assistant({
              type: "reasoning",
              text: "Thinking",
              providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
            }),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: null, reasoning: "Thinking", reasoning_details: details },
      ])
    }),
  )

  it.effect("does not merge distinct adjacent reasoning text blocks", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", id: "first", index: 0, text: "A", opaque: "first" },
        { type: "reasoning.text", id: "second", index: 1, text: "B", opaque: "second" },
      ]
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          cache: "none",
          messages: [
            Message.assistant({
              type: "reasoning",
              text: "AB",
              providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
            }),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: null, reasoning: "AB", reasoning_details: details },
      ])
    }),
  )

  it.effect("omits scalar reasoning without continuation details", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          cache: "none",
          messages: [Message.assistant({ type: "reasoning", text: "Thinking" })],
        }),
      )

      expect(prepared.body.messages).toEqual([{ role: "assistant", content: null }])
    }),
  )
})
