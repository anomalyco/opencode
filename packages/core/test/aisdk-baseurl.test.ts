import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { AIError, LLM, LanguageModel, Message } from "@opencode/ai"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { HttpClientRequest } from "effect/http"
import { expect } from "bun:test"
import { Effect, Layer, Result } from "effect"
import { AISDK } from "../src/aisdk"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { testEffect } from "./lib/effect"

const it = testEffect(AISDK.locationLayer)
const client = LLMClient.layer.pipe(
  Layer.provide(
    Layer.succeed(
      RequestExecutor.Service,
      RequestExecutor.Service.of({ execute: () => Effect.die("Unexpected native HTTP request") }),
    ),
  ),
)
const chunk =
  'data: {"id":"r","object":"chat.completion.chunk","created":0,"model":"api-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'

// Returning the original route from AISDK.route.with must fail the overridden cases.
for (const baseURL of [
  undefined,
  "https://replacement.example.invalid/v1",
  "https://replacement.example.invalid/custom/v2/",
]) {
  it.effect(`keeps the AI SDK request endpoint local to the model route: ${baseURL ?? "unchanged"}`, () =>
    Effect.gen(function* () {
      const sent: string[] = []
      const aisdk = yield* AISDK.Service
      yield* aisdk.hook.sdk((event) => {
        event.sdk = createOpenAICompatible({
          ...event.options,
          name: String(event.options.name),
          baseURL: String(event.options.baseURL),
        })
      })
      const resolved = yield* aisdk.model({
        ...Model.Info.make({
          ...Model.Info.default(Provider.ID.make("probe"), Model.ID.make("api-model")),
          package: Provider.aisdk("@ai-sdk/openai-compatible"),
        }),
        settings: {
          baseURL: "https://original.example.invalid/v1",
          apiKey: "test",
          fetch: Object.assign(
            async (input: string | URL | Request) => {
              sent.push(input instanceof Request ? input.url : String(input))
              return new Response(chunk, { headers: { "content-type": "text/event-stream" } })
            },
            { preconnect: fetch.preconnect },
          ),
        },
      })
      const selected =
        baseURL === undefined
          ? resolved
          : LanguageModel.update(resolved, {
              route: resolved.route.with({ endpoint: { baseURL } }),
            })
      yield* LLMClient.generate(LLM.request({ model: selected, messages: [Message.user("hello")] })).pipe(
        Effect.provide(client),
      )
      yield* LLMClient.generate(LLM.request({ model: resolved, messages: [Message.user("control")] })).pipe(
        Effect.provide(client),
      )
      expect(sent).toEqual([
        `${(baseURL ?? "https://original.example.invalid/v1").replace(/\/$/, "")}/chat/completions`,
        "https://original.example.invalid/v1/chat/completions",
      ])
    }),
  )
}

it.effect("caches overridden endpoints separately while retaining SDK and request hooks", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const loaded: string[] = []
    const sent: Array<{ url: string; headers: Headers }> = []
    yield* aisdk.hook.sdk((event) => {
      loaded.push(String(event.options.baseURL))
      event.sdk = createOpenAICompatible({
        ...event.options,
        name: String(event.options.name),
        baseURL: String(event.options.baseURL),
      })
    })
    const original = yield* aisdk.model({
      ...Model.Info.make({
        ...Model.Info.default(Provider.ID.make("probe"), Model.ID.make("api-model")),
        package: Provider.aisdk("@ai-sdk/openai-compatible"),
      }),
      headers: { "x-config": "retained" },
      settings: {
        baseURL: "https://original.example.invalid/v1",
        apiKey: "test",
        fetch: Object.assign(
          async (input: string | URL | Request, init?: RequestInit) => {
            sent.push({
              url: input instanceof Request ? input.url : String(input),
              headers: new Headers(init?.headers),
            })
            return new Response(chunk, { headers: { "content-type": "text/event-stream" } })
          },
          { preconnect: fetch.preconnect },
        ),
      },
    })
    const first = LanguageModel.update(original, {
      route: original.route.with({ endpoint: { baseURL: "https://first.example.invalid/v2" } }),
    })
    const second = LanguageModel.update(first, {
      route: first.route.with({ endpoint: { baseURL: "https://second.example.invalid/v3" } }),
    })
    for (const selected of [first, second, first, original]) {
      yield* LLMClient.generate(LLM.request({ model: selected, prompt: "hello" }), {
        http: (request, handler) => handler(HttpClientRequest.setHeader(request, "x-hook", "retained")),
      }).pipe(Effect.provide(client))
    }
    expect(loaded).toEqual([
      "https://original.example.invalid/v1",
      "https://first.example.invalid/v2",
      "https://second.example.invalid/v3",
    ])
    expect(sent.map((request) => request.url)).toEqual([
      "https://first.example.invalid/v2/chat/completions",
      "https://second.example.invalid/v3/chat/completions",
      "https://first.example.invalid/v2/chat/completions",
      "https://original.example.invalid/v1/chat/completions",
    ])
    expect(sent.every((request) => request.headers.get("authorization") === "Bearer test")).toBe(true)
    expect(sent.every((request) => request.headers.get("x-config") === "retained")).toBe(true)
    expect(sent.every((request) => request.headers.get("x-hook") === "retained")).toBe(true)
  }),
)

