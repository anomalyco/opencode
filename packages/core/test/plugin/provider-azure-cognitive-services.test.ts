import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AzureCognitiveServicesPlugin } from "@opencode-ai/core/plugin/provider/azure"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { addPlugin, fakeSelectorSdk, it, model, provider, required, withEnv } from "./provider-helper"

describe("AzureCognitiveServicesPlugin", () => {
  it.effect("maps the resource env var to the Azure SDK baseURL", () =>
    withEnv({ AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "cognitive" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* addPlugin(plugin, AzureCognitiveServicesPlugin)
        yield* catalog.transform((catalog) => {
          catalog.provider.update(ProviderV2.ID.make("azure-cognitive-services"), (item) => {
            item.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
          })
        })
        const result = required(yield* catalog.provider.get(ProviderV2.ID.make("azure-cognitive-services")))
        expect(result.api).toEqual({
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://cognitive.cognitiveservices.azure.com/openai",
        })
        expect(result.request.body.baseURL).toBeUndefined()
        expect(result.request.body.resourceName).toBeUndefined()
      }),
    ),
  )

  it.effect("leaves baseURL unset without resource env and ignores other providers", () =>
    withEnv({ AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* addPlugin(plugin, AzureCognitiveServicesPlugin)
        yield* catalog.transform((catalog) => {
          const azure = provider("azure-cognitive-services", {
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible" },
          })
          const openai = provider("openai")
          catalog.provider.update(azure.id, (item) => {
            item.api = azure.api
          })
          catalog.provider.update(openai.id, (item) => {
            item.api = openai.api
          })
        })
        const azure = required(yield* catalog.provider.get(ProviderV2.ID.make("azure-cognitive-services")))
        const openai = required(yield* catalog.provider.get(ProviderV2.ID.openai))
        expect(azure.request.body.baseURL).toBeUndefined()
        expect(azure.api).toEqual({ type: "aisdk", package: "@ai-sdk/openai-compatible" })
        expect(openai.request.body.baseURL).toBeUndefined()
        expect(openai.api).toEqual({ type: "aisdk", package: "test-provider" })
      }),
    ),
  )

  it.effect("selects chat only for completion URLs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* addPlugin(plugin, AzureCognitiveServicesPlugin)
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
      yield* addPlugin(plugin, AzureCognitiveServicesPlugin)
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
      yield* addPlugin(plugin, AzureCognitiveServicesPlugin)
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
