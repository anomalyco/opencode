import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { OpenRouterPlugin } from "@opencode/core/plugin/provider/openrouter"
import { Provider } from "@opencode/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* OpenRouterPlugin.effect(host)
})

describe("OpenRouterPlugin", () => {
  test("is registered so legacy OpenRouter behavior can be applied", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.openrouter")
  })

  it.effect("applies legacy referer headers only to openrouter", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openrouter, (provider) => {
          provider.package = Provider.aisdk("@openrouter/ai-sdk-provider")
          provider.headers = { Existing: "value" }
        })
        catalog.update(Provider.ID.make("nvidia"), () => {})
      })
      yield* addPlugin()

      expect((yield* catalog.get(Provider.ID.openrouter))?.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect((yield* catalog.get(Provider.ID.make("nvidia")))?.headers).toBeUndefined()
    }),
  )

  it.effect("filters OpenRouter's gpt-5 chat alias", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openrouter, (provider) => {
          provider.package = Provider.aisdk("@openrouter/ai-sdk-provider")
        })
        catalog.update(Provider.ID.openai, () => {})
        catalog.models.update(Provider.ID.openrouter, Model.ID.make("openai/gpt-5-chat"), () => {})
        catalog.models.update(Provider.ID.openrouter, Model.ID.make("openai/gpt-5"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("openai/gpt-5-chat"), () => {})
      })
      yield* addPlugin()

      expect((yield* models.get(Provider.ID.openrouter, Model.ID.make("openai/gpt-5-chat")))?.enabled).toBe(
        false,
      )
      expect((yield* models.get(Provider.ID.openrouter, Model.ID.make("openai/gpt-5")))?.enabled).toBe(true)
      expect((yield* models.get(Provider.ID.openai, Model.ID.make("openai/gpt-5-chat")))?.enabled).toBe(true)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-OpenRouter providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("custom-openrouter"), () => {})
        catalog.models.update(Provider.ID.make("custom-openrouter"), Model.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        (yield* models.get(Provider.ID.make("custom-openrouter"), Model.ID.make("gpt-5-chat-latest")))?.enabled,
      ).toBe(true)
    }),
  )
})
