import { afterEach, expect, test } from "bun:test"
import { mkdir, unlink } from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { disposeAllInstances, provideInstanceEffect, tmpdirScoped, TestInstance } from "../fixture/fixture"
import { markPluginDependenciesReady } from "../fixture/plugin"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin/index"
import { Provider } from "@/provider/provider"

import { RuntimeFlags } from "@/effect/runtime-flags"
import { Filesystem } from "@/util/filesystem"
import { InstanceLayer } from "@/project/instance-layer"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const originalEnv = new Map<string, string | undefined>()

const rememberEnv = (k: string) => {
  if (!originalEnv.has(k)) originalEnv.set(k, process.env[k])
}

const setProcessEnv = (k: string, v: string) =>
  Effect.sync(() => {
    rememberEnv(k)
    process.env[k] = v
  })

const set = (k: string, v: string) =>
  Effect.gen(function* () {
    rememberEnv(k)
    process.env[k] = v
    yield* Env.use.set(k, v)
  })

const remove = (k: string) =>
  Effect.gen(function* () {
    rememberEnv(k)
    delete process.env[k]
    yield* Env.use.remove(k)
  })

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
  await disposeAllInstances()
})

const providerLayer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Provider.layer.pipe(
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Env.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(ModelsDev.defaultLayer),
    Layer.provide(RuntimeFlags.layer(flags)),
  )

const list = Provider.use.list()

const paid = (providers: Record<string, { models: Record<string, { cost: { input: number } }> }>) => {
  const item = providers[ProviderV2.ID.make("opencode")]
  expect(item).toBeDefined()
  return Object.values(item.models).filter((model) => model.cost.input > 0).length
}

const languageBaseURL = (language: unknown) => (language as { config: { baseURL: string } }).config.baseURL

const it = testEffect(Layer.mergeAll(Provider.defaultLayer, Env.defaultLayer, Plugin.defaultLayer))
const experimentalModels = testEffect(providerLayer({ enableExperimentalModels: true }))

const alphaProviderConfig = {
  provider: {
    "custom-provider": {
      name: "Custom Provider",
      npm: "@ai-sdk/openai-compatible",
      api: "https://api.custom.com/v1",
      models: {
        "active-model": {
          name: "Active Model",
        },
        "alpha-model": {
          name: "Alpha Model",
          status: "alpha" as const,
        },
      },
      options: {
        apiKey: "custom-key",
      },
    },
  },
}

it.instance("provider loaded from env variable", () =>
  Effect.gen(function* () {
    yield* setProcessEnv("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
    // Provider should retain its connection source even if custom loaders
    // merge additional options.
    expect(providers[ProviderV2.ID.anthropic].source).toBe("env")
    expect(providers[ProviderV2.ID.anthropic].options.headers["anthropic-beta"]).toBeDefined()
  }),
)

it.instance(
  "provider loaded from config with apiKey option",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
  }),
  { config: { provider: { anthropic: { options: { apiKey: "config-api-key" } } } } },
)

it.instance(
  "disabled_providers excludes provider",
  Effect.gen(function* () {
    yield* setProcessEnv("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeUndefined()
  }),
  { config: { disabled_providers: ["anthropic"] } },
)

it.instance(
  "enabled_providers restricts to only listed providers",
  Effect.gen(function* () {
    yield* setProcessEnv("ANTHROPIC_API_KEY", "test-api-key")
    yield* setProcessEnv("OPENAI_API_KEY", "test-openai-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
    expect(providers[ProviderV2.ID.openai]).toBeUndefined()
  }),
  { config: { enabled_providers: ["anthropic"] } },
)

it.instance(
  "model whitelist filters models for provider",
  Effect.gen(function* () {
    yield* setProcessEnv("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
    const models = Object.keys(providers[ProviderV2.ID.anthropic].models)
    expect(models).toContain("claude-sonnet-4-20250514")
    expect(models.length).toBe(1)
  }),
  { config: { provider: { anthropic: { whitelist: ["claude-sonnet-4-20250514"] } } } },
)

it.instance(
  "model blacklist excludes specific models",
  Effect.gen(function* () {
    yield* setProcessEnv("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
    const models = Object.keys(providers[ProviderV2.ID.anthropic].models)
    expect(models).not.toContain("claude-sonnet-4-20250514")
  }),
  { config: { provider: { anthropic: { blacklist: ["claude-sonnet-4-20250514"] } } } },
)

it.instance(
  "custom model alias via config",
  Effect.gen(function* () {
    yield* setProcessEnv("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
    expect(providers[ProviderV2.ID.anthropic].models["my-alias"]).toBeDefined()
    expect(providers[ProviderV2.ID.anthropic].models["my-alias"].name).toBe("My Custom Alias")
  }),
  {
    config: {
      provider: {
        anthropic: { models: { "my-alias": { id: "claude-sonnet-4-20250514", name: "My Custom Alias" } } },
      },
    },
  },
)

it.instance(
  "custom provider with npm package",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-provider")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("custom-provider")].name).toBe("Custom Provider")
    expect(providers[ProviderV2.ID.make("custom-provider")].models["custom-model"]).toBeDefined()
  }),
  {
    config: {
      provider: {
        "custom-provider": {
          name: "Custom Provider",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          env: ["CUSTOM_API_KEY"],
          models: {
            "custom-model": {
              name: "Custom Model",
              tool_call: true,
              limit: { context: 128000, output: 4096 },
            },
          },
          options: { apiKey: "custom-key" },
        },
      },
    },
  },
)

it.instance(
  "filters alpha provider models by default",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-provider")].models["active-model"]).toBeDefined()
    expect(providers[ProviderV2.ID.make("custom-provider")].models["alpha-model"]).toBeUndefined()
  }),
  { config: alphaProviderConfig },
)

experimentalModels.instance(
  "includes alpha provider models when experimental models are enabled",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-provider")].models["active-model"]).toBeDefined()
    expect(providers[ProviderV2.ID.make("custom-provider")].models["alpha-model"]).toBeDefined()
  }),
  { config: alphaProviderConfig },
)