it.effect("overrides an SDK default endpoint and reruns language hooks without changing the original", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const sent: string[] = []
    const languages: unknown[] = []
    yield* aisdk.hook.sdk((event) => {
      event.sdk = createOpenAICompatible({
        ...event.options,
        name: String(event.options.name),
        baseURL: String(event.options.baseURL ?? "https://default.example.invalid/v1"),
      })
    })
    yield* aisdk.hook.language((event) => {
      languages.push(event.model.settings?.baseURL)
    })
    const original = yield* aisdk.model({
      ...Model.Info.make({
        ...Model.Info.default(Provider.ID.make("probe"), Model.ID.make("api-model")),
        package: Provider.aisdk("@ai-sdk/openai-compatible"),
      }),
      settings: {
        fetch: Object.assign(
          async (input: string | URL | Request) => {
            sent.push(input instanceof Request ? input.url : String(input))
            return new Response(chunk, { headers: { "content-type": "text/event-stream" } })
          },
          { preconnect: fetch.preconnect },
        ),
      },
    })
    const changed = LanguageModel.update(original, {
      route: original.route.with({ endpoint: { baseURL: "https://override.example.invalid/v2" } }),
    })
    for (const selected of [changed, original]) {
      yield* LLMClient.generate(LLM.request({ model: selected, prompt: "hello" })).pipe(Effect.provide(client))
    }
    expect(languages).toEqual([undefined, "https://override.example.invalid/v2"])
    expect(sent).toEqual([
      "https://override.example.invalid/v2/chat/completions",
      "https://default.example.invalid/v1/chat/completions",
    ])
  }),
)

it.effect("reports overridden SDK initialization failures without poisoning the original model", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const sent: string[] = []
    yield* aisdk.hook.sdk((event) => {
      if (event.options.baseURL === "https://broken.example.invalid/v2") throw new Error("SDK initialization failed")
      event.sdk = createOpenAICompatible({
        ...event.options,
        name: String(event.options.name),
        baseURL: String(event.options.baseURL),
      })
    })
    const original = yield* aisdk.model({
      ...Model.Info.make({
        ...Model.Info.default(Provider.ID.make("probe"), Model.ID.make("api-model")),
        package: Provider.aisdk("@ai-sdk/openai-compatible"),
      }),
      settings: {
        baseURL: "https://original.example.invalid/v1",
        fetch: Object.assign(
          async (input: string | URL | Request) => {
            sent.push(input instanceof Request ? input.url : String(input))
            return new Response(chunk, { headers: { "content-type": "text/event-stream" } })
          },
          { preconnect: fetch.preconnect },
        ),
      },
    })
    const changed = LanguageModel.update(original, {
      route: original.route.with({ endpoint: { baseURL: "https://broken.example.invalid/v2" } }),
    })
    const result = yield* LLMClient.generate(LLM.request({ model: changed, prompt: "hello" })).pipe(
      Effect.provide(client),
      Effect.result,
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(AIError)
    expect(sent).toEqual([])
    yield* LLMClient.generate(LLM.request({ model: original, prompt: "control" })).pipe(Effect.provide(client))
    expect(sent).toEqual(["https://original.example.invalid/v1/chat/completions"])
  }),
)
