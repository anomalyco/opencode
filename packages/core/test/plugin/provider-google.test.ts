import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { GooglePlugin } from "@opencode-ai/core/plugin/provider/google"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make()
  yield* plugin.add({ id: GooglePlugin.id, effect: GooglePlugin.effect(host) })
})

describe("GooglePlugin", () => {
  it.effect("creates a Google Generative AI SDK for @ai-sdk/google using the provider ID as SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("custom-google"), ModelV2.ID.make("gemini")),
            api: { id: ModelV2.ID.make("gemini"), type: "aisdk", package: "@ai-sdk/google" },
          }),
          package: "@ai-sdk/google",
          options: { name: "custom-google", apiKey: "test" },
        },
        {},
      )
      expect(result.sdk).toBeDefined()
      expect(result.sdk?.languageModel("gemini").provider).toBe("custom-google")
    }),
  )

  it.effect("ignores non-Google SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("google"), ModelV2.ID.make("gemini")),
            api: { id: ModelV2.ID.make("gemini"), type: "aisdk", package: "@ai-sdk/google" },
          }),
          package: "@ai-sdk/google-vertex",
          options: { name: "google" },
        },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("uses default languageModel loading with provider ID parity", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const sdkEvent = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("custom-google"), ModelV2.ID.make("alias")),
            api: { id: ModelV2.ID.make("gemini-api"), type: "aisdk", package: "@ai-sdk/google" },
          }),
          package: "@ai-sdk/google",
          options: { name: "custom-google", apiKey: "test" },
        },
        {},
      )
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: sdkEvent.model,
          sdk: sdkEvent.sdk,
          options: sdkEvent.options,
        },
        {},
      )
      const language = result.language ?? result.sdk.languageModel(result.model.api.id)
      expect(language.modelId).toBe("gemini-api")
      expect(language.provider).toBe("custom-google")
    }),
  )
})
