import { APICallError } from "@ai-sdk/provider"
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { AISDK } from "@opencode/core/aisdk"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import {
  Media,
  LLM,
  AIError,
  CompactionPart,
  ProviderID,
  HttpContext,
  InvalidRequestError,
  LLMEvent,
  Message,
  RateLimitError,
  TransportError,
  UnknownProviderError,
  isContextOverflowFailure,
} from "@opencode/ai"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { compileRequest, streamRequest } from "@opencode/ai/route/client"
import { expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { testEffect } from "./lib/effect"

const it = testEffect(AISDK.locationLayer)

const model = (packageName: string, settings: Provider.Settings = {}): Model.RuntimeInfo => ({
  ...Model.Info.make({
    ...Model.Info.default(Provider.ID.make("test-provider"), Model.ID.make("catalog-model")),
    modelID: Model.ID.make("api-model"),
    package: Provider.aisdk(packageName),
    limit: { context: 100, output: 20 },
  }),
  settings,
})

const streamModel = (events: ReadonlyArray<LanguageModelV3StreamPart>): LanguageModelV3 => ({
  specificationVersion: "v3",
  provider: "test",
  modelId: "test",
  supportedUrls: {},
  doGenerate: () => Promise.reject(new Error("Unexpected non-streaming request")),
  doStream: () =>
    Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          events.forEach((event) => controller.enqueue(event))
          controller.close()
        },
      }),
    }),
})

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 0, reasoning: 0 },
} as const

const client = LLMClient.layer.pipe(
  Layer.provide(
    Layer.succeed(
      RequestExecutor.Service,
      RequestExecutor.Service.of({
        execute: () => Effect.die("Unexpected HTTP request"),
      }),
    ),
  ),
)

it.effect("rejects native provider compaction rather than silently dropping replay state", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => streamModel([]) }
    })
    const resolved = yield* aisdk.model(model("@ai-sdk/openai"))
    const error = yield* compileRequest(
      LLM.request({
        model: resolved,
        messages: [
          Message.assistant(
            CompactionPart.make({
              provider: ProviderID.make("test-provider"),
              encrypted: "opaque",
            }),
          ),
        ],
      }),
    ).pipe(Effect.flip)
    expect(error.reason._tag).toBe("UnsupportedOperation")
    expect(error.message).toContain("cannot replay")
    if (error.reason._tag === "UnsupportedOperation") expect(error.reason.operation).toBe("compaction-replay")
  }),
)

it.effect("keys language models by package and flattened overlays", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const loaded: string[] = []
    yield* aisdk.hook.sdk((event) => {
      loaded.push(event.package)
      event.sdk = { languageModel: () => ({ package: event.package }) }
    })

    const first = yield* aisdk.language(model("first", { region: "us-east-1" }))
    const second = yield* aisdk.language(model("second", { region: "us-east-1" }))
    const third = yield* aisdk.language(model("second", { region: "us-west-2" }))

    expect(first).not.toBe(second)
    expect(second).not.toBe(third)
    expect(loaded).toEqual(["first", "second", "second"])
  }),
)

it.effect("uses canonical names and metadata without merging connection cache partitions", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const loaded: string[] = []
    yield* aisdk.hook.sdk((event) => {
      loaded.push(`${event.model.providerID}:${event.options.name}`)
      event.sdk = createOpenAICompatible({
        ...event.options,
        name: String(event.options.name),
        baseURL: String(event.options.baseURL),
      })
    })
    const input = {
      ...model("@ai-sdk/openai-compatible", { baseURL: "https://proxy.example/v1", reasoningEffort: "high" }),
      providerID: Provider.ID.make("work"),
      canonical: Provider.ID.openai,
    }
    const first = yield* aisdk.language(input)
    const second = yield* aisdk.language({ ...input, providerID: Provider.ID.make("personal") })
    const plain = yield* aisdk.language({ ...input, canonical: undefined })

    expect(yield* aisdk.language(input)).toBe(first)
    expect(first).not.toBe(second)
    expect(first).not.toBe(plain)
    expect(first).toMatchObject({ modelId: "api-model", provider: "openai.chat" })
    expect(plain.provider).toBe("work.chat")
    expect(loaded).toEqual(["work:openai", "personal:openai", "work:work"])

    const resolved = yield* aisdk.model(input)
    expect(resolved).toMatchObject({ id: "api-model", provider: "openai" })
    expect(resolved.route).toMatchObject({ provider: "openai", providerMetadataKey: "openai" })
    expect(resolved.route.model({ id: "another-model" })).toMatchObject({ provider: "openai" })
    const prepared = yield* compileRequest(LLM.request({ model: resolved, prompt: "Hello" }))
    expect(prepared.body.providerOptions).toEqual({ openai: { reasoningEffort: "high" } })
  }),
)

