import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { CoherePlugin } from "@opencode-ai/core/plugin/provider/cohere"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const cohereOptions: Record<string, any>[] = []
const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* CoherePlugin.effect(host)
})

function fakeSelectorSdk(calls: string[]) {
  const make = (method: string) => (id: string) => {
    calls.push(`${method}:${id}`)
    return { modelId: id, provider: method, specificationVersion: "v3" } as unknown as LanguageModelV3
  }
  return {
    responses: make("responses"),
    messages: make("messages"),
    chat: make("chat"),
    languageModel: make("languageModel"),
  }
}

void mock.module("@ai-sdk/cohere", () => ({
  createCohere: (options: Record<string, any>) => {
    cohereOptions.push({ ...options })
    return {
      languageModel: (modelID: string) => ({
        modelID,
        provider: `${options.name ?? "cohere"}.chat`,
        specificationVersion: "v3",
      }),
    }
  },
}))

describe("CoherePlugin", () => {
  it.effect("creates a Cohere SDK only for @ai-sdk/cohere", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const ignored = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("cohere"), ModelV2.ID.make("command")),
          api: { id: ModelV2.ID.make("command"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "cohere" },
      })
      expect(ignored.sdk).toBeUndefined()

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("cohere"), ModelV2.ID.make("command")),
          api: { id: ModelV2.ID.make("command"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/cohere",
        options: { name: "cohere" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("uses the model provider ID as the bundled SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-cohere"), ModelV2.ID.make("command-r-plus")),
          api: { id: ModelV2.ID.make("command-r-plus"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/cohere",
        options: { name: "custom-cohere", apiKey: "test", baseURL: "https://cohere.example" },
      })

      expect(cohereOptions.at(-1)).toEqual({
        name: "custom-cohere",
        apiKey: "test",
        baseURL: "https://cohere.example",
      })
      expect(result.sdk?.languageModel("command-r-plus").provider).toBe("custom-cohere.chat")
    }),
  )

  it.effect("leaves language selection to the default languageModel fallback", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      const sdk = fakeSelectorSdk(calls)
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("cohere"), ModelV2.ID.make("alias")),
          api: { id: ModelV2.ID.make("command-r-plus"), type: "aisdk", package: "test-provider" },
        }),
        sdk,
        options: {},
      })

      expect(result.language).toBeUndefined()
      expect(calls).toEqual([])
      expect(result.language ?? sdk.languageModel("command-r-plus")).toBeDefined()
      expect(calls).toEqual(["languageModel:command-r-plus"])
    }),
  )
})
