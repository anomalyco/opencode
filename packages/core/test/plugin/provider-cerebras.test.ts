import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { CerebrasPlugin } from "@opencode-ai/core/plugin/provider/cerebras"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* CerebrasPlugin.effect(host)
})

describe("CerebrasPlugin", () => {
  it.effect("applies the legacy integration header", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.make("cerebras"), (item) => {
          item.package = Provider.aisdk("@ai-sdk/cerebras")
          item.headers = { ...item.headers, Existing: "1" }
        })
      })
      yield* addPlugin()
      expect((yield* catalog.provider.get(Provider.ID.make("cerebras")))?.headers).toEqual({
        Existing: "1",
        "X-Cerebras-3rd-Party-Integration": "opencode",
      })
    }),
  )

  it.effect("ignores non-Cerebras providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => catalog.provider.update(Provider.ID.make("groq"), () => {}))
      yield* addPlugin()
      expect((yield* catalog.provider.get(Provider.ID.make("groq")))?.headers).toBeUndefined()
    }),
  )

  it.effect("applies the integration header to custom native Cerebras providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = Provider.ID.make("custom-cerebras")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (item) => {
          item.package = "@opencode-ai/ai/providers/cerebras"
          item.headers = { Existing: "1" }
        })
      })
      yield* addPlugin()
      expect((yield* catalog.provider.get(providerID))?.headers).toEqual({
        Existing: "1",
        "X-Cerebras-3rd-Party-Integration": "opencode",
      })
    }),
  )
})
