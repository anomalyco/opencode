import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AccountV2 } from "@opencode-ai/core/account"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AccountPlugin } from "@opencode-ai/core/plugin/account"
import { AzurePlugin } from "@opencode-ai/core/plugin/provider/azure"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { fakeSelectorSdk, it, model, npmLayer, provider, withEnv } from "./provider-helper"

const itWithAccount = testEffect(
  Catalog.layer.pipe(
    Layer.provideMerge(PluginV2.defaultLayer),
    Layer.provideMerge(AccountV2.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(Layer.succeed(Location.Service, Location.Service.of({ directory: "test" }))),
    Layer.provideMerge(npmLayer),
  ),
)

describe("AzurePlugin", () => {
  it.effect("resolves resourceName from env", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(AzurePlugin)
        const load = yield* catalog.loader()
        yield* load((catalog) => {
          catalog.provider.update(ProviderV2.ID.azure, (item) => {
            item.endpoint = { type: "aisdk", package: "@ai-sdk/azure" }
          })
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.azure)).options.aisdk.provider.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("keeps explicit resourceName over env and ignores other providers", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(AzurePlugin)
        const load = yield* catalog.loader()
        yield* load((catalog) => {
          const azure = provider("azure", {
            endpoint: { type: "aisdk", package: "@ai-sdk/azure" },
            options: { headers: {}, body: {}, aisdk: { provider: { resourceName: "from-config" }, request: {} } },
          })
          catalog.provider.update(azure.id, (item) => {
            item.endpoint = azure.endpoint
            item.options = azure.options
          })
          catalog.provider.update(ProviderV2.ID.openai, () => {})
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.azure)).options.aisdk.provider.resourceName).toBe(
          "from-config",
        )
        expect((yield* catalog.provider.get(ProviderV2.ID.openai)).options.aisdk.provider.resourceName).toBeUndefined()
      }),
    ),
  )

  itWithAccount.effect("prefers account resourceName over env", () =>
    withEnv(
      {
        AZURE_RESOURCE_NAME: "from-env",
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          const accounts = yield* AccountV2.Service
          const catalog = yield* Catalog.Service
          const events = yield* EventV2.Service
          yield* accounts.create({
            serviceID: AccountV2.ServiceID.make("azure"),
            credential: new AccountV2.ApiKeyCredential({
              type: "api",
              key: "key",
              metadata: { resourceName: "from-account" },
            }),
          })
          yield* plugin.add({
            ...AccountPlugin,
            effect: AccountPlugin.effect.pipe(
              Effect.provideService(AccountV2.Service, accounts),
              Effect.provideService(Catalog.Service, catalog),
              Effect.provideService(EventV2.Service, events),
              Effect.provideService(PluginV2.Service, plugin),
            ),
          })
          yield* plugin.add(AzurePlugin)
          const load = yield* catalog.loader()
          yield* load((catalog) => {
            catalog.provider.update(ProviderV2.ID.azure, (item) => {
              item.endpoint = { type: "aisdk", package: "@ai-sdk/azure" }
            })
          })
          expect((yield* catalog.provider.get(ProviderV2.ID.azure)).options.aisdk.provider.resourceName).toBe(
            "from-account",
          )
        }),
    ),
  )

  it.effect("falls back to env when configured resourceName is blank", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(AzurePlugin)
        const load = yield* catalog.loader()
        yield* load((catalog) => {
          const azure = provider("azure", {
            endpoint: { type: "aisdk", package: "@ai-sdk/azure" },
            options: { headers: {}, body: {}, aisdk: { provider: { resourceName: "" }, request: {} } },
          })
          catalog.provider.update(azure.id, (item) => {
            item.endpoint = azure.endpoint
            item.options = azure.options
          })
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.azure)).options.aisdk.provider.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("falls back to env when configured resourceName is whitespace", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(AzurePlugin)
        const load = yield* catalog.loader()
        yield* load((catalog) => {
          const azure = provider("azure", {
            endpoint: { type: "aisdk", package: "@ai-sdk/azure" },
            options: { headers: {}, body: {}, aisdk: { provider: { resourceName: "   " }, request: {} } },
          })
          catalog.provider.update(azure.id, (item) => {
            item.endpoint = azure.endpoint
            item.options = azure.options
          })
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.azure)).options.aisdk.provider.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("allows configured baseURL without resourceName", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AzurePlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("azure", "deployment"),
            package: "@ai-sdk/azure",
            options: { name: "azure", baseURL: "https://proxy.example.com/openai" },
          },
          {},
        )
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("rejects missing resourceName when baseURL is not configured", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AzurePlugin)
        const exit = yield* plugin
          .trigger(
            "aisdk.sdk",
            { model: model("azure", "deployment"), package: "@ai-sdk/azure", options: { name: "azure" } },
            {},
          )
          .pipe(Effect.exit)
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  it.effect("selects chat only for completion URLs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(AzurePlugin)
      yield* plugin.trigger(
        "aisdk.language",
        { model: model("azure", "deployment"), sdk: fakeSelectorSdk(calls), options: { useCompletionUrls: true } },
        {},
      )
      expect(calls).toEqual(["chat:deployment"])
    }),
  )

  it.effect("selects chat from per-call useCompletionUrls", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(AzurePlugin)
      yield* plugin.trigger(
        "aisdk.language",
        { model: model("azure", "deployment"), sdk: fakeSelectorSdk(calls), options: { useCompletionUrls: true } },
        {},
      )
      expect(calls).toEqual(["chat:deployment"])
    }),
  )

  it.effect("ignores model useCompletionUrls when per-call option is unset", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(AzurePlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("azure", "deployment", {
            options: { headers: {}, body: {}, aisdk: { provider: {}, request: { useCompletionUrls: true } } },
          }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )
      expect(calls).toEqual(["responses:deployment"])
    }),
  )

  it.effect("uses the legacy Azure selector order and provider guard", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(AzurePlugin)
      yield* plugin.trigger(
        "aisdk.language",
        { model: model("azure", "deployment"), sdk: fakeSelectorSdk(calls), options: {} },
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

  it.effect("falls back through the legacy Azure selector order", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      const make = (method: string) => (id: string) => {
        calls.push(`${method}:${id}`)
        return { modelId: id, provider: method, specificationVersion: "v3" }
      }
      yield* plugin.add(AzurePlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("azure", "messages-deployment"),
          sdk: { messages: make("messages"), chat: make("chat"), languageModel: make("languageModel") },
          options: {},
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        { model: model("azure", "language-deployment"), sdk: { languageModel: make("languageModel") }, options: {} },
        {},
      )
      expect(calls).toEqual(["messages:messages-deployment", "languageModel:language-deployment"])
    }),
  )
})
