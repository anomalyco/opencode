import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { VariantPlugin } from "@opencode/core/plugin/variant"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Effect, Layer } from "effect"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { modelHost, host } from "./host"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Provider.node, Model.node]), [Location.node.replace(locationLayer)]),
)

describe("VariantPlugin", () => {
  it.effect("adds GLM 5.2 variants after catalog sources", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.opencode, (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
        editor.models.update(Provider.ID.opencode, Model.ID.make("glm-5.2"), (model) => {
          model.modelID = Model.ID.make("glm-5.2")
          model.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ model: modelHost(models) }))

      expect((yield* models.get(Provider.ID.opencode, Model.ID.make("glm-5.2")))?.variants).toEqual([
        expect.objectContaining({ id: "high", settings: { reasoningEffort: "high" } }),
        expect.objectContaining({ id: "max", settings: { reasoningEffort: "max" } }),
      ])
    }),
  )

  it.effect("keeps explicit variants over generated defaults", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* providers.transform((editor) => {
        editor.models.update(Provider.ID.opencode, Model.ID.make("glm-5.2"), (model) => {
          model.modelID = Model.ID.make("glm-5.2")
          model.package = Provider.aisdk("@ai-sdk/openai-compatible")
          model.variants = [{ id: Model.VariantID.make("high"), settings: {}, headers: { custom: "true" }, body: {} }]
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ model: modelHost(models) }))

      expect((yield* models.get(Provider.ID.opencode, Model.ID.make("glm-5.2")))?.variants).toEqual([
        expect.objectContaining({ id: "high", headers: { custom: "true" } }),
        expect.objectContaining({ id: "max", settings: { reasoningEffort: "max" } }),
      ])
    }),
  )
})
