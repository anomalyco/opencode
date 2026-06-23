import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AzurePlugin } from "@opencode-ai/core/plugin/provider/azure"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
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
          catalog.provider.update(ProviderV2.ID.azure, (item) => {
            item.api = { type: "aisdk", package: "@ai-sdk/azure" }
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.azure)).request.body.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("keeps explicit resourceName over env and ignores other providers", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const azure = new ProviderV2.Info({
            ...ProviderV2.Info.empty(ProviderV2.ID.azure),
            api: { type: "aisdk", package: "@ai-sdk/azure" },
            request: { headers: {}, body: { resourceName: "from-config" } },
          })
          catalog.provider.update(azure.id, (item) => {
            item.api = azure.api
            item.request = azure.request
          })
          catalog.provider.update(ProviderV2.ID.openai, () => {})
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.azure)).request.body.resourceName).toBe("from-config")
        expect(required(yield* catalog.provider.get(ProviderV2.ID.openai)).request.body.resourceName).toBeUndefined()
      }),
    ),
  )

  it.effect("falls back to env when configured resourceName is blank", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const azure = new ProviderV2.Info({
            ...ProviderV2.Info.empty(ProviderV2.ID.azure),
            api: { type: "aisdk", package: "@ai-sdk/azure" },
            request: { headers: {}, body: { resourceName: "" } },
          })
          catalog.provider.update(azure.id, (item) => {
            item.api = azure.api
            item.request = azure.request
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.azure)).request.body.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("falls back to env when configured resourceName is whitespace", () =>
    withEnv({ AZURE_RESOURCE_NAME: "from-env" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const azure = new ProviderV2.Info({
            ...ProviderV2.Info.empty(ProviderV2.ID.azure),
            api: { type: "aisdk", package: "@ai-sdk/azure" },
            request: { headers: {}, body: { resourceName: "   " } },
          })
          catalog.provider.update(azure.id, (item) => {
            item.api = azure.api
            item.request = azure.request
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.azure)).request.body.resourceName).toBe("from-env")
      }),
    ),
  )

  it.effect("allows configured baseURL without resourceName", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.azure, ModelV2.ID.make("deployment")),
            api: { id: ModelV2.ID.make("deployment"), type: "aisdk", package: "test-provider" },
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
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.azure, ModelV2.ID.make("deployment")),
              api: { id: ModelV2.ID.make("deployment"), type: "aisdk", package: "test-provider" },
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
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.azure, ModelV2.ID.make("deployment")),
          api: { id: ModelV2.ID.make("deployment"), type: "aisdk", package: "test-provider" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: { useCompletionUrls: true },
      })
      expect(calls).toEqual(["chat:deployment"])
    }),
  )

  it.effect("selects chat from per-call useCompletionUrls", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.azure, ModelV2.ID.make("deployment")),
          api: { id: ModelV2.ID.make("deployment"), type: "aisdk", package: "test-provider" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: { useCompletionUrls: true },
      })
      expect(calls).toEqual(["chat:deployment"])
    }),
  )

  it.effect("ignores model useCompletionUrls when per-call option is unset", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.azure, ModelV2.ID.make("deployment")),
          api: { id: ModelV2.ID.make("deployment"), type: "aisdk", package: "test-provider" },
          request: { headers: {}, body: { useCompletionUrls: true } },
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual(["responses:deployment"])
    }),
  )

  it.effect("uses the legacy Azure selector order and provider guard", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.azure, ModelV2.ID.make("deployment")),
          api: { id: ModelV2.ID.make("deployment"), type: "aisdk", package: "test-provider" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      const ignored = yield* aisdk.runLanguage({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("deployment")),
          api: { id: ModelV2.ID.make("deployment"), type: "aisdk", package: "test-provider" },
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
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      const make = (method: string) => (id: string) => {
        calls.push(`${method}:${id}`)
        return { modelId: id, provider: method, specificationVersion: "v3" }
      }
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.azure, ModelV2.ID.make("messages-deployment")),
          api: { id: ModelV2.ID.make("messages-deployment"), type: "aisdk", package: "test-provider" },
        }),
        sdk: { messages: make("messages"), chat: make("chat"), languageModel: make("languageModel") },
        options: {},
      })
      yield* aisdk.runLanguage({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.azure, ModelV2.ID.make("language-deployment")),
          api: { id: ModelV2.ID.make("language-deployment"), type: "aisdk", package: "test-provider" },
        }),
        sdk: { languageModel: make("languageModel") },
        options: {},
      })
      expect(calls).toEqual(["messages:messages-deployment", "languageModel:language-deployment"])
    }),
  )
})
