import { AISDK } from "@bolt-ai/core/aisdk"
import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@bolt-ai/core/catalog"
import { ModelV2 } from "@bolt-ai/core/model"
import { PluginV2 } from "@bolt-ai/core/plugin"
import { PluginHost } from "@bolt-ai/core/plugin/host"
import { CerebrasPlugin } from "@bolt-ai/core/plugin/provider/cerebras"
import { ProviderV2 } from "@bolt-ai/core/provider"
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
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("cerebras"), (item) => {
          item.package = "@opencode/ai/providers/cerebras"
          item.headers = { ...item.headers, Existing: "1" }
        })
      })
      yield* addPlugin()
      expect((yield* catalog.get(Provider.ID.make("cerebras")))?.headers).toEqual({
        Existing: "1",
        "X-Cerebras-3rd-Party-Integration": "bolt",
      })
    }),
  )

  it.effect("ignores non-Cerebras providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => catalog.update(Provider.ID.make("groq"), () => {}))
      yield* addPlugin()
      expect((yield* catalog.get(Provider.ID.make("groq")))?.headers).toBeUndefined()
    }),
  )

  it.effect("applies the integration header to custom native Cerebras providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const providerID = Provider.ID.make("custom-cerebras")
      yield* catalog.transform((catalog) => {
        catalog.update(providerID, (item) => {
          item.package = "@opencode/ai/providers/cerebras"
          item.headers = { Existing: "1" }
        })
      })
      yield* addPlugin()
      expect((yield* catalog.get(providerID))?.headers).toEqual({
        Existing: "1",
        "X-Cerebras-3rd-Party-Integration": "opencode",
      })
    }),
  )
})
