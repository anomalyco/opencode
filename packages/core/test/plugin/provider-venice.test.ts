import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { VenicePlugin } from "@opencode-ai/core/plugin/provider/venice"
import { fakeSelectorSdk, it, model } from "./provider-helper"

describe("VenicePlugin", () => {
  it.effect("creates a Venice SDK for venice-ai-sdk-provider", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(VenicePlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("venice", "model"), package: "venice-ai-sdk-provider", options: { name: "venice" } },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("uses the model provider ID as the bundled Venice SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const observed: string[] = []
      yield* plugin.add(VenicePlugin)
      yield* plugin.add({
        id: PluginV2.ID.make("inspector"),
        effect: Effect.succeed({
          "aisdk.sdk": (evt) =>
            Effect.sync(() => {
              observed.push(evt.sdk.languageModel("model").provider)
            }),
        }),
      })
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-venice", "model"),
          package: "venice-ai-sdk-provider",
          options: { name: "custom-venice", apiKey: "test" },
        },
        {},
      )
      expect(result.sdk).toBeDefined()
      expect(observed).toEqual(["custom-venice.chat"])
    }),
  )

  it.effect("only handles the bundled venice-ai-sdk-provider package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(VenicePlugin)
      const similar = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("venice", "model"),
          package: "file:///tmp/venice-ai-sdk-provider.js",
          options: { name: "venice" },
        },
        {},
      )
      const other = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("venice", "model"), package: "@ai-sdk/openai-compatible", options: { name: "venice" } },
        {},
      )
      expect(similar.sdk).toBeUndefined()
      expect(other.sdk).toBeUndefined()
    }),
  )

  it.effect("leaves Venice language selection to the default languageModel fallback", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(VenicePlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        { model: model("venice", "alias"), sdk: fakeSelectorSdk(calls), options: {} },
        {},
      )
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})
