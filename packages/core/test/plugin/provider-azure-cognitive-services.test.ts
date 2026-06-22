import { describe, expect } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AzureCognitiveServicesPlugin } from "@opencode-ai/core/plugin/provider/azure"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make()
  yield* plugin.add({ id: AzureCognitiveServicesPlugin.id, effect: AzureCognitiveServicesPlugin.effect(host) })
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function withEnv<A, E, R>(vars: Record<string, string | undefined>, fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    fx,
    (previous) =>
      Effect.sync(() => {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        })
      }),
  )
}

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

describe("AzureCognitiveServicesPlugin", () => {
  it.effect("maps the resource env var to the Azure SDK baseURL", () =>
    withEnv({ AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "cognitive" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(ProviderV2.ID.make("azure-cognitive-services"), (item) => {
            item.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
          })
        })
        yield* addPlugin()
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
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const azure = new ProviderV2.Info({
            ...ProviderV2.Info.empty(ProviderV2.ID.make("azure-cognitive-services")),
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible" },
          })
          const openai = new ProviderV2.Info({
            ...ProviderV2.Info.empty(ProviderV2.ID.openai),
            api: { type: "aisdk", package: "test-provider" },
          })
          catalog.provider.update(azure.id, (item) => {
            item.api = azure.api
          })
          catalog.provider.update(openai.id, (item) => {
            item.api = openai.api
          })
        })
        yield* addPlugin()
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
      yield* addPlugin()
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("azure-cognitive-services"), ModelV2.ID.make("deployment")),
            api: { id: ModelV2.ID.make("deployment"), type: "aisdk", package: "test-provider" },
          }),
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
      yield* addPlugin()
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("azure-cognitive-services"), ModelV2.ID.make("deployment")),
            api: { id: ModelV2.ID.make("deployment"), type: "aisdk", package: "test-provider" },
          }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )
      const ignored = yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("deployment")),
            api: { id: ModelV2.ID.make("deployment"), type: "aisdk", package: "test-provider" },
          }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
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
      yield* addPlugin()
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(
              ProviderV2.ID.make("azure-cognitive-services"),
              ModelV2.ID.make("messages-deployment"),
            ),
            api: { id: ModelV2.ID.make("messages-deployment"), type: "aisdk", package: "test-provider" },
          }),
          sdk: { messages: sdk.messages, chat: sdk.chat, languageModel: sdk.languageModel },
          options: {},
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("azure-cognitive-services"), ModelV2.ID.make("chat-deployment")),
            api: { id: ModelV2.ID.make("chat-deployment"), type: "aisdk", package: "test-provider" },
          }),
          sdk: { chat: sdk.chat, languageModel: sdk.languageModel },
          options: {},
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(
              ProviderV2.ID.make("azure-cognitive-services"),
              ModelV2.ID.make("language-deployment"),
            ),
            api: { id: ModelV2.ID.make("language-deployment"), type: "aisdk", package: "test-provider" },
          }),
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