it.instance(
  "custom DeepSeek openai-compatible model defaults interleaved reasoning field",
  Effect.gen(function* () {
    const providers = yield* list
    const provider = providers[ProviderV2.ID.make("custom-provider")]
    expect(provider.models["deepseek-r1"].capabilities.interleaved).toEqual({ field: "reasoning_content" })
    expect(provider.models["deepseek-details"].capabilities.interleaved).toEqual({ field: "reasoning_details" })
    expect(provider.models["custom-model"].capabilities.interleaved).toBe(false)
    expect(
      providers[ProviderV2.ID.make("custom-anthropic-provider")].models["deepseek-r1"].capabilities.interleaved,
    ).toBe(false)
  }),
  {
    config: {
      provider: {
        "custom-provider": {
          name: "Custom Provider",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "deepseek-r1": { name: "DeepSeek R1" },
            "deepseek-details": { name: "DeepSeek Details", interleaved: { field: "reasoning_details" } },
            "custom-model": { name: "Custom Model" },
          },
          options: { apiKey: "custom-key" },
        },
        "custom-anthropic-provider": {
          name: "Custom Anthropic Provider",
          npm: "@ai-sdk/anthropic",
          api: "https://api.custom.com/v1",
          models: { "deepseek-r1": { name: "DeepSeek R1" } },
          options: { apiKey: "custom-key" },
        },
      },
    },
  },
)

it.instance(
  "env variable takes precedence, config merges options",
  Effect.gen(function* () {
    yield* setProcessEnv("ANTHROPIC_API_KEY", "env-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
    // Config options should be merged
    expect(providers[ProviderV2.ID.anthropic].options.timeout).toBe(60000)
    expect(providers[ProviderV2.ID.anthropic].options.headerTimeout).toBe(10000)
    expect(providers[ProviderV2.ID.anthropic].options.chunkTimeout).toBe(15000)
  }),
  { config: { provider: { anthropic: { options: { timeout: 60000, headerTimeout: 10000, chunkTimeout: 15000 } } } } },
)

it.instance("getModel returns model for valid provider/model", () =>
  Effect.gen(function* () {
    yield* setProcessEnv("ANTHROPIC_API_KEY", "test-api-key")
    const provider = yield* Provider.Service
    const model = yield* provider.getModel(ProviderV2.ID.anthropic, ModelV2.ID.make("claude-sonnet-4-20250514"))
    expect(model).toBeDefined()
    expect(String(model.providerID)).toBe("anthropic")
    expect(String(model.id)).toBe("claude-sonnet-4-20250514")
    const language = yield* provider.getLanguage(model)
    expect(language).toBeDefined()
  }),
)

it.instance("getModel throws ModelNotFoundError for invalid model", () =>
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const exit = yield* Provider.use
      .getModel(ProviderV2.ID.anthropic, ModelV2.ID.make("nonexistent-model"))
      .pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
  }),
)

it.instance("getModel throws ModelNotFoundError for invalid provider", () =>
  Effect.gen(function* () {
    const exit = yield* Provider.use
      .getModel(ProviderV2.ID.make("nonexistent-provider"), ModelV2.ID.make("some-model"))
      .pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
  }),
)

// Pure synchronous unit tests — no Effect runtime needed.

test("parseModel correctly parses provider/model string", () => {
  const result = Provider.parseModel("anthropic/claude-sonnet-4")
  expect(String(result.providerID)).toBe("anthropic")
  expect(String(result.modelID)).toBe("claude-sonnet-4")
})

test("parseModel handles model IDs with slashes", () => {
  const result = Provider.parseModel("openrouter/anthropic/claude-3-opus")
  expect(String(result.providerID)).toBe("openrouter")
  expect(String(result.modelID)).toBe("anthropic/claude-3-opus")
})

it.instance("defaultModel returns first available model when no config set", () =>
  Effect.gen(function* () {
    yield* setProcessEnv("ANTHROPIC_API_KEY", "test-api-key")
    const model = yield* Provider.use.defaultModel()
    expect(model.providerID).toBeDefined()
    expect(model.modelID).toBeDefined()
  }),
)

it.instance(
  "defaultModel respects config model setting",
  Effect.gen(function* () {
    yield* setProcessEnv("ANTHROPIC_API_KEY", "test-api-key")
    const model = yield* Provider.use.defaultModel()
    expect(String(model.providerID)).toBe("anthropic")
    expect(String(model.modelID)).toBe("claude-sonnet-4-20250514")
  }),
  { config: { model: "anthropic/claude-sonnet-4-20250514" } },
)

it.instance(
  "defaultModel returns a typed error when config excludes every provider",
  Effect.gen(function* () {
    const error = yield* Provider.use.defaultModel().pipe(Effect.flip)
    expect(error).toBeInstanceOf(Provider.NoProvidersError)
    expect(error._tag).toBe("ProviderNoProvidersError")
  }),
  { config: { enabled_providers: [] } },
)

it.instance(
  "provider with baseURL from config",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-openai")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("custom-openai")].options.baseURL).toBe("https://custom.openai.com/v1")
  }),
  {
    config: {
      provider: {
        "custom-openai": {
          name: "Custom OpenAI",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "gpt-4": { name: "GPT-4", tool_call: true, limit: { context: 128000, output: 4096 } } },
          options: { apiKey: "test-key", baseURL: "https://custom.openai.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "model cost defaults to zero when not specified",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("test-provider")].models["test-model"]
    expect(model.cost.input).toBe(0)
    expect(model.cost.output).toBe(0)
    expect(model.cost.cache.read).toBe(0)
    expect(model.cost.cache.write).toBe(0)
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "test-model": { name: "Test Model", tool_call: true, limit: { context: 128000, output: 4096 } } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "model options are merged from existing model",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.anthropic].models["claude-sonnet-4-20250514"]
    expect(model.options.customOption).toBe("custom-value")
  }),
  {
    config: {
      provider: {
        anthropic: {
          options: { apiKey: "test-api-key" },
          models: { "claude-sonnet-4-20250514": { options: { customOption: "custom-value" } } },
        },
      },
    },
  },
)

