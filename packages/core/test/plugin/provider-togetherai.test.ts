import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { TogetherAIPlugin } from "@opencode-ai/core/plugin/provider/togetherai"
import { fakeSelectorSdk, it, model } from "./provider-helper"

describe("TogetherAIPlugin", () => {
  it.effect("creates a TogetherAI SDK for @ai-sdk/togetherai", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(TogetherAIPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("togetherai", "model"), package: "@ai-sdk/togetherai", options: { name: "togetherai" } },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("matches the old bundled provider package exactly", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(TogetherAIPlugin)

      const ignored = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("togetherai", "model"),
          package: "file:///tmp/@ai-sdk/togetherai-provider.js",
          options: { name: "togetherai" },
        },
        {},
      )
      expect(ignored.sdk).toBeUndefined()

      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("togetherai", "model"), package: "@ai-sdk/togetherai", options: { name: "togetherai" } },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("creates bundled TogetherAI SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const observed: string[] = []
      yield* plugin.add(TogetherAIPlugin)
      yield* plugin.add({
        id: PluginV2.ID.make("inspector"),
        effect: Effect.succeed({
          "aisdk.sdk": (evt) =>
            Effect.sync(() => {
              observed.push(evt.sdk.languageModel("model").provider)
            }),
        }),
      })

      yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-togetherai", "model"),
          package: "@ai-sdk/togetherai",
          options: { name: "custom-togetherai" },
        },
        {},
      )

      expect(observed).toEqual(["togetherai.chat"])
    }),
  )

  it.effect("defaults language selection to sdk.languageModel with the model API ID", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(TogetherAIPlugin)

      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("togetherai", "meta-llama/Llama-3.3-70B-Instruct-Turbo"),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: {},
        },
        {},
      )

      expect(result.language).toBeUndefined()
      expect(calls).toEqual([])
      expect(result.language ?? fakeSelectorSdk(calls).languageModel(result.model.apiID)).toBeDefined()
      expect(calls).toEqual(["languageModel:meta-llama/Llama-3.3-70B-Instruct-Turbo"])
    }),
  )
})
