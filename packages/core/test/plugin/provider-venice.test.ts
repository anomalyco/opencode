import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { VenicePlugin } from "@opencode-ai/core/plugin/provider/venice"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* VenicePlugin.effect(host)
})

function fakeSelectorSdk(calls: string[]) {
  const make = (method: string) => (id: string) => {
    calls.push(`${method}:${id}`)
    return { modelId: id, provider: method, specificationVersion: "v3" } as unknown as LanguageModelV3
  }
  return {
    responses: make("responses"),
    messages: make("messages"),
    chat: make("chat"),
    languageModel: make("languageModel"),
  }
}

describe("VenicePlugin", () => {
  it.effect("creates a Venice SDK for venice-ai-sdk-provider", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("venice"), ModelV2.ID.make("model")),
          modelID: ModelV2.ID.make("model"),
          package: "aisdk:test-provider",
        }),
        package: "venice-ai-sdk-provider",
        options: { name: "venice" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("uses the model provider ID as the bundled Venice SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-venice"), ModelV2.ID.make("model")),
          modelID: ModelV2.ID.make("model"),
          package: "aisdk:test-provider",
        }),
        package: "venice-ai-sdk-provider",
        options: { name: "custom-venice", apiKey: "test" },
      })
      expect(result.sdk).toBeDefined()
      expect(result.sdk.languageModel("model").provider).toBe("custom-venice.chat")
    }),
  )

  it.effect("only handles the bundled venice-ai-sdk-provider package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const similar = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("venice"), ModelV2.ID.make("model")),
          modelID: ModelV2.ID.make("model"),
          package: "aisdk:test-provider",
        }),
        package: "file:///tmp/venice-ai-sdk-provider.js",
        options: { name: "venice" },
      })
      const other = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("venice"), ModelV2.ID.make("model")),
          modelID: ModelV2.ID.make("model"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "venice" },
      })
      expect(similar.sdk).toBeUndefined()
      expect(other.sdk).toBeUndefined()
    }),
  )

  it.effect("leaves Venice language selection to the default languageModel fallback", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("venice"), ModelV2.ID.make("alias")),
          modelID: ModelV2.ID.make("alias"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})
