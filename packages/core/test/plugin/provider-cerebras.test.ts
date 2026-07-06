import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { CerebrasPlugin } from "@opencode-ai/core/plugin/provider/cerebras"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const cerebrasOptions: Record<string, unknown>[] = []
const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* CerebrasPlugin.effect(host)
})

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
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("cerebras"), (item) => {
          item.package = ProviderV2.aisdk("@ai-sdk/cerebras")
          item.headers = { ...item.headers, Existing: "1" }
        })
      })
      yield* addPlugin()
      expect((yield* catalog.provider.get(ProviderV2.ID.make("cerebras")))?.headers).toEqual({
        Existing: "1",
        "X-Cerebras-3rd-Party-Integration": "opencode",
      })
    }),
  )

  it.effect("ignores non-Cerebras providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => catalog.provider.update(ProviderV2.ID.make("groq"), () => {}))
      yield* addPlugin()
      expect((yield* catalog.provider.get(ProviderV2.ID.make("groq")))?.headers).toBeUndefined()
    }),
  )

  it.effect("creates a bundled Cerebras SDK with the model provider ID as the SDK name", () =>
    Effect.gen(function* () {
      cerebrasOptions.length = 0
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(
            ProviderV2.ID.make("custom-cerebras"),
            ModelV2.ID.make("llama-4-scout-17b-16e-instruct"),
          ),
          modelID: ModelV2.ID.make("llama-4-scout-17b-16e-instruct"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/cerebras",
        options: { name: "custom-cerebras", apiKey: "test" },
      })
      expect(cerebrasOptions).toEqual([{ name: "custom-cerebras", apiKey: "test" }])
      expect(result.sdk.languageModel("llama-4-scout-17b-16e-instruct").provider).toBe("custom-cerebras")
    }),
  )

  it.effect("preserves an explicit bundled Cerebras SDK name option", () =>
    Effect.gen(function* () {
      cerebrasOptions.length = 0
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(
            ProviderV2.ID.make("custom-cerebras"),
            ModelV2.ID.make("llama-4-scout-17b-16e-instruct"),
          ),
          modelID: ModelV2.ID.make("llama-4-scout-17b-16e-instruct"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/cerebras",
        options: { name: "configured-cerebras", apiKey: "test" },
      })
      expect(cerebrasOptions).toEqual([{ name: "configured-cerebras", apiKey: "test" }])
    }),
  )

  it.effect("ignores non-Cerebras SDK packages", () =>
    Effect.gen(function* () {
      cerebrasOptions.length = 0
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(
            ProviderV2.ID.make("custom-cerebras"),
            ModelV2.ID.make("llama-4-scout-17b-16e-instruct"),
          ),
          modelID: ModelV2.ID.make("llama-4-scout-17b-16e-instruct"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/groq",
        options: { name: "custom-cerebras", apiKey: "test" },
      })
      expect(cerebrasOptions).toEqual([])
      expect(result.sdk).toBeUndefined()
    }),
  )
})
