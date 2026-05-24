import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { OpenRouterPlugin } from "@opencode-ai/core/plugin/provider/openrouter"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { expectPluginRegistered, it, model, provider } from "./provider-helper"

describe("OpenRouterPlugin", () => {
  it.effect("is registered so legacy OpenRouter behavior can be applied", () =>
    Effect.sync(() =>
      expectPluginRegistered(
        ProviderPlugins.map((item) => item.id),
        "openrouter",
      ),
    ),
  )

  it.effect("applies legacy referer headers only to openrouter", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(OpenRouterPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => {
        const openrouter = provider("openrouter", {
          endpoint: { type: "aisdk", package: "@openrouter/ai-sdk-provider" },
          options: { headers: { Existing: "value" }, body: {}, aisdk: { provider: {}, request: {} } },
        })
        catalog.provider.update(openrouter.id, (item) => {
          item.endpoint = openrouter.endpoint
          item.options = openrouter.options
        })
        catalog.provider.update(ProviderV2.ID.make("nvidia"), () => {})
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("openrouter"))).options.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia"))).options.headers).toEqual({})
    }),
  )

  it.effect("creates an SDK only for the OpenRouter package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(OpenRouterPlugin)

      const ignored = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("openrouter", "openai/gpt-5"),
          package: "@ai-sdk/openai-compatible",
          options: { name: "openrouter" },
        },
        {},
      )
      expect(ignored.sdk).toBeUndefined()

      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("custom", "openai/gpt-5"), package: "@openrouter/ai-sdk-provider", options: { name: "custom" } },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("filters OpenRouter's gpt-5 chat alias", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(OpenRouterPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => {
        const openrouter = provider("openrouter", {
          endpoint: { type: "aisdk", package: "@openrouter/ai-sdk-provider" },
        })
        catalog.provider.update(openrouter.id, (item) => {
          item.endpoint = openrouter.endpoint
        })
        catalog.provider.update(ProviderV2.ID.openai, () => {})
        for (const item of [
          model("openrouter", "openai/gpt-5-chat"),
          model("openrouter", "openai/gpt-5"),
          model("openai", "openai/gpt-5-chat"),
        ]) {
          catalog.model.update(item.providerID, item.id, () => {})
        }
      })

      expect(
        (yield* catalog.model.get(ProviderV2.ID.make("openrouter"), ModelV2.ID.make("openai/gpt-5-chat"))).enabled,
      ).toBe(false)
      expect(
        (yield* catalog.model.get(ProviderV2.ID.make("openrouter"), ModelV2.ID.make("openai/gpt-5"))).enabled,
      ).toBe(true)
      expect((yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("openai/gpt-5-chat"))).enabled).toBe(true)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-OpenRouter providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(OpenRouterPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("custom-openrouter"), () => {})
        catalog.model.update(ProviderV2.ID.make("custom-openrouter"), ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      expect(
        (yield* catalog.model.get(ProviderV2.ID.make("custom-openrouter"), ModelV2.ID.make("gpt-5-chat-latest")))
          .enabled,
      ).toBe(true)
    }),
  )
})
