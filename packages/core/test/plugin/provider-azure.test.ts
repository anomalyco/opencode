import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AuthV2 } from "@opencode-ai/core/auth"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AuthPlugin } from "@opencode-ai/core/plugin/auth"
import { AzurePlugin } from "@opencode-ai/core/plugin/provider/azure"
import { testEffect } from "../lib/effect"
import { fakeSelectorSdk, it, model, npmLayer, provider, withEnv } from "./provider-helper"

const itWithAuth = testEffect(Layer.mergeAll(PluginV2.defaultLayer, AuthV2.defaultLayer, npmLayer))

describe("AzurePlugin", () => {
  it.effect("resolves resourceName from env", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AzurePlugin)
        const result = yield* plugin.trigger("provider.update", {}, { provider: provider("azure"), cancel: false })
        expect(result.provider.options.aisdk.provider.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("keeps explicit resourceName over env and ignores other providers", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AzurePlugin)
        const azure = yield* plugin.trigger(
          "provider.update",
          {},
          {
            provider: provider("azure", {
              options: { headers: {}, body: {}, aisdk: { provider: { resourceName: "from-config" }, request: {} } },
            }),
            cancel: false,
          },
        )
        const other = yield* plugin.trigger("provider.update", {}, { provider: provider("openai"), cancel: false })
        expect(azure.provider.options.aisdk.provider.resourceName).toBe("from-config")
        expect(other.provider.options.aisdk.provider.resourceName).toBeUndefined()
      }),
    ),
  )

  itWithAuth.effect("prefers auth resourceName over env", () =>
    withEnv(
      {
        AZURE_RESOURCE_NAME: "from-env",
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          const auth = yield* AuthV2.Service
          yield* auth.create({
            serviceID: AuthV2.ServiceID.make("azure"),
            credential: new AuthV2.ApiKeyCredential({
              type: "api",
              key: "key",
              metadata: { resourceName: "from-auth" },
            }),
            active: true,
          })
          yield* plugin.add({
            ...AuthPlugin,
            effect: AuthPlugin.effect.pipe(Effect.provideService(AuthV2.Service, auth)),
          })
          yield* plugin.add(AzurePlugin)
          const result = yield* plugin.trigger("provider.update", {}, { provider: provider("azure"), cancel: false })
          expect(result.provider.options.aisdk.provider.resourceName).toBe("from-auth")
        }),
    ),
  )

  it.effect("falls back to env when configured resourceName is blank", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AzurePlugin)
        const result = yield* plugin.trigger(
          "provider.update",
          {},
          {
            provider: provider("azure", {
              options: { headers: {}, body: {}, aisdk: { provider: { resourceName: "" }, request: {} } },
            }),
            cancel: false,
          },
        )
        expect(result.provider.options.aisdk.provider.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("falls back to env when configured resourceName is whitespace", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AzurePlugin)
        const result = yield* plugin.trigger(
          "provider.update",
          {},
          {
            provider: provider("azure", {
              options: { headers: {}, body: {}, aisdk: { provider: { resourceName: "   " }, request: {} } },
            }),
            cancel: false,
          },
        )
        expect(result.provider.options.aisdk.provider.resourceName).toBe("from-env")
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
