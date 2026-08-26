import { APICallError } from "@ai-sdk/provider"
import type { LanguageModelV3, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { createMistral } from "@ai-sdk/mistral"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { AISDK } from "@opencode-ai/core/aisdk"
import { SessionRunnerRetry } from "@opencode-ai/core/session/runner/retry"
import { toSessionError } from "@opencode-ai/core/session/to-session-error"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { LLM, AIError, LLMEvent, Message, isContextOverflowFailure } from "@opencode-ai/ai"
import { LLMClient, RequestExecutor } from "@opencode-ai/ai/route"
import { compileRequest } from "@opencode-ai/ai/route/client"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AISDK.locationLayer)

const model = (packageName: string, settings: Record<string, unknown> = {}) =>
  Model.Info.make({
    ...Model.Info.default(Provider.ID.make("test-provider"), Model.ID.make("catalog-model")),
    modelID: Model.ID.make("api-model"),
    package: Provider.aisdk(packageName),
    settings,
    limit: { context: 100, output: 20 },
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

it.effect("projects request settings, headers, and body overlays", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    let body: unknown
    yield* aisdk.hook.sdk((event) => {
      body = event.options.body
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const input = model("@ai-sdk/google", {
      apiKey: "secret",
      thinkingConfig: { thinkingBudget: 1024 },
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

it.effect("moves a tool image through the real Mistral provider as a user message", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    let body: { messages?: unknown[] } | undefined
    const mockFetch = Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        body = JSON.parse(String(init?.body))
        const chunks = [
          {
            id: "response-1",
            created: 0,
            model: "pixtral-large-latest",
            choices: [{ index: 0, delta: { content: [{ type: "text", text: "I see it." }] } }],
          },
          {
            id: "response-1",
            created: 0,
            model: "pixtral-large-latest",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ]
        return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""), {
          headers: { "Content-Type": "text/event-stream" },
        })
      },
      { preconnect: fetch.preconnect },
    )
    yield* aisdk.hook.sdk((event) => {
      event.sdk = createMistral({ apiKey: "test", fetch: mockFetch })
    })

    const resolved = yield* aisdk.model({
      ...model("@ai-sdk/mistral"),
      modelID: Model.ID.make("pixtral-large-latest"),
    })
    yield* LLMClient.generate(
      LLM.request({
        model: resolved,
        messages: [
          Message.user("Inspect the screenshot."),
          Message.assistant({ type: "tool-call", id: "call_1", name: "screenshot", input: {} }),
          Message.tool({
            type: "tool-result",
            id: "call_1",
            name: "screenshot",
            result: {
              type: "content",
              value: [
                { type: "text", text: "Screenshot captured" },
                { type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png", name: "screen.png" },
              ],
            },
          }),
        ],
      }),
    ).pipe(Effect.provide(client))

    expect(body?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Inspect the screenshot." }] },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "screenshot", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        name: "screenshot",
        tool_call_id: "call_1",
        content: '[{"type":"text","text":"Screenshot captured"}]',
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Attached media from tool result:" },
          { type: "image_url", image_url: "data:image/png;base64,AAAA" },
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
      failure: { reason: { message: expect.stringContaining("SSE read timed out") } },
    })
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

const streamFailure = (failure: unknown) =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => failingModel(failure) }
    })
    const resolved = yield* aisdk.model(model("test-ai-sdk"))
    return yield* LLMClient.generate(LLM.request({ model: resolved, prompt: "Hello" })).pipe(
      Effect.provide(client),
      Effect.flip,
    )
  })

it.effect("preserves non-empty AI SDK error messages", () =>
  Effect.gen(function* () {
    const error = yield* streamFailure(new Error("Bad Request"))
    expect(error).toBeInstanceOf(AIError)
    expect(error.reason).toMatchObject({ _tag: "UnknownProvider", message: "Bad Request" })
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
    expect(error.reason.message).toBe("Provider request failed with HTTP 404: not_found")
    expect(error.reason.message).not.toContain("secret-token")
    expect(error.reason.message).not.toContain("private prompt")
    const projected = toSessionError(error)
    expect(projected.type).toBe("provider.invalid-request")
    expect(projected.status).toBe(404)
    expect(projected.message).not.toBe("")
  }),
)

it.effect("preserves complete HTTP context on AI SDK call errors", () =>
  Effect.gen(function* () {
    const error = yield* streamFailure(
      apiCallError({
        statusCode: 404,
        responseBody: '{"error":{"message":"","code":"not_found"}}',
      }),
    )
    expect(error.reason).toMatchObject({ _tag: "InvalidRequest" })
    const http = "http" in error.reason ? error.reason.http : undefined
    expect(http?.request.url).toBe("https://api.example.com/chat")
    expect(http?.response?.status).toBe(404)
    expect(http?.response?.headers["authorization"]).toBe("Bearer secret-token")
    expect(http?.body).toBe('{"error":{"message":"","code":"not_found"}}')
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
    const error = yield* streamFailure(
      apiCallError({
        statusCode: 400,
        data: { error: { code: "api_error" } },
      }),
    )
    expect(error.reason).toMatchObject({ _tag: "ProviderInternal", status: 400 })
    expect(SessionRunnerRetry.isRetryable(error)).toBeTrue()
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
    expect(error.reason).toMatchObject({ _tag: "Authentication", kind: "invalid" })
    expect(SessionRunnerRetry.isRetryable(error)).toBeFalse()
  }),
)

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
    const error = yield* streamFailure(
      apiCallError({
        message: "Cannot connect to API: connection refused",
        isRetryable: true,
      }),
    )
    expect(error.reason).toMatchObject({
      _tag: "Transport",
      transport: "http",
      operation: "request",
      code: "AI_APICallError",
    })
    expect(SessionRunnerRetry.isRetryable(error)).toBeTrue()
    expect("http" in error.reason ? error.reason.http?.request.url : undefined).toBe("https://api.example.com/chat")
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
    expect(error.reason.message).toBe("The requested model does not exist")
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
    expect(error.reason).toMatchObject({ _tag: "ProviderInternal", status: 502 })
    expect(error.reason.message).toBe("Provider request failed with HTTP 502")
  }),
)
