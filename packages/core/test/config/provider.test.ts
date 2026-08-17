import { describe, expect } from "bun:test"
import { Money } from "@opencode-ai/schema/money"
import { Document, Info, type Entry } from "@opencode-ai/schema/config"
import { Effect, Schema, Stream } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* (entries: Entry[]) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* ConfigProviderPlugin.Plugin.effect(host).pipe(Effect.provide(Config.testLayer(entries)))
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

const decode = Schema.decodeUnknownSync(Info)

describe("ConfigProviderPlugin.Plugin", () => {
  it.effect("adds key auth for custom providers without env credentials", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              litellm: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: { chat: {} },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      expect(yield* integrations.get(Integration.ID.make("litellm"))).toMatchObject({
        id: "litellm",
        name: "litellm",
        methods: [{ type: "key", label: "Manually enter API Key" }],
      })
    }),
  )

  it.effect("defaults custom models to agent capabilities", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = Provider.ID.make("custom")
      const modelID = Model.ID.make("chat")
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: { chat: {} },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      const model = required(yield* catalog.model.get(providerID, modelID))
      expect(model.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
    }),
  )

  it.effect("preserves catalog capabilities unless config overrides them", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = Provider.ID.make("custom")
      const inheritedID = Model.ID.make("inherited")
      const overriddenID = Model.ID.make("overridden")
      yield* catalog.transform((draft) => {
        draft.model.update(providerID, inheritedID, (model) => {
          model.capabilities = { tools: false, input: ["text"], output: ["text"] }
        })
        draft.model.update(providerID, overriddenID, (model) => {
          model.capabilities = { tools: false, input: ["text"], output: ["text"] }
        })
      })
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: {
                  inherited: { name: "Inherited" },
                  overridden: {
                    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                  },
                },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      expect((yield* catalog.model.get(providerID, inheritedID))?.capabilities).toEqual({
        tools: false,
        input: ["text"],
        output: ["text"],
      })
      expect((yield* catalog.model.get(providerID, overriddenID))?.capabilities).toEqual({
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      })
    }),
  )

  it.effect("keeps configured model variant bodies unchanged", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = Provider.ID.opencode
      const modelID = Model.ID.make("alpha-gpt-next")
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              opencode: {
                package: "aisdk:@ai-sdk/openai",
                settings: { baseURL: "https://opencode.test/v1" },
                models: {
                  "alpha-gpt-next": {
                    variants: [
                      {
                        id: "high",
                        body: {
                          reasoningEffort: "high",
                          reasoningSummary: "auto",
                          include: ["reasoning.encrypted_content"],
                        },
                      },
                    ],
                  },
                },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      const model = required(yield* catalog.model.get(providerID, modelID))
      expect(model.variants).toMatchObject([
        {
          id: "high",
          body: {
            reasoningEffort: "high",
            reasoningSummary: "auto",
            include: ["reasoning.encrypted_content"],
          },
        },
      ])
    }),
  )

  it.effect("keeps layered model variant bodies unchanged", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = Provider.ID.opencode
      const modelID = Model.ID.make("alpha-gpt-next")
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              opencode: {
                package: "aisdk:@ai-sdk/openai",
                settings: { baseURL: "https://opencode.test/v1" },
              },
            },
          }),
        }),
        new Document({
          type: "document",
          info: decode({
            providers: {
              opencode: {
                models: {
                  "alpha-gpt-next": {
                    variants: [{ id: "high", body: { reasoningEffort: "high" } }],
                  },
                },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      const model = required(yield* catalog.model.get(providerID, modelID))
      expect(model.variants?.[0]).toMatchObject({
        id: "high",
        body: { reasoningEffort: "high" },
      })
    }),
  )

  it.effect("loads configured providers and applies later model overrides", () =>
    withEnv({ CUSTOM_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        const integrations = yield* Integration.Service
        const providerID = Provider.ID.make("custom")
        const modelID = Model.ID.make("chat")
        const entries = [
          new Document({
            type: "document",
            info: decode({
              model: "custom/first",
              providers: {
                custom: {
                  name: "Configured",
                  env: ["CUSTOM_API_KEY"],
                  package: "native",
                  headers: { first: "first", shared: "first" },
                  models: {
                    chat: {
                      name: "First",
                      compatibility: {
                        reasoningField: "vendor_reasoning",
                        maxTokensField: "max_completion_tokens",
                        requireFinishReason: false,
                      },
                      capabilities: { tools: true, input: ["text"], output: ["text"] },
                      disabled: true,
                      limit: { context: 100, output: 50 },
                      cost: { input: 1, output: 2 },
                      settings: { retained: true },
                      headers: { first: "first", shared: "first" },
                      variants: [
                        {
                          id: "fast",
                          headers: { first: "first", shared: "first" },
                        },
                      ],
                    },
                  },
                },
              },
            }),
          }),
          new Document({
            type: "document",
            info: decode({
              model: "custom/default",
              providers: {
                custom: {
                  package: "aisdk:custom-sdk",
                  settings: { baseURL: "https://example.test" },
                  headers: { last: "last", shared: "last" },
                  models: {
                    default: {
                      name: "Default",
                    },
                    chat: {
                      modelID: "api-chat",
                      name: "Last",
                      limit: { output: 75 },
                      headers: { last: "last", shared: "last" },
                      variants: [
                        {
                          id: "fast",
                          headers: { last: "last", shared: "last" },
                        },
                        {
                          id: "slow",
                          headers: { slow: "slow" },
                        },
                      ],
                    },
                  },
                },
              },
            }),
          }),
          new Document({
            type: "document",
            info: decode({
              providers: {
                custom: { name: "Renamed" },
              },
            }),
          }),
        ]

        yield* addPlugin(entries)

        const provider = required(yield* catalog.provider.get(providerID))
        const model = required(yield* catalog.model.get(providerID, modelID))
        expect((yield* catalog.model.default())?.id).toBe(Model.ID.make("default"))
        expect(provider.name).toBe("Renamed")
        expect((yield* integrations.get(Integration.ID.make("custom")))?.methods).toContainEqual({
          type: "env",
          names: ["CUSTOM_API_KEY"],
        })
        expect((yield* integrations.get(Integration.ID.make("custom")))?.name).toBe("Renamed")
        expect(provider.activation).toBe("enabled")
        expect(provider.package).toBe("aisdk:custom-sdk")
        expect(provider.settings).toEqual({ baseURL: "https://example.test" })
        expect(provider.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.id).toBe(modelID)
        expect(model.modelID).toBe(Model.ID.make("api-chat"))
        expect(model.name).toBe("Last")
        expect(model.compatibility).toEqual({
          reasoningField: "vendor_reasoning",
          maxTokensField: "max_completion_tokens",
          requireFinishReason: false,
        })
        expect(model.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
        expect(model.enabled).toBe(false)
        expect(model.limit).toEqual({ context: 100, output: 75 })
        expect(model.cost).toEqual([
          {
            input: Money.USDPerMillionTokens.make(1),
            output: Money.USDPerMillionTokens.make(2),
            cache: {
              read: Money.USDPerMillionTokens.zero,
              write: Money.USDPerMillionTokens.zero,
            },
            tier: undefined,
          },
        ])
        expect(model.settings).toEqual({ baseURL: "https://example.test", retained: true })
        expect(model.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.variants?.map((variant) => variant.id)).toEqual([
          Model.VariantID.make("fast"),
          Model.VariantID.make("slow"),
        ])
        expect(model.variants?.[0]?.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.variants?.[1]?.headers).toEqual({ slow: "slow" })
      }),
    ),
  )
})