it.instance(
  "provider removed when all models filtered out",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeUndefined()
  }),
  { config: { provider: { anthropic: { options: { apiKey: "test-api-key" }, whitelist: ["nonexistent-model"] } } } },
)

it.instance("closest finds model by partial match", () =>
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const result = yield* Provider.use.closest(ProviderV2.ID.anthropic, ["sonnet-4"])
    expect(result).toBeDefined()
    expect(String(result?.providerID)).toBe("anthropic")
    expect(String(result?.modelID)).toContain("sonnet-4")
  }),
)

it.instance("closest returns undefined for nonexistent provider", () =>
  Effect.gen(function* () {
    const result = yield* Provider.use.closest(ProviderV2.ID.make("nonexistent"), ["model"])
    expect(result).toBeUndefined()
  }),
)

it.instance(
  "getModel uses realIdByKey for aliased models",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic].models["my-sonnet"]).toBeDefined()

    const model = yield* Provider.use.getModel(ProviderV2.ID.anthropic, ModelV2.ID.make("my-sonnet"))
    expect(model).toBeDefined()
    expect(String(model.id)).toBe("my-sonnet")
    expect(model.name).toBe("My Sonnet Alias")
  }),
  {
    config: {
      provider: {
        anthropic: {
          models: { "my-sonnet": { id: "claude-sonnet-4-20250514", name: "My Sonnet Alias" } },
        },
      },
    },
  },
)

it.instance(
  "provider api field sets model api.url",
  Effect.gen(function* () {
    const providers = yield* list
    // api field is stored on model.api.url, used by getSDK to set baseURL
    expect(providers[ProviderV2.ID.make("custom-api")].models["model-1"].api.url).toBe("https://api.example.com/v1")
  }),
  {
    config: {
      provider: {
        "custom-api": {
          name: "Custom API",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.example.com/v1",
          env: [],
          models: { "model-1": { name: "Model 1", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "explicit baseURL overrides api field",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-api")].options.baseURL).toBe("https://custom.override.com/v1")
  }),
  {
    config: {
      provider: {
        "custom-api": {
          name: "Custom API",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.example.com/v1",
          env: [],
          models: { "model-1": { name: "Model 1", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test-key", baseURL: "https://custom.override.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "model inherits properties from existing database model",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.anthropic].models["claude-sonnet-4-20250514"]
    expect(model.name).toBe("Custom Name for Sonnet")
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.capabilities.attachment).toBe(true)
    expect(model.limit.context).toBeGreaterThan(0)
  }),
  {
    config: {
      provider: { anthropic: { models: { "claude-sonnet-4-20250514": { name: "Custom Name for Sonnet" } } } },
    },
  },
)

it.instance(
  "disabled_providers prevents loading even with env var",
  Effect.gen(function* () {
    yield* set("OPENAI_API_KEY", "test-openai-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openai]).toBeUndefined()
  }),
  { config: { disabled_providers: ["openai"] } },
)

it.instance(
  "enabled_providers with empty array allows no providers",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    yield* set("OPENAI_API_KEY", "test-openai-key")
    const providers = yield* list
    expect(Object.keys(providers).length).toBe(0)
  }),
  { config: { enabled_providers: [] } },
)

it.instance(
  "whitelist and blacklist can be combined",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
    const models = Object.keys(providers[ProviderV2.ID.anthropic].models)
    expect(models).toContain("claude-sonnet-4-20250514")
    expect(models).not.toContain("claude-opus-4-20250514")
    expect(models.length).toBe(1)
  }),
  {
    config: {
      provider: {
        anthropic: {
          whitelist: ["claude-sonnet-4-20250514", "claude-opus-4-20250514"],
          blacklist: ["claude-opus-4-20250514"],
        },
      },
    },
  },
)

it.instance(
  "model modalities default correctly",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("test-provider")].models["test-model"]
    expect(model.capabilities.input.text).toBe(true)
    expect(model.capabilities.output.text).toBe(true)
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "test-model": { name: "Test Model", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance(
  "model with custom cost values",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("test-provider")].models["test-model"]
    expect(model.cost.input).toBe(5)
    expect(model.cost.output).toBe(15)
    expect(model.cost.cache.read).toBe(2.5)
    expect(model.cost.cache.write).toBe(7.5)
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            "test-model": {
              name: "Test Model",
              tool_call: true,
              limit: { context: 8000, output: 2000 },
              cost: { input: 5, output: 15, cache_read: 2.5, cache_write: 7.5 },
            },
          },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance("getSmallModel returns appropriate small model", () =>
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.anthropic)
    expect(model).toBeDefined()
    expect(model?.id).toContain("haiku")
  }),
)

it.instance(
  "getSmallModel respects config small_model override",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.anthropic)
    expect(model).toBeDefined()
    expect(String(model?.providerID)).toBe("anthropic")
    expect(String(model?.id)).toBe("claude-sonnet-4-20250514")
  }),
  { config: { small_model: "anthropic/claude-sonnet-4-20250514" } },
)

it.instance(
  "getSmallModel ignores invalid config small_model",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.anthropic)
    expect(model).toBeUndefined()
  }),
  { config: { small_model: "anthropic/not-a-real-model" } },
)

test("provider.sort prioritizes preferred models", () => {
  const models = [
    { id: "random-model", name: "Random" },
    { id: "claude-sonnet-4-latest", name: "Claude Sonnet 4" },
    { id: "gpt-5-turbo", name: "GPT-5 Turbo" },
    { id: "other-model", name: "Other" },
  ] as any[]

  const sorted = Provider.sort(models)
  expect(sorted[0].id).toContain("sonnet-4")
  expect(sorted[0].id).toContain("latest")
  expect(sorted[sorted.length - 1].id).not.toContain("gpt-5")
  expect(sorted[sorted.length - 1].id).not.toContain("sonnet-4")
})