it.effect("projects request settings, headers, and body overlays", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    let body: unknown
    let options: Record<string, unknown> | undefined
    yield* aisdk.hook.sdk((event) => {
      body = event.options.body
      options = event.options
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const input = model("@ai-sdk/google", {
      apiKey: "secret",
      thinkingConfig: { thinkingBudget: 1024 },
      compaction: { type: "native" },
      transport: "websocket",
    })
    const resolved = yield* aisdk.model({
      ...input,
      headers: { "x-test": "header" },
      body: { safety_setting: "strict" },
    })
    const prepared = yield* compileRequest(
      LLM.request({
        model: resolved,
        prompt: "Hello",
        providerOptions: { safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }] },
      }),
    )

    expect(prepared.body.providerOptions).toEqual({
      google: {
        thinkingConfig: { thinkingBudget: 1024 },
        safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
      },
    })
    expect(prepared.body.headers).toEqual({ "x-test": "header" })
    expect(body).toEqual({ safety_setting: "strict" })
    expect(options).not.toHaveProperty("compaction")
    expect(options).not.toHaveProperty("transport")
  }),
)

it.effect("uses only the provider timeout signal when the request signal is null", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    let wrappedFetch: typeof fetch | undefined
    let requestSignal: AbortSignal | null | undefined
    yield* aisdk.hook.sdk((event) => {
      wrappedFetch = event.options.fetch
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    yield* aisdk.language(
      model("test-ai-sdk", {
        timeout: 60_000,
        fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          requestSignal = init?.signal
          return new Response()
        },
      }),
    )
    const request = wrappedFetch
    if (!request) return yield* Effect.die("Expected wrapped fetch")
    yield* Effect.promise(() => request("https://example.com", { signal: null }))

    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal?.aborted).toBeFalse()
  }),
)

it.effect("lowers chronological system updates to wrapped user messages", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const resolved = yield* aisdk.model(model("opaque-provider"))
    const prepared = yield* compileRequest(
      LLM.request({
        model: resolved,
        system: "Initial instructions.",
        messages: [
          Message.user("Before."),
          Message.system("Updated <rules> & constraints."),
          Message.assistant("After."),
        ],
      }),
    )

    expect(prepared.body.prompt).toEqual([
      { role: "system", content: "Initial instructions." },
      { role: "user", content: [{ type: "text", text: "Before." }] },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "<system-update>\nUpdated &lt;rules&gt; &amp; constraints.\n</system-update>",
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "After." }] },
    ])
  }),
)

it.effect("leaves max output tokens unset when the request omits them", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const resolved = yield* aisdk.model({
      ...model("@openrouter/ai-sdk-provider"),
      limit: { context: 500_000, output: 500_000 },
    })
    const prepared = yield* compileRequest(LLM.request({ model: resolved, prompt: "Hello" }))

    expect(prepared.body.maxOutputTokens).toBeUndefined()
  }),
)

it.effect("maps pro reasoning bodies to AI SDK provider options", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    let body: unknown
    yield* aisdk.hook.sdk((event) => {
      body = event.options.body
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const resolved = yield* aisdk.model({
      ...model("@ai-sdk/openai"),
      body: { reasoning: { mode: "pro" } },
    })
    const prepared = yield* compileRequest(LLM.request({ model: resolved, prompt: "Hello" }))

    expect(body).toBeUndefined()
    expect(prepared.body.providerOptions).toEqual({
      openai: { forceReasoning: true, reasoningMode: "pro" },
    })
  }),
)

it.effect("maps package-specific AI SDK provider option keys", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const cases = [
      ["@ai-sdk/github-copilot", "copilot", { reasoningEffort: "high" }],
      ["@ai-sdk/amazon-bedrock/mantle", "openai", { reasoningEffort: "high", forceReasoning: true }],
      ["@ai-sdk/openai-compatible", "test-provider", { reasoningEffort: "high" }],
      ["@jerome-benoit/sap-ai-provider-v2", "sap-ai", { reasoningEffort: "high" }],
      ["ai-gateway-provider", "openaiCompatible", { reasoningEffort: "high" }],
    ] as const
    for (const [packageName, key, settings] of cases) {
      const resolved = yield* aisdk.model(model(packageName, { reasoningEffort: "high" }))
      const prepared = yield* compileRequest(LLM.request({ model: resolved, prompt: "Hello" }))
      expect(prepared.body.providerOptions).toEqual({ [key]: settings })
    }
  }),
)

it.effect("forces reasoning and projects both Azure AI SDK namespaces", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const openai = yield* aisdk.model(model("@ai-sdk/openai", { reasoningEffort: "high" }))
    const openaiPrepared = yield* compileRequest(LLM.request({ model: openai, prompt: "Hello" }))
    expect(openaiPrepared.body.providerOptions).toEqual({
      openai: { reasoningEffort: "high", forceReasoning: true },
    })

    const azure = yield* aisdk.model(model("@ai-sdk/azure", { reasoningEffort: "high" }))
    const azurePrepared = yield* compileRequest(LLM.request({ model: azure, prompt: "Hello" }))
    expect(azurePrepared.body.providerOptions).toEqual({
      openai: { reasoningEffort: "high", forceReasoning: true },
      azure: { reasoningEffort: "high", forceReasoning: true },
    })
  }),
)

