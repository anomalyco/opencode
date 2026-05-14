import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { CoherePlugin } from "@opencode-ai/core/plugin/provider/cohere"
import { fakeSelectorSdk, it, model } from "./provider-helper"

const cohereOptions: Record<string, any>[] = []

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
      yield* plugin.add(CoherePlugin)

      const ignored = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("cohere", "command"), package: "@ai-sdk/openai-compatible", options: { name: "cohere" } },
        {},
      )
      expect(ignored.sdk).toBeUndefined()

      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("cohere", "command"), package: "@ai-sdk/cohere", options: { name: "cohere" } },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("uses the model provider ID as the bundled SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(CoherePlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-cohere", "command-r-plus"),
          package: "@ai-sdk/cohere",
          options: { name: "custom-cohere", apiKey: "test", baseURL: "https://cohere.example" },
        },
        {},
      )

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
      const calls: string[] = []
      const sdk = fakeSelectorSdk(calls)
      yield* plugin.add(CoherePlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        { model: model("cohere", "alias", { apiID: ModelV2.ID.make("command-r-plus") }), sdk, options: {} },
        {},
      )

      expect(result.language).toBeUndefined()
      expect(calls).toEqual([])
      expect(result.language ?? sdk.languageModel("command-r-plus")).toBeDefined()
      expect(calls).toEqual(["languageModel:command-r-plus"])
    }),
  )
})
