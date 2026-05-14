import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { OpenRouterPlugin } from "@opencode-ai/core/plugin/provider/openrouter"
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
      yield* plugin.add(OpenRouterPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("openrouter", {
            options: { headers: { Existing: "value" }, body: {}, aisdk: { provider: {}, request: {} } },
          }),
          cancel: false,
        },
      )
      const ignored = yield* plugin.trigger("provider.update", {}, { provider: provider("nvidia"), cancel: false })
      expect(result.provider.options.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect(ignored.provider.options.headers).toEqual({})
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
      yield* plugin.add(OpenRouterPlugin)
      const result = yield* plugin.trigger(
        "model.update",
        {},
        { model: model("openrouter", "openai/gpt-5-chat"), cancel: false },
      )
      const regular = yield* plugin.trigger(
        "model.update",
        {},
        { model: model("openrouter", "openai/gpt-5"), cancel: false },
      )
      const ignored = yield* plugin.trigger(
        "model.update",
        {},
        { model: model("openai", "openai/gpt-5-chat"), cancel: false },
      )

      expect(result.cancel).toBe(true)
      expect(regular.cancel).toBe(false)
      expect(ignored.cancel).toBe(false)
    }),
  )

  it.effect("does not filter gpt-5-chat-latest for non-OpenRouter providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(OpenRouterPlugin)
      const result = yield* plugin.trigger(
        "model.update",
        {},
        { model: model("custom-openrouter", "gpt-5-chat-latest"), cancel: false },
      )
      expect(result.cancel).toBe(false)
    }),
  )
})
