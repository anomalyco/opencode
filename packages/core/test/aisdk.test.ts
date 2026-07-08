import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { LLM, LLMError, Message, RateLimitReason } from "@opencode-ai/llm"
import { LLMClient, RequestExecutor } from "@opencode-ai/llm/route"
import { expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AISDK.locationLayer)

const model = (packageName: string, settings: Record<string, unknown> = {}) =>
  ModelV2.Info.make({
    ...ModelV2.Info.empty(ProviderV2.ID.make("test-provider"), ModelV2.ID.make("catalog-model")),
    modelID: ModelV2.ID.make("api-model"),
    package: ProviderV2.aisdk(packageName),
    settings,
    limit: { context: 100, output: 20 },
  })

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
    const prepared = yield* LLMClient.prepare<LanguageModelV3CallOptions>(
      LLM.request({ model: resolved, prompt: "Hello" }),
    )

    expect(prepared.body.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingBudget: 1024 } },
    })
    expect(prepared.body.headers).toEqual({ "x-test": "header" })
    expect(body).toEqual({ safety_setting: "strict" })
  }),
)

it.effect("preserves content provider metadata when lowering requests", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => ({ provider: event.model.providerID }) }
    })

    const resolved = yield* aisdk.model(model("@ai-sdk/google"))
    const prepared = yield* LLMClient.prepare<LanguageModelV3CallOptions>(
      LLM.request({
        model: resolved,
        messages: [
          Message.assistant([
            {
              type: "reasoning",
              text: "thinking",
              providerMetadata: { google: { thoughtSignature: "signature" } },
            },
            {
              type: "tool-call",
              id: "call-1",
              name: "bash",
              input: { command: "pwd" },
              providerMetadata: { google: { itemId: "item-1" } },
            },
          ]),
        ],
      }),
    )

    expect(prepared.body.prompt).toMatchObject([
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking",
            providerOptions: { google: { thoughtSignature: "signature" } },
          },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { command: "pwd" },
            providerOptions: { google: { itemId: "item-1" } },
          },
        ],
      },
    ])
  }),
)

it.effect("preserves classified failures from AI SDK language models", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const failure = new LLMError({
      module: "Provider",
      method: "stream",
      reason: new RateLimitReason({ message: "slow down", retryAfterMs: 2_000 }),
    })
    yield* aisdk.hook.sdk((event) => {
      event.sdk = {
        languageModel: () =>
          ({
            specificationVersion: "v3",
            provider: "test-provider",
            modelId: "api-model",
            supportedUrls: {},
            doGenerate: () => Promise.reject(new Error("not used")),
            doStream: () => Promise.reject(failure),
          }) satisfies LanguageModelV3,
      }
    })

    const resolved = yield* aisdk.model(model("@ai-sdk/google"))
    const actual = yield* LLMClient.stream(LLM.request({ model: resolved, prompt: "Hello" })).pipe(
      Stream.runCollect,
      Effect.flip,
      Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.fetchLayer))),
    )

    expect(actual).toMatchObject({
      reason: { _tag: "RateLimit", retryAfterMs: 2_000 },
    })
  }),
)
