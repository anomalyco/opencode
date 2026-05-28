import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@simpliciocode/core/catalog"
import { PluginV2 } from "@simpliciocode/core/plugin"
import { ProviderPlugins } from "@simpliciocode/core/plugin/provider"
import { ZenmuxPlugin } from "@simpliciocode/core/plugin/provider/zenmux"
import { ProviderV2 } from "@simpliciocode/core/provider"
import { expectPluginRegistered, it, provider } from "./provider-helper"

describe("ZenmuxPlugin", () => {
  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() =>
      expectPluginRegistered(
        ProviderPlugins.map((item) => item.id),
        "zenmux",
      ),
    ),
  )

  it.effect("applies the exact legacy Zenmux headers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(ZenmuxPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => {
        const item = provider("zenmux", {
          endpoint: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://zenmux.ai/api/v1" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.endpoint = item.endpoint
        })
      })
      const result = yield* catalog.provider.get(ProviderV2.ID.make("zenmux"))
      expect(result.options.headers).toEqual({ "HTTP-Referer": "https://opencode.ai/", "X-Title": "opencode" })
      expect(Object.keys(result.options.headers).sort()).toEqual(["HTTP-Referer", "X-Title"])
    }),
  )

  it.effect("merges legacy Zenmux headers with existing headers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(ZenmuxPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => {
        const item = provider("zenmux", {
          endpoint: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://zenmux.ai/api/v1" },
          options: { headers: { Existing: "value" }, body: {}, aisdk: { provider: {}, request: {} } },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.endpoint = item.endpoint
          draft.options = item.options
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("zenmux"))).options.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
    }),
  )

  it.effect("lets configured Zenmux legacy headers override defaults", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(ZenmuxPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => {
        const item = provider("zenmux", {
          endpoint: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://zenmux.ai/api/v1" },
          options: {
            headers: { "HTTP-Referer": "https://example.com/", "X-Title": "custom-title" },
            body: {},
            aisdk: { provider: {}, request: {} },
          },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.endpoint = item.endpoint
          draft.options = item.options
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("zenmux"))).options.headers).toEqual({
        "HTTP-Referer": "https://example.com/",
        "X-Title": "custom-title",
      })
    }),
  )

  it.effect("guards legacy Zenmux headers to the exact zenmux provider id", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(ZenmuxPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => {
        const item = provider("openrouter", {
          options: {
            headers: { "HTTP-Referer": "https://example.com/", "X-Title": "custom-title" },
            body: {},
            aisdk: { provider: {}, request: {} },
          },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.options = item.options
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.openrouter)).options.headers).toEqual({
        "HTTP-Referer": "https://example.com/",
        "X-Title": "custom-title",
      })
    }),
  )
})