it.instance(
  "multiple providers can be configured simultaneously",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-anthropic-key")
    yield* set("OPENAI_API_KEY", "test-openai-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
    expect(providers[ProviderV2.ID.openai]).toBeDefined()
    expect(providers[ProviderV2.ID.anthropic].options.timeout).toBe(30000)
    expect(providers[ProviderV2.ID.openai].options.timeout).toBe(60000)
  }),
  {
    config: {
      provider: {
        anthropic: { options: { timeout: 30000 } },
        openai: { options: { timeout: 60000 } },
      },
    },
  },
)

it.instance(
  "provider with custom npm package",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("local-llm")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("local-llm")].models["llama-3"].api.npm).toBe("@ai-sdk/openai-compatible")
    expect(providers[ProviderV2.ID.make("local-llm")].options.baseURL).toBe("http://localhost:11434/v1")
  }),
  {
    config: {
      provider: {
        "local-llm": {
          name: "Local LLM",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "llama-3": { name: "Llama 3", tool_call: true, limit: { context: 8192, output: 2048 } } },
          options: { apiKey: "not-needed", baseURL: "http://localhost:11434/v1" },
        },
      },
    },
  },
)

// Edge cases for model configuration

it.instance(
  "model alias name defaults to alias key when id differs",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic].models["sonnet"].name).toBe("sonnet")
  }),
  {
    config: {
      provider: {
        anthropic: {
          models: { sonnet: { id: "claude-sonnet-4-20250514" } },
        },
      },
    },
  },
)

it.instance(
  "provider with multiple env var options only includes apiKey when single env",
  Effect.gen(function* () {
    yield* set("MULTI_ENV_KEY_1", "test-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("multi-env")]).toBeDefined()
    // When multiple env options exist, key should NOT be auto-set
    expect(providers[ProviderV2.ID.make("multi-env")].key).toBeUndefined()
  }),
  {
    config: {
      provider: {
        "multi-env": {
          name: "Multi Env Provider",
          npm: "@ai-sdk/openai-compatible",
          env: ["MULTI_ENV_KEY_1", "MULTI_ENV_KEY_2"],
          models: { "model-1": { name: "Model 1", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { baseURL: "https://api.example.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "provider with single env var includes apiKey automatically",
  Effect.gen(function* () {
    yield* set("SINGLE_ENV_KEY", "my-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("single-env")]).toBeDefined()
    // Single env option should auto-set key
    expect(providers[ProviderV2.ID.make("single-env")].key).toBe("my-api-key")
  }),
  {
    config: {
      provider: {
        "single-env": {
          name: "Single Env Provider",
          npm: "@ai-sdk/openai-compatible",
          env: ["SINGLE_ENV_KEY"],
          models: { "model-1": { name: "Model 1", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { baseURL: "https://api.example.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "model cost overrides existing cost values",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.anthropic].models["claude-sonnet-4-20250514"]
    expect(model.cost.input).toBe(999)
    expect(model.cost.output).toBe(888)
  }),
  {
    config: {
      provider: {
        anthropic: {
          models: { "claude-sonnet-4-20250514": { cost: { input: 999, output: 888 } } },
        },
      },
    },
  },
)

it.instance(
  "completely new provider not in database can be configured",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("brand-new-provider")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("brand-new-provider")].name).toBe("Brand New")
    const model = providers[ProviderV2.ID.make("brand-new-provider")].models["new-model"]
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.capabilities.attachment).toBe(true)
    expect(model.capabilities.input.image).toBe(true)
  }),
  {
    config: {
      provider: {
        "brand-new-provider": {
          name: "Brand New",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          api: "https://new-api.com/v1",
          models: {
            "new-model": {
              name: "New Model",
              tool_call: true,
              reasoning: true,
              attachment: true,
              temperature: true,
              limit: { context: 32000, output: 8000 },
              modalities: { input: ["text", "image"], output: ["text"] },
            },
          },
          options: { apiKey: "new-key" },
        },
      },
    },
  },
)

it.instance(
  "disabled_providers and enabled_providers interaction",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-anthropic")
    yield* set("OPENAI_API_KEY", "test-openai")
    yield* set("GOOGLE_GENERATIVE_AI_API_KEY", "test-google")
    const providers = yield* list
    // anthropic: in enabled, not in disabled = allowed
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
    // openai: in enabled, but also in disabled = NOT allowed
    expect(providers[ProviderV2.ID.openai]).toBeUndefined()
    // google: not in enabled = NOT allowed (even though not disabled)
    expect(providers[ProviderV2.ID.google]).toBeUndefined()
  }),
  {
    // enabled_providers takes precedence — only these are considered
    // Then disabled_providers filters from the enabled set
    config: { enabled_providers: ["anthropic", "openai"], disabled_providers: ["openai"] },
  },
)

it.instance(
  "model with tool_call false",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("no-tools")].models["basic-model"].capabilities.toolcall).toBe(false)
  }),
  {
    config: {
      provider: {
        "no-tools": {
          name: "No Tools Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "basic-model": { name: "Basic Model", tool_call: false, limit: { context: 4000, output: 1000 } } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance(
  "model defaults tool_call to true when not specified",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("default-tools")].models["model"].capabilities.toolcall).toBe(true)
  }),
  {
    config: {
      provider: {
        "default-tools": {
          name: "Default Tools Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { model: { name: "Model", limit: { context: 4000, output: 1000 } } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance(
  "model headers are preserved",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("headers-provider")].models["model"]
    expect(model.headers).toEqual({
      "X-Custom-Header": "custom-value",
      Authorization: "Bearer special-token",
    })
  }),
  {
    config: {
      provider: {
        "headers-provider": {
          name: "Headers Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            model: {
              name: "Model",
              tool_call: true,
              limit: { context: 4000, output: 1000 },
              headers: { "X-Custom-Header": "custom-value", Authorization: "Bearer special-token" },
            },
          },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance(
  "provider env fallback - second env var used if first missing",
  Effect.gen(function* () {
    // Only set fallback, not primary
    yield* set("FALLBACK_KEY", "fallback-api-key")
    const providers = yield* list
    // Provider should load because fallback env var is set
    expect(providers[ProviderV2.ID.make("fallback-env")]).toBeDefined()
  }),
  {
    config: {
      provider: {
        "fallback-env": {
          name: "Fallback Env Provider",
          npm: "@ai-sdk/openai-compatible",
          env: ["PRIMARY_KEY", "FALLBACK_KEY"],
          models: { model: { name: "Model", tool_call: true, limit: { context: 4000, output: 1000 } } },
          options: { baseURL: "https://api.example.com" },
        },
      },
    },
  },
)

it.instance("getModel returns consistent results", () =>
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const model1 = yield* Provider.use.getModel(ProviderV2.ID.anthropic, ModelV2.ID.make("claude-sonnet-4-20250514"))
    const model2 = yield* Provider.use.getModel(ProviderV2.ID.anthropic, ModelV2.ID.make("claude-sonnet-4-20250514"))
    expect(model1.providerID).toEqual(model2.providerID)
    expect(model1.id).toEqual(model2.id)
    expect(model1).toEqual(model2)
  }),
)

it.instance(
  "provider name defaults to id when not in database",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("my-custom-id")].name).toBe("my-custom-id")
  }),
  {
    config: {
      provider: {
        "my-custom-id": {
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { model: { name: "Model", tool_call: true, limit: { context: 4000, output: 1000 } } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance("ModelNotFoundError includes suggestions for typos", () =>
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.anthropic, ModelV2.ID.make("claude-sonet-4"))
      .pipe(Effect.flip)
    expect(error.suggestions).toBeDefined()
    expect((error.suggestions ?? []).length).toBeGreaterThan(0)
    expect(error.message).toContain("Model not found: anthropic/claude-sonet-4")
    expect(error.message).toContain("Did you mean:")
  }),
)

it.instance("ModelNotFoundError for provider includes suggestions", () =>
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.make("antropic"), ModelV2.ID.make("claude-sonnet-4"))
      .pipe(Effect.flip)
    expect(error.suggestions).toBeDefined()
    expect(error.suggestions).toContain("anthropic")
  }),
)

it.instance("ModelNotFoundError suggests catalog models for unloaded providers", () =>
  Effect.gen(function* () {
    yield* remove("OPENCODE_API_KEY")
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.opencode, ModelV2.ID.make("claude-haiku-fake-model"))
      .pipe(Effect.flip)
    if (!Provider.ModelNotFoundError.isInstance(error)) throw error
    expect(error.suggestions ?? []).toContain("claude-haiku-4-5")
  }),
)

