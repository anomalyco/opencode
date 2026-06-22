import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { VercelPlugin } from "@opencode-ai/core/plugin/provider/vercel"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { addPlugin, it, model, provider, required } from "./provider-helper"

describe("VercelPlugin", () => {
  it.effect("applies legacy lower-case referer headers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* addPlugin(plugin, VercelPlugin)
      yield* catalog.transform((catalog) => {
        const item = provider("vercel", {
          api: { type: "aisdk", package: "@ai-sdk/vercel" },
          request: { headers: { Existing: "1" }, body: {} },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
          draft.request = item.request
        })
      })
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("vercel"))).request.headers).toEqual({
        Existing: "1",
        "http-referer": "https://opencode.ai/",
        "x-title": "opencode",
      })
    }),
  )

  it.effect("does not add legacy upper-case referer headers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* addPlugin(plugin, VercelPlugin)
      yield* catalog.transform((catalog) => {
        const item = provider("vercel", { api: { type: "aisdk", package: "@ai-sdk/vercel" } })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
        })
      })
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("vercel"))).request.headers).not.toHaveProperty(
        "HTTP-Referer",
      )
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("vercel"))).request.headers).not.toHaveProperty(
        "X-Title",
      )
    }),
  )

  it.effect("creates @ai-sdk/vercel SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin(plugin, VercelPlugin)
      const event = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("custom-vercel", "v0-1.0-md"), package: "@ai-sdk/vercel", options: { name: "custom-vercel" } },
        {},
      )
      expect(event.sdk).toBeDefined()
      expect(event.sdk.languageModel("v0-1.0-md").provider).toBe("vercel.chat")
    }),
  )

  it.effect("ignores non-Vercel providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* addPlugin(plugin, VercelPlugin)
      yield* catalog.transform((catalog) => catalog.provider.update(provider("gateway").id, () => {}))
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("gateway"))).request.headers).toEqual({})
    }),
  )
})
