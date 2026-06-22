import type { LanguageModelV3 } from "@ai-sdk/provider"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { XAIPlugin } from "@opencode-ai/core/plugin/provider/xai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make()
  yield* plugin.add({ id: XAIPlugin.id, effect: XAIPlugin.effect(host) })
})

function fakeSelectorSdk(calls: string[]) {
  const make = (method: string) => (id: string) => {
    calls.push(`${method}:${id}`)
    return { modelId: id, provider: method, specificationVersion: "v3" } as unknown as LanguageModelV3
  }
  return {
    responses: make("responses"),
    messages: make("messages"),
    chat: make("chat"),
    languageModel: make("languageModel"),
  }
}

describe("XAIPlugin", () => {
  it.effect("creates an xAI SDK only for @ai-sdk/xai", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()

      const ignored = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("xai"), ModelV2.ID.make("grok-4")),
            api: { id: ModelV2.ID.make("grok-4"), type: "aisdk", package: "@ai-sdk/xai" },
          }),
          package: "@ai-sdk/openai-compatible",
          options: {},
        },
        {},
      )

      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("xai"), ModelV2.ID.make("grok-4")),
            api: { id: ModelV2.ID.make("grok-4"), type: "aisdk", package: "@ai-sdk/xai" },
          }),
          package: "@ai-sdk/xai",
          options: {},
        },
        {},
      )

      expect(ignored.sdk).toBeUndefined()
      expect(typeof result.sdk?.responses).toBe("function")
    }),
  )

  it.effect("creates xAI SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()

      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("custom-xai"), ModelV2.ID.make("grok-4")),
            api: { id: ModelV2.ID.make("grok-4"), type: "aisdk", package: "@ai-sdk/xai" },
          }),
          package: "@ai-sdk/xai",
          options: {},
        },
        {},
      )

      expect(result.sdk.responses("grok-4").provider).toBe("xai.responses")
    }),
  )

  it.effect("uses responses with the model api.id for xAI language models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []

      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("xai"), ModelV2.ID.make("alias")),
            api: { id: ModelV2.ID.make("grok-4"), type: "aisdk", package: "@ai-sdk/xai" },
          }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )

      expect(calls).toEqual(["responses:grok-4"])
      expect(result.language).toBeDefined()
    }),
  )

  it.effect("ignores non-xAI providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []

      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("grok-4")),
            api: { id: ModelV2.ID.make("grok-4"), type: "aisdk", package: "@ai-sdk/xai" },
          }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )

      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})