it.instance("getProvider returns undefined for nonexistent provider", () =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service.use((svc) => svc.getProvider(ProviderV2.ID.make("nonexistent")))
    expect(provider).toBeUndefined()
  }),
)

it.instance("getProvider returns provider info", () =>
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const provider = yield* Provider.use.getProvider(ProviderV2.ID.anthropic)
    expect(provider).toBeDefined()
    expect(String(provider?.id)).toBe("anthropic")
  }),
)

it.instance("closest returns undefined when no partial match found", () =>
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const result = yield* Provider.use.closest(ProviderV2.ID.anthropic, ["nonexistent-xyz-model"])
    expect(result).toBeUndefined()
  }),
)

it.instance("closest checks multiple query terms in order", () =>
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    // First term won't match, second will
    const result = yield* Provider.use.closest(ProviderV2.ID.anthropic, ["nonexistent", "haiku"])
    expect(result).toBeDefined()
    expect(result?.modelID).toContain("haiku")
  }),
)

it.instance(
  "model limit defaults to zero when not specified",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("no-limit")].models["model"]
    expect(model.limit.context).toBe(0)
    expect(model.limit.output).toBe(0)
  }),
  {
    config: {
      provider: {
        "no-limit": {
          name: "No Limit Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { model: { name: "Model", tool_call: true } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance(
  "provider options are deeply merged",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    // Custom options should be merged
    expect(providers[ProviderV2.ID.anthropic].options.timeout).toBe(30000)
    expect(providers[ProviderV2.ID.anthropic].options.headers["X-Custom"]).toBe("custom-value")
    // anthropic custom loader adds its own headers, they should coexist
    expect(providers[ProviderV2.ID.anthropic].options.headers["anthropic-beta"]).toBeDefined()
  }),
  {
    config: {
      provider: { anthropic: { options: { headers: { "X-Custom": "custom-value" }, timeout: 30000 } } },
    },
  },
)

it.instance(
  "hosted nvidia provider adds billing origin header",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("nvidia")].options.headers).toEqual({
      "HTTP-Referer": "https://opencode.ai/",
      "X-Title": "opencode",
      "X-BILLING-INVOKE-ORIGIN": "OpenCode",
    })
  }),
  { config: { provider: { nvidia: { options: { apiKey: "test-api-key" } } } } },
)

it.instance(
  "custom nvidia baseURL adds billing origin header",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("nvidia")].options.headers).toEqual({
      "HTTP-Referer": "https://opencode.ai/",
      "X-Title": "opencode",
      "X-BILLING-INVOKE-ORIGIN": "OpenCode",
    })
  }),
  { config: { provider: { nvidia: { options: { apiKey: "test-api-key", baseURL: "http://localhost:8000/v1" } } } } },
)

it.instance(
  "explicit nvidia billing origin header is preserved",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("nvidia")].options.headers["X-BILLING-INVOKE-ORIGIN"]).toBe("CustomOrigin")
  }),
  {
    config: {
      provider: {
        nvidia: {
          options: {
            apiKey: "test-api-key",
            baseURL: "http://localhost:8000/v1",
            headers: { "X-BILLING-INVOKE-ORIGIN": "CustomOrigin" },
          },
        },
      },
    },
  },
)

