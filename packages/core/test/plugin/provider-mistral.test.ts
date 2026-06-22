import type { LanguageModelV3 } from "@ai-sdk/provider"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { MistralPlugin } from "@opencode-ai/core/plugin/provider/mistral"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make()
  yield* plugin.add({ id: MistralPlugin.id, effect: MistralPlugin.effect(host) })
})

describe("MistralPlugin", () => {
  it.effect("creates a Mistral SDK for @ai-sdk/mistral", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("mistral"), ModelV2.ID.make("mistral-large")),
            api: { id: ModelV2.ID.make("mistral-large"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/mistral",
          options: { name: "mistral" },
        },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("ignores non-Mistral SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("mistral"), ModelV2.ID.make("mistral-large")),
            api: { id: ModelV2.ID.make("mistral-large"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/openai-compatible",
          options: { name: "mistral" },
        },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("matches the old bundled Mistral SDK provider name for the bundled provider ID", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const providers: string[] = []
      yield* addPlugin()
      yield* plugin.hook("aisdk.sdk", (event) =>
        Effect.sync(() => {
          providers.push(event.sdk.languageModel("mistral-large").provider)
        }),
      )
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("mistral"), ModelV2.ID.make("mistral-large")),
            api: { id: ModelV2.ID.make("mistral-large"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/mistral",
          options: { name: "mistral" },
        },
        {},
      )
      expect(result.sdk).toBeDefined()
      expect(providers).toEqual(["mistral.chat"])
    }),
  )

  it.effect("matches the old bundled Mistral SDK provider name for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const providers: string[] = []
      yield* addPlugin()
      yield* plugin.hook("aisdk.sdk", (event) =>
        Effect.sync(() => {
          providers.push(event.sdk.languageModel("mistral-large").provider)
        }),
      )
      yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("custom-mistral"), ModelV2.ID.make("mistral-large")),
            api: { id: ModelV2.ID.make("mistral-large"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/mistral",
          options: { name: "custom-mistral" },
        },
        {},
      )
      expect(providers).toEqual(["mistral.chat"])
    }),
  )

  it.effect("leaves Mistral language selection on the default sdk.languageModel(api.id) path", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      const sdk = {
        languageModel: (id: string) => {
          calls.push(`languageModel:${id}`)
          return { modelId: id, provider: "languageModel", specificationVersion: "v3" } as unknown as LanguageModelV3
        },
      }
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("mistral"), ModelV2.ID.make("alias")),
            api: { id: ModelV2.ID.make("mistral-large"), type: "aisdk", package: "test-provider" },
          }),
          sdk,
          options: {},
        },
        {},
      )
      const language = result.language ?? sdk.languageModel(result.model.api.id)
      expect(calls).toEqual(["languageModel:mistral-large"])
      expect(language).toBeDefined()
    }),
  )
})
