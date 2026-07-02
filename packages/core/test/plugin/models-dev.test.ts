import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ModelsDevPlugin } from "@opencode-ai/core/plugin/models-dev"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { catalogHost, host, integrationHost } from "./host"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const layer = AppNodeBuilder.build(LayerNode.group([Catalog.node, Integration.node, EventV2.node]), [
  [Location.node, locationLayer],
])
const it = testEffect(layer)

describe("ModelsDevPlugin", () => {
  it.effect("projects models.dev modes as separate models instead of variants", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const catalog = yield* Catalog.Service
      const models = ModelsDev.Service.of({
        get: () =>
          Effect.succeed({
            acme: {
              id: "acme",
              name: "Acme",
              env: [],
              npm: "@ai-sdk/openai-compatible",
              api: "https://api.acme.test/v1",
              models: {
                "gpt-5.4": {
                  id: "gpt-5.4",
                  name: "GPT-5.4",
                  family: "gpt",
                  release_date: "2026-01-01",
                  attachment: false,
                  reasoning: true,
                  temperature: true,
                  tool_call: true,
                  cost: {
                    input: 2.5,
                    output: 15,
                    tiers: [
                      {
                        tier: { type: "context", size: 272_000 },
                        input: 3,
                        output: 18,
                        cache_read: 0.25,
                      },
                    ],
                    context_over_200k: { input: 5, output: 22.5, cache_read: 0.5 },
                  },
                  limit: { context: 1_050_000, input: 922_000, output: 128_000 },
                  experimental: {
                    modes: {
                      fast: {
                        cost: { input: 5, output: 30, cache_read: 0.5 },
                        provider: {
                          headers: { "x-mode": "fast" },
                          body: { service_tier: "priority" },
                        },
                      },
                    },
                  },
                },
              },
            },
          } satisfies Record<string, ModelsDev.Provider>),
        refresh: () => Effect.void,
      })

      yield* ModelsDevPlugin.effect(
        host({
          catalog: catalogHost(catalog),
          integration: integrationHost(integrations),
        }),
      ).pipe(Effect.provideService(ModelsDev.Service, models))

      const providerID = ProviderV2.ID.make("acme")
      const base = yield* catalog.model.get(providerID, ModelV2.ID.make("gpt-5.4"))
      const fast = yield* catalog.model.get(providerID, ModelV2.ID.make("gpt-5.4-fast"))

      expect(base?.variants).toEqual([])
      expect(base?.request.body).toEqual({})
      expect(fast).toMatchObject({
        id: "gpt-5.4-fast",
        providerID: "acme",
        name: "GPT-5.4 Fast",
        api: { id: "gpt-5.4" },
        request: {
          headers: { "x-mode": "fast" },
          body: { service_tier: "priority" },
        },
        variants: [],
      })
      expect(fast?.cost).toEqual([
        { input: 5, output: 30, cache: { read: 0.5, write: 0 } },
        {
          tier: { type: "context", size: 272_000 },
          input: 3,
          output: 18,
          cache: { read: 0.25, write: 0 },
        },
        {
          tier: { type: "context", size: 200_000 },
          input: 5,
          output: 22.5,
          cache: { read: 0.5, write: 0 },
        },
      ])
    }),
  )

  it.effect("registers key methods for providers with environment variables", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = {
          path: Flag.OPENCODE_MODELS_PATH,
          disabled: Flag.OPENCODE_DISABLE_MODELS_FETCH,
        }
        Flag.OPENCODE_MODELS_PATH = path.join(import.meta.dir, "fixtures", "models-dev.json")
        Flag.OPENCODE_DISABLE_MODELS_FETCH = true
        return previous
      }),
      () =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const catalog = yield* Catalog.Service
          yield* ModelsDevPlugin.effect(
            host({
              catalog: catalogHost(catalog),
              integration: integrationHost(integrations),
            }),
          )
          expect(yield* integrations.list()).toEqual([
            new Integration.Info({
              id: Integration.ID.make("acme"),
              name: "Acme",
              methods: [
                { type: "key" },
                {
                  type: "env",
                  names: ["ACME_API_KEY"],
                },
              ],
              connections: [],
            }),
          ])
        }).pipe(Effect.provide(AppNodeBuilder.build(ModelsDev.node))),
      (previous) =>
        Effect.sync(() => {
          Flag.OPENCODE_MODELS_PATH = previous.path
          Flag.OPENCODE_DISABLE_MODELS_FETCH = previous.disabled
        }),
    ),
  )

  it.effect("converts reasoning options into settings variants", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = {
          path: Flag.OPENCODE_MODELS_PATH,
          disabled: Flag.OPENCODE_DISABLE_MODELS_FETCH,
        }
        Flag.OPENCODE_MODELS_PATH = path.join(import.meta.dir, "fixtures", "models-dev-reasoning.json")
        Flag.OPENCODE_DISABLE_MODELS_FETCH = true
        return previous
      }),
      () =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const integrations = yield* Integration.Service
          yield* ModelsDevPlugin.effect(
            host({
              catalog: catalogHost(catalog),
              integration: integrationHost(integrations),
            }),
          )

          const model = yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("gpt-reasoning"))
          expect(model?.variants.map((variant) => variant.id)).toEqual([
            ModelV2.VariantID.make("low"),
            ModelV2.VariantID.make("high"),
          ])
          expect(model?.variants).toContainEqual({
            id: ModelV2.VariantID.make("low"),
            settings: {
              reasoningEffort: "low",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
            headers: {},
            body: {},
          })
          expect(model?.variants).toContainEqual({
            id: ModelV2.VariantID.make("high"),
            settings: {
              reasoningEffort: "high",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
            headers: {},
            body: {},
          })

          const mode = yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("gpt-reasoning-high"))
          expect(mode).toMatchObject({
            id: "gpt-reasoning-high",
            name: "GPT Reasoning High",
            request: {
              headers: { "x-mode": "high" },
              body: { service_tier: "priority" },
            },
          })
          expect(mode?.variants.map((variant) => variant.id)).toEqual([
            ModelV2.VariantID.make("low"),
            ModelV2.VariantID.make("high"),
          ])

          const budgetModel = yield* catalog.model.get(ProviderV2.ID.anthropic, ModelV2.ID.make("claude-budget"))
          expect(budgetModel?.variants).toContainEqual({
            id: ModelV2.VariantID.make("high"),
            settings: { thinking: { type: "enabled", budgetTokens: 16000 } },
            headers: {},
            body: {},
          })
          expect(budgetModel?.variants).toContainEqual({
            id: ModelV2.VariantID.make("max"),
            settings: { thinking: { type: "enabled", budgetTokens: 64000 } },
            headers: {},
            body: {},
          })

          const anthropicEffortModel = yield* catalog.model.get(ProviderV2.ID.anthropic, ModelV2.ID.make("claude-effort"))
          expect(anthropicEffortModel?.variants).toContainEqual({
            id: ModelV2.VariantID.make("low"),
            settings: { thinking: { type: "adaptive", display: "summarized" }, effort: "low" },
            headers: {},
            body: {},
          })
        }).pipe(Effect.provide(AppNodeBuilder.build(ModelsDev.node))),
      (previous) =>
        Effect.sync(() => {
          Flag.OPENCODE_MODELS_PATH = previous.path
          Flag.OPENCODE_DISABLE_MODELS_FETCH = previous.disabled
        }),
    ),
  )
})