it.effect("routes AI Gateway model options by upstream prefix", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const anthropic = yield* aisdk.model({
      ...model("@ai-sdk/gateway", {
        gateway: { order: ["anthropic"] },
        thinking: { type: "adaptive" },
      }),
      modelID: Model.ID.make("anthropic/claude-sonnet-5"),
    })
    const anthropicPrepared = yield* compileRequest(LLM.request({ model: anthropic, prompt: "Hello" }))
    expect(anthropicPrepared.body.providerOptions).toEqual({
      gateway: { order: ["anthropic"] },
      anthropic: { thinking: { type: "adaptive" } },
    })

    const bedrock = yield* aisdk.model({
      ...model("@ai-sdk/gateway", { reasoningConfig: { type: "enabled" } }),
      modelID: Model.ID.make("amazon/nova-2-lite"),
    })
    const bedrockPrepared = yield* compileRequest(LLM.request({ model: bedrock, prompt: "Hello" }))
    expect(bedrockPrepared.body.providerOptions).toEqual({
      bedrock: { reasoningConfig: { type: "enabled" } },
    })

    const openai = yield* aisdk.model({
      ...model("@ai-sdk/gateway", { gateway: { order: ["openai"] } }),
      modelID: Model.ID.make("openai/gpt-5.5"),
    })
    const openaiPrepared = yield* compileRequest(
      LLM.request({ model: openai, prompt: "Hello", providerOptions: { textVerbosity: "low" } }),
    )
    expect(openaiPrepared.body.providerOptions).toEqual({
      gateway: { order: ["openai"] },
      openai: { textVerbosity: "low" },
    })

    const fallback = yield* aisdk.model({
      ...model("@ai-sdk/gateway", { reasoningEffort: "high" }),
      modelID: Model.ID.make("deepseek/deepseek-v4"),
    })
    const fallbackPrepared = yield* compileRequest(LLM.request({ model: fallback, prompt: "Hello" }))
    expect(fallbackPrepared.body.providerOptions).toEqual({
      deepseek: { reasoningEffort: "high" },
    })
  }),
)

it.effect("closes the open AI SDK reasoning part when the next one starts", () =>
  Effect.gen(function* () {
    // AI SDK OpenAI Responses can start summary part 1 before part 0 ends, then end both at item completion (#50662).
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = {
        languageModel: () =>
          streamModel([
            { type: "reasoning-start", id: "rs_1:0", providerMetadata: { gateway: { generationId: "gen_1" } } },
            { type: "reasoning-start", id: "rs_1:1" },
            { type: "reasoning-delta", id: "rs_1:1", delta: "Second summary" },
            { type: "reasoning-end", id: "rs_1:0", providerMetadata: { gateway: { encrypted: "late" } } },
            { type: "reasoning-end", id: "rs_1:1", providerMetadata: { gateway: { encrypted: "final" } } },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
          ]),
      }
    })

    const resolved = yield* aisdk.model(model("@ai-sdk/gateway"))
    const response = yield* LLMClient.generate(LLM.request({ model: resolved, prompt: "Think" })).pipe(
      Effect.provide(client),
    )

    expect(response.events.filter((event) => event.type.startsWith("reasoning-"))).toEqual([
      { type: "reasoning-start", id: "rs_1:0", providerMetadata: { gateway: { generationId: "gen_1" } } },
      { type: "reasoning-end", id: "rs_1:0" },
      { type: "reasoning-start", id: "rs_1:1", providerMetadata: undefined },
      { type: "reasoning-delta", id: "rs_1:1", text: "Second summary", providerMetadata: undefined },
      { type: "reasoning-end", id: "rs_1:1", providerMetadata: { gateway: { encrypted: "final" } } },
    ])
  }),
)

