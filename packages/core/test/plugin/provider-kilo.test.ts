import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { KiloPlugin } from "@opencode-ai/core/plugin/provider/kilo"
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
      yield* plugin.add(KiloPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("kilo", {
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
      })
      expect(ignored.provider.options.headers).toEqual({})
    }),
  )

  it.effect("uses the exact legacy Kilo header casing and set", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(KiloPlugin)
      const result = yield* plugin.trigger("provider.update", {}, { provider: provider("kilo"), cancel: false })

      expect(result.provider.options.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect(result.provider.options.headers).not.toHaveProperty("http-referer")
      expect(result.provider.options.headers).not.toHaveProperty("x-title")
      expect(result.provider.options.headers).not.toHaveProperty("X-Source")
    }),
  )

  it.effect("uses the legacy provider-id guard instead of endpoint package matching", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(KiloPlugin)
      const matchingID = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("kilo", {
            endpoint: { type: "aisdk", package: "not-kilo" },
          }),
          cancel: false,
        },
      )
      const matchingPackage = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("custom-kilo", {
            endpoint: { type: "aisdk", package: "kilo" },
          }),
          cancel: false,
        },
      )

      expect(matchingID.provider.options.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      })
      expect(matchingPackage.provider.options.headers).toEqual({})
    }),
  )
})
