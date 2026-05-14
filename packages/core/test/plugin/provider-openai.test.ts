import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { OpenAIPlugin } from "@opencode-ai/core/plugin/provider/openai"
import { fakeSelectorSdk, it, model } from "./provider-helper"

describe("OpenAIPlugin", () => {
  it.effect("creates an OpenAI SDK for @ai-sdk/openai using the provider ID as SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(OpenAIPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-openai", "gpt-5"),
          package: "@ai-sdk/openai",
          options: { name: "custom-openai", apiKey: "test" },
        },
        {},
      )
      expect(result.sdk?.responses("gpt-5").provider).toBe("custom-openai.responses")
    }),
  )

  it.effect("ignores non-OpenAI SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(OpenAIPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("openai", "gpt-5"), package: "@ai-sdk/openai-compatible", options: { name: "openai" } },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("uses the Responses API for language models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(OpenAIPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("openai", "alias", { apiID: ModelV2.ID.make("gpt-5") }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )
      expect(calls).toEqual(["responses:gpt-5"])
      expect(result.language).toBeDefined()
    }),
  )

  it.effect("ignores non-OpenAI providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(OpenAIPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        { model: model("anthropic", "gpt-5"), sdk: fakeSelectorSdk(calls), options: {} },
        {},
      )
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )

  it.effect("cancels gpt-5-chat-latest during model updates", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(OpenAIPlugin)
      const normal = yield* plugin.trigger("model.update", {}, { model: model("openai", "gpt-5"), cancel: false })
      const filtered = yield* plugin.trigger(
        "model.update",
        {},
        { model: model("openai", "gpt-5-chat-latest"), cancel: false },
      )
      expect(normal.cancel).toBe(false)
      expect(filtered.cancel).toBe(true)
    }),
  )

  it.effect("does not cancel gpt-5-chat-latest for non-OpenAI providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(OpenAIPlugin)
      const result = yield* plugin.trigger(
        "model.update",
        {},
        { model: model("custom-openai", "gpt-5-chat-latest"), cancel: false },
      )
      expect(result.cancel).toBe(false)
    }),
  )
})