it.instance(
  "custom model inherits npm package from models.dev provider config",
  Effect.gen(function* () {
    yield* set("OPENAI_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openai].models["my-custom-model"]
    expect(model).toBeDefined()
    expect(model.api.npm).toBe("@ai-sdk/openai")
  }),
  {
    config: {
      provider: {
        openai: {
          models: {
            "my-custom-model": {
              name: "My Custom Model",
              tool_call: true,
              limit: { context: 8000, output: 2000 },
            },
          },
        },
      },
    },
  },
)

it.instance(
  "custom model inherits api.url from models.dev provider",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()

    // New model not in database should inherit api.url from provider
    const intellect = providers[ProviderV2.ID.openrouter].models["prime-intellect/intellect-3"]
    expect(intellect).toBeDefined()
    expect(intellect.api.url).toBe("https://openrouter.ai/api/v1")

    // Another new model should also inherit api.url
    const deepseek = providers[ProviderV2.ID.openrouter].models["deepseek/deepseek-r1-0528"]
    expect(deepseek).toBeDefined()
    expect(deepseek.api.url).toBe("https://openrouter.ai/api/v1")
    expect(deepseek.name).toBe("DeepSeek R1")
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            "prime-intellect/intellect-3": {},
            "deepseek/deepseek-r1-0528": { name: "DeepSeek R1" },
          },
        },
      },
    },
  },
)

test("mode cost preserves over-200k pricing from base model", () => {
  const provider = {
    id: "openai",
    name: "OpenAI",
    env: [],
    api: "https://api.openai.com/v1",
    models: {
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT-5.4",
        family: "gpt",
        release_date: "2026-03-05",
        attachment: true,
        reasoning: true,
        temperature: false,
        tool_call: true,
        cost: {
          input: 2.5,
          output: 15,
          cache_read: 0.25,
          context_over_200k: {
            input: 5,
            output: 22.5,
            cache_read: 0.5,
          },
        },
        limit: {
          context: 1_050_000,
          input: 922_000,
          output: 128_000,
        },
        experimental: {
          modes: {
            fast: {
              cost: {
                input: 5,
                output: 30,
                cache_read: 0.5,
              },
              provider: {
                body: {
                  service_tier: "priority",
                },
              },
            },
          },
        },
      },
    },
  } as unknown as ModelsDev.Provider

  const model = Provider.fromModelsDevProvider(provider).models["gpt-5.4-fast"]
  expect(model.cost.input).toEqual(5)
  expect(model.cost.output).toEqual(30)
  expect(model.cost.cache.read).toEqual(0.5)
  expect(model.cost.cache.write).toEqual(0)
  expect(model.options["serviceTier"]).toEqual("priority")
  expect(model.cost.experimentalOver200K).toEqual({
    input: 5,
    output: 22.5,
    cache: { read: 0.5, write: 0 },
  })
})

test("models.dev normalization fills required response fields", () => {
  const provider = {
    id: "gateway",
    name: "Gateway",
    env: [],
    models: {
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT-5.4",
        family: "gpt",
        cost: { input: 2.5, output: 15 },
        limit: { context: 1_050_000, input: 922_000, output: 128_000 },
      },
    },
  } as unknown as ModelsDev.Provider

  const model = Provider.fromModelsDevProvider(provider).models["gpt-5.4"]
  expect(model.api.url).toBe("")
  expect(model.capabilities.temperature).toBe(false)
  expect(model.capabilities.reasoning).toBe(false)
  expect(model.capabilities.attachment).toBe(false)
  expect(model.capabilities.toolcall).toBe(true)
  expect(model.release_date).toBe("")
})

it.instance("model variants are generated for reasoning models", () =>
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    // Claude sonnet 4 has reasoning capability
    const model = providers[ProviderV2.ID.anthropic].models["claude-sonnet-4-20250514"]
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.variants).toBeDefined()
    expect(Object.keys(model.variants!).length).toBeGreaterThan(0)
  }),
)

it.instance(
  "model variants can be disabled via config",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.anthropic].models["claude-sonnet-4-20250514"]
    expect(model.variants).toBeDefined()
    expect(model.variants!["high"]).toBeUndefined()
    // max variant should still exist
    expect(model.variants!["max"]).toBeDefined()
  }),
  {
    config: {
      provider: {
        anthropic: {
          models: { "claude-sonnet-4-20250514": { variants: { high: { disabled: true } } } },
        },
      },
    },
  },
)

it.instance(
  "model variants can be customized via config",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.anthropic].models["claude-sonnet-4-20250514"]
    expect(model.variants!["high"]).toBeDefined()
    expect(model.variants!["high"].thinking.budgetTokens).toBe(20000)
  }),
  {
    config: {
      provider: {
        anthropic: {
          models: {
            "claude-sonnet-4-20250514": {
              variants: { high: { thinking: { type: "enabled", budgetTokens: 20000 } } },
            },
          },
        },
      },
    },
  },
)

it.instance(
  "disabled key is stripped from variant config",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.anthropic].models["claude-sonnet-4-20250514"]
    expect(model.variants!["max"]).toBeDefined()
    expect(model.variants!["max"].disabled).toBeUndefined()
    expect(model.variants!["max"].customField).toBe("test")
  }),
  {
    config: {
      provider: {
        anthropic: {
          models: {
            "claude-sonnet-4-20250514": {
              variants: { max: { disabled: false, customField: "test" } },
            },
          },
        },
      },
    },
  },
)

it.instance(
  "all variants can be disabled via config",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.anthropic].models["claude-sonnet-4-20250514"]
    expect(model.variants).toBeDefined()
    expect(Object.keys(model.variants!).length).toBe(0)
  }),
  {
    config: {
      provider: {
        anthropic: {
          models: {
            "claude-sonnet-4-20250514": {
              variants: { high: { disabled: true }, max: { disabled: true } },
            },
          },
        },
      },
    },
  },
)

