import { describe, expect } from "bun:test"
import { Money } from "@opencode-ai/schema/money"
import { Effect, Fiber, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("test") })),
)
const catalogLayer = AppNodeBuilder.build(
  LayerNode.group([Catalog.node, EventV2.node, Credential.node, Integration.node]),
  [[Location.node, locationLayer]],
)
const it = testEffect(catalogLayer)

describe("CatalogV2", () => {
  it.effect("publishes an updated event after catalog changes", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const events = yield* EventV2.Service
      const updated = yield* events
        .subscribe(Catalog.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* catalog.transform((editor) => editor.provider.update(ProviderV2.ID.make("test"), () => {}))

      expect((yield* Fiber.join(updated)).length).toBe(1)
    }),
  )

  it.effect("derives availability from active credentials without changing provider state", () => {
    const integrationID = Integration.ID.make("test")
    const localCatalogLayer = Layer.fresh(
      AppNodeBuilder.build(LayerNode.group([Catalog.node, Credential.node]), [[Location.node, locationLayer]]),
    )

    return Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((editor) => editor.provider.update(ProviderV2.ID.make("test"), () => {}))
      yield* credentials.create({
        integrationID,
        label: "First",
        value: Credential.Key.make({ type: "key", key: "first", metadata: { tenant: "one" } }),
      })

      expect((yield* catalog.provider.available()).map((provider) => provider.id)).toEqual([ProviderV2.ID.make("test")])
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("test"))).body).toBeUndefined()
      yield* credentials.create({
        integrationID,
        label: "Second",
        value: Credential.Key.make({ type: "key", key: "second", metadata: { tenant: "two" } }),
      })
      expect((yield* catalog.provider.available()).map((provider) => provider.id)).toEqual([ProviderV2.ID.make("test")])
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("test"))).body).toBeUndefined()
    }).pipe(Effect.provide(localCatalogLayer))
  })

  it.effect("derives availability from a provider's integration", () => {
    const integrationID = Integration.ID.make("gateway")
    const providerID = ProviderV2.ID.make("remote")
    const localCatalogLayer = Layer.fresh(
      AppNodeBuilder.build(LayerNode.group([Catalog.node, Credential.node, Integration.node]), [
        [Location.node, locationLayer],
      ]),
    )

    return Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* (yield* Integration.Service).transform((editor) => editor.update(integrationID, () => {}))
      yield* catalog.transform((editor) =>
        editor.provider.update(providerID, (provider) => {
          provider.integrationID = integrationID
        }),
      )
      expect(yield* catalog.provider.available()).toEqual([])

      yield* (yield* Credential.Service).create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })

      expect((yield* catalog.provider.available()).map((provider) => provider.id)).toEqual([providerID])
    }).pipe(Effect.provide(localCatalogLayer))
  })

  it.effect("projects environment connections without a catalog plugin", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env.CATALOG_TEST_API_KEY
        process.env.CATALOG_TEST_API_KEY = "secret"
        return previous
      }),
      () =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const integrations = yield* Integration.Service
          const providerID = ProviderV2.ID.make("test")
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID: Integration.ID.make(providerID),
              method: { type: "env", names: ["CATALOG_TEST_API_KEY"] },
            }),
          )
          yield* catalog.transform((editor) => editor.provider.update(providerID, () => {}))

          expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(providerID)
        }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.CATALOG_TEST_API_KEY
          else process.env.CATALOG_TEST_API_KEY = previous
        }),
    ),
  )

  it.effect("stores provider package settings", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      yield* catalog.transform((catalog) =>
        catalog.provider.update(providerID, (provider) => {
          provider.package = ProviderV2.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL: "https://override.example.com" }
        }),
      )

      expect(required(yield* catalog.provider.get(providerID))).toMatchObject({
        package: ProviderV2.aisdk("@ai-sdk/openai-compatible"),
        settings: { baseURL: "https://override.example.com" },
      })
    }),
  )

  it.effect("uses model package settings over provider settings", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.package = ProviderV2.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL: "https://provider.example.com" }
        })
        catalog.model.update(providerID, modelID, (model) => {
          model.modelID = ModelV2.ID.make("upstream-model")
          model.package = ProviderV2.aisdk("@ai-sdk/openai-compatible")
          model.settings = { baseURL: "https://override.example.com" }
        })
      })

      expect(required(yield* catalog.model.get(providerID, modelID))).toMatchObject({
        modelID: ModelV2.ID.make("upstream-model"),
        package: ProviderV2.aisdk("@ai-sdk/openai-compatible"),
        settings: { baseURL: "https://override.example.com" },
      })
    }),
  )

  it.effect("resolves default model package settings from the provider", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.package = ProviderV2.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL: "https://provider.example.com" }
        })
        catalog.model.update(providerID, modelID, () => {})
      })

      expect(required(yield* catalog.model.get(providerID, modelID))).toMatchObject({
        package: ProviderV2.aisdk("@ai-sdk/openai-compatible"),
        settings: { baseURL: "https://provider.example.com" },
      })
    }),
  )

  it.effect("resolves provider and model overlay merges", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.settings = { provider: true, shared: "provider" }
          provider.headers = { provider: "provider", shared: "provider" }
          provider.body = { provider: true, shared: "provider" }
        })
        catalog.model.update(providerID, modelID, (model) => {
          model.settings = { model: true, shared: "model" }
          model.headers = { model: "model", shared: "model" }
          model.body = { model: true, shared: "model" }
        })
      })

      const model = required(yield* catalog.model.get(providerID, modelID))
      expect(model.settings).toEqual({ provider: true, shared: "model", model: true })
      expect(model.headers).toEqual({ provider: "provider", shared: "model", model: "model" })
      expect(model.body).toEqual({ provider: true, shared: "model", model: true })
    }),
  )

  it.effect("falls back to newest available model when no default is configured", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("old"), (model) => {
          model.time.released = 1000
        })
        catalog.model.update(providerID, ModelV2.ID.make("new"), (model) => {
          model.time.released = 2000
        })
      })

      expect((yield* catalog.model.default())?.id).toMatch("new")
    }),
  )

  it.effect("uses a transform-provided default model until that transform is replaced", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const old = ModelV2.ID.make("old")
      const newest = ModelV2.ID.make("new")
      const models = (catalog: Catalog.Draft) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, old, (model) => {
          model.time.released = 1000
        })
        catalog.model.update(providerID, newest, (model) => {
          model.time.released = 2000
        })
      }

      let configured = true
      yield* catalog.transform((catalog) => {
        models(catalog)
        if (configured) catalog.model.default.set(providerID, old)
      })
      expect((yield* catalog.model.default())?.id).toBe(old)

      configured = false
      const reload = yield* catalog.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(reload)
      expect((yield* catalog.model.default())?.id).toBe(newest)
    }),
  )

  it.effect("ignores a configured default on a disabled provider", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const disabledProvider = ProviderV2.ID.make("disabled")
      const enabledProvider = ProviderV2.ID.make("enabled")
      const disabledModel = ModelV2.ID.make("configured")
      const fallbackModel = ModelV2.ID.make("fallback")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(disabledProvider, (provider) => {
          provider.disabled = true
        })
        catalog.model.update(disabledProvider, disabledModel, () => {})
        catalog.provider.update(enabledProvider, () => {})
        catalog.model.update(enabledProvider, fallbackModel, () => {})
        catalog.model.default.set(disabledProvider, disabledModel)
      })

      expect(yield* catalog.model.default()).toMatchObject({
        providerID: enabledProvider,
        id: fallbackModel,
      })
    }),
  )

  it.effect("small model prefers small keyword candidates before cost scoring", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("cheap-large"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [
            {
              input: Money.USDPerMillionTokens.make(1),
              output: Money.USDPerMillionTokens.make(1),
              cache: {
                read: Money.USDPerMillionTokens.zero,
                write: Money.USDPerMillionTokens.zero,
              },
            },
          ]
          model.time.released = Date.now()
        })
        catalog.model.update(providerID, ModelV2.ID.make("expensive-mini"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [
            {
              input: Money.USDPerMillionTokens.make(10),
              output: Money.USDPerMillionTokens.make(10),
              cache: {
                read: Money.USDPerMillionTokens.zero,
                write: Money.USDPerMillionTokens.zero,
              },
            },
          ]
          model.time.released = Date.now()
        })
      })

      expect((yield* catalog.model.small(providerID))?.id).toMatch("expensive-mini")
    }),
  )
})
