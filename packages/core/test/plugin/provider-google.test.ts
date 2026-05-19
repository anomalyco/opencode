import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { GooglePlugin } from "@opencode-ai/core/plugin/provider/google"
import { testEffect } from "../lib/effect"
import { it, model } from "./provider-helper"

const itWithAISDK = testEffect(AISDK.layer.pipe(Layer.provideMerge(PluginV2.defaultLayer)))

describe("GooglePlugin", () => {
  it.effect("creates a Google Generative AI SDK for @ai-sdk/google using the provider ID as SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GooglePlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-google", "gemini"),
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
      yield* plugin.add(GooglePlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("google", "gemini"), package: "@ai-sdk/google-vertex", options: { name: "google" } },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  itWithAISDK.effect("uses default languageModel loading with provider ID parity", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* plugin.add(GooglePlugin)
      const language = yield* aisdk.language(
        model("custom-google", "alias", {
          apiID: ModelV2.ID.make("gemini-api"),
          endpoint: {
            type: "aisdk",
            package: "@ai-sdk/google",
          },
          options: {
            headers: {},
            body: {},
            aisdk: {
              provider: { apiKey: "test" },
              request: {},
            },
          },
        }),
      )
      expect(language.modelId).toBe("gemini-api")
      expect(language.provider).toBe("custom-google")
    }),
  )
})
