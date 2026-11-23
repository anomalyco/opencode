import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { AnthropicPlugin } from "@opencode/core/plugin/provider/anthropic"
import { Provider } from "@opencode/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("anthropic")

const settingsAfterPlugin = Effect.fn(function* (settings?: Provider.Settings) {
  const catalog = yield* Provider.Service
  yield* catalog.transform((catalog) =>
    catalog.update(providerID, (provider) => {
      provider.package = "@opencode/ai/providers/anthropic"
      provider.settings = settings
    }),
  )
  const plugin = yield* Plugin.Service
  yield* AnthropicPlugin.effect(yield* PluginHost.make(plugin, "test"))
  return (yield* catalog.get(providerID))?.settings
})

describe("AnthropicPlugin", () => {
  it.effect("gzips request bodies to the Anthropic API by default", () =>
    Effect.gen(function* () {
      expect((yield* settingsAfterPlugin())?.encoding).toBe("gzip")
    }),
  )

  it.effect("keeps a configured encoding", () =>
    Effect.gen(function* () {
      expect((yield* settingsAfterPlugin({ encoding: "none" }))?.encoding).toBe("none")
    }),
  )

  it.effect("leaves a custom baseURL uncompressed, since a proxy may not decode gzip", () =>
    Effect.gen(function* () {
      expect((yield* settingsAfterPlugin({ baseURL: "https://proxy.example/v1" }))?.encoding).toBeUndefined()
    }),
  )
})
