import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { LLM } from "@opencode-ai/llm"
import { LLMClient } from "@opencode-ai/llm/route"
import { expect } from "bun:test"
import { Effect, Stream } from "effect"
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

it.effect("preserves Copilot billing metadata from raw provider chunks", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const parts: LanguageModelV3StreamPart[] = [
      {
        type: "raw",
        rawValue: {
          type: "message_delta",
          copilot_usage: { total_nano_aiu: 4_473_525_000 },
        },
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: {
          inputTokens: { total: 10, noCache: 8, cacheRead: 2, cacheWrite: 0 },
          outputTokens: { total: 3, text: 2, reasoning: 1 },
        },
        providerMetadata: { anthropic: { cacheCreationInputTokens: 0 } },
      },
    ]
    const language: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "github-copilot",
      modelId: "claude-sonnet",
      supportedUrls: {},
      doGenerate: () => Promise.reject(new Error("unused")),
      doStream: () =>
        Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              for (const part of parts) controller.enqueue(part)
              controller.close()
            },
          }),
        }),
    }
    yield* aisdk.hook.sdk((event) => {
      event.sdk = { languageModel: () => language }
    })

    const resolved = yield* aisdk.model(model("@ai-sdk/anthropic"))
    const request = LLM.request({ model: resolved, prompt: "Hello" })
    const body = yield* resolved.route.body.from(request)
    const prepared = yield* resolved.route.prepareTransport(body, request)
    const events = Array.from(
      yield* resolved.route
        .streamPrepared(prepared, request, { http: { execute: () => Effect.die("unused") } })
        .pipe(Stream.runCollect),
    )
    expect(events.find((event) => event.type === "step-finish")?.providerMetadata).toEqual({
      anthropic: { cacheCreationInputTokens: 0 },
      copilot: { totalNanoAiu: 4_473_525_000 },
    })
  }),
)
