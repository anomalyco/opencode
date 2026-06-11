import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Connector } from "@opencode-ai/core/connector"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { OpenAIPlugin } from "@opencode-ai/core/plugin/provider/openai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { fakeSelectorSdk, it, model, provider } from "./provider-helper"

function add(plugin: PluginV2.Interface, connectors: Connector.Interface) {
  return plugin.add({
    ...OpenAIPlugin,
    effect: OpenAIPlugin.effect.pipe(Effect.provideService(Connector.Service, connectors)),
  })
}

describe("OpenAIPlugin", () => {
  it.effect("registers browser and headless ChatGPT OAuth methods", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* add(plugin, yield* Connector.Service)
      expect((yield* (yield* Connector.Service).get(Connector.ID.make("openai")))?.methods).toEqual([
        new Connector.OAuthMethod({
          id: Connector.MethodID.make("chatgpt-browser"),
          type: "oauth",
          label: "ChatGPT Pro/Plus (browser)",
        }),
        new Connector.OAuthMethod({
          id: Connector.MethodID.make("chatgpt-headless"),
          type: "oauth",
          label: "ChatGPT Pro/Plus (headless)",
        }),
      ])
    }),
  )

  it.effect("creates an OpenAI SDK for @ai-sdk/openai using the provider ID as SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* add(plugin, yield* Connector.Service)
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
      yield* add(plugin, yield* Connector.Service)
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
      yield* add(plugin, yield* Connector.Service)
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("openai", "alias", {
            api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "test-provider" },
          }),
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
      yield* add(plugin, yield* Connector.Service)
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
      yield* add(plugin, yield* Connector.Service)
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
      yield* add(plugin, yield* Connector.Service)
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
