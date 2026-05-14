import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer, Option } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Instance } from "@opencode-ai/core/instance"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "./lib/effect"

const instanceLayer = Layer.succeed(Instance.Service, Instance.Service.of({ directory: "test" }))
const it = testEffect(Catalog.layer.pipe(Layer.provideMerge(PluginV2.defaultLayer), Layer.provide(instanceLayer)))

describe("CatalogV2", () => {
  it.effect("normalizes provider baseURL into endpoint url", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")

      yield* catalog.provider.update(providerID, (provider) => {
        provider.endpoint = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://default.example.com",
        }
        provider.options.aisdk.provider.baseURL = "https://override.example.com"
      })

      const provider = yield* catalog.provider.get(providerID)

      expect(provider.endpoint).toEqual({
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://override.example.com",
      })
      expect(provider.options.aisdk.provider.baseURL).toBeUndefined()
    }),
  )

  it.effect("normalizes model baseURL into endpoint url", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")

      yield* catalog.provider.update(providerID, (provider) => {
        provider.endpoint = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://provider.example.com",
        }
      })
      yield* catalog.model.update(providerID, modelID, (model) => {
        model.endpoint = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://model.example.com",
        }
        model.options.aisdk.provider.baseURL = "https://override.example.com"
      })

      const model = yield* catalog.model.get(providerID, modelID)

      expect(model.endpoint).toEqual({
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://override.example.com",
      })
      expect(model.options.aisdk.provider.baseURL).toBeUndefined()
    }),
  )

  it.effect("resolves unknown model endpoint from provider endpoint", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")

      yield* catalog.provider.update(providerID, (provider) => {
        provider.endpoint = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://provider.example.com",
        }
      })
      yield* catalog.model.update(providerID, modelID, () => {})

      const model = yield* catalog.model.get(providerID, modelID)

      expect(model.endpoint).toEqual({
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://provider.example.com",
      })
    }),
  )

  it.effect("runs provider hooks after baseURL is normalized", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const plugin = yield* PluginV2.Service
      const providerID = ProviderV2.ID.make("test")
      const seen: unknown[] = []

      yield* plugin.add({
        id: PluginV2.ID.make("test"),
        effect: Effect.succeed({
          "provider.update": (evt) =>
            Effect.sync(() => {
              seen.push(evt.provider.endpoint.type)
              if (evt.provider.endpoint.type === "aisdk") seen.push(evt.provider.endpoint.url)
              seen.push(evt.provider.options.aisdk.provider.baseURL)
            }),
        }),
      })
      yield* catalog.provider.update(providerID, (provider) => {
        provider.endpoint = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
        }
        provider.options.aisdk.provider.baseURL = "https://provider.example.com"
      })

      expect(seen).toEqual(["aisdk", "https://provider.example.com", undefined])
    }),
  )

  it.effect("resolves provider and model option merges", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")

      yield* catalog.provider.update(providerID, (provider) => {
        provider.options.headers.provider = "provider"
        provider.options.headers.shared = "provider"
        provider.options.body.provider = true
        provider.options.aisdk.provider.provider = true
      })
      yield* catalog.model.update(providerID, modelID, (model) => {
        model.options.headers.model = "model"
        model.options.headers.shared = "model"
        model.options.body.model = true
        model.options.aisdk.provider.model = true
        model.options.aisdk.request.request = true
      })

      const model = yield* catalog.model.get(providerID, modelID)

      expect(model.options.headers).toEqual({ provider: "provider", shared: "model", model: "model" })
      expect(model.options.body).toEqual({ provider: true, model: true })
      expect(model.options.aisdk.provider).toEqual({ provider: true, model: true })
      expect(model.options.aisdk.request).toEqual({ request: true })
    }),
  )

  it.effect("falls back to newest available model when no default is configured", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")

      yield* catalog.provider.update(providerID, (provider) => {
        provider.enabled = { via: "custom", data: {} }
      })
      yield* catalog.model.update(providerID, ModelV2.ID.make("old"), (model) => {
        model.time.released = DateTime.makeUnsafe(1000)
      })
      yield* catalog.model.update(providerID, ModelV2.ID.make("new"), (model) => {
        model.time.released = DateTime.makeUnsafe(2000)
      })

      const model = yield* catalog.model.default()

      expect(Option.getOrUndefined(model)?.id).toMatch("new")
    }),
  )

  it.effect("small model prefers small keyword candidates before cost scoring", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")

      yield* catalog.provider.update(providerID, () => {})
      yield* catalog.model.update(providerID, ModelV2.ID.make("cheap-large"), (model) => {
        model.capabilities.input = ["text"]
        model.capabilities.output = ["text"]
        model.cost = [{ input: 1, output: 1, cache: { read: 0, write: 0 } }]
        model.time.released = DateTime.makeUnsafe(Date.now())
      })
      yield* catalog.model.update(providerID, ModelV2.ID.make("expensive-mini"), (model) => {
        model.capabilities.input = ["text"]
        model.capabilities.output = ["text"]
        model.cost = [{ input: 10, output: 10, cache: { read: 0, write: 0 } }]
        model.time.released = DateTime.makeUnsafe(Date.now())
      })

      const model = yield* catalog.model.small(providerID)

      expect(Option.getOrUndefined(model)?.id).toMatch("expensive-mini")
    }),
  )
})