it.effect("normalizes repeated, reopened, and overlapping AI SDK fragment boundaries", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = {
        languageModel: () =>
          streamModel([
            // Older xAI Responses repeat the start for every summary part.
            { type: "reasoning-start", id: "rs_1" },
            { type: "reasoning-start", id: "rs_1" },
            { type: "reasoning-delta", id: "rs_1", delta: "First" },
            { type: "reasoning-end", id: "rs_1" },
            // xAI Chat keeps streaming an ended reasoning id after an empty tool_calls chunk.
            { type: "reasoning-delta", id: "rs_1", delta: "Second" },
            { type: "reasoning-end", id: "rs_1" },
            // xAI Responses ends every message item only when the stream flushes.
            { type: "text-start", id: "msg_1" },
            { type: "text-delta", id: "msg_1", delta: "One" },
            { type: "text-start", id: "msg_2" },
            { type: "text-delta", id: "msg_2", delta: "Two" },
            { type: "text-end", id: "msg_1" },
            { type: "text-end", id: "msg_2" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
          ]),
      }
    })

    const resolved = yield* aisdk.model(model("@ai-sdk/gateway"))
    const response = yield* LLMClient.generate(LLM.request({ model: resolved, prompt: "Think" })).pipe(
      Effect.provide(client),
    )

    expect(
      response.events.filter((event) => event.type.startsWith("reasoning-") || event.type.startsWith("text-")),
    ).toMatchObject([
      { type: "reasoning-start", id: "rs_1" },
      { type: "reasoning-delta", id: "rs_1", text: "First" },
      { type: "reasoning-end", id: "rs_1" },
      { type: "reasoning-start", id: "rs_1" },
      { type: "reasoning-delta", id: "rs_1", text: "Second" },
      { type: "reasoning-end", id: "rs_1" },
      { type: "text-start", id: "msg_1" },
      { type: "text-delta", id: "msg_1", text: "One" },
      { type: "text-end", id: "msg_1" },
      { type: "text-start", id: "msg_2" },
      { type: "text-delta", id: "msg_2", text: "Two" },
      { type: "text-end", id: "msg_2" },
    ])
  }),
)

it.effect("projects replay metadata onto AI SDK prompt parts", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const resolved = yield* aisdk.model(model("@ai-sdk/anthropic"))
    expect(resolved.route.providerMetadataKey).toBe("anthropic")
    const prepared = yield* compileRequest(
      LLM.request({
        model: resolved,
        messages: [
          Message.assistant([
            { type: "text", text: "Answer", providerMetadata: { anthropic: { cacheControl: { type: "ephemeral" } } } },
            { type: "text", text: " without metadata" },
            { type: "reasoning", text: "Think", providerMetadata: { anthropic: { signature: "signed" } } },
            {
              type: "tool-call",
              id: "hosted",
              name: "web_search",
              input: { query: "Effect" },
              providerExecuted: true,
              providerMetadata: { anthropic: { blockType: "server_tool_use" } },
            },
          ]),
        ],
      }),
    )

    expect(prepared.body.prompt).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Answer",
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
          },
          {
            type: "text",
            text: " without metadata",
            providerOptions: undefined,
          },
          {
            type: "reasoning",
            text: "Think",
            providerOptions: { anthropic: { signature: "signed" } },
          },
          {
            type: "tool-call",
            toolCallId: "hosted",
            toolName: "web_search",
            input: { query: "Effect" },
            providerExecuted: true,
            providerOptions: { anthropic: { blockType: "server_tool_use" } },
          },
        ],
      },
    ])
  }),
)

it.effect("normalizes file data across AI SDK prompt parts", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const resolved = yield* aisdk.model(model("opaque-provider"))
    const bytes = new Uint8Array([0, 1, 2, 3])
    const prepared = yield* compileRequest(
      LLM.request({
        model: resolved,
        messages: [
          Message.user([
            { type: "media", media: Media.bytes(bytes, "image/png"), filename: "bytes.png" },
            { type: "media", media: Media.base64("AAAA", "image/png"), filename: "base64.png" },
            { type: "media", media: Media.fromDataUrl("data:image/png;charset=utf-8;base64,AQID"), filename: "inline.png" },
            { type: "media", media: Media.url("https://example.com/image.png", { mediaType: "image/png" }) },
            { type: "media", media: Media.base64("s3://bucket/image.png", "image/png") },
          ]),
          Message.assistant({ type: "media", media: Media.url("http://example.com/document.pdf", { mediaType: "application/pdf" }), filename: "document.pdf" }),
          Message.tool({
            id: "call_1",
            name: "screenshot",
            result: {
              type: "content",
              value: [{ type: "file", uri: "data:image/png;base64,BAUG", mime: "image/png", name: "tool.png" }],
            },
          }),
        ],
      }),
    )

    expect(prepared.body.prompt).toEqual([
      {
        role: "user",
        content: [
          { type: "file", mediaType: "image/png", data: bytes, filename: "bytes.png" },
          { type: "file", mediaType: "image/png", data: "AAAA", filename: "base64.png" },
          { type: "file", mediaType: "image/png", data: "AQID", filename: "inline.png" },
          {
            type: "file",
            mediaType: "image/png",
            data: new URL("https://example.com/image.png"),
            filename: undefined,
          },
          { type: "file", mediaType: "image/png", data: "s3://bucket/image.png", filename: undefined },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "file",
            mediaType: "application/pdf",
            data: new URL("http://example.com/document.pdf"),
            filename: "document.pdf",
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "screenshot",
            output: { type: "text", value: "Media attached in the following user message." },
            providerOptions: undefined,
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Attached media from tool result:" },
          { type: "file", mediaType: "image/png", data: "BAUG", filename: "tool.png" },
        ],
      },
    ])
  }),
)

