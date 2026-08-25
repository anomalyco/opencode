import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, LLMRequest, Message, ToolCallPart, ToolChoice, ToolDefinition } from "../../src/index.js"
import { Auth, LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import * as OpenAICompatible from "../../src/providers/openai-compatible.js"
import * as OpenAICompatibleChat from "../../src/protocols/openai-compatible-chat.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)

const model = OpenAICompatibleChat.route
  .with({
    provider: "deepseek",
    endpoint: { baseURL: "https://api.deepseek.test/v1/", query: { "api-version": "2026-01-01" } },
    auth: Auth.bearer("test-key"),
  })
  .model({ id: "deepseek-chat" })

const request = LLM.request({
  id: "req_1",
  model,
  system: "You are concise.",
  prompt: "Say hello.",
  generation: { maxTokens: 20, temperature: 0 },
})

const deltaChunk = (delta: object, finishReason: string | null = null) => ({
  id: "chatcmpl_fixture",
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

const usageChunk = (usage: object) => ({
  id: "chatcmpl_fixture",
  choices: [],
  usage,
})

const providerFamilies = [
  ["baseten", OpenAICompatible.baseten, "https://inference.baseten.co/v1"],
  ["cerebras", OpenAICompatible.cerebras, "https://api.cerebras.ai/v1"],
  ["deepinfra", OpenAICompatible.deepinfra, "https://api.deepinfra.com/v1/openai"],
  ["deepseek", OpenAICompatible.deepseek, "https://api.deepseek.com/v1"],
  ["fireworks", OpenAICompatible.fireworks, "https://api.fireworks.ai/inference/v1"],
  ["togetherai", OpenAICompatible.togetherai, "https://api.together.xyz/v1"],
] as const

describe("OpenAI-compatible Chat route", () => {
  it.effect("prepares generic Chat target", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
          toolChoice: ToolChoice.make({ type: "required" }),
        }),
      )

      expect(prepared.route).toBe("openai-compatible-chat")
      expect(prepared.model).toMatchObject({
        id: "deepseek-chat",
        provider: "deepseek",
        route: { id: "openai-compatible-chat" },
      })
      expect(prepared.model.route.endpoint).toMatchObject({
        baseURL: "https://api.deepseek.test/v1/",
        query: { "api-version": "2026-01-01" },
      })
      expect(prepared.body).toMatchObject({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Say hello." },
        ],
        tools: [
          {
            type: "function",
            function: { name: "lookup", description: "Lookup data", parameters: { type: "object" }, strict: false },
          },
        ],
        tool_choice: "required",
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("provides model helpers for compatible provider families", () =>
    Effect.gen(function* () {
      expect(
        providerFamilies.map(([provider, family]) => {
          const model = family.configure({ apiKey: "test-key" }).model(`${provider}-model`)
          return {
            id: String(model.id),
            provider: String(model.provider),
            route: model.route.id,
            baseURL: model.route.endpoint.baseURL,
          }
        }),
      ).toEqual(
        providerFamilies.map(([provider, _, baseURL]) => ({
          id: `${provider}-model`,
          provider,
          route: "openai-compatible-chat",
          baseURL,
        })),
      )

      const custom = OpenAICompatible.deepseek
        .configure({
          apiKey: "test-key",
          baseURL: "https://custom.deepseek.test/v1",
        })
        .model("deepseek-chat")
      expect(custom).toMatchObject({
        provider: "deepseek",
        route: { id: "openai-compatible-chat" },
      })
      expect(custom.route.endpoint.baseURL).toBe("https://custom.deepseek.test/v1")
    }),
  )

  it.effect("matches AI SDK compatible basic request body fixture", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(request)

      expect(prepared.body).toMatchObject({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Say hello." },
        ],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("configures the max tokens request field", () =>
    Effect.gen(function* () {
      const compatible = OpenAICompatibleChat.route
        .with({ provider: "custom", endpoint: { baseURL: "https://api.custom.test/v1" } })
        .model({ id: "custom-model", compatibility: { maxTokensField: "max_completion_tokens" } })
      const prepared = yield* compileRequest(
        LLM.request({ model: compatible, prompt: "Say hello.", generation: { maxTokens: 20 } }),
      )

      expect(prepared.body).toMatchObject({ max_completion_tokens: 20 })
      expect(prepared.body).not.toHaveProperty("max_tokens")
    }),
  )

  it.effect("enables ZAI tool streaming except for GLM 4.5 models", () =>
    Effect.gen(function* () {
      const prepare = (provider: string, baseURL: string, id: string) =>
        compileRequest(
          LLM.request({
            model: OpenAICompatibleChat.route.with({ provider, endpoint: { baseURL } }).model({ id }),
            prompt: "Use a tool.",
            tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: {} })],
          }),
        )

      const current = yield* prepare("zai", "https://api.z.ai/api/paas/v4", "glm-4.7")
      expect(current.body).toMatchObject({ tool_stream: true })

      const legacy = yield* Effect.all(
        ["glm-4.5", "glm-4.5-air", "glm-4.5-flash", "glm-4.5v"].map((id) =>
          prepare("zhipuai", "https://open.bigmodel.cn/api/paas/v4", id),
        ),
      )
      legacy.forEach((item) => expect(item.body).not.toHaveProperty("tool_stream"))
    }),
  )

  it.effect("matches AI SDK compatible tool request body fixture", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_parity",
          model,
          tools: [
            {
              name: "lookup",
              description: "Lookup data",
              inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
            },
          ],
          toolChoice: "lookup",
          messages: [
            Message.user("What is the weather?"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: { query: "weather" } })]),
            Message.tool({ id: "call_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        model: "deepseek-chat",
        messages: [
          { role: "user", content: "What is the weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: '{"query":"weather"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: '{"forecast":"sunny"}' },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "lookup",
              description: "Lookup data",
              parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
              strict: false,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "lookup" } },
        stream: true,
        stream_options: { include_usage: true },
      })
    }),
  )

  it.effect("bridges tool results for Mistral-family models and honors compatibility overrides", () =>
    Effect.gen(function* () {
      const cases = [
        { id: "mistral-small", bridge: true },
        { id: "devstral-small", bridge: true },
        { id: "codestral-latest", bridge: true },
        { id: "pixtral-large", bridge: true },
        { id: "open-mixtral-8x22b", bridge: true },
        { id: "ordinary-model", bridge: false },
        { id: "ordinary-model", override: true, bridge: true },
        { id: "mistral-small", override: false, bridge: false },
      ] as const

      yield* Effect.forEach(cases, (item) =>
        Effect.gen(function* () {
          const selected = OpenAICompatibleChat.route
            .with({ provider: "custom", endpoint: { baseURL: "https://api.custom.test/v1" } })
            .model({
              id: item.id,
              compatibility: "override" in item ? { requireAssistantAfterTool: item.override } : undefined,
            })
          const prepared = yield* compileRequest(
            LLM.request({
              model: selected,
              messages: [
                Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })]),
                Message.tool({ id: "call_1", name: "lookup", result: "Sunny" }),
                Message.user("What next?"),
              ],
            }),
          )

          expect(prepared.body.messages.map((message) => message.role)).toEqual(
            item.bridge ? ["assistant", "tool", "assistant", "user"] : ["assistant", "tool", "user"],
          )
          if (item.bridge) expect(prepared.body.messages[2]).toEqual({ role: "assistant", content: "Done." })
        }),
      )
    }),
  )

  it.effect("posts to the configured compatible endpoint and parses text usage", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe("https://api.deepseek.test/v1/chat/completions?api-version=2026-01-01")
              expect(web.headers.get("authorization")).toBe("Bearer test-key")
              expect(decodeJson(input.text)).toMatchObject({
                model: "deepseek-chat",
                stream: true,
                messages: [
                  { role: "system", content: "You are concise." },
                  { role: "user", content: "Say hello." },
                ],
              })
              return input.respond(
                sseEvents(
                  deltaChunk({ role: "assistant", content: "Hello" }),
                  deltaChunk({ content: "!" }),
                  deltaChunk({}, "stop"),
                  usageChunk({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }),
                ),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Hello!")
      expect(response.usage).toMatchObject({ inputTokens: 5, outputTokens: 2, totalTokens: 7 })
      expect(response.events.at(-1)).toMatchObject({
        type: "finish",
        reason: { normalized: "stop", raw: "stop" },
      })
    }),
  )

  it.effect("accepts nullable usage and preserves provider fields", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              deltaChunk({ content: "Hello" }),
              deltaChunk({}, "stop"),
              usageChunk({
                prompt_tokens: null,
                completion_tokens: null,
                total_tokens: null,
                prompt_tokens_details: { cached_tokens: null, vendor_cache_tokens: 3 },
                completion_tokens_details: {
                  reasoning_tokens: null,
                  accepted_prediction_tokens: null,
                  rejected_prediction_tokens: null,
                },
                cost: "0.001",
              }),
            ),
          ),
        ),
      )

      expect(response.usage).toMatchObject({
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
        providerMetadata: {
          openai: {
            prompt_tokens: null,
            completion_tokens: null,
            total_tokens: null,
            prompt_tokens_details: { cached_tokens: null, vendor_cache_tokens: 3 },
            cost: "0.001",
          },
        },
      })
    }),
  )

  it.effect("assembles indexless parallel tool calls across sparse chunks", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [
            ToolDefinition.make({ name: "weather", description: "Get weather", inputSchema: { type: "object" } }),
          ],
        }),
      ).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              deltaChunk({
                tool_calls: [
                  { id: "call_paris", function: { name: "weather", arguments: '{"city":"' } },
                  { index: null, id: "call_london", function: { name: "weather", arguments: '{"city":"' } },
                ],
              }),
              deltaChunk({ tool_calls: [{ function: { arguments: 'London"}' } }] }),
              deltaChunk({ tool_calls: [{ id: "call_paris", function: { arguments: 'Paris"}' } }] }),
              deltaChunk({}, "tool_calls"),
            ),
          ),
        ),
      )

      expect(response.toolCalls).toMatchObject([
        { id: "call_paris", name: "weather", input: { city: "Paris" } },
        { id: "call_london", name: "weather", input: { city: "London" } },
      ])
    }),
  )

  it.effect("rejects a stream without a required finish reason", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents(deltaChunk({ content: "Hello" }), deltaChunk({}, "")))),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        classification: "incomplete-stream",
        message: "OpenAI Chat stream ended without finish_reason",
      })
    }),
  )

  it.effect("infers stop when finish reasons are optional", () =>
    Effect.gen(function* () {
      const compatible = OpenAICompatibleChat.route
        .with({ provider: "custom", endpoint: { baseURL: "https://api.custom.test/v1" } })
        .model({ id: "custom-model", compatibility: { requireFinishReason: false } })
      const response = yield* LLMClient.generate(LLMRequest.update(request, { model: compatible })).pipe(
        Effect.provide(fixedResponse(sseEvents(deltaChunk({ content: "Hello" }), deltaChunk({}, "")))),
      )

      expect(response.finishReason).toEqual({ normalized: "stop" })
    }),
  )

  it.effect("normalizes the end finish reason to stop", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents(deltaChunk({ content: "Hello" }), deltaChunk({}, "end")))),
      )

      expect(response.finishReason).toEqual({ normalized: "stop", raw: "end" })
    }),
  )

  it.effect("classifies provider error finish reasons", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents(deltaChunk({}, "network_error")))),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({
        _tag: "ProviderInternal",
        message: "Provider reported a network error (finish_reason: network_error)",
      })
      expect(decodeJson(error.body ?? "")).toMatchObject({
        id: "chatcmpl_fixture",
        choices: [{ finish_reason: "network_error" }],
      })

      const generic = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents(deltaChunk({}, "error")))),
        Effect.flip,
      )
      expect(generic.reason).toMatchObject({
        _tag: "UnknownProvider",
        message: "Provider reported an error (finish_reason: error)",
      })
    }),
  )

  it.effect("preserves explicit provider error events", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              id: "chatcmpl_error",
              error: { code: 502, message: "Provider disconnected", details: { upstream: "vendor" } },
              trace_id: "trace_1",
            }),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "ProviderInternal", message: "Provider disconnected", status: 502 })
      expect(decodeJson(error.body ?? "")).toMatchObject({
        id: "chatcmpl_error",
        error: { code: 502, message: "Provider disconnected", details: { upstream: "vendor" } },
        trace_id: "trace_1",
      })
    }),
  )

  it.effect("preserves provider finish outcomes in the common reason algebra", () =>
    Effect.gen(function* () {
      const filtered = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents(deltaChunk({}, "content_filter")))),
      )
      const future = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents(deltaChunk({}, "future_reason")))),
      )

      expect(filtered.finishReason).toEqual({ normalized: "content-filter", raw: "content_filter" })
      expect(future.finishReason).toEqual({ normalized: "unknown", raw: "future_reason" })
    }),
  )

  it.effect("rejects content after a terminal chunk", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              deltaChunk({ content: "Hello" }),
              deltaChunk({}, "stop"),
              deltaChunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{}" } }] }),
            ),
          ),
        ),
        Effect.flip,
      )

      expect(error.message).toContain("OpenAI Chat received content after the finish reason")
      expect(error.reason._tag).toBe("InvalidProviderOutput")
      if (error.reason._tag !== "InvalidProviderOutput") return
      expect(decodeJson(error.reason.raw ?? "")).toMatchObject({
        choices: [{ delta: { tool_calls: [{ id: "call_1" }] } }],
      })
    }),
  )
})
