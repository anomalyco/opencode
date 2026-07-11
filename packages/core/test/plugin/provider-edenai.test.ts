import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { EdenAiPlugin } from "@opencode-ai/core/plugin/provider/edenai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* EdenAiPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const edenaiApi = {
  type: "aisdk",
  package: "@ai-sdk/openai-compatible",
  url: "https://api.edenai.run/v3",
} as const

describe("EdenAiPlugin", () => {
  it.effect("is registered so opencode identity headers can be applied", () =>
    Effect.sync(() => expect(ProviderPlugins.map((item) => item.id)).toContain(PluginV2.ID.make("edenai"))),
  )

  it.effect("applies the opencode identity headers to edenai", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("edenai"), (provider) => {
          provider.api = { ...edenaiApi }
        })
      })
      yield* addPlugin()
      const result = required(yield* catalog.provider.get(ProviderV2.ID.make("edenai")))
      expect(result.request.headers).toEqual({ "HTTP-Referer": "https://opencode.ai/", "X-Title": "opencode" })
    }),
  )

  it.effect("merges opencode identity headers with existing headers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("edenai"), (provider) => {
          provider.api = { ...edenaiApi }
          provider.request.headers.Existing = "value"
        })
      })
      yield* addPlugin()
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("edenai"))).request.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
    }),
  )

  it.effect("only touches the edenai openai-compatible endpoint", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        // A different openai-compatible provider must be left untouched.
        catalog.provider.update(ProviderV2.ID.make("zenmux"), (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://zenmux.ai/api/v1" }
        })
      })
      yield* addPlugin()
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("zenmux"))).request.headers).toEqual({})
    }),
  )
})
