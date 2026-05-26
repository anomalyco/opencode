import { describe, expect, mock } from "bun:test"
import { Effect, Layer } from "effect"
import { AISDK } from "@opencode-ai/core/aisdk"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { DeepInfraPlugin } from "@opencode-ai/core/plugin/provider/deepinfra"
import { testEffect } from "../lib/effect"
import { it, model } from "./provider-helper"

const itAISDK = testEffect(Layer.provideMerge(AISDK.layer, PluginV2.defaultLayer))
const deepinfraOptions: Record<string, any>[] = []
const deepinfraLanguageModels: string[] = []

void mock.module("@ai-sdk/deepinfra", () => ({
  createDeepInfra: (options: Record<string, any>) => {
    const captured = { ...options }
    deepinfraOptions.push(captured)
    return {
      languageModel: (modelID: string) => {
        deepinfraLanguageModels.push(modelID)
        return { modelID, provider: `${captured.name ?? "deepinfra"}.chat`, specificationVersion: "v3" }
      },
    }
  },
}))

function resetDeepInfraMock() {
  deepinfraOptions.length = 0
  deepinfraLanguageModels.length = 0
}

describe("DeepInfraPlugin", () => {
  it.effect("creates a DeepInfra SDK for @ai-sdk/deepinfra", () =>
    Effect.gen(function* () {
      resetDeepInfraMock()
      const plugin = yield* PluginV2.Service
      yield* plugin.add(DeepInfraPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("deepinfra", "model"), package: "@ai-sdk/deepinfra", options: { name: "deepinfra" } },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("passes the model provider ID as the bundled DeepInfra SDK name", () =>
    Effect.gen(function* () {
      resetDeepInfraMock()
      const plugin = yield* PluginV2.Service
      yield* plugin.add(DeepInfraPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-deepinfra", "model"),
          package: "@ai-sdk/deepinfra",
          options: { name: "custom-deepinfra", apiKey: "test" },
        },
        {},
      )
      expect(result.sdk.languageModel("model").provider).toBe("custom-deepinfra.chat")
      expect(deepinfraOptions).toEqual([{ name: "custom-deepinfra", apiKey: "test" }])
    }),
  )

  it.effect("uses the canonical provider ID as the bundled DeepInfra SDK name", () =>
    Effect.gen(function* () {
      resetDeepInfraMock()
      const plugin = yield* PluginV2.Service
      yield* plugin.add(DeepInfraPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("deepinfra", "model"),
          package: "@ai-sdk/deepinfra",
          options: { name: "deepinfra", apiKey: "test" },
        },
        {},
      )
      expect(result.sdk.languageModel("model").provider).toBe("deepinfra.chat")
      expect(deepinfraOptions).toEqual([{ name: "deepinfra", apiKey: "test" }])
    }),
  )

  it.effect("matches only the exact bundled DeepInfra package", () =>
    Effect.gen(function* () {
      resetDeepInfraMock()
      const plugin = yield* PluginV2.Service
      yield* plugin.add(DeepInfraPlugin)
      const packages = [
        "unmatched-package",
        "@ai-sdk/deepinfra-compatible",
        "file:///tmp/@ai-sdk/deepinfra-provider.js",
      ]
      yield* Effect.forEach(packages, (item) =>
        Effect.gen(function* () {
          const ignored = yield* plugin.trigger(
            "aisdk.sdk",
            { model: model("deepinfra", "model"), package: item, options: { name: "deepinfra" } },
            {},
          )
          expect(ignored.sdk).toBeUndefined()
        }),
      )
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("deepinfra", "model"), package: "@ai-sdk/deepinfra", options: { name: "deepinfra" } },
        {},
      )
      expect(result.sdk).toBeDefined()
      expect(deepinfraOptions).toEqual([{ name: "deepinfra" }])
    }),
  )

  itAISDK.effect("uses the default languageModel selection for DeepInfra models", () =>
    Effect.gen(function* () {
      resetDeepInfraMock()
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* plugin.add(DeepInfraPlugin)
      const language = yield* aisdk.language(
        model("deepinfra", "meta-llama/Llama-3.3-70B-Instruct", {
          endpoint: { type: "aisdk", package: "@ai-sdk/deepinfra" },
        }),
      )
      expect(language.provider).toBe("deepinfra.chat")
      expect(deepinfraLanguageModels).toEqual(["meta-llama/Llama-3.3-70B-Instruct"])
    }),
  )
})
