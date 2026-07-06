import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { createAlibaba } from "@ai-sdk/alibaba"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AlibabaPlugin } from "@opencode-ai/core/plugin/provider/alibaba"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* AlibabaPlugin.effect(host)
})

describe("AlibabaPlugin", () => {
  it.effect("creates an Alibaba SDK for @ai-sdk/alibaba", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("alibaba"), ModelV2.ID.make("qwen")),
          modelID: ModelV2.ID.make("qwen"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/alibaba",
        options: { name: "alibaba" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("ignores non-Alibaba SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("alibaba"), ModelV2.ID.make("qwen")),
          modelID: ModelV2.ID.make("qwen"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "alibaba" },
      })
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("matches the old bundled Alibaba SDK provider naming", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-alibaba"), ModelV2.ID.make("qwen")),
          modelID: ModelV2.ID.make("qwen"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/alibaba",
        options: { name: "custom-alibaba", apiKey: "test" },
      })
      const expected = createAlibaba({ apiKey: "test", ...{ name: "custom-alibaba" } }).languageModel("qwen")
      const actual = result.sdk?.languageModel("qwen")
      expect(actual?.provider).toBe(expected.provider)
      expect(actual?.modelId).toBe(expected.modelId)
    }),
  )

  it.effect("uses the default languageModel(modelID) behavior", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const item = ModelV2.Info.make({
        ...ModelV2.Info.empty(ProviderV2.ID.make("alibaba"), ModelV2.ID.make("alias")),
        modelID: ModelV2.ID.make("qwen-plus"),
        package: "aisdk:test-provider",
      })
      const result = yield* aisdk.runSDK({ model: item, package: "@ai-sdk/alibaba", options: {} })
      const language = result.sdk?.languageModel(item.modelID ?? item.id)
      expect(language?.modelId).toBe("qwen-plus")
      expect(language?.provider).toBe("alibaba.chat")
    }),
  )
})
