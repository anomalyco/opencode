import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@bolt-ai/core/catalog"
import { PluginV2 } from "@bolt-ai/core/plugin"
import { PluginHost } from "@bolt-ai/core/plugin/host"
import { ProviderPlugins } from "@bolt-ai/core/plugin/provider"
import { KiloPlugin } from "@bolt-ai/core/plugin/provider/kilo"
import { ProviderV2 } from "@bolt-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* KiloPlugin.effect(host)
})

describe("KiloPlugin", () => {
  test("is registered so legacy referer headers can be applied", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.kilo")
  })

  it.effect("applies legacy referer headers only to Kilo endpoints", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("kilo"), (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
          provider.headers = { Existing: "value" }
        })
        catalog.update(Provider.ID.openrouter, () => {})
      })
      yield* addPlugin()
      expect((yield* catalog.get(Provider.ID.make("kilo")))?.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://bolt.ai/",
        "X-Title": "bolt",
      })
      expect((yield* catalog.get(Provider.ID.openrouter))?.headers).toBeUndefined()
    }),
  )

  it.effect("uses the exact legacy Kilo header casing and set", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("kilo"), (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(ProviderV2.ID.make("kilo")))?.request.headers).toEqual({
        "HTTP-Referer": "https://bolt.ai/",
        "X-Title": "bolt",
      })
      expect((yield* catalog.get(Provider.ID.make("kilo")))?.headers).not.toHaveProperty("http-referer")
      expect((yield* catalog.get(Provider.ID.make("kilo")))?.headers).not.toHaveProperty("x-title")
      expect((yield* catalog.get(Provider.ID.make("kilo")))?.headers).not.toHaveProperty("X-Source")
    }),
  )

  it.effect("uses endpoint package matching instead of a provider ID guard", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("kilo"), (provider) => {
          provider.package = Provider.aisdk("kilo")
        })
        catalog.update(Provider.ID.make("custom-kilo"), (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(ProviderV2.ID.make("kilo")))?.request.headers).toEqual({
        "HTTP-Referer": "https://bolt.ai/",
        "X-Title": "bolt",
      })
    }),
  )
})
