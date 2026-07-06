import { AISDK } from "@opencode-ai/core/aisdk"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { XAIPlugin } from "@opencode-ai/core/plugin/provider/xai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* XAIPlugin.effect(host)
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

describe("XAIPlugin", () => {
  it.effect("creates an xAI SDK only for @ai-sdk/xai", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const ignored = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("xai"), ModelV2.ID.make("grok-4")),
          modelID: ModelV2.ID.make("grok-4"),
          package: "aisdk:@ai-sdk/xai",
        }),
        package: "@ai-sdk/openai-compatible",
        options: {},
      })

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("xai"), ModelV2.ID.make("grok-4")),
          modelID: ModelV2.ID.make("grok-4"),
          package: "aisdk:@ai-sdk/xai",
        }),
        package: "@ai-sdk/xai",
        options: {},
      })

      expect(ignored.sdk).toBeUndefined()
      expect(typeof result.sdk?.responses).toBe("function")
    }),
  )

  it.effect("creates xAI SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-xai"), ModelV2.ID.make("grok-4")),
          modelID: ModelV2.ID.make("grok-4"),
          package: "aisdk:@ai-sdk/xai",
        }),
        package: "@ai-sdk/xai",
        options: {},
      })

      expect(result.sdk.responses("grok-4").provider).toBe("xai.responses")
    }),
  )

  it.effect("uses responses with the model modelID for xAI language models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []

      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("xai"), ModelV2.ID.make("alias")),
          modelID: ModelV2.ID.make("grok-4"),
          package: "aisdk:@ai-sdk/xai",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })

      expect(calls).toEqual(["responses:grok-4"])
      expect(result.language).toBeDefined()
    }),
  )

  it.effect("ignores non-xAI providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []

      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("grok-4")),
          modelID: ModelV2.ID.make("grok-4"),
          package: "aisdk:@ai-sdk/xai",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })

      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})
