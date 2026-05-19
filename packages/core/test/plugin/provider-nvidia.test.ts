import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { NvidiaPlugin } from "@opencode-ai/core/plugin/provider/nvidia"
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
      yield* plugin.add(NvidiaPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("nvidia", {
            options: { headers: { Existing: "value" }, body: {}, aisdk: { provider: {}, request: {} } },
          }),
          cancel: false,
        },
      )
      const ignored = yield* plugin.trigger("provider.update", {}, { provider: provider("openrouter"), cancel: false })
      expect(result.provider.options.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-BILLING-INVOKE-ORIGIN": "OpenCode",
      })
      expect(ignored.provider.options.headers).toEqual({})
    }),
  )

  it.effect("adds billing origin for custom NVIDIA endpoints", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(NvidiaPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("nvidia", {
            endpoint: { type: "aisdk", package: "test-provider", url: "http://localhost:8000/v1" },
            options: { headers: {}, body: {}, aisdk: { provider: {}, request: {} } },
          }),
          cancel: false,
        },
      )

      expect(result.provider.options.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-BILLING-INVOKE-ORIGIN": "OpenCode",
      })
    }),
  )

  it.effect("preserves an explicit NVIDIA billing origin header", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(NvidiaPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("nvidia", {
            options: {
              headers: { "X-BILLING-INVOKE-ORIGIN": "CustomOrigin" },
              body: {},
              aisdk: { provider: { baseURL: "https://integrate.api.nvidia.com/v1" }, request: {} },
            },
          }),
          cancel: false,
        },
      )

      expect(result.provider.options.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-BILLING-INVOKE-ORIGIN": "CustomOrigin",
      })
    }),
  )
})