it.effect("does not treat SSE comment heartbeats as model progress", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const encoder = new TextEncoder()
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const customFetch = Object.assign(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"id":"response-1","object":"chat.completion.chunk","created":0,"model":"api-model","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
                ),
              )
              heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 5)
            },
            cancel() {
              if (heartbeat) clearInterval(heartbeat)
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      { preconnect: fetch.preconnect },
    )
    yield* aisdk.hook.sdk((event) => {
      event.sdk = createOpenAICompatible({
        ...event.options,
        name: String(event.options.name),
        baseURL: String(event.options.baseURL),
      })
    })
    const resolved = yield* aisdk.model(
      model("@ai-sdk/openai-compatible", {
        apiKey: "test",
        baseURL: "https://example.test/v1",
        chunkTimeout: 25,
        fetch: customFetch,
      }),
    )
    const result = yield* LLMClient.generate(LLM.request({ model: resolved, prompt: "Hello" })).pipe(
      Effect.provide(client),
      Effect.result,
      Effect.ensuring(
        Effect.sync(() => {
          if (heartbeat) clearInterval(heartbeat)
        }),
      ),
    )

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { message: expect.stringContaining("SSE read timed out") },
    })
  }),
)

const chatChunk = (text: string) =>
  `data: ${JSON.stringify({
    id: "response-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "api-model",
    choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }],
  })}\n\ndata: [DONE]\n\n`

const compatibleModel = Effect.fn(function* (customFetch: typeof fetch) {
  const aisdk = yield* AISDK.Service
  yield* aisdk.hook.sdk((event) => {
    event.sdk = createOpenAICompatible({
      ...event.options,
      name: String(event.options.name),
      baseURL: String(event.options.baseURL),
    })
  })
  return yield* aisdk.model(
    model("@ai-sdk/openai-compatible", { apiKey: "test", baseURL: "https://example.test/v1", fetch: customFetch }),
  )
})

it.effect("routes AI SDK requests and responses through HTTP hook middleware", () =>
  Effect.gen(function* () {
    const sent: Array<{ url: string; headers: Headers; body: string }> = []
    const resolved = yield* compatibleModel(
      Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          sent.push({
            url: String(input),
            headers: new Headers(init?.headers),
            body: new TextDecoder().decode(init?.body as ArrayBuffer),
          })
          return new Response(chatChunk("upstream"), { headers: { "content-type": "text/event-stream" } })
        },
        { preconnect: fetch.preconnect },
      ),
    )
    const seen: string[] = []
    const response = yield* LLMClient.generate(LLM.request({ model: resolved, prompt: "Hello" }), {
      http: (request, handler) =>
        Effect.gen(function* () {
          // Read the body twice the way session hooks do, to prove it is not a single-use stream.
          const first = yield* HttpClientRequest.toWeb(request)
          const second = yield* HttpClientRequest.toWeb(request)
          seen.push(`${request.method} ${request.url}`)
          seen.push(yield* Effect.promise(() => first.text()))
          seen.push(yield* Effect.promise(() => second.text()))
          const upstream = yield* handler(HttpClientRequest.setHeader(request, "x-hook", "applied"))
          seen.push(`status ${upstream.status}`)
          return HttpClientResponse.fromWeb(
            upstream.request,
            new Response(chatChunk("rewritten"), { headers: { "content-type": "text/event-stream" } }),
          )
        }),
    }).pipe(Effect.provide(client))

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe("https://example.test/v1/chat/completions")
    expect(sent[0]?.headers.get("x-hook")).toBe("applied")
    expect(sent[0]?.headers.get("authorization")).toBe("Bearer test")
    expect(JSON.parse(sent[0]?.body ?? "")).toMatchObject({ model: "api-model" })
    expect(seen).toEqual([
      "POST https://example.test/v1/chat/completions",
      sent[0]?.body,
      sent[0]?.body,
      "status 200",
    ])
    expect(response.events.filter(LLMEvent.is.textDelta).map((event) => event.text)).toEqual(["rewritten"])
  }),
)

it.effect("sends AI SDK requests directly when no HTTP hook middleware is attached", () =>
  Effect.gen(function* () {
    const bodies: unknown[] = []
    const resolved = yield* compatibleModel(
      Object.assign(
        async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          bodies.push(init?.body)
          return new Response(chatChunk("upstream"), { headers: { "content-type": "text/event-stream" } })
        },
        { preconnect: fetch.preconnect },
      ),
    )
    const response = yield* LLMClient.generate(LLM.request({ model: resolved, prompt: "Hello" })).pipe(
      Effect.provide(client),
    )
    expect(bodies).toHaveLength(1)
    expect(typeof bodies[0]).toBe("string")
    expect(response.events.filter(LLMEvent.is.textDelta).map((event) => event.text)).toEqual(["upstream"])
  }),
)

