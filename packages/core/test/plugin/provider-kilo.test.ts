import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { KiloPlugin } from "@opencode-ai/core/plugin/provider/kilo"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { expectPluginRegistered, it, provider } from "./provider-helper"

describe("KiloPlugin", () => {
  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() =>
      expectPluginRegistered(
        ProviderPlugins.map((item) => item.id),
        "kilo",
      ),
    ),
  )

  it.effect("applies legacy referer headers only to kilo", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(KiloPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const kilo = provider("kilo", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.kilo.ai/api/gateway" },
          request: { headers: { Existing: "value" }, body: {} },
        })
        catalog.provider.update(kilo.id, (draft) => {
          draft.api = kilo.api
          draft.request = kilo.request
        })
        catalog.provider.update(provider("openrouter").id, () => {})
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("kilo"))).request.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.openrouter)).request.headers).toEqual({})
    }),
  )

  it.effect("uses the exact legacy Kilo header casing and set", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(KiloPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("kilo", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.kilo.ai/api/gateway" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
        })
      })

      const result = yield* catalog.provider.get(ProviderV2.ID.make("kilo"))
      expect(result.request.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect(result.request.headers).not.toHaveProperty("http-referer")
      expect(result.request.headers).not.toHaveProperty("x-title")
      expect(result.request.headers).not.toHaveProperty("X-Source")
    }),
  )

  it.effect("uses the legacy provider-id guard instead of endpoint package matching", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(KiloPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const kilo = provider("kilo", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.kilo.ai/api/gateway" },
        })
        catalog.provider.update(kilo.id, (draft) => {
          draft.api = kilo.api
        })
        const custom = provider("custom-kilo", {
          api: { type: "aisdk", package: "kilo" },
        })
        catalog.provider.update(custom.id, (draft) => {
          draft.api = custom.api
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("kilo"))).request.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("custom-kilo"))).request.headers).toEqual({})
    }),
  )
})
