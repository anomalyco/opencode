import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { DeepInfraPlugin } from "@opencode-ai/core/plugin/provider/deepinfra"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const deepinfraOptions: Record<string, unknown>[] = []
const deepinfraLanguageModels: string[] = []

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* DeepInfraPlugin.effect(host)
})

void mock.module("@ai-sdk/deepinfra", () => ({
  createDeepInfra: (options: Record<string, unknown>) => {
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
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("deepinfra"), ModelV2.ID.make("model")),
          modelID: ModelV2.ID.make("model"),
          package: "aisdk:@ai-sdk/deepinfra",
        }),
        package: "@ai-sdk/deepinfra",
        options: { name: "deepinfra" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("passes the model provider ID as the bundled DeepInfra SDK name", () =>
    Effect.gen(function* () {
      resetDeepInfraMock()
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-deepinfra"), ModelV2.ID.make("model")),
          modelID: ModelV2.ID.make("model"),
          package: "aisdk:@ai-sdk/deepinfra",
        }),
        package: "@ai-sdk/deepinfra",
        options: { name: "custom-deepinfra", apiKey: "test" },
      })
      expect(result.sdk.languageModel("model").provider).toBe("custom-deepinfra.chat")
      expect(deepinfraOptions).toEqual([{ name: "custom-deepinfra", apiKey: "test" }])
    }),
  )

  it.effect("uses the canonical provider ID as the bundled DeepInfra SDK name", () =>
    Effect.gen(function* () {
      resetDeepInfraMock()
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("deepinfra"), ModelV2.ID.make("model")),
          modelID: ModelV2.ID.make("model"),
          package: "aisdk:@ai-sdk/deepinfra",
        }),
        package: "@ai-sdk/deepinfra",
        options: { name: "deepinfra", apiKey: "test" },
      })
      expect(result.sdk.languageModel("model").provider).toBe("deepinfra.chat")
      expect(deepinfraOptions).toEqual([{ name: "deepinfra", apiKey: "test" }])
    }),
  )

  it.effect("matches only the exact bundled DeepInfra package", () =>
    Effect.gen(function* () {
      resetDeepInfraMock()
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const packages = [
        "unmatched-package",
        "@ai-sdk/deepinfra-compatible",
        "file:///tmp/@ai-sdk/deepinfra-provider.js",
      ]
      yield* Effect.forEach(packages, (item) =>
        Effect.gen(function* () {
          const ignored = yield* aisdk.runSDK({
            model: ModelV2.Info.make({
              ...ModelV2.Info.empty(ProviderV2.ID.make("deepinfra"), ModelV2.ID.make("model")),
              modelID: ModelV2.ID.make("model"),
              package: "aisdk:@ai-sdk/deepinfra",
            }),
            package: item,
            options: { name: "deepinfra" },
          })
          expect(ignored.sdk).toBeUndefined()
        }),
      )
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("deepinfra"), ModelV2.ID.make("model")),
          modelID: ModelV2.ID.make("model"),
          package: "aisdk:@ai-sdk/deepinfra",
        }),
        package: "@ai-sdk/deepinfra",
        options: { name: "deepinfra" },
      })
      expect(result.sdk).toBeDefined()
      expect(deepinfraOptions).toEqual([{ name: "deepinfra" }])
    }),
  )

  it.effect("uses the default languageModel selection for DeepInfra models", () =>
    Effect.gen(function* () {
      resetDeepInfraMock()
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const sdkEvent = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("deepinfra"), ModelV2.ID.make("meta-llama/Llama-3.3-70B-Instruct")),
          modelID: ModelV2.ID.make("meta-llama/Llama-3.3-70B-Instruct"),
          package: "aisdk:@ai-sdk/deepinfra",
        }),
        package: "@ai-sdk/deepinfra",
        options: { name: "deepinfra" },
      })
      const result = yield* aisdk.runLanguage({ model: sdkEvent.model, sdk: sdkEvent.sdk, options: sdkEvent.options })
      const language = result.language ?? result.sdk.languageModel(result.model.modelID ?? result.model.id)
      expect(language.provider).toBe("deepinfra.chat")
      expect(deepinfraLanguageModels).toEqual(["meta-llama/Llama-3.3-70B-Instruct"])
    }),
  )
})
