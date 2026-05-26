import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { XAIPlugin } from "@opencode-ai/core/plugin/provider/xai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { fakeSelectorSdk } from "./provider-helper"

const it = testEffect(PluginV2.defaultLayer)

const model = new ModelV2.Info({
  ...ModelV2.Info.empty(ProviderV2.ID.make("xai"), ModelV2.ID.make("grok-4")),
  apiID: ModelV2.ID.make("grok-4"),
  endpoint: {
    type: "aisdk",
    package: "@ai-sdk/xai",
  },
})

describe("XAIPlugin", () => {
  it.effect("creates an xAI SDK only for @ai-sdk/xai", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(XAIPlugin)

      const ignored = yield* plugin.trigger(
        "aisdk.sdk",
        { model, package: "@ai-sdk/openai-compatible", options: {} },
        {},
      )

      const result = yield* plugin.trigger("aisdk.sdk", { model, package: "@ai-sdk/xai", options: {} }, {})

      expect(ignored.sdk).toBeUndefined()
      expect(typeof result.sdk?.responses).toBe("function")
    }),
  )

  it.effect("creates xAI SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const providers: string[] = []

      yield* plugin.add(XAIPlugin)
      yield* plugin.add(
        PluginV2.define({
          id: PluginV2.ID.make("xai-sdk-name-observer"),
          effect: Effect.gen(function* () {
            return {
              "aisdk.sdk": Effect.fn(function* (evt) {
                if (!evt.sdk) return
                providers.push(evt.sdk.responses("grok-4").provider)
              }),
            }
          }),
        }),
      )

      yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({ ...model, providerID: ProviderV2.ID.make("custom-xai") }),
          package: "@ai-sdk/xai",
          options: {},
        },
        {},
      )

      expect(providers).toEqual(["xai.responses"])
    }),
  )

  it.effect("uses responses with the model apiID for xAI language models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []

      yield* plugin.add(XAIPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({ ...model, id: ModelV2.ID.make("alias"), apiID: ModelV2.ID.make("grok-4") }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )

      expect(calls).toEqual(["responses:grok-4"])
      expect(result.language).toBeDefined()
    }),
  )

  it.effect("ignores non-xAI providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []

      yield* plugin.add(XAIPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({ ...model, providerID: ProviderV2.ID.openai }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )

      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})
