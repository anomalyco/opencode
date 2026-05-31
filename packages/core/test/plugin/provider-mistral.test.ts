import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { MistralPlugin } from "@opencode-ai/core/plugin/provider/mistral"
import { fakeSelectorSdk, it, model } from "./provider-helper"

describe("MistralPlugin", () => {
  it.effect("creates a Mistral SDK for @ai-sdk/mistral", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(MistralPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("mistral", "mistral-large"), package: "@ai-sdk/mistral", options: { name: "mistral" } },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("ignores non-Mistral SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(MistralPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("mistral", "mistral-large"),
          package: "@ai-sdk/openai-compatible",
          options: { name: "mistral" },
        },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("matches the old bundled Mistral SDK provider name for the bundled provider ID", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const providers: string[] = []
      yield* plugin.add(MistralPlugin)
      yield* plugin.add({
        id: PluginV2.ID.make("mistral-sdk-inspector"),
        effect: Effect.succeed({
          "aisdk.sdk": (evt) =>
            Effect.sync(() => {
              providers.push(evt.sdk.languageModel("mistral-large").provider)
            }),
        }),
      })
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("mistral", "mistral-large"), package: "@ai-sdk/mistral", options: { name: "mistral" } },
        {},
      )
      expect(result.sdk).toBeDefined()
      expect(providers).toEqual(["mistral.chat"])
    }),
  )

  it.effect("matches the old bundled Mistral SDK provider name for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const providers: string[] = []
      yield* plugin.add(MistralPlugin)
      yield* plugin.add({
        id: PluginV2.ID.make("mistral-sdk-inspector"),
        effect: Effect.succeed({
          "aisdk.sdk": (evt) =>
            Effect.sync(() => {
              providers.push(evt.sdk.languageModel("mistral-large").provider)
            }),
        }),
      })
      yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-mistral", "mistral-large"),
          package: "@ai-sdk/mistral",
          options: { name: "custom-mistral" },
        },
        {},
      )
      expect(providers).toEqual(["mistral.chat"])
    }),
  )

  it.effect("leaves Mistral language selection on the default sdk.languageModel(apiID) path", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      const sdk = fakeSelectorSdk(calls)
      yield* plugin.add(MistralPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        { model: model("mistral", "alias", { apiID: ModelV2.ID.make("mistral-large") }), sdk, options: {} },
        {},
      )
      const language = result.language ?? sdk.languageModel(result.model.apiID)
      expect(calls).toEqual(["languageModel:mistral-large"])
      expect(language).toBeDefined()
    }),
  )
})
