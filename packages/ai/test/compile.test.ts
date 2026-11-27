import { describe, expect, test } from "bun:test"
import { Effect, Ref, Schema } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/http"
import { ai, Message, ToolCallPart, ToolDefinition, ToolNamespace } from "../src/effect.js"
import {
  AnthropicMessages,
  BedrockConverse,
  CohereChat,
  Gemini,
  GoogleInteractions,
  MistralChat,
  OpenAIChat,
  OpenAICompatibleResponses,
  OpenAIResponses,
} from "../src/protocols.js"
import { Auth, LLMClient } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { mergeProviderOptions } from "../src/schema/index.js"
import { it } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"
import { deltaChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"
import { apiModel } from "./lib/model.js"

const TargetJson = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(TargetJson)

describe("request option precedence", () => {
  test("deep-merges provider option records and replaces arrays, primitives, and null", () => {
    const merged = mergeProviderOptions(
      {
        include: ["route"],
        metadata: { route: true, shared: "route" },
        nullable: "route",
        primitive: "route",
      },
      {
        include: ["model"],
        metadata: { model: true, shared: "model" },
        nullable: null,
        primitive: "model",
      },
      { metadata: { request: true }, primitive: false },
    )

    expect(merged).toEqual({
      include: ["model"],
      metadata: { route: true, model: true, request: true, shared: "model" },
      nullable: null,
      primitive: false,
    })
  })

  it.effect("compiles bodies with host defaults, model defaults, and call options in order", () =>
    Effect.gen(function* () {
      const api = OpenAIChat.api.configure({
        options: {
          maxTokens: 10,
          temperature: 1,
          stop: ["route"],
          providerOptions: { store: false, reasoningEffort: "low" },
        },
      })
      const model = apiModel(api, "gpt-4o-mini", {
        baseURL: "https://api.openai.test/v1/",
        auth: Auth.bearer("test"),
        options: {
          maxTokens: 20,
          temperature: 0.5,
          frequencyPenalty: 0.25,
          stop: ["model"],
          providerOptions: { reasoningEffort: "medium" },
        },
      })
      const prepared = yield* compileRequest(
        ai.request({
          model,
          prompt: "Say hello.",
          maxTokens: 30,
          topP: 0.9,
          stop: ["request"],
          providerOptions: { store: true },
        }),
      )

      expect(prepared.body).toMatchObject({
        model: "gpt-4o-mini",
        stream: true,
        max_completion_tokens: 30,
        temperature: 0.5,
        top_p: 0.9,
        frequency_penalty: 0.25,
        store: true,
        reasoning_effort: "medium",
      })
      expect(prepared.body.stop).toEqual(["request"])
    }),
  )

  it.effect("keeps the last tool definition for duplicate names", () =>
    Effect.gen(function* () {
      const request = ai.request({
        model: apiModel(OpenAIChat.api, "gpt-4o-mini", { baseURL: "https://api.openai.com/v1" }),
        prompt: "Use a tool.",
      })
      const prepared = yield* compileRequest({
        ...request,
        tools: [
          ToolDefinition.make({ name: "lookup", description: "old", inputSchema: { type: "object" } }),
          ToolDefinition.make({ name: "search", description: "search", inputSchema: { type: "object" } }),
          ToolDefinition.make({ name: "lookup", description: "new", inputSchema: { type: "object" } }),
        ],
      })

      expect(prepared.body.tools).toEqual([
        {
          type: "function",
          function: { name: "lookup", description: "new", parameters: { type: "object" }, strict: false },
        },
        {
          type: "function",
          function: { name: "search", description: "search", parameters: { type: "object" }, strict: false },
        },
      ])
    }),
  )

  it.effect("deduplicates tools within each namespace", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: apiModel(OpenAIResponses.api, "gpt-5.4", { baseURL: "https://api.openai.com/v1" }),
          prompt: "Hello",
          tools: [
            ToolDefinition.make({ name: "crm", description: "Top-level CRM tool", inputSchema: {} }),
            ToolNamespace.make({
              name: "crm",
              description: "CRM tools",
              tools: [
                ToolDefinition.make({ name: "lookup", description: "old", inputSchema: {} }),
                ToolDefinition.make({ name: "search", description: "search", inputSchema: {} }),
                ToolDefinition.make({ name: "lookup", description: "new", inputSchema: {} }),
              ],
            }),
            ToolNamespace.make({
              name: "support",
              description: "Support tools",
              tools: [ToolDefinition.make({ name: "lookup", description: "support", inputSchema: {} })],
            }),
          ],
        }),
      )

      expect(prepared.body.tools).toEqual([
        {
          type: "function",
          name: "crm",
          description: "Top-level CRM tool",
          parameters: { type: "object" },
          strict: false,
        },
        {
          type: "namespace",
          name: "crm",
          description: "CRM tools",
          tools: [
            { type: "function", name: "lookup", description: "new", parameters: { type: "object" }, strict: false },
            { type: "function", name: "search", description: "search", parameters: { type: "object" }, strict: false },
          ],
        },
        {
          type: "namespace",
          name: "support",
          description: "Support tools",
          tools: [
            { type: "function", name: "lookup", description: "support", parameters: { type: "object" }, strict: false },
          ],
        },
      ])
    }),
  )

  it.effect("forces a namespaced tool under its flattened name on flat protocols", () =>
    Effect.forEach(
      [
        [AnthropicMessages.api, "anthropic"],
        [BedrockConverse.api, "bedrock"],
        [CohereChat.api, "cohere"],
        [Gemini.api, "google"],
        [GoogleInteractions.api, "google"],
        [MistralChat.api, "mistral"],
        [OpenAIChat.api, "openai"],
        [OpenAICompatibleResponses.api, "custom"],
      ] as const,
      ([api, provider]) =>
        Effect.gen(function* () {
          const prepared = yield* compileRequest(
            ai.request({
              model: apiModel(api, "test-model", {
                provider,
                baseURL: "https://example.invalid/v1",
                auth: Auth.bearer("unused"),
              }),
              prompt: "Look up a customer",
              tools: [
                ToolNamespace.make({
                  name: "crm",
                  description: "CRM tools",
                  tools: [ToolDefinition.make({ name: "lookup", description: "Look up", inputSchema: {} })],
                }),
              ],
              toolChoice: "crm.lookup",
            }),
          )
          const body = JSON.stringify(prepared.body)
          expect(body).toContain("crm_lookup")
          expect(body).not.toContain("crm.lookup")
        }),
      { discard: true },
    ),
  )

  it.effect("flattens a forced choice only when it names a namespaced tool", () =>
    Effect.gen(function* () {
      const choose = (name: string) =>
        compileRequest(
          ai.request({
            model: apiModel(OpenAIChat.api, "gpt-4o-mini", { baseURL: "https://api.openai.com/v1" }),
            prompt: "Hi",
            tools: [
              ToolDefinition.make({ name: "foo_bar", description: "Top level", inputSchema: {} }),
              ToolNamespace.make({
                name: "crm",
                description: "CRM tools",
                tools: [ToolDefinition.make({ name: "customer.lookup", description: "Look up", inputSchema: {} })],
              }),
            ],
            toolChoice: name,
          }),
        ).pipe(Effect.map((prepared) => prepared.body.tool_choice))
      // A dotted leaf flattens as flattenTools names it.
      expect(yield* choose("crm.customer.lookup")).toEqual({
        type: "function",
        function: { name: "crm_customer.lookup" },
      })
      // A dotted name that isn't a namespaced tool is left for the provider to reject, not matched to foo_bar.
      expect(yield* choose("foo.bar")).toEqual({ type: "function", function: { name: "foo.bar" } })
    }),
  )

  it.effect("flattens a forced choice for a namespace a tool update adds", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: apiModel(AnthropicMessages.api, "claude-opus-5", {
            baseURL: "https://api.anthropic.test/v1/",
            provider: "anthropic",
            auth: Auth.bearer("unused"),
            capabilities: { tools: { updates: ["add", "remove", "replace"] } },
          }),
          messages: [
            Message.user("Hi"),
            Message.tools({
              add: [
                ToolNamespace.make({
                  name: "crm",
                  description: "CRM tools",
                  tools: [ToolDefinition.make({ name: "lookup", description: "Look up", inputSchema: {} })],
                }),
              ],
            }),
            Message.user("Look up a customer"),
          ],
          toolChoice: "crm.lookup",
        }),
      )
      expect(prepared.body.tool_choice).toMatchObject({ type: "tool", name: "crm_lookup" })
    }),
  )

  it.effect("flattens namespaces when a flat protocol's body is built directly", () =>
    Effect.gen(function* () {
      const body = yield* OpenAIChat.protocol.body.from(
        ai.request({
          model: apiModel(OpenAIChat.api, "gpt-4o-mini", { baseURL: "https://api.openai.com/v1" }),
          tools: [
            ToolNamespace.make({
              name: "crm",
              description: "CRM tools",
              tools: [ToolDefinition.make({ name: "lookup", description: "Look up", inputSchema: {} })],
            }),
          ],
          messages: [
            Message.user("Look up a customer"),
            Message.assistant(ToolCallPart.make({ id: "call_1", name: "lookup", namespace: "crm", input: {} })),
          ],
          toolChoice: "crm.lookup",
        }),
      )
      const json = JSON.stringify(body)
      expect(json).toContain("crm_lookup")
      expect(json).not.toContain("crm.lookup")
      expect(body.messages).toMatchObject([
        { role: "user" },
        { role: "assistant", tool_calls: [{ function: { name: "crm_lookup" } }] },
      ])
    }),
  )

  it.effect("normalizes tool history before protocol lowering", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: apiModel(OpenAIChat.api, "gpt-4o-mini", { baseURL: "https://api.openai.com/v1" }),
          messages: [
            Message.assistant(ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })),
            Message.user("Continue."),
          ],
        }),
      )

      expect(prepared.body.messages).toMatchObject([
        { role: "assistant", tool_calls: [{ id: "call_1", function: { name: "lookup" } }] },
        { role: "tool", tool_call_id: "call_1", content: "Tool result missing" },
        { role: "user", content: "Continue." },
      ])
    }),
  )

  it.effect("applies model HTTP defaults before request HTTP overlays", () =>
    LLMClient.generate(
      ai.request({
        model: apiModel(
          OpenAIChat.api.configure({
            options: {
              headers: { "x-route": "route", "x-shared": "route" },
              http: {
                body: { metadata: { route: true, shared: "route" }, value: "route" },
                query: { route: "1", shared: "route" },
              },
            },
          }),
          "gpt-4o-mini",
          {
            baseURL: "https://api.openai.test/v1/",
            auth: Auth.bearer("fresh-key"),
            options: {
              headers: { "x-model": "model", "x-shared": "model" },
              http: {
                body: { metadata: { model: true, shared: "model" }, value: "model" },
                query: { model: "1", shared: "model" },
              },
            },
          },
        ),
        prompt: "Say hello.",
        headers: { "x-request": "request" },
        http: { body: { metadata: { request: true }, value: null }, query: { request: "1" } },
      }),
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            expect(web.url).toBe("https://api.openai.test/v1/chat/completions?route=1&shared=model&model=1&request=1")
            expect(web.headers.get("authorization")).toBe("Bearer fresh-key")
            expect(web.headers.get("x-route")).toBe("route")
            expect(web.headers.get("x-model")).toBe("model")
            expect(web.headers.get("x-request")).toBe("request")
            expect(web.headers.get("x-shared")).toBe("model")
            expect(decodeJson(input.text)).toMatchObject({
              metadata: { route: true, model: true, request: true, shared: "model" },
              value: null,
            })
            return input.respond(sseEvents(deltaChunk({}, "stop")), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("transforms the final HTTP request after serialization and authentication", () =>
    LLMClient.generate(
      ai.request({
        model: apiModel(OpenAIChat.api, "gpt-4o-mini", {
          baseURL: "https://api.openai.test/v1/",
          auth: Auth.bearer("fresh-key"),
        }),
        prompt: "Say hello.",
      }),
      {
        http: (request, handler) =>
          Effect.gen(function* () {
            return yield* handler(
              request.pipe(
                HttpClientRequest.setUrl("https://proxy.test/v1/chat/completions"),
                HttpClientRequest.setMethod("PUT"),
                HttpClientRequest.setHeader("x-plugin", "transformed"),
                HttpClientRequest.bodyText(JSON.stringify({ transformed: true }), "application/custom+json"),
              ),
            )
          }),
      },
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            expect(web.url).toBe("https://proxy.test/v1/chat/completions")
            expect(web.method).toBe("PUT")
            expect(web.headers.get("x-plugin")).toBe("transformed")
            expect(web.headers.get("content-type")).toBe("application/custom+json")
            expect(decodeJson(input.text)).toEqual({ transformed: true })
            return input.respond(sseEvents(deltaChunk({}, "stop")), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("transforms the HTTP response before protocol decoding", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        ai.request({
          model: apiModel(OpenAIChat.api, "gpt-4o-mini", {
            baseURL: "https://api.openai.test/v1/",
            auth: Auth.bearer("test"),
          }),
          prompt: "Say hello.",
        }),
        {
          http: (request, handler) =>
            Effect.gen(function* () {
              const response = yield* handler(request)
              return HttpClientResponse.fromWeb(
                response.request,
                new Response((yield* response.text).replace("network", "hooked"), {
                  status: response.status,
                  headers: response.headers,
                }),
              )
            }),
        },
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.succeed(
              input.respond(sseEvents(deltaChunk({ content: "network" }, "stop")), {
                headers: { "content-type": "text/event-stream" },
              }),
            ),
          ),
        ),
      )

      expect(response.text).toBe("hooked")
    }),
  )

  it.effect("can inspect an error response and retry the native request", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const response = yield* LLMClient.generate(
        ai.request({
          model: apiModel(OpenAIChat.api, "gpt-4o-mini", {
            baseURL: "https://api.openai.test/v1/",
            auth: Auth.bearer("stale"),
          }),
          prompt: "Say hello.",
        }),
        {
          http: (request, handler) =>
            Effect.gen(function* () {
              const response = yield* handler(request)
              expect(response.status).toBe(401)
              return yield* handler(HttpClientRequest.setHeader(request, "authorization", "Bearer refreshed"))
            }),
        },
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              yield* Ref.update(attempts, (value) => value + 1)
              if (input.request.headers.authorization !== "Bearer refreshed")
                return input.respond("unauthorized", { status: 401 })
              return input.respond(sseEvents(deltaChunk({ content: "retried" }, "stop")), {
                headers: { "content-type": "text/event-stream" },
              })
            }),
          ),
        ),
      )

      expect(response.text).toBe("retried")
      expect(yield* Ref.get(attempts)).toBe(2)
    }),
  )

  it.effect("sanitizes outbound JSON without an HTTP overlay", () =>
    LLMClient.generate(
      ai.request({
        model: apiModel(OpenAIChat.api, "gpt-4o-mini", {
          baseURL: "https://api.openai.test/v1/",
          auth: Auth.bearer("test"),
        }),
        prompt: "hello \uD800 \u{1F600}",
      }),
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            expect(decodeJson(input.text)).toMatchObject({
              messages: [{ role: "user", content: "hello \uFFFD \u{1F600}" }],
            })
            return input.respond(sseEvents(deltaChunk({}, "stop")), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("sanitizes unpaired surrogates throughout outbound JSON", () =>
    LLMClient.generate(
      ai.request({
        model: apiModel(OpenAIChat.api, "gpt-4o-mini", {
          baseURL: "https://api.openai.test/v1/",
          auth: Auth.bearer("test"),
        }),
        system: "system \uD800 \u{1F600}",
        messages: [
          Message.user("user \uDC00"),
          Message.assistant([
            Message.text("assistant \uD800"),
            ToolCallPart.make({ id: "call_1", name: "lookup", input: { query: "input \uDC00" } }),
          ]),
          Message.tool({ id: "call_1", name: "lookup", result: { output: "result \uD800" } }),
        ],
        http: { body: { metadata: { "key\uD800": ["overlay \uDC00", "valid \u{1F600}"] } } },
      }),
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            expect(decodeJson(input.text)).toMatchObject({
              messages: [
                { role: "system", content: "system \uFFFD \u{1F600}" },
                { role: "user", content: "user \uFFFD" },
                {
                  role: "assistant",
                  content: "assistant \uFFFD",
                  tool_calls: [{ function: { arguments: '{"query":"input \uFFFD"}' } }],
                },
                { role: "tool", content: '{"output":"result \uFFFD"}' },
              ],
              metadata: { "key\uFFFD": ["overlay \uFFFD", "valid \u{1F600}"] },
            })
            return input.respond(sseEvents(deltaChunk({}, "stop")), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("applies raw body overlays after protocol lowering", () =>
    LLMClient.generate(
      ai.request({
        model: apiModel(OpenAIChat.api, "gpt-4o-mini", {
          baseURL: "https://api.openai.test/v1/",
          auth: Auth.bearer("test"),
        }),
        prompt: "Say hello.",
        http: { body: { model: "gpt-5", messages: [], tools: [] } },
      }),
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            expect(decodeJson(input.text)).toMatchObject({ model: "gpt-5", messages: [], tools: [] })
            return input.respond(sseEvents(deltaChunk({}, "stop")), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("uses the Anthropic default before call maxTokens", () =>
    Effect.gen(function* () {
      const model = apiModel(AnthropicMessages.api, "claude-sonnet-4-5", {
        provider: "anthropic",
        baseURL: "https://api.anthropic.test/v1/",
        auth: Auth.header("x-api-key", "test"),
      })
      const withoutMaxTokens = yield* compileRequest(ai.request({ model, prompt: "Say hello.", cache: "none" }))
      const withMaxTokens = yield* compileRequest(
        ai.request({ model, prompt: "Say hello.", cache: "none", maxTokens: 8_000 }),
      )

      expect(withoutMaxTokens.body.max_tokens).toBe(32_000)
      expect(withMaxTokens.body.max_tokens).toBe(8_000)
    }),
  )
})
