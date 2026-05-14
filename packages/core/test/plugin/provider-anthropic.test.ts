import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AnthropicPlugin } from "@opencode-ai/core/plugin/provider/anthropic"
import { it, model, provider } from "./provider-helper"

describe("AnthropicPlugin", () => {
  it.effect("applies legacy beta headers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(AnthropicPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("anthropic", {
            options: { headers: { Existing: "1" }, body: {}, aisdk: { provider: {}, request: {} } },
          }),
          cancel: false,
        },
      )
      expect(result.provider.options.headers["anthropic-beta"]).toBe(
        "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
      )
      expect(result.provider.options.headers.Existing).toBe("1")
    }),
  )

  it.effect("ignores non-Anthropic providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(AnthropicPlugin)
      const result = yield* plugin.trigger("provider.update", {}, { provider: provider("openai"), cancel: false })
      expect(result.provider.options.headers["anthropic-beta"]).toBeUndefined()
    }),
  )

  it.effect("creates Anthropic SDKs with the model provider ID as the SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const providers: string[] = []
      yield* plugin.add(AnthropicPlugin)
      yield* plugin.add({
        id: PluginV2.ID.make("anthropic-sdk-inspector"),
        effect: Effect.succeed({
          "aisdk.sdk": (evt) =>
            Effect.sync(() => {
              providers.push(evt.sdk.languageModel("claude-sonnet-4-5").provider)
            }),
        }),
      })
      yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-anthropic", "claude-sonnet-4-5"),
          package: "@ai-sdk/anthropic",
          options: { name: "custom-anthropic", apiKey: "test" },
        },
        {},
      )
      expect(providers).toEqual(["custom-anthropic"])
    }),
  )

  it.effect("uses the Anthropic provider ID as the SDK name for the bundled Anthropic provider", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const providers: string[] = []
      yield* plugin.add(AnthropicPlugin)
      yield* plugin.add({
        id: PluginV2.ID.make("anthropic-sdk-inspector"),
        effect: Effect.succeed({
          "aisdk.sdk": (evt) =>
            Effect.sync(() => {
              providers.push(evt.sdk.languageModel("claude-sonnet-4-5").provider)
            }),
        }),
      })
      yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("anthropic", "claude-sonnet-4-5"),
          package: "@ai-sdk/anthropic",
          options: { name: "anthropic", apiKey: "test" },
        },
        {},
      )
      expect(providers).toEqual(["anthropic"])
    }),
  )
})
