import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@bolt-ai/core/catalog"
import { PluginV2 } from "@bolt-ai/core/plugin"
import { PluginHost } from "@bolt-ai/core/plugin/host"
import { ProviderPlugins } from "@bolt-ai/core/plugin/provider"
import { NvidiaPlugin } from "@bolt-ai/core/plugin/provider/nvidia"
import { ProviderV2 } from "@bolt-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* NvidiaPlugin.effect(host)
})

describe("NvidiaPlugin", () => {
  test("is registered so legacy referer headers can be applied", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.nvidia")
  })

  it.effect("applies NVIDIA tracking headers only to nvidia", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("nvidia"), (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { baseURL: "https://integrate.api.nvidia.com/v1" }
          provider.headers = { Existing: "value" }
        })
        catalog.update(Provider.ID.openrouter, () => {})
      })
      yield* addPlugin()
      expect((yield* catalog.get(Provider.ID.make("nvidia")))?.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://bolt.ai/",
        "X-Title": "bolt",
        "X-BILLING-INVOKE-ORIGIN": "Bolt",
      })
      expect((yield* catalog.get(Provider.ID.openrouter))?.headers).toBeUndefined()
    }),
  )

  it.effect("adds billing origin for custom NVIDIA endpoints", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("nvidia"), (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { baseURL: "https://integrate.api.nvidia.com/v1" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia")))?.request.headers).toEqual({
        "HTTP-Referer": "https://bolt.ai/",
        "X-Title": "bolt",
        "X-BILLING-INVOKE-ORIGIN": "Bolt",
      })
    }),
  )

  it.effect("preserves an explicit NVIDIA billing origin header", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("nvidia"), (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { baseURL: "https://integrate.api.nvidia.com/v1" }
          provider.headers = { "X-BILLING-INVOKE-ORIGIN": "CustomOrigin" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia")))?.request.headers).toEqual({
        "HTTP-Referer": "https://bolt.ai/",
        "X-Title": "bolt",
        "X-BILLING-INVOKE-ORIGIN": "CustomOrigin",
      })
    }),
  )
})
