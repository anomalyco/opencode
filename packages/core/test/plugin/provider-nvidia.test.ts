import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@moks/core/catalog"
import { PluginV2 } from "@moks/core/plugin"
import { PluginHost } from "@moks/core/plugin/host"
import { ProviderPlugins } from "@moks/core/plugin/provider"
import { NvidiaPlugin } from "@moks/core/plugin/provider/nvidia"
import { ProviderV2 } from "@moks/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* NvidiaPlugin.effect(host)
})

describe("NvidiaPlugin", () => {
  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() => expect(ProviderPlugins.map((item) => item.id)).toContain(PluginV2.ID.make("nvidia"))),
  )

  it.effect("applies NVIDIA tracking headers only to nvidia", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("nvidia"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://integrate.api.nvidia.com/v1",
          }
          provider.request = { headers: { Existing: "value" }, body: {} }
        })
        catalog.provider.update(ProviderV2.ID.openrouter, () => {})
      })
      yield* addPlugin()
      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia")))?.request.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://github.com/artemysone/moks",
        "X-Title": "moks",
        "X-BILLING-INVOKE-ORIGIN": "moks",
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.openrouter))?.request.headers).toEqual({})
    }),
  )

  it.effect("adds billing origin for custom NVIDIA endpoints", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("nvidia"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://integrate.api.nvidia.com/v1",
          }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia")))?.request.headers).toEqual({
        "HTTP-Referer": "https://github.com/artemysone/moks",
        "X-Title": "moks",
        "X-BILLING-INVOKE-ORIGIN": "moks",
      })
    }),
  )

  it.effect("preserves an explicit NVIDIA billing origin header", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("nvidia"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://integrate.api.nvidia.com/v1",
          }
          provider.request = {
            headers: { "X-BILLING-INVOKE-ORIGIN": "CustomOrigin" },
            body: { baseURL: "https://integrate.api.nvidia.com/v1" },
          }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia")))?.request.headers).toEqual({
        "HTTP-Referer": "https://github.com/artemysone/moks",
        "X-Title": "moks",
        "X-BILLING-INVOKE-ORIGIN": "CustomOrigin",
      })
    }),
  )
})
