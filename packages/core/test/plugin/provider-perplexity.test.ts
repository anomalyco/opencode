import { describe, expect } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PerplexityPlugin } from "@opencode-ai/core/plugin/provider/perplexity"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make()
  yield* plugin.add({ id: PerplexityPlugin.id, effect: PerplexityPlugin.effect(host) })
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

describe("PerplexityPlugin", () => {
  it.effect("creates a Perplexity SDK for the exact @ai-sdk/perplexity package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("perplexity"), ModelV2.ID.make("sonar")),
            api: { id: ModelV2.ID.make("sonar"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/perplexity",
          options: { name: "perplexity" },
        },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("ignores packages that are not the bundled Perplexity package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("perplexity"), ModelV2.ID.make("sonar")),
            api: { id: ModelV2.ID.make("sonar"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/perplexity-compatible",
          options: { name: "perplexity" },
        },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("uses the Perplexity provider ID as the SDK name for the bundled provider", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("perplexity"), ModelV2.ID.make("sonar")),
            api: { id: ModelV2.ID.make("sonar"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/perplexity",
          options: { name: "perplexity" },
        },
        {},
      )
      expect(result.sdk.languageModel("sonar").provider).toBe("perplexity")
    }),
  )

  it.effect("creates bundled Perplexity SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("custom-perplexity"), ModelV2.ID.make("sonar")),
            api: { id: ModelV2.ID.make("sonar"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/perplexity",
          options: { name: "custom-perplexity" },
        },
        {},
      )
      expect(result.sdk.languageModel("sonar").provider).toBe("perplexity")
    }),
  )

  it.effect("leaves Perplexity language selection to the default languageModel fallback", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("perplexity"), ModelV2.ID.make("alias")),
            api: { id: ModelV2.ID.make("sonar"), type: "aisdk", package: "test-provider" },
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