it.instance(
  "variant config merges with generated variants",
  Effect.gen(function* () {
    yield* set("ANTHROPIC_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.anthropic].models["claude-sonnet-4-20250514"]
    expect(model.variants!["high"]).toBeDefined()
    // Should have both the generated thinking config and the custom option
    expect(model.variants!["high"].thinking).toBeDefined()
    expect(model.variants!["high"].extraOption).toBe("custom-value")
  }),
  {
    config: {
      provider: {
        anthropic: {
          models: {
            "claude-sonnet-4-20250514": { variants: { high: { extraOption: "custom-value" } } },
          },
        },
      },
    },
  },
)

it.instance(
  "variants filtered in second pass for database models",
  Effect.gen(function* () {
    yield* set("OPENAI_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openai].models["gpt-5"]
    expect(model.variants).toBeDefined()
    expect(model.variants!["high"]).toBeUndefined()
    // Other variants should still exist
    expect(model.variants!["medium"]).toBeDefined()
  }),
  {
    config: {
      provider: { openai: { models: { "gpt-5": { variants: { high: { disabled: true } } } } } },
    },
  },
)

it.instance(
  "custom model with variants enabled and disabled",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-reasoning")].models["reasoning-model"]
    expect(model.variants).toBeDefined()
    // Enabled variants should exist
    expect(model.variants!["low"]).toBeDefined()
    expect(model.variants!["low"].reasoningEffort).toBe("low")
    expect(model.variants!["medium"]).toBeDefined()
    expect(model.variants!["medium"].reasoningEffort).toBe("medium")
    expect(model.variants!["custom"]).toBeDefined()
    expect(model.variants!["custom"].reasoningEffort).toBe("custom")
    expect(model.variants!["custom"].budgetTokens).toBe(5000)
    // Disabled variant should not exist
    expect(model.variants!["high"]).toBeUndefined()
    // disabled key should be stripped from all variants
    expect(model.variants!["low"].disabled).toBeUndefined()
    expect(model.variants!["medium"].disabled).toBeUndefined()
    expect(model.variants!["custom"].disabled).toBeUndefined()
  }),
  {
    config: {
      provider: {
        "custom-reasoning": {
          name: "Custom Reasoning Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            "reasoning-model": {
              name: "Reasoning Model",
              tool_call: true,
              reasoning: true,
              limit: { context: 128000, output: 16000 },
              variants: {
                low: { reasoningEffort: "low" },
                medium: { reasoningEffort: "medium" },
                high: { reasoningEffort: "high", disabled: true },
                custom: { reasoningEffort: "custom", budgetTokens: 5000 },
              },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "Google Vertex: retains baseURL for custom proxy",
  Effect.gen(function* () {
    yield* set("GOOGLE_APPLICATION_CREDENTIALS", "test-creds")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("vertex-proxy")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("vertex-proxy")].options.baseURL).toBe("https://my-proxy.com/v1")
  }),
  {
    config: {
      provider: {
        "vertex-proxy": {
          name: "Vertex Proxy",
          npm: "@ai-sdk/google-vertex",
          api: "https://my-proxy.com/v1",
          env: ["GOOGLE_APPLICATION_CREDENTIALS"],
          models: { "gemini-pro": { name: "Gemini Pro", tool_call: true } },
          options: {
            project: "test-project",
            location: "us-central1",
            baseURL: "https://my-proxy.com/v1",
          },
        },
      },
    },
  },
)

it.instance(
  "Google Vertex: supports OpenAI compatible models",
  Effect.gen(function* () {
    yield* set("GOOGLE_APPLICATION_CREDENTIALS", "test-creds")
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("vertex-openai")].models["gpt-4"]
    expect(model).toBeDefined()
    expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
  }),
  {
    config: {
      provider: {
        "vertex-openai": {
          name: "Vertex OpenAI",
          npm: "@ai-sdk/google-vertex",
          env: ["GOOGLE_APPLICATION_CREDENTIALS"],
          models: {
            "gpt-4": {
              name: "GPT-4",
              provider: { npm: "@ai-sdk/openai-compatible", api: "https://api.openai.com/v1" },
            },
          },
          options: { project: "test-project", location: "us-central1" },
        },
      },
    },
  },
)

it.instance("Google Vertex: uses REP endpoint for Claude continental multi-regions", () =>
  Effect.gen(function* () {
    yield* set("GOOGLE_CLOUD_PROJECT", "test-project")
    yield* set("VERTEX_LOCATION", "eu")
    const provider = yield* Provider.Service
    const model = yield* provider.getModel(
      ProviderV2.ID.make("google-vertex"),
      ModelV2.ID.make("claude-sonnet-4-6@default"),
    )
    const language = yield* provider.getLanguage(model)
    expect(languageBaseURL(language)).toBe(
      "https://aiplatform.eu.rep.googleapis.com/v1/projects/test-project/locations/eu/publishers/anthropic/models",
    )
  }),
)

it.instance("Google Vertex Anthropic: uses REP endpoint for continental multi-regions", () =>
  Effect.gen(function* () {
    yield* set("GOOGLE_CLOUD_PROJECT", "test-project")
    yield* set("VERTEX_LOCATION", "us")
    const provider = yield* Provider.Service
    const model = yield* provider.getModel(
      ProviderV2.ID.make("google-vertex-anthropic"),
      ModelV2.ID.make("claude-sonnet-4-6@default"),
    )
    const language = yield* provider.getLanguage(model)
    expect(languageBaseURL(language)).toBe(
      "https://aiplatform.us.rep.googleapis.com/v1/projects/test-project/locations/us/publishers/anthropic/models",
    )
  }),
)

it.instance("Google Vertex: keeps regional Claude endpoints unchanged", () =>
  Effect.gen(function* () {
    yield* set("GOOGLE_CLOUD_PROJECT", "test-project")
    yield* set("VERTEX_LOCATION", "europe-west1")
    const provider = yield* Provider.Service
    const model = yield* provider.getModel(
      ProviderV2.ID.make("google-vertex"),
      ModelV2.ID.make("claude-sonnet-4-6@default"),
    )
    const language = yield* provider.getLanguage(model)
    expect(languageBaseURL(language)).toBe(
      "https://europe-west1-aiplatform.googleapis.com/v1/projects/test-project/locations/europe-west1/publishers/anthropic/models",
    )
  }),
)

it.instance("cloudflare-ai-gateway loads with env variables", () =>
  Effect.gen(function* () {
    yield* set("CLOUDFLARE_ACCOUNT_ID", "test-account")
    yield* set("CLOUDFLARE_GATEWAY_ID", "test-gateway")
    yield* set("CLOUDFLARE_API_TOKEN", "test-token")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("cloudflare-ai-gateway")]).toBeDefined()
  }),
)

