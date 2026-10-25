import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@bolt-ai/core/catalog"
import { PluginV2 } from "@bolt-ai/core/plugin"
import { PluginHost } from "@bolt-ai/core/plugin/host"
import { ProviderPlugins } from "@bolt-ai/core/plugin/provider"
import { ZenmuxPlugin } from "@bolt-ai/core/plugin/provider/zenmux"
import { ProviderV2 } from "@bolt-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* ZenmuxPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

describe("ZenmuxPlugin", () => {
  test("is registered so legacy referer headers can be applied", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.zenmux")
  })

  it.effect("applies the exact legacy Zenmux headers", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("zenmux"), (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { ...provider.settings, baseURL: "https://zenmux.ai/api/v1" }
        })
      })
      yield* addPlugin()
      const result = required(yield* catalog.provider.get(ProviderV2.ID.make("zenmux")))
      expect(result.request.headers).toEqual({ "HTTP-Referer": "https://bolt.ai/", "X-Title": "bolt" })
      expect(Object.keys(result.request.headers).sort()).toEqual(["HTTP-Referer", "X-Title"])
    }),
  )

  it.effect("merges legacy Zenmux headers with existing headers", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("zenmux"), (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { ...provider.settings, baseURL: "https://zenmux.ai/api/v1" }
          provider.headers = { ...provider.headers, Existing: "value" }
        })
      })
      yield* addPlugin()

      expect(required(yield* catalog.get(Provider.ID.make("zenmux"))).headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://bolt.ai/",
        "X-Title": "bolt",
      })
    }),
  )

  it.effect("lets configured Zenmux legacy headers override defaults", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("zenmux"), (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { ...provider.settings, baseURL: "https://zenmux.ai/api/v1" }
          provider.headers = { "HTTP-Referer": "https://example.com/", "X-Title": "custom-title" }
        })
      })
      yield* addPlugin()

      expect(required(yield* catalog.get(Provider.ID.make("zenmux"))).headers).toEqual({
        "HTTP-Referer": "https://example.com/",
        "X-Title": "custom-title",
      })
    }),
  )

  it.effect("guards legacy Zenmux headers to the exact zenmux provider id", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openrouter, (provider) => {
          provider.headers = { "HTTP-Referer": "https://example.com/", "X-Title": "custom-title" }
        })
      })
      yield* addPlugin()

      expect(required(yield* catalog.get(Provider.ID.openrouter)).headers).toEqual({
        "HTTP-Referer": "https://example.com/",
        "X-Title": "custom-title",
      })
    }),
  )
})
