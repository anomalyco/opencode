import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { LLMGatewayPlugin } from "@opencode-ai/core/plugin/provider/llmgateway"
import { expectPluginRegistered, it, provider } from "./provider-helper"

describe("LLMGatewayPlugin", () => {
  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() =>
      expectPluginRegistered(
        ProviderPlugins.map((item) => item.id),
        "llmgateway",
      ),
    ),
  )

  it.effect("applies legacy referer headers only to enabled llmgateway", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(LLMGatewayPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("llmgateway", {
            enabled: { via: "env", name: "LLMGATEWAY_API_KEY" },
            options: { headers: { Existing: "value" }, body: {}, aisdk: { provider: {}, request: {} } },
          }),
          cancel: false,
        },
      )
      const ignored = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("openrouter", {
            enabled: { via: "env", name: "OPENROUTER_API_KEY" },
          }),
          cancel: false,
        },
      )
      expect(result.provider.options.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-Source": "opencode",
      })
      expect(ignored.provider.options.headers).toEqual({})
    }),
  )

  it.effect("does not apply legacy headers to a disabled llmgateway provider", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(LLMGatewayPlugin)
      const result = yield* plugin.trigger("provider.update", {}, { provider: provider("llmgateway"), cancel: false })

      expect(result.provider.enabled).toBe(false)
      expect(result.provider.options.headers).toEqual({})
    }),
  )
})
