import { describe, expect } from "bun:test"
import { Catalog } from "@opencode-ai/core/catalog"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { VariantPlugin } from "@opencode-ai/core/plugin/variant"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { catalogHost, host } from "./host"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const it = testEffect(AppNodeBuilder.build(Catalog.node, [[Location.node, locationLayer]]))

describe("VariantPlugin", () => {
  it.effect("adds GLM 5.2 variants after catalog sources", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.opencode, (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
        })
        catalog.model.update(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2"), (model) => {
          model.api = {
            id: ModelV2.ID.make("glm-5.2"),
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
          }
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) }))

      expect((yield* service.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2")))?.variants).toEqual([
        expect.objectContaining({ id: "high", settings: { reasoningEffort: "high" } }),
        expect.objectContaining({ id: "max", settings: { reasoningEffort: "max" } }),
      ])
    }),
  )

  it.effect("keeps explicit variants over generated defaults", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.model.update(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2"), (model) => {
          model.api = {
            id: ModelV2.ID.make("glm-5.2"),
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
          }
          model.variants = [{ id: ModelV2.VariantID.make("high"), settings: {}, headers: { custom: "true" }, body: {} }]
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) }))

      expect((yield* service.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2")))?.variants).toEqual([
        expect.objectContaining({ id: "high", headers: { custom: "true" } }),
        expect.objectContaining({ id: "max", settings: { reasoningEffort: "max" } }),
      ])
    }),
  )
})
