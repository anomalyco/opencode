import { describe, expect } from "bun:test"
import { Money } from "@opencode/schema/money"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { Effect, Schema } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { AzurePlugin } from "@opencode/core/plugin/provider/azure"
import { OpenAIPlugin } from "@opencode/core/plugin/provider/openai"
import { XAIPlugin } from "@opencode/core/plugin/provider/xai"
import { Provider } from "@opencode/core/provider"
import { withEnv } from "../fixture/env"
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

const decode = Schema.decodeUnknownSync(Info)

describe("ConfigProviderPlugin.Plugin", () => {
  it.effect("inherits the provider compaction setting with model overrides and rejects unsupported routes", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "@opencode/ai/providers/openai/responses",
                settings: { compaction: { type: "native" } },
                models: {
                  native: {},
                  local: { settings: { compaction: { type: "summary" } }, package: "@opencode/ai/providers/openai/chat" },
                  unsupported: { package: "@opencode/ai/providers/openai/chat" },
                },
              },
              default: { package: "@opencode/ai/providers/openai/chat", models: { chat: {} } },
            },
          }),
        }),
      ])
      const native = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("native")))
      const local = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("local")))
      const unsupported = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("unsupported")))
      const defaultModel = required(yield* models.get(Provider.ID.make("default"), Model.ID.make("chat")))
      expect(native.settings?.compaction).toEqual({ type: "native" })
      expect(local.settings?.compaction).toEqual({ type: "summary" })
      expect(defaultModel.settings?.compaction).toBeUndefined()
      expect((yield* providers.get(Provider.ID.make("custom")))?.settings?.compaction).toEqual({ type: "native" })
      yield* ModelResolver.fromCatalogModel(native)
      yield* ModelResolver.fromCatalogModel(local)
      yield* ModelResolver.fromCatalogModel(defaultModel)
      expect(yield* ModelResolver.fromCatalogModel(unsupported).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionRunnerModel.UnsupportedCompactionError",
        message: "Provider compaction is not supported by custom/unsupported (openai-chat)",
      })
    }),
  )

  it.effect("keeps the provider websocket policy out of model settings", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "@opencode/ai/providers/openai/responses",
                settings: { transport: "http", timeout: 100, chunkTimeout: 200, shared: "provider" },
                models: {
                  inherited: {
                    settings: { transport: "websocket", timeout: 1, chunkTimeout: 2, model: true },
                  },
                },
              },
              default: { package: "@opencode/ai/providers/openai/responses", models: { untouched: {} } },
            },
          }),
        }),
      ])
      const inherited = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("inherited")))
      const untouched = required(yield* models.get(Provider.ID.make("default"), Model.ID.make("untouched")))
      expect((yield* providers.get(Provider.ID.make("custom")))?.settings?.transport).toBe("http")
      expect(inherited.settings).toEqual({ shared: "provider", model: true })
      expect(untouched.settings?.transport).toBeUndefined()
    }),
  )

  for (const builtin of [
    { id: "openai", model: "gpt-5.6-sol", package: "@opencode/ai/providers/openai/responses", plugin: OpenAIPlugin },
    { id: "xai", model: "grok-4.6", package: "@opencode/ai/providers/xai", plugin: XAIPlugin },
    { id: "azure", model: "gpt-5.6-sol", package: "@opencode/ai/providers/azure/responses", plugin: AzurePlugin },
    { id: "custom-azure", model: "deployment", package: "@opencode/ai/providers/azure/responses", plugin: AzurePlugin },
  ]) {
    it.live(`configured provider transport overrides ${builtin.id} defaults`, () =>
      Effect.gen(function* () {
        const providers = yield* Provider.Service
        const models = yield* Model.Service
        const plugin = yield* Plugin.Service
        const host = yield* PluginHost.make(plugin)
        const providerID = Provider.ID.make(builtin.id)
        const modelID = Model.ID.make(builtin.model)
        yield* providers.transform((editor) => {
          editor.update(providerID, (provider) => {
            provider.activation = "enabled"
            provider.package = builtin.package
          })
          editor.models.update(providerID, modelID, () => {})
        })
        yield* builtin.plugin.effect(host)
        expect((yield* providers.get(providerID))?.settings?.transport).toBe("websocket")
        expect((yield* models.get(providerID, modelID))?.settings?.transport).toBeUndefined()

        yield* addPlugin([
          new Document({
            type: "document",
            info: decode({
              providers: {
                [builtin.id]: {
                  settings: { transport: "http" },
                  models: { override: { modelID: builtin.model } },
                },
              },
            }),
          }),
        ])

        expect((yield* providers.get(providerID))?.settings?.transport).toBe("http")
        expect((yield* models.get(providerID, modelID))?.settings?.transport).toBeUndefined()
        expect((yield* models.get(providerID, Model.ID.make("override")))?.settings?.transport).toBeUndefined()
      }),
    )
  }

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

  it.effect("defaults custom model metadata", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
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

      const model = required(yield* models.get(providerID, modelID))
      expect(model.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
      expect(model.limit).toEqual({ context: 200_000, output: 32_000 })
    }),
  )

  it.effect("preserves catalog capabilities unless config overrides them", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      const inheritedID = Model.ID.make("inherited")
      const overriddenID = Model.ID.make("overridden")
      yield* providers.transform((editor) => {
        editor.models.update(providerID, inheritedID, (model) => {
          model.capabilities = { tools: false, input: ["text"], output: ["text"] }
        })
        editor.models.update(providerID, overriddenID, (model) => {
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

      expect((yield* models.get(providerID, inheritedID))?.capabilities).toEqual({
        tools: false,
        input: ["text"],
        output: ["text"],
      })
      expect((yield* models.get(providerID, overriddenID))?.capabilities).toEqual({
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      })
    }),
  )

  it.effect("merges partial config capabilities onto the base model's existing fields", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      const modelID = Model.ID.make("partial")
      yield* providers.transform((editor) => {
        editor.models.update(providerID, modelID, (model) => {
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
                models: { partial: { capabilities: { input: ["text", "image"] } } },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      expect((yield* models.get(providerID, modelID))?.capabilities).toEqual({
        tools: false,
        input: ["text", "image"],
        output: ["text"],
      })
    }),
  )

  it.effect("resolves a config model with only input/output capabilities using default tools", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      const modelID = Model.ID.make("demo")
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: { demo: { name: "Demo", capabilities: { input: ["text"], output: ["text"] } } },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      expect((yield* models.get(providerID, modelID))?.capabilities).toEqual({
        tools: true,
        input: ["text"],
        output: ["text"],
      })
    }),
  )

  for (const scenario of [
    { name: "omitted capabilities", legacy: {}, overrides: {} },
    {
      name: "input-only modalities",
      legacy: { modalities: { input: ["text", "image", "pdf"] } },
      overrides: { input: ["text", "image", "pdf"] },
    },
    {
      name: "output-only modalities",
      legacy: { modalities: { output: ["audio"] } },
      overrides: { output: ["audio"] },
    },
    { name: "enabled tools", legacy: { tool_call: true }, overrides: { tools: true } },
    { name: "disabled tools", legacy: { tool_call: false }, overrides: { tools: false } },
    {
      name: "explicit empty modalities",
      legacy: { modalities: { input: [], output: [] } },
      overrides: { input: [], output: [] },
    },
    {
      name: "fully specified capabilities",
      legacy: { tool_call: false, modalities: { input: ["audio"], output: ["text"] } },
      overrides: { tools: false, input: ["audio"], output: ["text"] },
    },
  ]) {
    it.effect(`uses native model defaults for migrated ${scenario.name}`, () =>
      Effect.gen(function* () {
        const models = yield* Model.Service
        const providerID = Provider.ID.make("custom")
        const result = ConfigNormalize.normalize({ provider: { custom: { models: { migrated: scenario.legacy } } } })
        if (result.type !== "normalized") throw new Error("Expected normalized config")
        expect(result.diagnostics).toEqual([])

        yield* addPlugin([
          new Document({
            type: "document",
            info: decode({ providers: { custom: { models: { native: {} } } } }),
          }),
          new Document({ type: "document", info: decode(result.encoded) }),
        ])

        const native = required(yield* models.get(providerID, Model.ID.make("native")))
        const migrated = required(yield* models.get(providerID, Model.ID.make("migrated")))
        expect(migrated).toEqual({
          ...native,
          id: migrated.id,
          modelID: migrated.id,
          name: migrated.id,
          capabilities: { ...native.capabilities, ...scenario.overrides },
        })
      }),
    )
  }

  for (const scenario of [
    {
      name: "provider package and request defaults",
      legacy: {
        npm: "@ai-sdk/openai",
        api: "https://proxy.example/v1",
        options: { headers: { "x-provider": "default" }, body: { store: false } },
        models: { chat: {} },
      },
      native: {
        package: "aisdk:@ai-sdk/openai",
        settings: { baseURL: "https://proxy.example/v1" },
        headers: { "x-provider": "default" },
        body: { store: false },
        models: { chat: {} },
      },
    },
    {
      name: "model package, limits, costs, and variant overrides",
      legacy: {
        npm: "@ai-sdk/openai",
        api: "https://proxy.example/v1",
        models: {
          chat: {
            id: "vendor/chat",
            name: "Custom chat",
            provider: { npm: "@ai-sdk/anthropic", api: "https://model.example/v1" },
            limit: { context: 100000, input: 80000, output: 16000 },
            cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
            options: { temperature: 0.2 },
            variants: { high: { effort: "high" } },
          },
        },
      },
      native: {
        package: "aisdk:@ai-sdk/openai",
        settings: { baseURL: "https://proxy.example/v1" },
        models: {
          chat: {
            modelID: "vendor/chat",
            name: "Custom chat",
            package: "aisdk:@ai-sdk/anthropic",
            settings: { baseURL: "https://model.example/v1", temperature: 0.2 },
            limit: { context: 100000, input: 80000, output: 16000 },
            cost: { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } },
            variants: [{ id: "high", settings: { effort: "high" } }],
          },
        },
      },
    },
    {
      name: "zero costs and omitted cache costs",
      legacy: { models: { chat: { cost: { input: 0, output: 0 } } } },
      native: { models: { chat: { cost: { input: 0, output: 0 } } } },
    },
  ]) {
    it.effect(`matches native configuration for migrated ${scenario.name}`, () =>
      Effect.gen(function* () {
        const models = yield* Model.Service
        const result = ConfigNormalize.normalize({ provider: { legacy: scenario.legacy } })
        if (result.type !== "normalized") throw new Error("Expected normalized config")
        expect(result.diagnostics).toEqual([])

        yield* addPlugin([
          new Document({ type: "document", info: decode({ providers: { native: scenario.native } }) }),
          new Document({ type: "document", info: decode(result.encoded) }),
        ])

        const native = required(yield* models.get(Provider.ID.make("native"), Model.ID.make("chat")))
        const migrated = required(yield* models.get(Provider.ID.make("legacy"), Model.ID.make("chat")))
        expect({ ...migrated, providerID: native.providerID }).toEqual(native)
        for (const variant of native.variants) {
          const expected = yield* ModelResolver.withVariant(native, variant.id)
          const actual = yield* ModelResolver.withVariant(migrated, variant.id)
          expect({ ...actual, providerID: expected.providerID }).toEqual(expected)
        }
      }),
    )
  }

  it.effect("preserves existing catalog metadata when migrated fields are omitted", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      const modelID = Model.ID.make("chat")
      yield* providers.transform((editor) => {
        editor.models.update(providerID, modelID, (model) => {
          model.package = "aisdk:@ai-sdk/anthropic"
          model.settings = { baseURL: "https://catalog.example/v1" }
          model.capabilities = { tools: false, input: ["audio"], output: ["audio"] }
          model.limit = { context: 100000, input: 80000, output: 16000 }
          model.cost = [
            {
              input: Money.USDPerMillionTokens.make(1),
              output: Money.USDPerMillionTokens.make(2),
              cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
            },
          ]
          model.variants = [{ id: Model.VariantID.make("high"), settings: { effort: "high" } }]
        })
      })
      const before = required(yield* models.get(providerID, modelID))
      const result = ConfigNormalize.normalize({ provider: { custom: { models: { chat: {} } } } })
      if (result.type !== "normalized") throw new Error("Expected normalized config")
      expect(result.diagnostics).toEqual([])
      yield* addPlugin([new Document({ type: "document", info: decode(result.encoded) })])
      expect(yield* models.get(providerID, modelID)).toEqual(before)
    }),
  )

  it.effect("generates variants after rewriting a configured model package", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "aisdk:@ai-sdk/openai",
                models: {
                  claude: {
                    modelID: "claude-opus-4-8",
                    package: "aisdk:@ai-sdk/anthropic",
                  },
                },
              },
            },
          }),
        }),
      ])

      const model = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("claude")))
      expect(model.package).toBe("@opencode/ai/providers/anthropic")
      expect(model.variants.map((variant) => variant.id)).toEqual([
        Model.VariantID.make("low"),
        Model.VariantID.make("medium"),
        Model.VariantID.make("high"),
        Model.VariantID.make("xhigh"),
        Model.VariantID.make("max"),
      ])
    }),
  )

  it.effect("keeps configured model variant bodies unchanged", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
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

      const model = required(yield* models.get(providerID, modelID))
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
      const models = yield* Model.Service
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

      const model = required(yield* models.get(providerID, modelID))
      expect(model.variants?.[0]).toMatchObject({
        id: "high",
        body: { reasoningEffort: "high" },
      })
    }),
  )

  it.effect("loads configured providers and applies later model overrides", () =>
    withEnv({ CUSTOM_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const providers = yield* Provider.Service
        const models = yield* Model.Service
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
                  canonical: "anthropic",
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
                  canonical: "anthropic",
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

        yield* providers.transform((editor) => {
          editor.update(Provider.ID.anthropic, (provider) => {
            provider.package = "aisdk:@ai-sdk/anthropic"
          })
          editor.models.update(Provider.ID.anthropic, modelID, (model) => {
            model.variants = [{ id: Model.VariantID.make("fast"), settings: { effort: "high" } }]
          })
        })
        yield* addPlugin(entries)

        const provider = required(yield* providers.get(providerID))
        const model = required(yield* models.get(providerID, modelID))
        expect((yield* models.default())?.id).toBe(Model.ID.make("default"))
        expect(provider.name).toBe("Renamed")
        expect(provider.canonical).toBe(Provider.ID.anthropic)
        expect(model.canonical).toBe(Provider.ID.anthropic)
        expect(model.providerID).toBe(providerID)
        expect((yield* integrations.get(Integration.ID.make("custom")))?.methods).toContainEqual({
          type: "env",
          names: ["CUSTOM_API_KEY"],
        })
        expect((yield* integrations.get(Integration.ID.make("custom")))?.name).toBe("Renamed")
        expect(provider.activation).toBe("enabled")
        expect(provider.package).toBe("aisdk:custom-sdk")
        expect(model.package).toBe("aisdk:custom-sdk")
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
        expect(model.variants?.[0]?.settings).toEqual({ effort: "high" })
        expect(model.variants?.[1]?.headers).toEqual({ slow: "slow" })
      }),
    ),
  )
})
