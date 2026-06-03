import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { OpenAIPlugin } from "@opencode-ai/core/plugin/provider/openai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { fakeSelectorSdk, it, model, provider } from "./provider-helper"

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

  it.effect("disables gpt-5-chat-latest during catalog transforms", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(OpenAIPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("openai", { api: { type: "aisdk", package: "@ai-sdk/openai" } })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
        })
        catalog.model.update(item.id, ModelV2.ID.make("gpt-5"), () => {})
        catalog.model.update(item.id, ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      expect((yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5"))).enabled).toBe(true)
      expect((yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5-chat-latest"))).enabled).toBe(false)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-OpenAI providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(OpenAIPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("custom-openai")
        catalog.provider.update(item.id, () => {})
        catalog.model.update(item.id, ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      expect(
        (yield* catalog.model.get(ProviderV2.ID.make("custom-openai"), ModelV2.ID.make("gpt-5-chat-latest"))).enabled,
      ).toBe(true)
    }),
  )
})
