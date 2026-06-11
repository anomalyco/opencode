import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer, Option } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Connector } from "@opencode-ai/core/connector"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { Policy } from "@opencode-ai/core/policy"
import { Project } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("test") })),
)
const it = testEffect(
  Catalog.locationLayer.pipe(
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(locationLayer),
    Layer.provideMerge(Layer.mock(Credential.Service)({ activeAll: () => Effect.succeed(new Map()) })),
  ),
)

describe("CatalogV2", () => {
  it.effect("projects active credentials without rebuilding catalog state", () => {
    const connectorID = Connector.ID.make("test")
    const methodID = Connector.MethodID.make("api-key")
    const first = new Credential.Info({
      id: Credential.ID.create(),
      connectorID,
      methodID,
      label: "First",
      value: new Credential.Key({ type: "key", key: "first", metadata: { tenant: "one" } }),
    })
    const second = new Credential.Info({
      id: Credential.ID.create(),
      connectorID,
      methodID,
      label: "Second",
      value: new Credential.Key({ type: "key", key: "second", metadata: { tenant: "two" } }),
    })
    let active = first
    const layer = Catalog.locationLayer.pipe(
      Layer.fresh,
      Layer.provideMerge(EventV2.defaultLayer),
      Layer.provideMerge(locationLayer),
      Layer.provideMerge(
        Layer.mock(Credential.Service)({ activeAll: () => Effect.succeed(new Map([[connectorID, active]])) }),
      ),
    )

    return Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const transform = yield* catalog.transform()
      yield* transform((editor) => editor.provider.update(ProviderV2.ID.make("test"), () => {}))

      expect(yield* catalog.provider.get(ProviderV2.ID.make("test"))).toMatchObject({
        enabled: { via: "credential", credentialID: first.id },
        request: { body: { apiKey: "first", tenant: "one" } },
      })
      active = second
      expect(yield* catalog.provider.get(ProviderV2.ID.make("test"))).toMatchObject({
        enabled: { via: "credential", credentialID: second.id },
        request: { body: { apiKey: "second", tenant: "two" } },
      })
    }).pipe(Effect.provide(layer))
  })

  it.effect("normalizes provider baseURL into api url", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const transform = yield* catalog.transform()

      yield* transform((catalog) =>
        catalog.provider.update(providerID, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://default.example.com",
          }
          provider.request.body.baseURL = "https://override.example.com"
        }),
      )

      expect((yield* catalog.provider.get(providerID)).api).toEqual({
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://override.example.com",
      })
    }),
  )

  it.effect("normalizes model baseURL into api url", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      const transform = yield* catalog.transform()

      yield* transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://provider.example.com",
          }
        })
        catalog.model.update(providerID, modelID, (model) => {
          model.api = {
            id: modelID,
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://model.example.com",
          }
          model.request.body.baseURL = "https://override.example.com"
        })
      })

      expect((yield* catalog.model.get(providerID, modelID)).api).toEqual({
        id: modelID,
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://override.example.com",
        settings: {},
      })
    }),
  )

  it.effect("resolves default model api from provider api", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      const transform = yield* catalog.transform()

      yield* transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://provider.example.com",
          }
        })
        catalog.model.update(providerID, modelID, () => {})
      })

      expect((yield* catalog.model.get(providerID, modelID)).api).toEqual({
        id: modelID,
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://provider.example.com",
      })
    }),
  )

  it.effect("runs catalog transform hooks after baseURL is normalized", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const plugin = yield* PluginV2.Service
      const providerID = ProviderV2.ID.make("test")
      const seen: unknown[] = []
      const transform = yield* catalog.transform()

      yield* plugin.add({
        id: PluginV2.ID.make("test"),
        effect: Effect.succeed({
          "catalog.transform": (evt) =>
            Effect.sync(() => {
              const item = evt.provider.get(providerID)
              if (!item) return
              seen.push(item.provider.api.type)
              if (item?.provider.api.type === "aisdk") seen.push(item.provider.api.url)
              seen.push(item?.provider.request.body.baseURL)
            }),
        }),
      })
      yield* transform((catalog) =>
        catalog.provider.update(providerID, (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
          provider.request.body.baseURL = "https://provider.example.com"
        }),
      )

      expect(seen).toEqual(["aisdk", "https://provider.example.com", undefined])
    }),
  )

  it.effect("runs catalog transform when a plugin is added", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const plugin = yield* PluginV2.Service
      const providerID = ProviderV2.ID.make("test")
      const transform = yield* catalog.transform()

      yield* transform((catalog) =>
        catalog.provider.update(providerID, (provider) => {
          provider.name = "Before"
        }),
      )
      yield* plugin.add({
        id: PluginV2.ID.make("test-transform"),
        effect: Effect.succeed({
          "catalog.transform": (evt) =>
            Effect.sync(() =>
              evt.provider.update(providerID, (provider) => {
                provider.name = "After"
              }),
            ),
        }),
      })
      yield* Effect.yieldNow

      expect((yield* catalog.provider.get(providerID)).name).toBe("After")
    }),
  )

  it.effect("ignores plugin additions from another location", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const plugin = yield* PluginV2.Service
      let invoked = 0

      yield* plugin.add({
        id: PluginV2.ID.make("test-transform"),
        effect: Effect.succeed({
          "catalog.transform": () => Effect.sync(() => invoked++),
        }),
      })
      yield* Effect.yieldNow
      expect(invoked).toBe(1)

      yield* events.publish(
        PluginV2.Event.Added,
        { id: PluginV2.ID.make("test-transform") },
        {
          location: new Location.Info({
            directory: AbsolutePath.make("other"),
            project: { id: Project.ID.global, directory: AbsolutePath.make("other") },
          }),
        },
      )
      yield* Effect.yieldNow

      expect(invoked).toBe(1)
    }),
  )

  it.effect("resolves provider and model request merges", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      const transform = yield* catalog.transform()

      yield* transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.request.headers.provider = "provider"
          provider.request.headers.shared = "provider"
          provider.request.body.provider = true
        })
        catalog.model.update(providerID, modelID, (model) => {
          model.request.headers.model = "model"
          model.request.headers.shared = "model"
          model.request.body.model = true
          model.request.body.request = true
          const options = (model.request.options ??= {})
          options.shared = "model"
          options.model = true
        })
      })

      const model = yield* catalog.model.get(providerID, modelID)
      expect(model.request.headers).toEqual({ provider: "provider", shared: "model", model: "model" })
      expect(model.request.body).toEqual({ provider: true, model: true, request: true })
      expect(model.request.options).toEqual({ shared: "model", model: true })
    }),
  )

  it.effect("falls back to newest available model when no default is configured", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const transform = yield* catalog.transform()

      yield* transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.enabled = { via: "custom", data: {} }
        })
        catalog.model.update(providerID, ModelV2.ID.make("old"), (model) => {
          model.time.released = DateTime.makeUnsafe(1000)
        })
        catalog.model.update(providerID, ModelV2.ID.make("new"), (model) => {
          model.time.released = DateTime.makeUnsafe(2000)
        })
      })

      expect(Option.getOrUndefined(yield* catalog.model.default())?.id).toMatch("new")
    }),
  )

  it.effect("uses a transform-provided default model until that transform is replaced", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const old = ModelV2.ID.make("old")
      const newest = ModelV2.ID.make("new")
      const transform = yield* catalog.transform()

      const models = (catalog: Catalog.Editor) => {
        catalog.provider.update(providerID, (provider) => {
          provider.enabled = { via: "custom", data: {} }
        })
        catalog.model.update(providerID, old, (model) => {
          model.time.released = DateTime.makeUnsafe(1000)
        })
        catalog.model.update(providerID, newest, (model) => {
          model.time.released = DateTime.makeUnsafe(2000)
        })
      }

      yield* transform((catalog) => {
        models(catalog)
        catalog.model.default.set(providerID, old)
      })
      expect(Option.getOrUndefined(yield* catalog.model.default())?.id).toBe(old)

      yield* transform(models)
      expect(Option.getOrUndefined(yield* catalog.model.default())?.id).toBe(newest)
    }),
  )

  it.effect("ignores a configured default on a disabled provider", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const disabledProvider = ProviderV2.ID.make("disabled")
      const enabledProvider = ProviderV2.ID.make("enabled")
      const disabledModel = ModelV2.ID.make("configured")
      const fallbackModel = ModelV2.ID.make("fallback")
      const transform = yield* catalog.transform()

      yield* transform((catalog) => {
        catalog.provider.update(disabledProvider, (provider) => {
          provider.enabled = false
        })
        catalog.model.update(disabledProvider, disabledModel, () => {})
        catalog.provider.update(enabledProvider, (provider) => {
          provider.enabled = { via: "custom", data: {} }
        })
        catalog.model.update(enabledProvider, fallbackModel, () => {})
        catalog.model.default.set(disabledProvider, disabledModel)
      })

      expect(Option.getOrUndefined(yield* catalog.model.default())).toMatchObject({
        providerID: enabledProvider,
        id: fallbackModel,
      })
    }),
  )

  it.effect("small model prefers small keyword candidates before cost scoring", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const transform = yield* catalog.transform()

      yield* transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("cheap-large"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [{ input: 1, output: 1, cache: { read: 0, write: 0 } }]
          model.time.released = DateTime.makeUnsafe(Date.now())
        })
        catalog.model.update(providerID, ModelV2.ID.make("expensive-mini"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [{ input: 10, output: 10, cache: { read: 0, write: 0 } }]
          model.time.released = DateTime.makeUnsafe(Date.now())
        })
      })

      expect(Option.getOrUndefined(yield* catalog.model.small(providerID))?.id).toMatch("expensive-mini")
    }),
  )

  it.effect("removes providers denied by policy after loading", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const policy = yield* Policy.Service
      const providerID = ProviderV2.ID.make("blocked")
      const transform = yield* catalog.transform()

      yield* policy.load([new Policy.Info({ effect: "deny", action: "provider.use", resource: "blocked" })])
      yield* transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("model"), () => {})
      })

      expect(yield* catalog.provider.all()).toEqual([])
      expect(yield* catalog.model.all()).toEqual([])
      expect(yield* catalog.provider.get(providerID).pipe(Effect.option)).toEqual(Option.none())
    }),
  )
})
