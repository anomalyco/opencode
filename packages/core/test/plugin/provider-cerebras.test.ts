import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { CerebrasPlugin } from "@opencode-ai/core/plugin/provider/cerebras"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { it, model } from "./provider-helper"

const cerebrasOptions: Record<string, unknown>[] = []

void mock.module("@ai-sdk/cerebras", () => ({
  createCerebras: (options: Record<string, unknown>) => {
    const snapshot = { ...options }
    cerebrasOptions.push(snapshot)
    return {
      languageModel: (modelID: string) => ({ modelID, provider: snapshot.name, specificationVersion: "v3" }),
    }
  },
}))

describe("CerebrasPlugin", () => {
  it.effect("applies the legacy integration header", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(CerebrasPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("cerebras"), (item) => {
          item.endpoint = { type: "aisdk", package: "@ai-sdk/cerebras" }
          item.options.headers.Existing = "1"
        })
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("cerebras"))).options.headers).toEqual({
        Existing: "1",
        "X-Cerebras-3rd-Party-Integration": "opencode",
      })
    }),
  )

  it.effect("ignores non-Cerebras providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(CerebrasPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => catalog.provider.update(ProviderV2.ID.make("groq"), () => {}))
      expect((yield* catalog.provider.get(ProviderV2.ID.make("groq"))).options.headers).toEqual({})
    }),
  )

  it.effect("creates a bundled Cerebras SDK with the model provider ID as the SDK name", () =>
    Effect.gen(function* () {
      cerebrasOptions.length = 0
      const plugin = yield* PluginV2.Service
      yield* plugin.add(CerebrasPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-cerebras", "llama-4-scout-17b-16e-instruct"),
          package: "@ai-sdk/cerebras",
          options: { name: "custom-cerebras", apiKey: "test" },
        },
        {},
      )
      expect(cerebrasOptions).toEqual([{ name: "custom-cerebras", apiKey: "test" }])
      expect(result.sdk.languageModel("llama-4-scout-17b-16e-instruct").provider).toBe("custom-cerebras")
    }),
  )

  it.effect("preserves an explicit bundled Cerebras SDK name option", () =>
    Effect.gen(function* () {
      cerebrasOptions.length = 0
      const plugin = yield* PluginV2.Service
      yield* plugin.add(CerebrasPlugin)
      yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-cerebras", "llama-4-scout-17b-16e-instruct"),
          package: "@ai-sdk/cerebras",
          options: { name: "configured-cerebras", apiKey: "test" },
        },
        {},
      )
      expect(cerebrasOptions).toEqual([{ name: "configured-cerebras", apiKey: "test" }])
    }),
  )

  it.effect("ignores non-Cerebras SDK packages", () =>
    Effect.gen(function* () {
      cerebrasOptions.length = 0
      const plugin = yield* PluginV2.Service
      yield* plugin.add(CerebrasPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-cerebras", "llama-4-scout-17b-16e-instruct"),
          package: "@ai-sdk/groq",
          options: { name: "custom-cerebras", apiKey: "test" },
        },
        {},
      )
      expect(cerebrasOptions).toEqual([])
      expect(result.sdk).toBeUndefined()
    }),
  )
})
