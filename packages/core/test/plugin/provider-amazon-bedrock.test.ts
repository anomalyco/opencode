import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AmazonBedrockPlugin } from "@opencode-ai/core/plugin/provider/amazon-bedrock"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* AmazonBedrockPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

describe("AmazonBedrockPlugin", () => {
  it.effect("moves endpoint setting to baseURL", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        const bedrock = Provider.Info.make({
          ...Provider.Info.empty(Provider.ID.amazonBedrock),
          package: Provider.aisdk("@ai-sdk/amazon-bedrock"),
          settings: { endpoint: "https://bedrock.example" },
        })
        catalog.provider.update(bedrock.id, (item) => {
          item.package = bedrock.package
          item.settings = { endpoint: "https://bedrock.example" }
        })
      })
      yield* addPlugin()
      const result = required(yield* catalog.provider.get(Provider.ID.amazonBedrock))
      expect(result.package).toBe(Provider.aisdk("@ai-sdk/amazon-bedrock"))
      expect(result.settings).toEqual({ baseURL: "https://bedrock.example" })
    }),
  )
})
