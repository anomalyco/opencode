import path from "path"
import { describe, expect } from "bun:test"
import { Money } from "@opencode-ai/schema/money"
import { Effect, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { Model } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ModelsDevPlugin } from "@opencode-ai/core/plugin/models-dev"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { catalogHost, host, integrationHost } from "./host"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const layer = AppNodeBuilder.build(LayerNode.group([Catalog.node, Integration.node, Bus.node]), [
  [Location.node, locationLayer],
])
const it = testEffect(layer)
const models = (file: string) =>
  AppNodeBuilder.build(ModelsDev.node, [[ModelsDev.node, ModelsDev.configured({ file, fetch: false })]])

function withEnv<A, E, R>(variables: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
      Object.entries(variables).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() => {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        })
      }),
  )
}

describe("ModelsDevPlugin", () => {
  it.effect("projects normalized models.dev snapshots into the catalog", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const catalog = yield* Catalog.Service
      const providerID = Provider.ID.make("acme")
      const modelID = Model.ID.make("gpt-5.4")
      const models = ModelsDev.Service.of({
        get: () =>
          Effect.succeed([
            {
              info: {
                id: providerID,
                name: "Acme",
                activation: "auto",
                package: Provider.aisdk("@ai-sdk/openai-compatible"),
                settings: { baseURL: "https://api.acme.test/v1" },
              },
              environment: [],
              models: [
                {
                  id: modelID,
                  modelID,
                  providerID,
                  name: "GPT-5.4",
                  family: Model.Family.make("gpt"),
                  capabilities: { tools: true, input: [], output: [] },
                  variants: [],
                  time: { released: Date.parse("2026-01-01") },
                  cost: [
                    {
                      input: Money.USDPerMillionTokens.make(2.5),
                      output: Money.USDPerMillionTokens.make(15),
                      cache: {
                        read: Money.USDPerMillionTokens.zero,
                        write: Money.USDPerMillionTokens.zero,
                      },
                    },
                    {
                      tier: { type: "context", size: 272_000 },
                      input: Money.USDPerMillionTokens.make(3),
                      output: Money.USDPerMillionTokens.make(18),
                      cache: {
                        read: Money.USDPerMillionTokens.make(0.25),
                        write: Money.USDPerMillionTokens.zero,
                      },
                    },
                    {
                      tier: { type: "context", size: 200_000 },
                      input: Money.USDPerMillionTokens.make(5),
                      output: Money.USDPerMillionTokens.make(22.5),
                      cache: {
                        read: Money.USDPerMillionTokens.make(0.5),
                        write: Money.USDPerMillionTokens.zero,
                      },
                    },
                  ],
                  status: "active",
                  enabled: true,
                  limit: { context: 1_050_000, input: 922_000, output: 128_000 },
                },
                {
                  id: Model.ID.make("gpt-5.4-fast"),
                  modelID,
                  providerID,
                  name: "GPT-5.4 Fast",
                  family: Model.Family.make("gpt"),
                  package: Provider.aisdk("@ai-sdk/openai-compatible"),
                  settings: { baseURL: "https://api.acme.test/v1" },
                  headers: { "x-mode": "fast" },
                  body: { service_tier: "priority" },
                  capabilities: { tools: true, input: [], output: [] },
                  variants: [],
                  time: { released: Date.parse("2026-01-01") },
                  cost: [
                    {
                      input: Money.USDPerMillionTokens.make(5),
                      output: Money.USDPerMillionTokens.make(30),
                      cache: {
                        read: Money.USDPerMillionTokens.make(0.5),
                        write: Money.USDPerMillionTokens.zero,
                      },
                    },
                    {
                      tier: { type: "context", size: 272_000 },
                      input: Money.USDPerMillionTokens.make(3),
                      output: Money.USDPerMillionTokens.make(18),
                      cache: {
                        read: Money.USDPerMillionTokens.make(0.25),
                        write: Money.USDPerMillionTokens.zero,
                      },
                    },
                    {
                      tier: { type: "context", size: 200_000 },
                      input: Money.USDPerMillionTokens.make(5),
                      output: Money.USDPerMillionTokens.make(22.5),
                      cache: {
                        read: Money.USDPerMillionTokens.make(0.5),
                        write: Money.USDPerMillionTokens.zero,
                      },
                    },
                  ],
                  status: "active",
                  enabled: true,
                  limit: { context: 1_050_000, input: 922_000, output: 128_000 },
                },
              ],
            },
          ] satisfies readonly ModelsDev.Snapshot[]),
        refresh: () => Effect.void,
      })

      yield* ModelsDevPlugin.effect(
        host({
          catalog: catalogHost(catalog),
          integration: integrationHost(integrations),
        }),
      ).pipe(Effect.provideService(ModelsDev.Service, models))

      const base = yield* catalog.model.get(providerID, Model.ID.make("gpt-5.4"))
      const fast = yield* catalog.model.get(providerID, Model.ID.make("gpt-5.4-fast"))

      expect(base?.variants).toEqual([])
      expect(base?.body).toBeUndefined()
      expect(fast).toMatchObject({
        id: "gpt-5.4-fast",
        modelID: "gpt-5.4",
        providerID: "acme",
        name: "GPT-5.4 Fast",
        package: Provider.aisdk("@ai-sdk/openai-compatible"),
        settings: { baseURL: "https://api.acme.test/v1" },
        headers: { "x-mode": "fast" },
        body: { service_tier: "priority" },
        variants: [],
      })
      expect(fast?.cost).toEqual([
        {
          input: Money.USDPerMillionTokens.make(5),
          output: Money.USDPerMillionTokens.make(30),
          cache: {
            read: Money.USDPerMillionTokens.make(0.5),
            write: Money.USDPerMillionTokens.zero,
          },
        },
        {
          tier: { type: "context", size: 272_000 },
          input: Money.USDPerMillionTokens.make(3),
          output: Money.USDPerMillionTokens.make(18),
          cache: {
            read: Money.USDPerMillionTokens.make(0.25),
            write: Money.USDPerMillionTokens.zero,
          },
        },
        {
          tier: { type: "context", size: 200_000 },
          input: Money.USDPerMillionTokens.make(5),
          output: Money.USDPerMillionTokens.make(22.5),
          cache: {
            read: Money.USDPerMillionTokens.make(0.5),
            write: Money.USDPerMillionTokens.zero,
          },
        },
      ])
    }),
  )

  it.effect("omits deprecated models from the catalog", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const catalog = yield* Catalog.Service
      const providerID = Provider.ID.make("acme")
      const activeID = Model.ID.make("current")
      const deprecatedID = Model.ID.make("legacy")
      const model = {
        modelID: activeID,
        providerID,
        name: "Current",
        capabilities: { tools: true, input: [], output: [] },
        variants: [],
        time: { released: Date.parse("2026-01-01") },
        cost: [],
        status: "active",
        enabled: true,
        limit: { context: 128_000, output: 32_000 },
      } satisfies Omit<Model.Info, "id">
      const snapshots = [
        {
          info: {
            id: providerID,
            name: "Acme",
            activation: "auto",
            package: Provider.aisdk("@ai-sdk/openai-compatible"),
          },
          environment: [],
          models: [
            { id: activeID, ...model },
            {
              id: deprecatedID,
              ...model,
              modelID: deprecatedID,
              name: "Legacy",
              status: "deprecated" as const,
            },
          ],
        },
      ] satisfies readonly ModelsDev.Snapshot[]

      yield* ModelsDevPlugin.effect(
        host({
          catalog: catalogHost(catalog),
          integration: integrationHost(integrations),
        }),
      ).pipe(
        Effect.provideService(
          ModelsDev.Service,
          ModelsDev.Service.of({
            get: () => Effect.succeed(snapshots),
            refresh: () => Effect.void,
          }),
        ),
      )

      expect(yield* catalog.model.get(providerID, activeID)).toBeDefined()
      expect(yield* catalog.model.get(providerID, deprecatedID)).toBeUndefined()
    }),
  )

  it.effect("registers key methods for providers with environment variables", () =>
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
        Integration.Info.make({
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
    }).pipe(Effect.provide(models(path.join(import.meta.dir, "fixtures", "models-dev.json")))),
  )

  it.effect("preserves provider and model URL templates in the catalog", () =>
    withEnv(
      {
        ACME_HOST: "api.acme.test",
        ACME_MODEL_PATH: undefined,
        UNDECLARED_HOST: "private.example",
      },
      () =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const catalog = yield* Catalog.Service
          const providerID = Provider.ID.make("acme")
          const modelID = Model.ID.make("gpt-5.4")
          yield* ModelsDevPlugin.effect(
            host({
              catalog: catalogHost(catalog),
              integration: integrationHost(integrations),
            }),
          ).pipe(
            Effect.provideService(
              ModelsDev.Service,
              ModelsDev.Service.of({
                get: () =>
                  Effect.succeed([
                    {
                      info: {
                        id: providerID,
                        name: "Acme",
                        activation: "auto",
                        package: Provider.aisdk("@ai-sdk/openai-compatible"),
                        settings: { baseURL: "https://${ACME_HOST}/${UNDECLARED_HOST}/v1" },
                      },
                      environment: ["ACME_HOST", "ACME_MODEL_PATH", "ACME_API_KEY"],
                      models: [
                        {
                          id: modelID,
                          modelID,
                          providerID,
                          name: "GPT-5.4",
                          settings: { baseURL: "https://${ACME_HOST}/${ACME_MODEL_PATH}/v1" },
                          capabilities: { tools: true, input: [], output: [] },
                          variants: [],
                          time: { released: Date.parse("2026-01-01") },
                          cost: [],
                          status: "active",
                          enabled: true,
                          limit: { context: 1_050_000, output: 128_000 },
                        },
                      ],
                    },
                  ] satisfies readonly ModelsDev.Snapshot[]),
                refresh: () => Effect.void,
              }),
            ),
          )

          expect((yield* catalog.provider.get(providerID))?.settings?.baseURL).toBe(
            "https://${ACME_HOST}/${UNDECLARED_HOST}/v1",
          )
          expect((yield* catalog.model.get(providerID, modelID))?.settings?.baseURL).toBe(
            "https://${ACME_HOST}/${ACME_MODEL_PATH}/v1",
          )
        }),
    ),
  )

  it.effect("omits legacy provider aliases", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const catalog = yield* Catalog.Service
      const snapshots = [
        ["azure", "Azure", "AZURE_API_KEY", "@ai-sdk/azure"],
        ["azure-cognitive-services", "Azure Cognitive Services", "AZURE_COGNITIVE_SERVICES_API_KEY", "@ai-sdk/azure"],
        ["google-vertex", "Google Vertex", "GOOGLE_APPLICATION_CREDENTIALS", "@ai-sdk/google-vertex"],
        [
          "google-vertex-anthropic",
          "Google Vertex Anthropic",
          "GOOGLE_APPLICATION_CREDENTIALS",
          "@ai-sdk/google-vertex/anthropic",
        ],
      ].map(([id, name, environment, packageName]) => ({
        info: {
          id: Provider.ID.make(id),
          name,
          activation: "auto",
          package: Provider.aisdk(packageName),
        },
        environment: id === "azure" ? ["AZURE_RESOURCE_NAME", environment] : [environment],
        models: [],
      })) satisfies readonly ModelsDev.Snapshot[]

      yield* ModelsDevPlugin.effect(
        host({
          catalog: catalogHost(catalog),
          integration: integrationHost(integrations),
        }),
      ).pipe(
        Effect.provideService(
          ModelsDev.Service,
          ModelsDev.Service.of({
            get: () => Effect.succeed(snapshots),
            refresh: () => Effect.void,
          }),
        ),
      )

      expect(yield* catalog.provider.get(Provider.ID.azure)).toBeDefined()
      expect(yield* catalog.provider.get(Provider.ID.make("google-vertex"))).toBeDefined()
      expect(yield* catalog.provider.get(Provider.ID.make("azure-cognitive-services"))).toBeUndefined()
      expect(yield* catalog.provider.get(Provider.ID.make("google-vertex-anthropic"))).toBeUndefined()
      expect(yield* integrations.get(Integration.ID.make("azure"))).toBeDefined()
      expect(yield* integrations.get(Integration.ID.make("azure"))).toMatchObject({
        methods: [{ type: "key" }, { type: "env", names: ["AZURE_API_KEY", "AZURE_COGNITIVE_SERVICES_API_KEY"] }],
      })
      expect(yield* integrations.get(Integration.ID.make("google-vertex"))).toBeDefined()
      expect(yield* integrations.get(Integration.ID.make("azure-cognitive-services"))).toBeUndefined()
      expect(yield* integrations.get(Integration.ID.make("google-vertex-anthropic"))).toBeUndefined()
      expect(ProviderPlugins.map((plugin) => plugin.id)).not.toContain("opencode.provider.azure.cognitive.services")
      expect(ProviderPlugins.map((plugin) => plugin.id)).not.toContain("opencode.provider.google.vertex.anthropic")
    }),
  )

  it.effect("advertises only key-bearing Google Vertex environment variables", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const catalog = yield* Catalog.Service

      yield* ModelsDevPlugin.effect(
        host({
          catalog: catalogHost(catalog),
          integration: integrationHost(integrations),
        }),
      ).pipe(
        Effect.provideService(
          ModelsDev.Service,
          ModelsDev.Service.of({
            get: () =>
              Effect.succeed([
                {
                  info: {
                    id: Provider.ID.make("google-vertex"),
                    name: "Google Vertex",
                    activation: "auto",
                    package: Provider.aisdk("@ai-sdk/google-vertex"),
                  },
                  environment: ["GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_LOCATION", "GOOGLE_APPLICATION_CREDENTIALS"],
                  models: [],
                },
              ] satisfies readonly ModelsDev.Snapshot[]),
            refresh: () => Effect.void,
          }),
        ),
      )

      // Vertex authenticates through ADC; project, location, and the credentials
      // file path are configuration, not API keys.
      expect(yield* integrations.get(Integration.ID.make("google-vertex"))).toMatchObject({
        methods: [{ type: "key" }, { type: "env", names: ["GOOGLE_VERTEX_API_KEY"] }],
      })
    }),
  )

  it.effect("converts reasoning options into settings variants", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const integrations = yield* Integration.Service
      yield* ModelsDevPlugin.effect(
        host({
          catalog: catalogHost(catalog),
          integration: integrationHost(integrations),
        }),
      )

      const model = yield* catalog.model.get(Provider.ID.openai, Model.ID.make("gpt-reasoning"))
      expect(model?.variants?.map((variant) => variant.id)).toEqual([
        Model.VariantID.make("low"),
        Model.VariantID.make("high"),
      ])
      expect(model?.variants).toContainEqual({
        id: Model.VariantID.make("low"),
        settings: {
          reasoningEffort: "low",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      })
      expect(model?.variants).toContainEqual({
        id: Model.VariantID.make("high"),
        settings: {
          reasoningEffort: "high",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      })

      const mode = yield* catalog.model.get(Provider.ID.openai, Model.ID.make("gpt-reasoning-high"))
      expect(mode).toMatchObject({
        id: "gpt-reasoning-high",
        name: "GPT Reasoning High",
        headers: { "x-mode": "high" },
        body: { service_tier: "priority" },
      })
      expect(mode?.variants?.map((variant) => variant.id)).toEqual([
        Model.VariantID.make("low"),
        Model.VariantID.make("high"),
      ])

      const pro = yield* catalog.model.get(Provider.ID.openai, Model.ID.make("gpt-reasoning-pro"))
      expect(pro).toMatchObject({
        id: "gpt-reasoning-pro",
        body: { reasoning: { mode: "pro" } },
      })

      const budgetModel = yield* catalog.model.get(Provider.ID.anthropic, Model.ID.make("claude-budget"))
      expect(budgetModel?.variants).toContainEqual({
        id: Model.VariantID.make("high"),
        settings: { thinking: { type: "enabled", budgetTokens: 16000 } },
      })
      expect(budgetModel?.variants).toContainEqual({
        id: Model.VariantID.make("max"),
        settings: { thinking: { type: "enabled", budgetTokens: 31999 } },
      })

      const anthropicEffortModel = yield* catalog.model.get(Provider.ID.anthropic, Model.ID.make("claude-opus-4.7"))
      expect(anthropicEffortModel?.variants).toEqual([
        { id: Model.VariantID.make("none"), settings: { thinking: { type: "disabled" } } },
        {
          id: Model.VariantID.make("low"),
          settings: { thinking: { type: "adaptive", display: "summarized" }, effort: "low" },
        },
      ])

      const anthropicToggleModel = yield* catalog.model.get(Provider.ID.anthropic, Model.ID.make("claude-toggle"))
      expect(anthropicToggleModel?.variants).toEqual([
        { id: Model.VariantID.make("none"), settings: { thinking: { type: "disabled" } } },
        {
          id: Model.VariantID.make("thinking"),
          settings: { thinking: { type: "adaptive", display: "summarized" } },
        },
      ])

      const opus45 = yield* catalog.model.get(Provider.ID.anthropic, Model.ID.make("claude-opus-4-5"))
      expect(opus45?.variants).toEqual([
        { id: Model.VariantID.make("low"), settings: { effort: "low" } },
        { id: Model.VariantID.make("high"), settings: { effort: "high" } },
      ])

      const grok = yield* catalog.model.get(Provider.ID.make("xai"), Model.ID.make("grok-4.5"))
      expect(grok?.variants).toEqual(
        ["low", "medium", "high"].map((id) => ({
          id: Model.VariantID.make(id),
          settings: { reasoningEffort: id },
        })),
      )

      const minimax = yield* catalog.model.get(Provider.ID.make("opencode-go"), Model.ID.make("minimax-m3"))
      expect(minimax?.variants).toEqual([
        { id: Model.VariantID.make("none"), settings: { thinking: { type: "disabled" } } },
        {
          id: Model.VariantID.make("thinking"),
          settings: { thinking: { type: "adaptive", display: "summarized" } },
        },
      ])

      const toggle = yield* catalog.model.get(Provider.ID.make("alibaba"), Model.ID.make("toggle-only"))
      expect(toggle?.variants).toEqual([
        { id: Model.VariantID.make("none"), settings: { enableThinking: false } },
        { id: Model.VariantID.make("thinking"), settings: { enableThinking: true } },
      ])

      const combined = yield* catalog.model.get(Provider.ID.make("alibaba"), Model.ID.make("toggle-budget"))
      expect(combined?.variants).toEqual([
        { id: Model.VariantID.make("none"), settings: { enableThinking: false } },
        {
          id: Model.VariantID.make("high"),
          settings: { enableThinking: true, thinkingBudget: 8000 },
        },
        {
          id: Model.VariantID.make("max"),
          settings: { enableThinking: true, thinkingBudget: 16000 },
        },
      ])

      const gateway = yield* catalog.model.get(Provider.ID.make("vercel"), Model.ID.make("alibaba/qwen-toggle"))
      expect(gateway?.variants).toEqual([
        { id: Model.VariantID.make("none"), settings: { enableThinking: false } },
        {
          id: Model.VariantID.make("high"),
          settings: { enableThinking: true, thinkingBudget: 8000 },
        },
        {
          id: Model.VariantID.make("max"),
          settings: { enableThinking: true, thinkingBudget: 16000 },
        },
      ])

      const gatewayNova = yield* catalog.model.get(Provider.ID.make("vercel"), Model.ID.make("amazon/nova-2-lite"))
      expect(gatewayNova?.variants).toEqual([
        {
          id: Model.VariantID.make("none"),
          settings: { additionalModelRequestFields: { reasoningConfig: { type: "disabled" } } },
        },
        {
          id: Model.VariantID.make("low"),
          settings: { reasoningConfig: { type: "enabled", maxReasoningEffort: "low" } },
        },
        {
          id: Model.VariantID.make("high"),
          settings: { reasoningConfig: { type: "enabled", maxReasoningEffort: "high" } },
        },
      ])

      const gatewayFallback = yield* catalog.model.get(
        Provider.ID.make("vercel"),
        Model.ID.make("deepseek/deepseek-toggle"),
      )
      expect(gatewayFallback?.variants).toEqual([
        {
          id: Model.VariantID.make("none"),
          settings: { reasoning: { enabled: false } },
        },
        {
          id: Model.VariantID.make("low"),
          settings: { reasoningEffort: "low" },
        },
        {
          id: Model.VariantID.make("high"),
          settings: { reasoningEffort: "high" },
        },
      ])

      const openrouter = yield* catalog.model.get(Provider.ID.make("openrouter"), Model.ID.make("openrouter-toggle"))
      expect(openrouter?.variants).toEqual([
        { id: Model.VariantID.make("none"), settings: { reasoning: { enabled: false } } },
        { id: Model.VariantID.make("thinking"), settings: { reasoning: { enabled: true } } },
      ])

      const google = yield* catalog.model.get(Provider.ID.make("google"), Model.ID.make("gemini-2.5-flash"))
      expect(google?.variants).toEqual([
        {
          id: Model.VariantID.make("none"),
          settings: { thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } },
        },
        {
          id: Model.VariantID.make("high"),
          settings: { thinkingConfig: { includeThoughts: true, thinkingBudget: 8000 } },
        },
        {
          id: Model.VariantID.make("max"),
          settings: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
        },
      ])

      const vertex = yield* catalog.model.get(Provider.ID.make("google-vertex"), Model.ID.make("gemini-2.5-flash-lite"))
      expect(vertex?.variants).toEqual([
        {
          id: Model.VariantID.make("none"),
          settings: { thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } },
        },
        {
          id: Model.VariantID.make("high"),
          settings: { thinkingConfig: { includeThoughts: true, thinkingBudget: 8000 } },
        },
        {
          id: Model.VariantID.make("max"),
          settings: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
        },
      ])

      const bedrock = yield* catalog.model.get(
        Provider.ID.make("amazon-bedrock"),
        Model.ID.make("amazon.nova-2-lite-v1:0"),
      )
      expect(bedrock?.variants).toEqual([
        {
          id: Model.VariantID.make("none"),
          settings: { additionalModelRequestFields: { reasoningConfig: { type: "disabled" } } },
        },
        {
          id: Model.VariantID.make("low"),
          settings: { reasoningConfig: { type: "enabled", maxReasoningEffort: "low" } },
        },
        {
          id: Model.VariantID.make("high"),
          settings: { reasoningConfig: { type: "enabled", maxReasoningEffort: "high" } },
        },
      ])

      const sapGemini = yield* catalog.model.get(Provider.ID.make("sap-ai-core"), Model.ID.make("gemini-2.5-flash"))
      expect(sapGemini?.variants).toEqual([
        {
          id: Model.VariantID.make("none"),
          settings: { modelParams: { thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } } },
        },
        {
          id: Model.VariantID.make("high"),
          settings: { modelParams: { thinkingConfig: { includeThoughts: true, thinkingBudget: 8000 } } },
        },
        {
          id: Model.VariantID.make("max"),
          settings: { modelParams: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } } },
        },
      ])

      const sapNova = yield* catalog.model.get(Provider.ID.make("sap-ai-core"), Model.ID.make("amazon--nova-lite"))
      expect(sapNova?.variants).toEqual([
        {
          id: Model.VariantID.make("none"),
          settings: {
            modelParams: { additionalModelRequestFields: { thinking: { type: "disabled" } } },
          },
        },
        {
          id: Model.VariantID.make("low"),
          settings: {
            modelParams: { additionalModelRequestFields: { output_config: { effort: "low" } } },
          },
        },
        {
          id: Model.VariantID.make("high"),
          settings: {
            modelParams: { additionalModelRequestFields: { output_config: { effort: "high" } } },
          },
        },
      ])

      const sapCohere = yield* catalog.model.get(
        Provider.ID.make("sap-ai-core"),
        Model.ID.make("cohere--command-a-reasoning"),
      )
      expect(sapCohere?.variants).toEqual([
        {
          id: Model.VariantID.make("none"),
          settings: { modelParams: { thinking: { type: "disabled" } } },
        },
        {
          id: Model.VariantID.make("low"),
          settings: { modelParams: { reasoning_effort: "low" } },
        },
        {
          id: Model.VariantID.make("high"),
          settings: { modelParams: { reasoning_effort: "high" } },
        },
      ])

      const sapAnthropicEffort = yield* catalog.model.get(
        Provider.ID.make("sap-ai-core"),
        Model.ID.make("anthropic--claude-4.7-opus"),
      )
      expect(sapAnthropicEffort?.variants).toEqual([
        {
          id: Model.VariantID.make("low"),
          settings: {
            modelParams: {
              additionalModelRequestFields: {
                thinking: { type: "adaptive", display: "summarized" },
                output_config: { effort: "low" },
              },
            },
          },
        },
      ])

      const sapAnthropicBudget = yield* catalog.model.get(
        Provider.ID.make("sap-ai-core"),
        Model.ID.make("anthropic--claude-4-sonnet"),
      )
      expect(sapAnthropicBudget?.variants).toEqual([
        {
          id: Model.VariantID.make("high"),
          settings: {
            modelParams: {
              additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: 8000 } },
            },
          },
        },
        {
          id: Model.VariantID.make("max"),
          settings: {
            modelParams: {
              additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: 16000 } },
            },
          },
        },
      ])
    }).pipe(Effect.provide(models(path.join(import.meta.dir, "fixtures", "models-dev-reasoning.json")))),
  )
})
