import { describe, expect } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect, Layer } from "effect"
import { AISDK } from "@opencode-ai/core/aisdk"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "./lib/effect"
import { model } from "./plugin/provider-helper"

function fakeLanguageModel(id: string): LanguageModelV3 {
  return { specificationVersion: "v3", provider: "test", modelId: id } as unknown as LanguageModelV3
}

function pluginWithCounter(sdkCalls: string[]) {
  return PluginV2.define({
    id: PluginV2.ID.make("test-counter"),
    effect: Effect.gen(function* () {
      return {
        "aisdk.sdk": Effect.fn(function* (evt) {
          if (evt.package !== "test-provider") return
          sdkCalls.push(evt.model.id)
          evt.sdk = {
            languageModel: (id: string) => fakeLanguageModel(id),
          }
        }),
      }
    }),
  })
}

const layer = AISDK.layer.pipe(
  Layer.provideMerge(PluginV2.locationLayer.pipe(Layer.provide(EventV2.defaultLayer))),
)

const it = testEffect(layer)

const providerA = ProviderV2.ID.make("provider-a")
const providerB = ProviderV2.ID.make("provider-b")
const modelA1 = model("provider-a", "model-1")
const modelA2 = model("provider-a", "model-2")
const modelB1 = model("provider-b", "model-1")

describe("AISDK.evict", () => {
  it.effect("language() returns cached model on second call (baseline)", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const sdkCalls: string[] = []
      yield* plugin.add(pluginWithCounter(sdkCalls))

      yield* aisdk.language(modelA1)
      yield* aisdk.language(modelA1)

      expect(sdkCalls).toHaveLength(1)
    }),
  )

  it.effect("evict causes next language() call to re-derive (cache miss)", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const sdkCalls: string[] = []
      yield* plugin.add(pluginWithCounter(sdkCalls))

      yield* aisdk.language(modelA1)
      expect(sdkCalls).toHaveLength(1)

      yield* aisdk.evict({ providerID: providerA, id: ModelV2.ID.make("model-1") })

      yield* aisdk.language(modelA1)
      expect(sdkCalls).toHaveLength(2)
    }),
  )

  it.effect(
    "evict clears language cache for target model but not other models (language eviction is model-scoped, SDK eviction is provider-wide by design)",
    () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const aisdk = yield* AISDK.Service
        const sdkCalls: string[] = []
        yield* plugin.add(pluginWithCounter(sdkCalls))

        yield* aisdk.language(modelA1)
        yield* aisdk.language(modelA2)
        expect(sdkCalls).toHaveLength(2)

        yield* aisdk.evict({ providerID: providerA, id: ModelV2.ID.make("model-1") })

        yield* aisdk.language(modelA2)
        expect(sdkCalls).toHaveLength(2)
      }),
  )

  it.effect("evict does not remove entries for different providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const sdkCalls: string[] = []
      yield* plugin.add(pluginWithCounter(sdkCalls))

      yield* aisdk.language(modelA1)
      yield* aisdk.language(modelB1)
      expect(sdkCalls).toHaveLength(2)

      yield* aisdk.evict({ providerID: providerA, id: ModelV2.ID.make("model-1") })

      yield* aisdk.language(modelB1)
      expect(sdkCalls).toHaveLength(2)
    }),
  )

  it.effect("evict clears all variants for the same model", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const sdkCalls: string[] = []
      yield* plugin.add(pluginWithCounter(sdkCalls))

      const modelVariantA = model("provider-a", "model-1", { request: { headers: {}, body: {}, variant: "high" } })
      const modelVariantB = model("provider-a", "model-1", { request: { headers: {}, body: {}, variant: "low" } })

      const langA1 = yield* aisdk.language(modelVariantA)
      const langB1 = yield* aisdk.language(modelVariantB)
      expect(langA1).not.toBe(langB1)

      yield* aisdk.evict({ providerID: providerA, id: ModelV2.ID.make("model-1") })

      const langA2 = yield* aisdk.language(modelVariantA)
      const langB2 = yield* aisdk.language(modelVariantB)

      expect(langA2).not.toBe(langA1)
      expect(langB2).not.toBe(langB1)
    }),
  )

  it.effect("evict on model that was never loaded is a no-op", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service

      const result = yield* aisdk
        .evict({ providerID: ProviderV2.ID.make("never-loaded"), id: ModelV2.ID.make("ghost") })
        .pipe(Effect.exit)
      expect(result._tag).toBe("Success")
    }),
  )

  it.effect("evict does not affect models whose providerID is a prefix of the target providerID", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const sdkCalls: string[] = []
      yield* plugin.add(pluginWithCounter(sdkCalls))

      const shortProvider = model("provider", "model-1")
      const longProvider = model("provider-a", "model-1")

      yield* aisdk.language(shortProvider)
      yield* aisdk.language(longProvider)
      expect(sdkCalls).toHaveLength(2)

      yield* aisdk.evict({ providerID: ProviderV2.ID.make("provider-a"), id: ModelV2.ID.make("model-1") })

      yield* aisdk.language(shortProvider)
      expect(sdkCalls).toHaveLength(2)
    }),
  )
})
