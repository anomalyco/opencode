import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OpenAICompatiblePlugin } from "@opencode-ai/core/plugin/provider/openai-compatible"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* OpenAICompatiblePlugin.effect(host)
})

describe("OpenAICompatiblePlugin", () => {
  it.effect("preserves explicit includeUsage false and defaults it to true", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const defaulted = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("custom"), Model.ID.make("model")),
          modelID: Model.ID.make("model"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "custom" },
      })
      const disabled = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("custom"), Model.ID.make("model")),
          modelID: Model.ID.make("model"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "custom", includeUsage: false },
      })
      expect(defaulted.options.includeUsage).toBe(true)
      expect(disabled.options.includeUsage).toBe(false)
    }),
  )

  it.effect("defaults includeUsage for OpenAI-compatible package matches", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("custom"), Model.ID.make("model")),
          modelID: Model.ID.make("model"),
          package: "aisdk:test-provider",
        }),
        package: "file:///tmp/@ai-sdk/openai-compatible-provider.js",
        options: { name: "custom" },
      })
      expect(result.options.includeUsage).toBe(true)
    }),
  )

  it.effect("uses the provider ID as the OpenAI-compatible provider name", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const observed: string[] = []
      yield* addPlugin()
      yield* aisdk.hook.sdk((event) =>
        Effect.sync(() => {
          observed.push(event.sdk.languageModel("model").provider)
        }),
      )
      yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("custom-provider"), Model.ID.make("model")),
          modelID: Model.ID.make("model"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "custom-provider", baseURL: "https://example.com/v1" },
      })
      expect(observed).toEqual(["custom-provider.chat"])
    }),
  )

  it.effect("does not overwrite an SDK created by an earlier provider-specific plugin", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const sentinel = { languageModel: (modelID: string) => ({ modelID }) }
      yield* aisdk.hook.sdk((event) => {
        event.sdk = sentinel
      })
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("cloudflare-workers-ai"), Model.ID.make("model")),
          modelID: Model.ID.make("model"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "cloudflare-workers-ai" },
      })
      expect(result.sdk).toBe(sentinel)
    }),
  )
})
