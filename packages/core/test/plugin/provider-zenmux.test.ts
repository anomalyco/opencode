import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { ZenmuxPlugin } from "@opencode-ai/core/plugin/provider/zenmux"
import { ProviderV2 } from "@opencode-ai/core/provider"
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
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("zenmux", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://zenmux.ai/api/v1" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
        })
      })
      const result = yield* catalog.provider.get(ProviderV2.ID.make("zenmux"))
      expect(result.request.headers).toEqual({ "HTTP-Referer": "https://opencode.ai/", "X-Title": "opencode" })
      expect(Object.keys(result.request.headers).sort()).toEqual(["HTTP-Referer", "X-Title"])
    }),
  )

  it.effect("merges legacy Zenmux headers with existing headers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(ZenmuxPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("zenmux", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://zenmux.ai/api/v1" },
          request: { headers: { Existing: "value" }, body: {} },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
          draft.request = item.request
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("zenmux"))).request.headers).toEqual({
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
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("zenmux", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://zenmux.ai/api/v1" },
          request: {
            headers: { "HTTP-Referer": "https://example.com/", "X-Title": "custom-title" },
            body: {},
          },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
          draft.request = item.request
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("zenmux"))).request.headers).toEqual({
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
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("openrouter", {
          request: {
            headers: { "HTTP-Referer": "https://example.com/", "X-Title": "custom-title" },
            body: {},
          },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.request = item.request
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.openrouter)).request.headers).toEqual({
        "HTTP-Referer": "https://example.com/",
        "X-Title": "custom-title",
      })
    }),
  )
})