it.instance(
  "cloudflare-ai-gateway forwards config metadata options",
  Effect.gen(function* () {
    yield* set("CLOUDFLARE_ACCOUNT_ID", "test-account")
    yield* set("CLOUDFLARE_GATEWAY_ID", "test-gateway")
    yield* set("CLOUDFLARE_API_TOKEN", "test-token")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("cloudflare-ai-gateway")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("cloudflare-ai-gateway")].options.metadata).toEqual({
      invoked_by: "test",
      project: "opencode",
    })
  }),
  {
    config: {
      provider: { "cloudflare-ai-gateway": { options: { metadata: { invoked_by: "test", project: "opencode" } } } },
    },
  },
)

// Tests that need plugin file setup or multi-instance flows fall back to a
// scoped tmpdir + provideInstance pattern via it.effect.

const provideMultiInstance = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
  eff.pipe(Effect.provide(InstanceLayer.layer), Effect.provide(CrossSpawnSpawner.defaultLayer))

it.effect("plugin config providers persist after instance dispose", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const configDir = path.join(dir, ".opencode")
    const root = path.join(configDir, "plugin")
    yield* Effect.promise(() => mkdir(root, { recursive: true }))
    yield* Effect.promise(() => markPluginDependenciesReady(configDir))
    yield* Effect.promise(() => markPluginDependenciesReady(Global.Path.config))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(root, "demo-provider.ts"),
        [
          "export default {",
          '  id: "demo.plugin-provider",',
          "  server: async () => ({",
          "    async config(cfg) {",
          "      cfg.provider ??= {}",
          "      cfg.provider.demo = {",
          '        name: "Demo Provider",',
          '        npm: "@ai-sdk/openai-compatible",',
          '        api: "https://example.com/v1",',
          "        models: {",
          "          chat: {",
          '            name: "Demo Chat",',
          "            tool_call: true,",
          "            limit: { context: 128000, output: 4096 },",
          "          },",
          "        },",
          "      }",
          "    },",
          "  }),",
          "}",
          "",
        ].join("\n"),
      ),
    )

    const loadAndList = Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const provider = yield* Provider.Service
      yield* plugin.init()
      return yield* provider.list()
    }).pipe(provideInstanceEffect(dir))

    const first = yield* loadAndList
    expect(first[ProviderV2.ID.make("demo")]).toBeDefined()
    expect(first[ProviderV2.ID.make("demo")].models[ModelV2.ID.make("chat")]).toBeDefined()

    yield* Effect.promise(() => disposeAllInstances())

    const second = yield* loadAndList
    expect(second[ProviderV2.ID.make("demo")]).toBeDefined()
    expect(second[ProviderV2.ID.make("demo")].models[ModelV2.ID.make("chat")]).toBeDefined()
  }).pipe(provideMultiInstance),
)

it.instance(
  "plugin config enabled and disabled providers are honored",
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const configDir = path.join(instance.directory, ".opencode")
    const root = path.join(configDir, "plugin")
    yield* Effect.promise(() => mkdir(root, { recursive: true }))
    yield* Effect.promise(() => markPluginDependenciesReady(configDir))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(root, "provider-filter.ts"),
        [
          "export default {",
          '  id: "demo.provider-filter",',
          "  server: async () => ({",
          "    async config(cfg) {",
          '      cfg.enabled_providers = ["anthropic", "openai"]',
          '      cfg.disabled_providers = ["openai"]',
          "    },",
          "  }),",
          "}",
          "",
        ].join("\n"),
      ),
    )

    yield* set("ANTHROPIC_API_KEY", "test-anthropic-key")
    yield* set("OPENAI_API_KEY", "test-openai-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.anthropic]).toBeDefined()
    expect(providers[ProviderV2.ID.openai]).toBeUndefined()
  }),
)

it.effect("opencode loader keeps paid models when config apiKey is present", () =>
  Effect.gen(function* () {
    const noneDir = yield* tmpdirScoped()
    const keyedDir = yield* tmpdirScoped({
      config: { provider: { opencode: { options: { apiKey: "test-key" } } } },
    })

    const listIn = (directory: string) =>
      Provider.use
        .list()
        .pipe(provideInstanceEffect(directory))
        .pipe(Effect.provide(InstanceLayer.layer), Effect.provide(CrossSpawnSpawner.defaultLayer))

    const none = paid(yield* listIn(noneDir))
    const keyedCount = paid(yield* listIn(keyedDir))

    expect(none).toBe(0)
    expect(keyedCount).toBeGreaterThan(0)
  }).pipe(provideMultiInstance),
)

it.effect("opencode loader keeps paid models when auth exists", () =>
  Effect.gen(function* () {
    const noneDir = yield* tmpdirScoped()
    const keyedDir = yield* tmpdirScoped()

    const listIn = (directory: string) =>
      Provider.use
        .list()
        .pipe(provideInstanceEffect(directory))
        .pipe(Effect.provide(InstanceLayer.layer), Effect.provide(CrossSpawnSpawner.defaultLayer))

    const none = paid(yield* listIn(noneDir))

    const authPath = path.join(Global.Path.data, "auth.json")
    const original = yield* Effect.promise(() => Filesystem.readText(authPath).catch(() => undefined))

    yield* Effect.acquireRelease(
      Effect.promise(() => Filesystem.write(authPath, JSON.stringify({ opencode: { type: "api", key: "test-key" } }))),
      () =>
        Effect.promise(async () => {
          if (original !== undefined) await Filesystem.write(authPath, original)
          else await unlink(authPath).catch(() => undefined)
        }),
    )

    const keyedCount = paid(yield* listIn(keyedDir))

    expect(none).toBe(0)
    expect(keyedCount).toBeGreaterThan(0)
  }).pipe(provideMultiInstance),
)
