import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { KiloPlugin } from "@opencode-ai/core/plugin/provider/kilo"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* KiloPlugin.effect(host)
})

describe("KiloPlugin", () => {
  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() => expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.kilo")),
  )

  it.effect("applies legacy referer headers only to Kilo endpoints", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.make("kilo"), (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
          provider.headers = { Existing: "value" }
        })
        catalog.provider.update(Provider.ID.openrouter, () => {})
      })
      yield* addPlugin()
      expect((yield* catalog.provider.get(Provider.ID.make("kilo")))?.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect((yield* catalog.provider.get(Provider.ID.openrouter))?.headers).toBeUndefined()
    }),
  )

  it.effect("uses the exact legacy Kilo header casing and set", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.make("kilo"), (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(Provider.ID.make("kilo")))?.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect((yield* catalog.provider.get(Provider.ID.make("kilo")))?.headers).not.toHaveProperty("http-referer")
      expect((yield* catalog.provider.get(Provider.ID.make("kilo")))?.headers).not.toHaveProperty("x-title")
      expect((yield* catalog.provider.get(Provider.ID.make("kilo")))?.headers).not.toHaveProperty("X-Source")
    }),
  )

  it.effect("uses endpoint package matching instead of a provider ID guard", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.make("kilo"), (provider) => {
          provider.package = Provider.aisdk("kilo")
        })
        catalog.provider.update(Provider.ID.make("custom-kilo"), (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(Provider.ID.make("kilo")))?.headers).toBeUndefined()
      expect((yield* catalog.provider.get(Provider.ID.make("custom-kilo")))?.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
    }),
  )
})
