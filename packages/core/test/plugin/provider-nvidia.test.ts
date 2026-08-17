import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { NvidiaPlugin } from "@opencode-ai/core/plugin/provider/nvidia"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* NvidiaPlugin.effect(host)
})

describe("NvidiaPlugin", () => {
  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() => expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.nvidia")),
  )

  it.effect("applies NVIDIA tracking headers only to nvidia", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.make("nvidia"), (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL: "https://integrate.api.nvidia.com/v1" }
          provider.headers = { Existing: "value" }
        })
        catalog.provider.update(Provider.ID.openrouter, () => {})
      })
      yield* addPlugin()
      expect((yield* catalog.provider.get(Provider.ID.make("nvidia")))?.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-BILLING-INVOKE-ORIGIN": "OpenCode",
      })
      expect((yield* catalog.provider.get(Provider.ID.openrouter))?.headers).toBeUndefined()
    }),
  )

  it.effect("adds billing origin for custom NVIDIA endpoints", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.make("nvidia"), (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL: "https://integrate.api.nvidia.com/v1" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(Provider.ID.make("nvidia")))?.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-BILLING-INVOKE-ORIGIN": "OpenCode",
      })
    }),
  )

  it.effect("preserves an explicit NVIDIA billing origin header", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.make("nvidia"), (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL: "https://integrate.api.nvidia.com/v1" }
          provider.headers = { "X-BILLING-INVOKE-ORIGIN": "CustomOrigin" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(Provider.ID.make("nvidia")))?.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-BILLING-INVOKE-ORIGIN": "CustomOrigin",
      })
    }),
  )
})