it.effect("emits malformed AI SDK tool input without executing it", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const raw = '{"query":"partial'
    yield* aisdk.hook.sdk((event) => {
      event.sdk = {
        languageModel: () =>
          streamModel([
            { type: "tool-input-start", id: "call_1", toolName: "lookup" },
            { type: "tool-input-delta", id: "call_1", delta: raw },
            { type: "tool-input-end", id: "call_1" },
            { type: "tool-call", toolCallId: "call_1", toolName: "lookup", input: raw },
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
          ]),
      }
    })

    const resolved = yield* aisdk.model(model("test-ai-sdk"))
    const response = yield* LLMClient.generate(LLM.request({ model: resolved, prompt: "Lookup" })).pipe(
      Effect.provide(client),
    )

    expect(response.events.find(LLMEvent.is.toolInputError)).toMatchObject({
      id: "call_1",
      name: "lookup",
      raw,
    })
    expect(response.events.some(LLMEvent.is.toolInputEnd)).toBeTrue()
    expect(response.events.some(LLMEvent.is.toolCall)).toBeFalse()
    expect(response.finishReason).toEqual({ normalized: "tool-calls", raw: "tool_calls" })
  }),
)

it.effect("keeps malformed provider-executed AI SDK input terminal", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const raw = '{"query":"partial'
    yield* aisdk.hook.sdk((event) => {
      event.sdk = {
        languageModel: () =>
          streamModel([
            { type: "tool-input-start", id: "call_1", toolName: "web_search", providerExecuted: true },
            { type: "tool-input-delta", id: "call_1", delta: raw },
            { type: "tool-input-end", id: "call_1" },
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "web_search",
              input: raw,
              providerExecuted: true,
            },
          ]),
      }
    })

    const resolved = yield* aisdk.model(model("hosted-test-ai-sdk"))
    const error = yield* LLMClient.generate(LLM.request({ model: resolved, prompt: "Search" })).pipe(
      Effect.provide(client),
      Effect.flip,
    )

    expect(error).toBeInstanceOf(AIError)
    expect(error.message).toContain("Invalid JSON input for aisdk tool call web_search")
  }),
)

const failingModel = (failure: unknown): LanguageModelV3 => ({
  specificationVersion: "v3",
  provider: "test",
  modelId: "test",
  supportedUrls: {},
  doGenerate: () => Promise.reject(new Error("Unexpected non-streaming request")),
  doStream: () => Promise.reject(failure),
})

const streamFailure = (failure: unknown, streamed = false) =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = {
        languageModel: () => (streamed ? streamModel([{ type: "error", error: failure }]) : failingModel(failure)),
      }
    })
    const resolved = yield* aisdk.model(model("test-ai-sdk"))
    return yield* LLMClient.generate(LLM.request({ model: resolved, prompt: "Hello" })).pipe(
      Effect.provide(client),
      Effect.flip,
    )
  })

it.effect("preserves non-empty AI SDK error messages", () =>
  Effect.gen(function* () {
    const cause = new Error("Bad Request")
    const error = yield* streamFailure(cause)
    expect(error).toBeInstanceOf(AIError)
    expect(error.message).toBe("Bad Request")
    expect(error.reason).toBeInstanceOf(UnknownProviderError)
    expect(error.reason).toBeInstanceOf(Error)
    expect(error.cause).toBe(error.reason)
    expect(error.reason.cause).toBe(cause)
  }),
)

Object.values({
  object: { error: { message: "Provider busy", metadata: { requestId: "stream-request", retryable: true } } },
  string: '{"error":"Provider busy","requestId":"stream-request"}',
}).forEach((payload) => {
  it.effect(`preserves ${typeof payload} AI SDK stream error payloads in the runtime body`, () =>
    Effect.gen(function* () {
      const error = yield* streamFailure(payload, true)
      const body = typeof payload === "string" ? payload : JSON.stringify(payload)
      expect(error.reason.body).toBe(body)
      expect(error.reason.cause).toBe(payload)
    }),
  )
})

// Shapes the Vercel AI Gateway streams when the upstream rejects a request.
Object.entries({
  "type validation": {
    name: "AI_TypeValidationError",
    value: { error: { type: "invalid_request_error", message: "Bad max_tokens" } },
  },
  invalid_request: { code: "invalid_request", message: "Bad max_tokens" },
}).forEach(([shape, failure]) =>
  it.effect(`reads gateway ${shape} stream errors as invalid requests`, () =>
    Effect.gen(function* () {
      const error = yield* streamFailure(failure, true)
      expect(error.message).toBe("Bad max_tokens")
      expect(error.reason).toBeInstanceOf(InvalidRequestError)
    }),
  ),
)

it.effect("does not copy Error request internals into the provider body", () =>
  Effect.gen(function* () {
    const cause = Object.assign(new Error("Connection failed"), {
      requestBodyValues: { prompt: "private prompt" },
      requestHeaders: { authorization: "Bearer private-token" },
    })
    cause.cause = cause
    const error = yield* streamFailure(cause, true)
    expect(error.reason.body).toBeUndefined()
    expect(error.reason.cause).toBe(cause)
    expect(error.message).toBe("Connection failed")
  }),
)

