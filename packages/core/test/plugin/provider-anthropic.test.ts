import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AnthropicPlugin } from "@opencode-ai/core/plugin/provider/anthropic"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* AnthropicPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

describe("AnthropicPlugin", () => {
  it.effect("applies legacy beta headers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.anthropic, (draft) => {
          draft.package = Provider.aisdk("@ai-sdk/anthropic")
          draft.headers = { Existing: "1" }
        })
      })
      yield* addPlugin()
      expect(required(yield* catalog.provider.get(Provider.ID.anthropic)).headers?.["anthropic-beta"]).toBe(
        "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
      )
      expect(required(yield* catalog.provider.get(Provider.ID.anthropic)).headers?.Existing).toBe("1")
    }),
  )

  it.effect("ignores non-Anthropic providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => catalog.provider.update(Provider.ID.openai, () => {}))
      yield* addPlugin()
      expect(required(yield* catalog.provider.get(Provider.ID.openai)).headers?.["anthropic-beta"]).toBeUndefined()
    }),
  )

  it.effect("creates Anthropic SDKs with the model provider ID as the SDK name", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("custom-anthropic"), Model.ID.make("claude-sonnet-4-5")),
          modelID: Model.ID.make("claude-sonnet-4-5"),
          package: Provider.aisdk("@ai-sdk/anthropic"),
        }),
        package: "@ai-sdk/anthropic",
        options: { name: "custom-anthropic", apiKey: "test" },
      })
      expect(result.sdk.languageModel("claude-sonnet-4-5").provider).toBe("custom-anthropic")
    }),
  )

  it.effect("uses the Anthropic provider ID as the SDK name for the bundled Anthropic provider", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.anthropic, Model.ID.make("claude-sonnet-4-5")),
          modelID: Model.ID.make("claude-sonnet-4-5"),
          package: Provider.aisdk("@ai-sdk/anthropic"),
        }),
        package: "@ai-sdk/anthropic",
        options: { name: "anthropic", apiKey: "test" },
      })
      expect(result.sdk.languageModel("claude-sonnet-4-5").provider).toBe("anthropic")
    }),
  )
})
