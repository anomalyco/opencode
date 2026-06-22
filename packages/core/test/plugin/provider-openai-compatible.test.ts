import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OpenAICompatiblePlugin } from "@opencode-ai/core/plugin/provider/openai-compatible"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make()
  yield* plugin.add({ id: OpenAICompatiblePlugin.id, effect: OpenAICompatiblePlugin.effect(host) })
})

describe("OpenAICompatiblePlugin", () => {
  it.effect("preserves explicit includeUsage false and defaults it to true", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const defaulted = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("custom"), ModelV2.ID.make("model")),
            api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/openai-compatible",
          options: { name: "custom" },
        },
        {},
      )
      const disabled = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("custom"), ModelV2.ID.make("model")),
            api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/openai-compatible",
          options: { name: "custom", includeUsage: false },
        },
        {},
      )
      expect(defaulted.options.includeUsage).toBe(true)
      expect(disabled.options.includeUsage).toBe(false)
    }),
  )

  it.effect("defaults includeUsage for OpenAI-compatible package matches", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("custom"), ModelV2.ID.make("model")),
            api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
          }),
          package: "file:///tmp/@ai-sdk/openai-compatible-provider.js",
          options: { name: "custom" },
        },
        {},
      )
      expect(result.options.includeUsage).toBe(true)
    }),
  )

  it.effect("uses the provider ID as the OpenAI-compatible provider name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const observed: string[] = []
      yield* addPlugin()
      yield* plugin.hook("aisdk.sdk", (event) =>
        Effect.sync(() => {
          observed.push(event.sdk.languageModel("model").provider)
        }),
      )
      yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("custom-provider"), ModelV2.ID.make("model")),
            api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/openai-compatible",
          options: { name: "custom-provider", baseURL: "https://example.com/v1" },
        },
        {},
      )
      expect(observed).toEqual(["custom-provider.chat"])
    }),
  )

  it.effect("does not overwrite an SDK created by an earlier provider-specific plugin", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const sentinel = { languageModel: (modelID: string) => ({ modelID }) }
      yield* plugin.add({
        id: PluginV2.ID.make("sentinel"),
        effect: Effect.succeed({
          "aisdk.sdk": (evt) =>
            Effect.sync(() => {
              evt.sdk = sentinel
            }),
        }),
      })
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-workers-ai"), ModelV2.ID.make("model")),
            api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/openai-compatible",
          options: { name: "cloudflare-workers-ai" },
        },
        {},
      )
      expect(result.sdk).toBe(sentinel)
    }),
  )
})
