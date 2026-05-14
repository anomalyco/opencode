import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer, Option } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Instance } from "@opencode-ai/core/instance"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { OpencodePlugin } from "@opencode-ai/core/plugin/provider/opencode"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { it, model, provider, withEnv } from "./provider-helper"

const cost = (input: number, output = 0) => [{ input, output, cache: { read: 0, write: 0 } }]
const instanceLayer = Layer.succeed(Instance.Service, Instance.Service.of({ directory: "test" }))

describe("OpencodePlugin", () => {
  it.effect("uses a public key and cancels paid models without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(OpencodePlugin)
        const updated = yield* plugin.trigger("provider.update", {}, { provider: provider("opencode"), cancel: false })
        const paid = yield* plugin.trigger(
          "model.update",
          {},
          { model: model("opencode", "paid", { cost: cost(1) }), cancel: false },
        )
        expect(updated.provider.options.aisdk.provider.apiKey).toBe("public")
        expect(paid.cancel).toBe(true)
      }),
    ),
  )

  it.effect("keeps free models without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(OpencodePlugin)
        yield* plugin.trigger("provider.update", {}, { provider: provider("opencode"), cancel: false })
        const free = yield* plugin.trigger(
          "model.update",
          {},
          { model: model("opencode", "free", { cost: cost(0) }), cancel: false },
        )
        expect(free.cancel).toBe(false)
      }),
    ),
  )

  it.effect("treats output-only cost as free without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(OpencodePlugin)
        yield* plugin.trigger("provider.update", {}, { provider: provider("opencode"), cancel: false })
        const outputOnly = yield* plugin.trigger(
          "model.update",
          {},
          { model: model("opencode", "output-only", { cost: cost(0, 1) }), cancel: false },
        )
        expect(outputOnly.cancel).toBe(false)
      }),
    ),
  )

  it.effect("uses OPENCODE_API_KEY as credentials", () =>
    withEnv({ OPENCODE_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(OpencodePlugin)
        const updated = yield* plugin.trigger("provider.update", {}, { provider: provider("opencode"), cancel: false })
        const paid = yield* plugin.trigger(
          "model.update",
          {},
          { model: model("opencode", "paid", { cost: cost(1) }), cancel: false },
        )
        expect(updated.provider.options.aisdk.provider.apiKey).toBeUndefined()
        expect(paid.cancel).toBe(false)
      }),
    ),
  )

  it.effect("uses configured provider env vars as credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined, CUSTOM_OPENCODE_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(OpencodePlugin)
        const updated = yield* plugin.trigger(
          "provider.update",
          {},
          { provider: provider("opencode", { env: ["CUSTOM_OPENCODE_API_KEY"] }), cancel: false },
        )
        const paid = yield* plugin.trigger(
          "model.update",
          {},
          { model: model("opencode", "paid", { cost: cost(1) }), cancel: false },
        )
        expect(updated.provider.options.aisdk.provider.apiKey).toBeUndefined()
        expect(paid.cancel).toBe(false)
      }),
    ),
  )

  it.effect("uses configured apiKey as credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(OpencodePlugin)
        const updated = yield* plugin.trigger(
          "provider.update",
          {},
          {
            provider: provider("opencode", {
              options: {
                headers: {},
                body: {},
                aisdk: {
                  provider: { apiKey: "configured" },
                  request: {},
                },
              },
            }),
            cancel: false,
          },
        )
        const paid = yield* plugin.trigger(
          "model.update",
          {},
          { model: model("opencode", "paid", { cost: cost(1) }), cancel: false },
        )
        expect(updated.provider.options.aisdk.provider.apiKey).toBe("configured")
        expect(paid.cancel).toBe(false)
      }),
    ),
  )

  it.effect("uses auth-enabled providers as credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(OpencodePlugin)
        const updated = yield* plugin.trigger(
          "provider.update",
          {},
          { provider: provider("opencode", { enabled: { via: "auth", service: "opencode" } }), cancel: false },
        )
        const paid = yield* plugin.trigger(
          "model.update",
          {},
          { model: model("opencode", "paid", { cost: cost(1) }), cancel: false },
        )
        expect(updated.provider.options.aisdk.provider.apiKey).toBeUndefined()
        expect(paid.cancel).toBe(false)
      }),
    ),
  )

  it.effect("ignores non-opencode providers and models", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(OpencodePlugin)
        const updated = yield* plugin.trigger("provider.update", {}, { provider: provider("openai"), cancel: false })
        const paid = yield* plugin.trigger(
          "model.update",
          {},
          { model: model("openai", "paid", { cost: cost(1) }), cancel: false },
        )
        expect(updated.provider.options.aisdk.provider.apiKey).toBeUndefined()
        expect(paid.cancel).toBe(false)
      }),
    ),
  )

  it.effect("prefers gpt-5-nano as the opencode small model", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.opencode

      yield* catalog.provider.update(providerID, () => {})
      yield* catalog.model.update(providerID, ModelV2.ID.make("cheap-mini"), (model) => {
        model.capabilities.input = ["text"]
        model.capabilities.output = ["text"]
        model.cost = cost(1, 1)
        model.time.released = DateTime.makeUnsafe(Date.now())
      })
      yield* catalog.model.update(providerID, ModelV2.ID.make("gpt-5-nano"), (model) => {
        model.capabilities.input = ["text"]
        model.capabilities.output = ["text"]
        model.cost = cost(10, 10)
        model.time.released = DateTime.makeUnsafe(Date.now())
      })

      const selected = yield* catalog.model.small(providerID)

      expect(Option.getOrUndefined(selected)?.id).toBe(ModelV2.ID.make("gpt-5-nano"))
    }).pipe(Effect.provide(Catalog.defaultLayer.pipe(Layer.provide(instanceLayer)))),
  )
})
