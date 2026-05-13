import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { ZenmuxPlugin } from "@opencode-ai/core/plugin/provider/zenmux"
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
      yield* plugin.add(ZenmuxPlugin)
      const result = yield* plugin.trigger("provider.update", {}, { provider: provider("zenmux"), cancel: false })
      expect(result.provider.options.headers).toEqual({ "HTTP-Referer": "https://opencode.ai/", "X-Title": "opencode" })
      expect(Object.keys(result.provider.options.headers).sort()).toEqual(["HTTP-Referer", "X-Title"])
      expect(result.cancel).toBe(false)
    }),
  )

  it.effect("merges legacy Zenmux headers with existing headers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(ZenmuxPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("zenmux", {
            options: { headers: { Existing: "value" }, body: {}, aisdk: { provider: {}, request: {} } },
          }),
          cancel: false,
        },
      )

      expect(result.provider.options.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
    }),
  )

  it.effect("lets configured Zenmux legacy headers override defaults", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(ZenmuxPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("zenmux", {
            options: {
              headers: { "HTTP-Referer": "https://example.com/", "X-Title": "custom-title" },
              body: {},
              aisdk: { provider: {}, request: {} },
            },
          }),
          cancel: false,
        },
      )

      expect(result.provider.options.headers).toEqual({
        "HTTP-Referer": "https://example.com/",
        "X-Title": "custom-title",
      })
    }),
  )

  it.effect("guards legacy Zenmux headers to the exact zenmux provider id", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(ZenmuxPlugin)
      const ignored = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("openrouter", {
            options: {
              headers: { "HTTP-Referer": "https://example.com/", "X-Title": "custom-title" },
              body: {},
              aisdk: { provider: {}, request: {} },
            },
          }),
          cancel: false,
        },
      )

      expect(ignored.provider.options.headers).toEqual({
        "HTTP-Referer": "https://example.com/",
        "X-Title": "custom-title",
      })
    }),
  )
})
