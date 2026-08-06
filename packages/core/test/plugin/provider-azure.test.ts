import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AzurePlugin } from "@opencode-ai/core/plugin/provider/azure"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* AzurePlugin.effect(host)
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

describe("AzurePlugin", () => {
  it.effect("resolves resourceName from env", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.azure, (item) => {
            item.package = Provider.aisdk("@ai-sdk/azure")
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings?.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("resolves resourceName from the legacy env", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "legacy-resource" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.azure, (item) => {
            item.package = Provider.aisdk("@ai-sdk/azure")
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings?.resourceName).toBe("legacy-resource")
      }),
    ),
  )

  it.effect("expands provider and model resource URLs", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env", AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "legacy-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.azure, (provider) => {
            provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
            provider.settings = {
              baseURL: "https://${AZURE_COGNITIVE_SERVICES_RESOURCE_NAME}.cognitiveservices.azure.com/openai",
            }
          })
          catalog.model.update(Provider.ID.azure, Model.ID.make("anthropic"), (model) => {
            model.package = Provider.aisdk("@ai-sdk/anthropic")
            model.settings = {
              resourceName: "model-resource",
              baseURL: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1",
            }
          })
        })
        yield* addPlugin()

        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings).toMatchObject({
          resourceName: "from-env",
          baseURL: "https://from-env.cognitiveservices.azure.com/openai",
        })
        expect(
          required(yield* catalog.model.get(Provider.ID.azure, Model.ID.make("anthropic"))).settings,
        ).toMatchObject({
          resourceName: "model-resource",
          baseURL: "https://model-resource.services.ai.azure.com/anthropic/v1",
        })
      }),
    ),
  )

  it.effect("keeps explicit resourceName over env and ignores other providers", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const azure = Provider.Info.make({
            ...Provider.Info.empty(Provider.ID.azure),
            package: Provider.aisdk("@ai-sdk/azure"),
            settings: { resourceName: "from-config" },
          })
          catalog.provider.update(azure.id, (item) => {
            item.package = azure.package
            item.settings = { resourceName: "from-config" }
          })
          catalog.provider.update(Provider.ID.openai, () => {})
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings?.resourceName).toBe("from-config")
        expect(required(yield* catalog.provider.get(Provider.ID.openai)).settings?.resourceName).toBeUndefined()
      }),
    ),
  )

  it.effect("falls back to env when configured resourceName is blank", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const azure = Provider.Info.make({
            ...Provider.Info.empty(Provider.ID.azure),
            package: Provider.aisdk("@ai-sdk/azure"),
            settings: { resourceName: "" },
          })
          catalog.provider.update(azure.id, (item) => {
            item.package = azure.package
            item.settings = { resourceName: "" }
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings?.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("falls back to env when configured resourceName is whitespace", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const azure = Provider.Info.make({
            ...Provider.Info.empty(Provider.ID.azure),
            package: Provider.aisdk("@ai-sdk/azure"),
            settings: { resourceName: "   " },
          })
          catalog.provider.update(azure.id, (item) => {
            item.package = azure.package
            item.settings = { resourceName: "   " }
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.azure)).settings?.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("allows configured baseURL without resourceName", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
            modelID: Model.ID.make("deployment"),
            package: Provider.aisdk("test-provider"),
          }),
          package: "@ai-sdk/azure",
          options: { name: "azure", baseURL: "https://proxy.example.com/openai" },
        })
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("rejects missing resourceName when baseURL is not configured", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const exit = yield* aisdk
          .runSDK({
            model: Model.Info.make({
              ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
              modelID: Model.ID.make("deployment"),
              package: Provider.aisdk("test-provider"),
            }),
            package: "@ai-sdk/azure",
            options: { name: "azure" },
          })
          .pipe(Effect.exit)
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  it.effect("selects chat only for completion URLs", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
          modelID: Model.ID.make("deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: fakeSelectorSdk(calls),
        options: { useCompletionUrls: true },
      })
      expect(calls).toEqual(["chat:deployment"])
    }),
  )

  it.effect("selects chat from per-call useCompletionUrls", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
          modelID: Model.ID.make("deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: fakeSelectorSdk(calls),
        options: { useCompletionUrls: true },
      })
      expect(calls).toEqual(["chat:deployment"])
    }),
  )

  it.effect("ignores model useCompletionUrls when per-call option is unset", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
          modelID: Model.ID.make("deployment"),
          package: Provider.aisdk("test-provider"),
          body: { useCompletionUrls: true },
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual(["responses:deployment"])
    }),
  )

  it.effect("uses the legacy Azure selector order and provider guard", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("deployment")),
          modelID: Model.ID.make("deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      const ignored = yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.openai, Model.ID.make("deployment")),
          modelID: Model.ID.make("deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual(["responses:deployment"])
      expect(ignored.language).toBeUndefined()
    }),
  )

  it.effect("falls back through the legacy Azure selector order", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      const make = (method: string) => (id: string) => {
        calls.push(`${method}:${id}`)
        return { modelId: id, provider: method, specificationVersion: "v3" }
      }
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("messages-deployment")),
          modelID: Model.ID.make("messages-deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: { messages: make("messages"), chat: make("chat"), languageModel: make("languageModel") },
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.azure, Model.ID.make("language-deployment")),
          modelID: Model.ID.make("language-deployment"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: { languageModel: make("languageModel") },
        options: {},
      })
      expect(calls).toEqual(["messages:messages-deployment", "languageModel:language-deployment"])
    }),
  )
})
