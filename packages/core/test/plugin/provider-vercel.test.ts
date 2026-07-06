import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { VercelPlugin } from "@opencode-ai/core/plugin/provider/vercel"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* VercelPlugin.effect(host)
})

describe("VercelPlugin", () => {
  it.effect("applies legacy lower-case referer headers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("vercel"), (provider) => {
          provider.package = ProviderV2.aisdk("@ai-sdk/vercel")
          provider.headers = { ...provider.headers, Existing: "1" }
        })
      })
      yield* addPlugin()
      expect((yield* catalog.provider.get(ProviderV2.ID.make("vercel")))?.headers).toEqual({
        Existing: "1",
        "http-referer": "https://opencode.ai/",
        "x-title": "opencode",
      })
    }),
  )

  it.effect("does not add legacy upper-case referer headers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) =>
        catalog.provider.update(ProviderV2.ID.make("vercel"), (provider) => {
          provider.package = ProviderV2.aisdk("@ai-sdk/vercel")
        }),
      )
      yield* addPlugin()
      expect((yield* catalog.provider.get(ProviderV2.ID.make("vercel")))?.headers).not.toHaveProperty("HTTP-Referer")
      expect((yield* catalog.provider.get(ProviderV2.ID.make("vercel")))?.headers).not.toHaveProperty("X-Title")
    }),
  )

  it.effect("creates @ai-sdk/vercel SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const event = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-vercel"), ModelV2.ID.make("v0-1.0-md")),
          modelID: ModelV2.ID.make("v0-1.0-md"),
          package: "aisdk:@ai-sdk/vercel",
        }),
        package: "@ai-sdk/vercel",
        options: { name: "custom-vercel" },
      })
      expect(event.sdk).toBeDefined()
      expect(event.sdk.languageModel("v0-1.0-md").provider).toBe("vercel.chat")
    }),
  )

  it.effect("ignores non-Vercel providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => catalog.provider.update(ProviderV2.ID.make("gateway"), () => {}))
      yield* addPlugin()
      expect((yield* catalog.provider.get(ProviderV2.ID.make("gateway")))?.headers).toBeUndefined()
    }),
  )
})
