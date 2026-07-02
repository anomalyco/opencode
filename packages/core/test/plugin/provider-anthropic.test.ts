import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AnthropicPlugin } from "@opencode-ai/core/plugin/provider/anthropic"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
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
        const item = ProviderV2.Info.make({
          ...ProviderV2.Info.empty(ProviderV2.ID.anthropic),
          api: { type: "aisdk", package: "@ai-sdk/anthropic" },
          request: { headers: { Existing: "1" }, body: {} },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
          draft.request = { settings: {}, headers: { Existing: "1" }, body: {} }
        })
      })
      yield* addPlugin()
      expect(required(yield* catalog.provider.get(ProviderV2.ID.anthropic)).request.headers["anthropic-beta"]).toBe(
        "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
      )
      expect(required(yield* catalog.provider.get(ProviderV2.ID.anthropic)).request.headers.Existing).toBe("1")
    }),
  )

  it.effect("ignores non-Anthropic providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => catalog.provider.update(ProviderV2.ID.openai, () => {}))
      yield* addPlugin()
      expect(
        required(yield* catalog.provider.get(ProviderV2.ID.openai)).request.headers["anthropic-beta"],
      ).toBeUndefined()
    }),
  )

  it.effect("creates Anthropic SDKs with the model provider ID as the SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-anthropic"), ModelV2.ID.make("claude-sonnet-4-5")),
          api: { id: ModelV2.ID.make("claude-sonnet-4-5"), type: "aisdk", package: "@ai-sdk/anthropic" },
        }),
        package: "@ai-sdk/anthropic",
        options: { name: "custom-anthropic", apiKey: "test" },
      })
      expect(result.sdk.languageModel("claude-sonnet-4-5").provider).toBe("custom-anthropic")
    }),
  )

  it.effect("uses the Anthropic provider ID as the SDK name for the bundled Anthropic provider", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.anthropic, ModelV2.ID.make("claude-sonnet-4-5")),
          api: { id: ModelV2.ID.make("claude-sonnet-4-5"), type: "aisdk", package: "@ai-sdk/anthropic" },
        }),
        package: "@ai-sdk/anthropic",
        options: { name: "anthropic", apiKey: "test" },
      })
      expect(result.sdk.languageModel("claude-sonnet-4-5").provider).toBe("anthropic")
    }),
  )
})
