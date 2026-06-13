import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { OpenAICompatiblePlugin } from "@opencode-ai/core/plugin/provider/openai-compatible"
import { it, model } from "./provider-helper"

describe("OpenAICompatiblePlugin", () => {
  it.effect("preserves explicit includeUsage false and defaults it to true", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(OpenAICompatiblePlugin)
      const defaulted = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("custom", "model"), package: "@ai-sdk/openai-compatible", options: { name: "custom" } },
        {},
      )
      const disabled = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom", "model"),
          package: "@ai-sdk/openai-compatible",
          options: { name: "custom", includeUsage: false },
        },
        {},
      )
      expect(defaulted.options.includeUsage).toBe(true)
      expect(disabled.options.includeUsage).toBe(false)
    }),
  )

  it.effect("defaults includeUsage for OpenAI-compatible package matches", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(OpenAICompatiblePlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom", "model"),
          package: "file:///tmp/@ai-sdk/openai-compatible-provider.js",
          options: { name: "custom" },
        },
        {},
      )
      expect(result.options.includeUsage).toBe(true)
    }),
  )

  it.effect("uses the provider ID as the OpenAI-compatible provider name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const observed: string[] = []
      yield* plugin.add(OpenAICompatiblePlugin)
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
          model: model("custom-provider", "model"),
          package: "@ai-sdk/openai-compatible",
          options: { name: "custom-provider", baseURL: "https://example.com/v1" },
        },
        {},
      )
      expect(observed).toEqual(["custom-provider.chat"])
    }),
  )

  it.effect("does not overwrite an SDK created by an earlier provider-specific plugin", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const sentinel = { languageModel: (modelID: string) => ({ modelID }) }
      yield* plugin.add({
        id: PluginV2.ID.make("sentinel"),
        effect: Effect.succeed({
          "aisdk.sdk": (evt) =>
            Effect.sync(() => {
              evt.sdk = sentinel
            }),
        }),
      })
      yield* plugin.add(OpenAICompatiblePlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("cloudflare-workers-ai", "model"),
          package: "@ai-sdk/openai-compatible",
          options: { name: "cloudflare-workers-ai" },
        },
        {},
      )
      expect(result.sdk).toBe(sentinel)
    }),
  )
})
