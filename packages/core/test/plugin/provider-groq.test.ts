import { describe, expect } from "bun:test"
import { createGroq } from "@ai-sdk/groq"
import { Effect, Layer } from "effect"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { GroqPlugin } from "@opencode-ai/core/plugin/provider/groq"
import { it, model } from "./provider-helper"
import { testEffect } from "../lib/effect"

const aisdkIt = testEffect(AISDK.layer.pipe(Layer.provideMerge(PluginV2.defaultLayer)))

describe("GroqPlugin", () => {
  it.effect("creates a Groq SDK for @ai-sdk/groq", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GroqPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("groq", "llama"), package: "@ai-sdk/groq", options: { name: "groq" } },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("ignores non-Groq SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GroqPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("groq", "llama"), package: "@ai-sdk/openai-compatible", options: { name: "groq" } },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("only matches the bundled @ai-sdk/groq package exactly", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GroqPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("groq", "llama"), package: "@ai-sdk/groq/compat", options: { name: "groq" } },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("matches the old bundled Groq SDK provider naming", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GroqPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-groq", "llama"),
          package: "@ai-sdk/groq",
          options: { name: "custom-groq", apiKey: "test" },
        },
        {},
      )
      const expected = createGroq({ name: "custom-groq", apiKey: "test" } as Parameters<typeof createGroq>[0] & {
        name: string
      }).languageModel("llama")
      const actual = result.sdk?.languageModel("llama")
      expect(actual?.provider).toBe(expected.provider)
      expect(actual?.modelId).toBe(expected.modelId)
    }),
  )

  aisdkIt.effect("uses the default languageModel(apiID) behavior", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* plugin.add(GroqPlugin)
      const result = yield* aisdk.language(
        model("groq", "alias", {
          apiID: ModelV2.ID.make("llama-api"),
          endpoint: {
            type: "aisdk",
            package: "@ai-sdk/groq",
          },
          options: {
            headers: {},
            body: {},
            aisdk: {
              provider: { apiKey: "test" },
              request: {},
            },
          },
        }),
      )
      expect(result.modelId).toBe("llama-api")
      expect(result.provider).toBe("groq.chat")
    }),
  )
})
