import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { createGroq } from "@ai-sdk/groq"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { GroqPlugin } from "@opencode-ai/core/plugin/provider/groq"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* GroqPlugin.effect(host)
})

describe("GroqPlugin", () => {
  it.effect("creates a Groq SDK for @ai-sdk/groq", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.make("groq"), ModelV2.ID.make("llama")),
          api: { id: ModelV2.ID.make("llama"), type: "aisdk", package: "@ai-sdk/groq" },
        }),
        package: "@ai-sdk/groq",
        options: { name: "groq" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("ignores non-Groq SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.make("groq"), ModelV2.ID.make("llama")),
          api: { id: ModelV2.ID.make("llama"), type: "aisdk", package: "@ai-sdk/groq" },
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "groq" },
      })
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("only matches the bundled @ai-sdk/groq package exactly", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.make("groq"), ModelV2.ID.make("llama")),
          api: { id: ModelV2.ID.make("llama"), type: "aisdk", package: "@ai-sdk/groq" },
        }),
        package: "@ai-sdk/groq/compat",
        options: { name: "groq" },
      })
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("matches the old bundled Groq SDK provider naming", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-groq"), ModelV2.ID.make("llama")),
          api: { id: ModelV2.ID.make("llama"), type: "aisdk", package: "@ai-sdk/groq" },
        }),
        package: "@ai-sdk/groq",
        options: { name: "custom-groq", apiKey: "test" },
      })
      const expected = createGroq({ name: "custom-groq", apiKey: "test" } as Parameters<typeof createGroq>[0] & {
        name: string
      }).languageModel("llama")
      const actual = result.sdk?.languageModel("llama")
      expect(actual?.provider).toBe(expected.provider)
      expect(actual?.modelId).toBe(expected.modelId)
    }),
  )

  it.effect("uses the default languageModel(api.id) behavior", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const sdk = createGroq({ name: "groq", apiKey: "test" } as Parameters<typeof createGroq>[0] & {
        name: string
      })
      const result = yield* aisdk.runLanguage({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.make("groq"), ModelV2.ID.make("alias")),
          api: {
            id: ModelV2.ID.make("llama-api"),
            type: "aisdk",
            package: "@ai-sdk/groq",
          },
        }),
        sdk,
        options: { name: "groq", apiKey: "test" },
      })
      const language = result.language ?? sdk.languageModel(result.model.api.id)
      expect(language.modelId).toBe("llama-api")
      expect(language.provider).toBe("groq.chat")
    }),
  )
})
