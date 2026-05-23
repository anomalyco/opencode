import { describe, expect } from "bun:test"
import { createAlibaba } from "@ai-sdk/alibaba"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AlibabaPlugin } from "@opencode-ai/core/plugin/provider/alibaba"
import { it, model } from "./provider-helper"

describe("AlibabaPlugin", () => {
  it.effect("creates an Alibaba SDK for @ai-sdk/alibaba", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(AlibabaPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("alibaba", "qwen"), package: "@ai-sdk/alibaba", options: { name: "alibaba" } },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("ignores non-Alibaba SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(AlibabaPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("alibaba", "qwen"), package: "@ai-sdk/openai-compatible", options: { name: "alibaba" } },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("matches the old bundled Alibaba SDK provider naming", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(AlibabaPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-alibaba", "qwen"),
          package: "@ai-sdk/alibaba",
          options: { name: "custom-alibaba", apiKey: "test" },
        },
        {},
      )
      const expected = createAlibaba({ apiKey: "test", ...{ name: "custom-alibaba" } }).languageModel("qwen")
      const actual = result.sdk?.languageModel("qwen")
      expect(actual?.provider).toBe(expected.provider)
      expect(actual?.modelId).toBe(expected.modelId)
    }),
  )

  it.effect("uses the old default languageModel(apiID) behavior", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(AlibabaPlugin)
      const item = model("alibaba", "alias", { apiID: ModelV2.ID.make("qwen-plus") })
      const result = yield* plugin.trigger("aisdk.sdk", { model: item, package: "@ai-sdk/alibaba", options: {} }, {})
      const language = result.sdk?.languageModel(item.apiID)
      expect(language?.modelId).toBe("qwen-plus")
      expect(language?.provider).toBe("alibaba.chat")
    }),
  )
})
