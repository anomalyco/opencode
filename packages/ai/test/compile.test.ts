import { describe, expect, test } from "bun:test"
import { Effect, Ref, Schema } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LLM, mergeProviderOptions } from "../src/index.js"
import { AnthropicMessages, OpenAIChat } from "../src/protocols.js"
import { Auth, LLMClient } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { it } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"
import { deltaChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"

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

  it.effect("compiles bodies with route defaults, model defaults, and call options in order", () =>
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({
        endpoint: { baseURL: "https://api.openai.test/v1/" },
        auth: Auth.bearer("test"),
        generation: { maxTokens: 10, temperature: 1, stop: ["route"] },
        providerOptions: { store: false, reasoningEffort: "low" },
      })
      const model = route.model({
        id: "gpt-4o-mini",
        defaults: {
          generation: { maxTokens: 20, temperature: 0.5, frequencyPenalty: 0.25, stop: ["model"] },
          providerOptions: { reasoningEffort: "medium" },
        },
      })
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Say hello.",
          generation: { maxTokens: 30, topP: 0.9, stop: ["request"] },
          providerOptions: { store: true },
        }),
      )

      expect(prepared.body).toMatchObject({
        model: "gpt-4o-mini",
        stream: true,
        max_tokens: 30,
        temperature: 0.5,
        top_p: 0.9,
        frequency_penalty: 0.25,
        store: true,
        reasoning_effort: "medium",
      })
      expect(prepared.body.stop).toEqual(["request"])
    }),
  )

  it.effect("applies model HTTP defaults before request HTTP overlays", () =>
    LLMClient.generate(
      LLM.request({
        model: OpenAIChat.route
          .with({
            endpoint: { baseURL: "https://api.openai.test/v1/" },
            auth: Auth.bearer("fresh-key"),
            http: {
              body: { metadata: { route: true, shared: "route" }, value: "route" },
              headers: { "x-route": "route", "x-shared": "route" },
              query: { route: "1", shared: "route" },
            },
          })
          .model({
            id: "gpt-4o-mini",
            defaults: {
              http: {
                body: { metadata: { model: true, shared: "model" }, value: "model" },
                headers: { "x-model": "model", "x-shared": "model" },
                query: { model: "1", shared: "model" },
              },
            },
          }),
        prompt: "Say hello.",
        http: {
          body: { metadata: { request: true }, value: null },
          headers: { "x-request": "request" },
          query: { request: "1" },
        },
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
      LLM.request({
        model: OpenAIChat.route
          .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("fresh-key") })
          .model({ id: "gpt-4o-mini" }),
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
        LLM.request({
          model: OpenAIChat.route
            .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
            .model({ id: "gpt-4o-mini" }),
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
        LLM.request({
          model: OpenAIChat.route
            .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("stale") })
            .model({ id: "gpt-4o-mini" }),
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

  it.effect("applies raw body overlays after protocol lowering", () =>
    LLMClient.generate(
      LLM.request({
        model: OpenAIChat.route
          .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
          .model({ id: "gpt-4o-mini" }),
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

  it.effect("uses model output limits after route limits and before call maxTokens", () =>
    Effect.gen(function* () {
      const route = AnthropicMessages.route.with({
        endpoint: { baseURL: "https://api.anthropic.test/v1/" },
        auth: Auth.header("x-api-key", "test"),
        limits: { output: 128 },
      })
      const model = route.model({ id: "claude-sonnet-4-5", defaults: { limits: { output: 64 } } })
      const withoutMaxTokens = yield* compileRequest(LLM.request({ model, prompt: "Say hello.", cache: "none" }))
      const withMaxTokens = yield* compileRequest(
        LLM.request({ model, prompt: "Say hello.", cache: "none", generation: { maxTokens: 32 } }),
      )

      expect(withoutMaxTokens.body.max_tokens).toBe(64)
      expect(withMaxTokens.body.max_tokens).toBe(32)
    }),
  )
})
