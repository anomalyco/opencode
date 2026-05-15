import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AzureCognitiveServicesPlugin } from "@opencode-ai/core/plugin/provider/azure"
import { fakeSelectorSdk, it, model, provider, withEnv } from "./provider-helper"

describe("AzureCognitiveServicesPlugin", () => {
  it.effect("maps the resource env var to the Azure SDK baseURL", () =>
    withEnv({ AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "cognitive" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AzureCognitiveServicesPlugin)
        const result = yield* plugin.trigger(
          "provider.update",
          {},
          { provider: provider("azure-cognitive-services"), cancel: false },
        )
        expect(result.provider.endpoint).toEqual({
          type: "aisdk",
          package: "test-provider",
        })
        expect(result.provider.options.aisdk.provider.baseURL).toBe(
          "https://cognitive.cognitiveservices.azure.com/openai",
        )
        expect(result.provider.options.aisdk.provider.resourceName).toBeUndefined()
      }),
    ),
  )

  it.effect("leaves baseURL unset without resource env and ignores other providers", () =>
    withEnv({ AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AzureCognitiveServicesPlugin)
        const azure = yield* plugin.trigger(
          "provider.update",
          {},
          { provider: provider("azure-cognitive-services"), cancel: false },
        )
        const other = yield* plugin.trigger("provider.update", {}, { provider: provider("openai"), cancel: false })
        expect(azure.provider.options.aisdk.provider.baseURL).toBeUndefined()
        expect(azure.provider.endpoint).toEqual({ type: "aisdk", package: "test-provider" })
        expect(other.provider.options.aisdk.provider.baseURL).toBeUndefined()
        expect(other.provider.endpoint).toEqual({ type: "aisdk", package: "test-provider" })
      }),
    ),
  )

  it.effect("selects chat only for completion URLs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(AzureCognitiveServicesPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("azure-cognitive-services", "deployment"),
          sdk: fakeSelectorSdk(calls),
          options: { useCompletionUrls: true },
        },
        {},
      )
      expect(calls).toEqual(["chat:deployment"])
    }),
  )

  it.effect("uses the legacy Azure selector order and provider guard", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(AzureCognitiveServicesPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        { model: model("azure-cognitive-services", "deployment"), sdk: fakeSelectorSdk(calls), options: {} },
        {},
      )
      const ignored = yield* plugin.trigger(
        "aisdk.language",
        { model: model("openai", "deployment"), sdk: fakeSelectorSdk(calls), options: {} },
        {},
      )
      expect(calls).toEqual(["responses:deployment"])
      expect(ignored.language).toBeUndefined()
    }),
  )

  it.effect("falls back from responses to messages, chat, then languageModel", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      const sdk = fakeSelectorSdk(calls)
      yield* plugin.add(AzureCognitiveServicesPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("azure-cognitive-services", "messages-deployment"),
          sdk: { messages: sdk.messages, chat: sdk.chat, languageModel: sdk.languageModel },
          options: {},
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("azure-cognitive-services", "chat-deployment"),
          sdk: { chat: sdk.chat, languageModel: sdk.languageModel },
          options: {},
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("azure-cognitive-services", "language-deployment"),
          sdk: { languageModel: sdk.languageModel },
          options: {},
        },
        {},
      )
      expect(calls).toEqual([
        "messages:messages-deployment",
        "chat:chat-deployment",
        "languageModel:language-deployment",
      ])
    }),
  )
})