it.effect("preserves existing AI errors and their retry semantics unchanged", () =>
  Effect.gen(function* () {
    const failure = new AIError({
      reason: new RateLimitError({
        message: "Provider is busy",
        retryAfterMs: 7000,
        body: '{"error":"busy"}',
        http: new HttpContext({ url: "https://api.example.com/chat", status: 429, headers: { "retry-after": "7" } }),
        cause: new Error("original provider failure"),
      }),
    })
    const error = yield* streamFailure(failure)
    expect(error).toBe(failure)
    expect(error.reason).toBe(failure.reason)
    expect(error.reason).toBeInstanceOf(RateLimitError)
    expect(error.cause).toBe(error.reason)
    expect(SessionRunnerRetry.isRetryable(error)).toBeTrue()
  }),
)

const apiCallError = (input: Partial<ConstructorParameters<typeof APICallError>[0]>) =>
  new APICallError({
    message: "",
    url: "https://api.example.com/chat",
    requestBodyValues: { messages: [{ role: "user", content: "private prompt" }] },
    responseHeaders: { authorization: "Bearer secret-token" },
    ...input,
  })

it.effect("derives status and code when the AI SDK error message is empty", () =>
  Effect.gen(function* () {
    const error = yield* streamFailure(
      apiCallError({
        statusCode: 404,
        responseBody: '{"error":{"message":"","code":"not_found"}}',
        data: { error: { message: "", code: "not_found" } },
      }),
    )
    expect(error.message).toBe("Provider request failed with HTTP 404: not_found")
    expect(error.message).not.toContain("secret-token")
    expect(error.message).not.toContain("private prompt")
    const projected = toSessionError(error)
    expect(projected.type).toBe("provider.invalid-request")
    expect(projected.status).toBe(404)
    expect(projected.message).not.toBe("")
  }),
)

it.effect("preserves complete HTTP context on AI SDK call errors", () =>
  Effect.gen(function* () {
    const cause = apiCallError({
      statusCode: 404,
      responseBody: '{"error":{"message":"","code":"not_found"}}',
      data: { error: { code: "not_found", metadata: "parsed-only" } },
    })
    const error = yield* streamFailure(cause)
    expect(error.reason).toMatchObject({ _tag: "InvalidRequest" })
    expect(error.reason.http).toEqual(
      new HttpContext({
        url: "https://api.example.com/chat",
        status: 404,
        headers: { authorization: "Bearer secret-token" },
      }),
    )
    expect(error.reason.body).toBe('{"error":{"message":"","code":"not_found"}}')
    expect(error.reason.cause).toBe(cause)
  }),
)

it.effect("classifies retryable AI SDK failures with retry-after details", () =>
  Effect.gen(function* () {
    const error = yield* streamFailure(
      apiCallError({
        statusCode: 429,
        responseHeaders: { "retry-after": "7" },
      }),
    )
    expect(error.reason).toMatchObject({ _tag: "RateLimit", retryAfterMs: 7000 })
  }),
)

it.effect("classifies data-only AI SDK provider codes", () =>
  Effect.gen(function* () {
    const data = {
      error: { code: "rate_limit_error", metadata: { requestId: "data-request", retryable: true } },
      trace: { region: "test-region" },
    }
    const cause = apiCallError({ statusCode: 400, data })
    const error = yield* streamFailure(cause)
    expect(error.reason).toMatchObject({ _tag: "RateLimit" })
    expect(error.reason.http?.status).toBe(400)
    expect(SessionRunnerRetry.isRetryable(error)).toBeTrue()
    expect(error.reason.body).toBe(JSON.stringify(data))
    expect(error.reason.cause).toBe(cause)
    expect(error.reason.body).not.toContain("private prompt")
  }),
)

it.effect("classifies data-only AI SDK authentication errors", () =>
  Effect.gen(function* () {
    const error = yield* streamFailure(
      apiCallError({
        statusCode: 400,
        data: { error: { code: "authentication_error" } },
      }),
    )
    expect(error.reason).toMatchObject({ _tag: "Authentication" })
    expect(SessionRunnerRetry.isRetryable(error)).toBeFalse()
  }),
)

Object.entries({
  json: '{"message":"Request failed"}',
  malformed: "<html>Request failed</html>",
  empty: "",
}).forEach(([kind, responseBody]) => {
  it.effect(`classifies SDK data alongside the original ${kind} response body`, () =>
    Effect.gen(function* () {
      const cause = apiCallError({
        message: "Request failed",
        statusCode: 400,
        data: { error: { code: "authentication_error" } },
        responseBody,
      })
      const error = yield* streamFailure(cause)
      expect(error.reason).toMatchObject({ _tag: "Authentication" })
      expect(SessionRunnerRetry.isRetryable(error)).toBeFalse()
      expect(error.reason.body).toBe(responseBody)
      expect(error.reason.cause).toBe(cause)
    }),
  )
})

