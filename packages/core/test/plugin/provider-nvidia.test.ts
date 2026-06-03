import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { NvidiaPlugin } from "@opencode-ai/core/plugin/provider/nvidia"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { expectPluginRegistered, it, provider } from "./provider-helper"

describe("NvidiaPlugin", () => {
  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() =>
      expectPluginRegistered(
        ProviderPlugins.map((item) => item.id),
        "nvidia",
      ),
    ),
  )

  it.effect("applies NVIDIA tracking headers only to nvidia", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(NvidiaPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const nvidia = provider("nvidia", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://integrate.api.nvidia.com/v1" },
          request: { headers: { Existing: "value" }, body: {} },
        })
        catalog.provider.update(nvidia.id, (draft) => {
          draft.api = nvidia.api
          draft.request = nvidia.request
        })
        catalog.provider.update(provider("openrouter").id, () => {})
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia"))).request.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-BILLING-INVOKE-ORIGIN": "OpenCode",
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.openrouter)).request.headers).toEqual({})
    }),
  )

  it.effect("adds billing origin for custom NVIDIA endpoints", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(NvidiaPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("nvidia", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://integrate.api.nvidia.com/v1" },
          request: { headers: {}, body: {} },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
          draft.request = item.request
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia"))).request.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-BILLING-INVOKE-ORIGIN": "OpenCode",
      })
    }),
  )

  it.effect("preserves an explicit NVIDIA billing origin header", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(NvidiaPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("nvidia", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://integrate.api.nvidia.com/v1" },
          request: {
            headers: { "X-BILLING-INVOKE-ORIGIN": "CustomOrigin" },
            body: { baseURL: "https://integrate.api.nvidia.com/v1" },
          },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
          draft.request = item.request
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia"))).request.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-BILLING-INVOKE-ORIGIN": "CustomOrigin",
      })
    }),
  )
})
