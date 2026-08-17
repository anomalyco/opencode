import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AzurePlugin } from "@opencode-ai/core/plugin/provider/azure"
import { Provider } from "@opencode-ai/core/provider"
import { Integration } from "@opencode-ai/core/integration"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
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

describe("AzurePlugin", () => {
  it.effect("registers a resource name form when the environment does not provide one", () =>
    withEnv({ AZURE_RESOURCE_NAME: undefined, AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        expect((yield* (yield* Integration.Service).get(Integration.ID.make("azure")))?.methods).toContainEqual({
          type: "key",
          label: "API key",
          form: [
            {
              type: "string",
              key: "resourceName",
              title: "Enter Azure Resource Name",
              placeholder: "e.g. my-models",
              required: true,
            },
          ],
        })
      }),
    ),
  )

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
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) =>
          catalog.provider.update(Provider.ID.azure, (provider) => {
            provider.settings = { ...provider.settings, baseURL: "https://proxy.example.com/openai" }
          }),
        )
        yield* addPlugin()
        expect((yield* (yield* Integration.Service).get(Integration.ID.make("azure")))?.methods).toContainEqual({
          type: "key",
          label: "API key",
        })
      }),
    ),
  )
})