it.effect("detects context overflow from data-only AI SDK errors", () =>
  Effect.gen(function* () {
    const error = yield* streamFailure(
      apiCallError({
        statusCode: 400,
        data: { error: { code: "context_length_exceeded" } },
      }),
    )
    expect(error.reason).toMatchObject({ _tag: "InvalidRequest", classification: "context-overflow" })
    expect(isContextOverflowFailure(error)).toBeTrue()
  }),
)

it.effect("retries status-less AI SDK transport failures", () =>
  Effect.gen(function* () {
    const cause = apiCallError({
      message: "Cannot connect to API: connection refused",
      isRetryable: true,
      data: { code: "ECONNREFUSED" },
    })
    const error = yield* streamFailure(cause)
    expect(error.reason).toMatchObject({
      _tag: "Transport",
      transport: "http",
      operation: "request",
    })
    expect(error.reason).not.toHaveProperty("code")
    expect(SessionRunnerRetry.isRetryable(error)).toBeTrue()
    expect(error.reason).toBeInstanceOf(TransportError)
    expect(error.reason).toBeInstanceOf(Error)
    expect(error.cause).toBe(error.reason)
    expect(error.reason.cause).toBe(cause)
    expect(error.message).toBe(cause.message)
    expect(error.reason.body).toBe(JSON.stringify(cause.data))
    expect(error.reason).toMatchObject({ url: "https://api.example.com/chat" })
    expect(error.reason.http).toBeUndefined()
  }),
)

it.effect("classifies native fetch failures as request transport errors", () =>
  Effect.gen(function* () {
    const cause = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" }),
    })
    const error = yield* streamFailure(cause)
    expect(error.reason).toMatchObject({
      _tag: "Transport",
      transport: "http",
      operation: "request",
      code: "ECONNREFUSED",
    })
    expect(error.message).toBe("connect ECONNREFUSED 127.0.0.1:443")
    expect(error.reason.cause).toBe(cause)
    expect(SessionRunnerRetry.isRetryable(error)).toBeTrue()
  }),
)

it.effect("classifies mid-stream socket drops as read transport errors", () =>
  Effect.gen(function* () {
    const cause = Object.assign(new Error("terminated"), {
      cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
    })
    const error = yield* streamFailure(cause, true)
    expect(error.reason).toMatchObject({
      _tag: "Transport",
      transport: "http",
      operation: "read",
      code: "UND_ERR_SOCKET",
    })
    expect(SessionRunnerRetry.isRetryable(error)).toBeTrue()
  }),
)

it.effect("classifies the SSE chunk timeout as a read transport error", () =>
  Effect.gen(function* () {
    const error = yield* streamFailure(new Error("SSE read timed out"), true)
    expect(error.reason).toMatchObject({ _tag: "Transport", transport: "http", operation: "read" })
    expect(SessionRunnerRetry.isRetryable(error)).toBeTrue()
  }),
)

it.effect("keeps unrecognized error codes on the unknown provider path", () =>
  Effect.gen(function* () {
    const error = yield* streamFailure(Object.assign(new Error("kaput"), { code: "E_SOMETHING_ELSE" }), true)
    expect(error.reason).toBeInstanceOf(UnknownProviderError)
  }),
)

it.effect("prefers a structured provider message over the code fallback", () =>
  Effect.gen(function* () {
    const error = yield* streamFailure(
      apiCallError({
        statusCode: 404,
        data: { error: { code: "not_found" } },
        responseBody: '{"message":"The requested model does not exist"}',
      }),
    )
    expect(error.message).toBe("The requested model does not exist")
  }),
)

it.effect("falls back to the status alone for malformed response bodies", () =>
  Effect.gen(function* () {
    const error = yield* streamFailure(
      apiCallError({
        statusCode: 502,
        isRetryable: false,
        responseBody: "<html>Bad Gateway</html>",
      }),
    )
    expect(error.reason).toMatchObject({ _tag: "ProviderInternal" })
    expect(error.reason.http?.status).toBe(502)
    expect(error.message).toBe("Provider request failed with HTTP 502")
  }),
)

it.effect("passes the caller's abort signal to the language model", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    let received: LanguageModelV3CallOptions | undefined
    yield* aisdk.hook.sdk((event) => {
      event.sdk = {
        languageModel: () => ({
          specificationVersion: "v3",
          provider: "test",
          modelId: "test",
          supportedUrls: {},
          doGenerate: () => Promise.reject(new Error("Unexpected non-streaming request")),
          doStream: (options: LanguageModelV3CallOptions) => {
            received = options
            return Promise.resolve({
              stream: new ReadableStream({ start: (controller) => controller.close() }),
            })
          },
        }),
      }
    })
    const resolved = yield* aisdk.model(model("test-ai-sdk"))
    const controller = new AbortController()
    yield* streamRequest(LLM.request({ model: resolved, prompt: "Hello" }), {
      abortSignal: controller.signal,
    }).pipe(Stream.runDrain, Effect.provide(client))

    expect(received?.abortSignal).toBe(controller.signal)
  }),
)
