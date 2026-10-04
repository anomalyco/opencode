import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { OpenRouterPlugin } from "@opencode-ai/core/plugin/provider/openrouter"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* OpenRouterPlugin.effect(host)
})

describe("OpenRouterPlugin", () => {
  it.effect("is registered so legacy OpenRouter behavior can be applied", () =>
    Effect.sync(() => expect(ProviderPlugins.map((item) => item.id)).toContain(PluginV2.ID.make("openrouter"))),
  )

  it.effect("applies legacy referer headers only to openrouter", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.openrouter, (provider) => {
          provider.api = { type: "aisdk", package: "@openrouter/ai-sdk-provider" }
          provider.request = { headers: { Existing: "value" }, body: {} }
        })
        catalog.provider.update(ProviderV2.ID.make("nvidia"), () => {})
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(ProviderV2.ID.openrouter))?.request.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia")))?.request.headers).toEqual({})
    }),
  )

  it.effect("creates an SDK only for the OpenRouter package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const ignored = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.openrouter, ModelV2.ID.make("openai/gpt-5")),
          api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "openrouter" },
      })
      expect(ignored.sdk).toBeUndefined()

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom"), ModelV2.ID.make("openai/gpt-5")),
          api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
        }),
        package: "@openrouter/ai-sdk-provider",
        options: { name: "custom" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("filters OpenRouter's gpt-5 chat alias", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.openrouter, (provider) => {
          provider.api = { type: "aisdk", package: "@openrouter/ai-sdk-provider" }
        })
        catalog.provider.update(ProviderV2.ID.openai, () => {})
        catalog.model.update(ProviderV2.ID.openrouter, ModelV2.ID.make("openai/gpt-5-chat"), () => {})
        catalog.model.update(ProviderV2.ID.openrouter, ModelV2.ID.make("openai/gpt-5"), () => {})
        catalog.model.update(ProviderV2.ID.openai, ModelV2.ID.make("openai/gpt-5-chat"), () => {})
      })
      yield* addPlugin()

      expect((yield* catalog.model.get(ProviderV2.ID.openrouter, ModelV2.ID.make("openai/gpt-5-chat")))?.enabled).toBe(
        false,
      )
      expect((yield* catalog.model.get(ProviderV2.ID.openrouter, ModelV2.ID.make("openai/gpt-5")))?.enabled).toBe(true)
      expect((yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("openai/gpt-5-chat")))?.enabled).toBe(true)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-OpenRouter providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("custom-openrouter"), () => {})
        catalog.model.update(ProviderV2.ID.make("custom-openrouter"), ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        (yield* catalog.model.get(ProviderV2.ID.make("custom-openrouter"), ModelV2.ID.make("gpt-5-chat-latest")))
          ?.enabled,
      ).toBe(true)
    }),
  )
})
