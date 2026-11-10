import { describe, expect } from "bun:test"
import { ai } from "@opencode/ai/effect"
import { compileRequest } from "@opencode/ai/testing"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { Effect, Schema, Struct } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigIntegration } from "@opencode/core/config/integration"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { ModelsDev } from "@opencode/core/models-dev"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ModelsDevPlugin } from "@opencode/core/plugin/models-dev"
import { Provider } from "@opencode/core/provider"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

// Each case loads a small models.dev catalog through the real catalog plugin, applies config and plugin edits,
// then compiles the selected variant's request offline. Cases marked `failing` record the expected request for
// configurations whose variants are still spelled for a package or limit the model no longer has.

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Info)
const doc = (providers: unknown) => new Document({ type: "document", info: decode({ providers }) })

const google = Provider.ID.make("google")
const gemini = Model.ID.make("gemini-4-argon")
const claude = Model.ID.make("claude-sonnet-4-5")
const INTERACTIONS = "@opencode/ai/providers/google/interactions"
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"

const api = (protocol: string, baseURL: string, aisdk: string, opencodeai?: string) => ({
  [protocol]: { base_url: baseURL, sdk: { aisdk, ...(opencodeai ? { opencodeai } : {}) } },
})
const chat = (id: string, reasoning: unknown, output: number, apis: object) => ({
  id,
  type: "chat",
  name: id,
  release_date: "2026-01-01",
  modalities: { input: ["text"], output: ["text"] },
  capabilities: { tools: { supported: true }, reasoning, temperature: true },
  limit: { context: 200_000, output },
  api: apis,
})
const provider = (id: string, models: object) => ({ id, name: id, env: [`${id.toUpperCase()}_API_KEY`], models })
const catalog = {
  google: provider("google", {
    [gemini]: chat("gemini-4-argon", { supported: true, effort: ["low", "high"] }, 65_536, {
      ...api("generate-content", GEMINI_URL, "@ai-sdk/google", "@opencode/ai/providers/google"),
      ...api("interactions", GEMINI_URL, "@ai-sdk/google"),
    }),
  }),
  anthropic: provider("anthropic", {
    [claude]: chat(
      "claude-sonnet-4-5",
      { supported: true, budget: { min: 1024 } },
      64_000,
      api("messages", "https://api.anthropic.com/v1", "@ai-sdk/anthropic", "@opencode/ai/providers/anthropic"),
    ),
  }),
  azure: provider("azure", {
    "gpt-5.5": chat(
      "gpt-5.5",
      { supported: true, effort: ["none", "low", "high"] },
      128_000,
      api("responses", "https://azure.test/openai/v1", "@ai-sdk/azure", "@opencode/ai/providers/azure/responses"),
    ),
  }),
  nvidia: provider("nvidia", {
    "qwen/qwen4-coder": chat(
      "qwen/qwen4-coder",
      { supported: true, toggle: true },
      65_536,
      api(
        "chat-completions",
        "https://integrate.api.nvidia.com/v1",
        "@ai-sdk/openai-compatible",
        "@opencode/ai/providers/openai-compatible",
      ),
    ),
  }),
}

const seed = Effect.fn(function* () {
  const snapshot = yield* ModelsDev.decodeSnapshot(JSON.stringify(catalog))
  yield* ModelsDevPlugin.effect(yield* PluginHost.make(yield* Plugin.Service, "catalog")).pipe(
    Effect.provideService(
      ModelsDev.Service,
      ModelsDev.Service.of({ get: () => Effect.succeed(snapshot), refresh: () => Effect.void }),
    ),
  )
  yield* (yield* Provider.Service).transform((editor) => {
    for (const record of editor.list())
      editor.update(record.provider.id, (provider) => {
        provider.activation = "enabled"
      })
  })
})

const configure = Effect.fn(function* (entries: Entry[]) {
  yield* ConfigProviderPlugin.Plugin.effect(yield* PluginHost.make(yield* Plugin.Service, "config")).pipe(
    Effect.provide(Config.testLayer(entries)),
  )
})

const editModel = Effect.fn(function* (update: (model: Model.MutableInfo) => void) {
  yield* (yield* Model.Service).transform((editor) => editor.update(google, gemini, update))
})

/** The model's variant ids, the selected variant and the request it compiles to, without prompt fields. */
const request = Effect.fn(function* (
  providerID: string,
  modelID: string,
  variant: string,
): Effect.fn.Return<Record<string, unknown>, unknown, Model.Service> {
  const model = yield* (yield* Model.Service).get(Provider.ID.make(providerID), Model.ID.make(modelID))
  if (!model) throw new Error(`Missing model ${providerID}/${modelID}`)
  const selected = yield* ModelResolver.withVariant(model, Model.VariantID.make(variant))
  const language = yield* ModelResolver.fromCatalogModel(selected, Credential.Key.make({ type: "key", key: "test" }))
  const prepared = yield* compileRequest(ai.request({ model: language, prompt: "hi" }))
  return {
    package: selected.package,
    variants: model.variants.map((item) => item.id),
    variant: model.variants.find((item) => item.id === variant),
    headers: selected.headers,
    wire: Struct.omit(prepared.body as Record<string, unknown>, [
      "model",
      "input",
      "messages",
      "contents",
      "stream",
      "store",
      "stream_options",
    ]),
  }
})

const interactionsHigh = {
  package: INTERACTIONS,
  variants: ["low", "high"],
  variant: { id: "high", settings: { thinkingLevel: "high", thinkingSummaries: "auto" } },
  headers: undefined,
  wire: { generation_config: { thinking_level: "high", thinking_summaries: "auto" } },
}

describe("catalog variants after config and plugin edits", () => {
  it.effect("spells catalog reasoning for the catalog package", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([doc({ azure: { settings: { resourceName: "example" } } })])
      expect(yield* request("google", gemini, "high")).toEqual({
        package: "@opencode/ai/providers/google",
        variants: ["low", "high"],
        variant: { id: "high", settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } } },
        headers: undefined,
        wire: { generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } } },
      })
      expect(yield* request("anthropic", claude, "max")).toEqual({
        package: "@opencode/ai/providers/anthropic",
        variants: ["high", "max"],
        variant: { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 31_999 } } },
        headers: undefined,
        wire: { max_tokens: 32_000, thinking: { type: "enabled", budget_tokens: 16_000 } },
      })
      expect(yield* request("azure", "gpt-5.5", "high")).toEqual({
        package: "@opencode/ai/providers/azure/responses",
        variants: ["none", "low", "high"],
        variant: {
          id: "high",
          settings: { reasoningEffort: "high", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
        },
        headers: undefined,
        wire: { include: ["reasoning.encrypted_content"], reasoning: { effort: "high", summary: "auto" } },
      })
    }),
  )

  it.effect("overlays config variants on a default by id and appends new ids", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([
        doc({
          google: {
            models: {
              [gemini]: {
                variants: [
                  { id: "high", settings: { thinkingConfig: { includeThoughts: false } } },
                  { id: "fast", headers: { "x-fast": "1" } },
                ],
              },
            },
          },
        }),
      ])
      expect(yield* request("google", gemini, "high")).toEqual({
        package: "@opencode/ai/providers/google",
        variants: ["low", "high", "fast"],
        variant: { id: "high", settings: { thinkingConfig: { includeThoughts: false, thinkingLevel: "high" } } },
        headers: undefined,
        wire: { generationConfig: { thinkingConfig: { includeThoughts: false, thinkingLevel: "high" } } },
      })
    }),
  )

  it.effect("replaces the defaults with configured reasoning", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([
        doc({
          google: {
            models: { [gemini]: { capabilities: { reasoning: { supported: true, effort: ["minimal", "high"] } } } },
          },
        }),
      ])
      expect(yield* request("google", gemini, "minimal")).toEqual({
        package: "@opencode/ai/providers/google",
        variants: ["minimal", "high"],
        variant: { id: "minimal", settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: "minimal" } } },
        headers: undefined,
        wire: { generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: "minimal" } } },
      })
    }),
  )

  it.effect("keeps a plugin-registered variant and overlays config on it", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* editModel((model) => {
        model.variants.push({ id: Model.VariantID.make("fast"), body: { speed: "fast" } })
      })
      yield* configure([
        doc({ google: { models: { [gemini]: { variants: [{ id: "fast", headers: { "x-fast": "1" } }] } } } }),
      ])
      expect(yield* request("google", gemini, "fast")).toEqual({
        package: "@opencode/ai/providers/google",
        variants: ["low", "high", "fast"],
        variant: { id: "fast", body: { speed: "fast" }, headers: { "x-fast": "1" } },
        headers: { "x-fast": "1" },
        wire: {},
      })
    }),
  )

  it.effect("gives a custom model the protocol's default efforts", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([
        doc({
          custom: {
            package: "@opencode/ai/providers/openai/chat",
            settings: { baseURL: "https://custom.test/v1" },
            models: { mine: {} },
          },
        }),
      ])
      expect(yield* request("custom", "mine", "high")).toEqual({
        package: "@opencode/ai/providers/openai/chat",
        variants: ["low", "medium", "high"],
        variant: { id: "high", settings: { reasoningEffort: "high" } },
        headers: undefined,
        wire: { reasoning_effort: "high" },
      })
    }),
  )

  it.effect("keeps the host's spelling on a model inherited by an alias", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([doc({ "my-nvidia": { canonical: "nvidia", models: { "qwen/qwen4-coder": {} } } })])
      expect(yield* request("my-nvidia", "qwen/qwen4-coder", "thinking")).toEqual({
        package: "@opencode/ai/providers/openai-compatible",
        variants: ["none", "thinking"],
        variant: { id: "thinking", body: { chat_template_kwargs: { enable_thinking: true } } },
        headers: undefined,
        wire: {},
      })
    }),
  )

  it.effect.failing("spells an alias's inherited model for the alias package", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([doc({ "google-ix": { canonical: "google", package: INTERACTIONS, models: { [gemini]: {} } } })])
      expect(yield* request("google-ix", gemini, "high")).toEqual(interactionsHigh)
    }),
  )

  it.effect.failing("respells a listed model when its provider package changes in place", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([doc({ google: { package: INTERACTIONS, models: { [gemini]: {} } } })])
      expect(yield* request("google", gemini, "high")).toEqual(interactionsHigh)
    }),
  )

  it.effect.failing("respells unlisted models when their provider package changes in place", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([doc({ google: { package: INTERACTIONS } })])
      expect(yield* request("google", gemini, "high")).toEqual(interactionsHigh)
    }),
  )

  it.effect.failing("keeps the catalog effort list when a model's own package changes", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([doc({ google: { models: { [gemini]: { package: INTERACTIONS } } } })])
      expect(yield* request("google", gemini, "high")).toEqual(interactionsHigh)
    }),
  )

  it.effect.failing("still respells when a config variant only adds a header", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([
        doc({
          "google-ix": {
            canonical: "google",
            package: INTERACTIONS,
            models: { [gemini]: { variants: [{ id: "high", headers: { "x-tier": "high" } }] } },
          },
        }),
      ])
      expect(yield* request("google-ix", gemini, "high")).toEqual({
        ...interactionsHigh,
        variant: { ...interactionsHigh.variant, headers: { "x-tier": "high" } },
        headers: { "x-tier": "high" },
      })
    }),
  )

  it.effect.failing("merges a plugin variant into the default with the same id", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* editModel((model) => {
        model.variants.push({ id: Model.VariantID.make("high"), headers: { "x-plugin": "1" } })
      })
      expect(yield* request("google", gemini, "high")).toEqual({
        package: "@opencode/ai/providers/google",
        variants: ["low", "high"],
        variant: {
          id: "high",
          settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
          headers: { "x-plugin": "1" },
        },
        headers: { "x-plugin": "1" },
        wire: { generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } } },
      })
    }),
  )

  it.effect.failing("lets a plugin narrow the catalog reasoning", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* editModel((model) => {
        Object.assign(model, { reasoning: [{ type: "effort", values: ["high"] }] })
      })
      expect((yield* request("google", gemini, "high")).variants).toEqual(["high"])
    }),
  )

  it.effect.failing("sizes budget variants for a lowered output limit", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([doc({ anthropic: { models: { [claude]: { limit: { output: 8000 } } } } })])
      expect(yield* request("anthropic", claude, "max")).toEqual({
        package: "@opencode/ai/providers/anthropic",
        variants: ["high", "max"],
        variant: { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 7999 } } },
        headers: undefined,
        wire: { max_tokens: 32_000, thinking: { type: "enabled", budget_tokens: 7999 } },
      })
    }),
  )

  it.effect.failing("spells Azure Chat variants when the provider uses completion URLs", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([doc({ azure: { settings: { resourceName: "example", useCompletionUrls: true } } })])
      expect(yield* request("azure", "gpt-5.5", "high")).toEqual({
        package: "@opencode/ai/providers/azure/chat",
        variants: ["none", "low", "high"],
        variant: { id: "high", settings: { reasoningEffort: "high" } },
        headers: undefined,
        wire: { reasoning_effort: "high" },
      })
    }),
  )

  it.effect.failing("spells an integration document's model for its package", () =>
    withEnv({ OPENCODE_API_KEY: "test" }, () =>
      Effect.gen(function* () {
        yield* seed()
        yield* (yield* Integration.Service).transform((editor) => {
          editor.method.update({
            integrationID: Integration.ID.make("opencode"),
            method: { type: "env", names: ["OPENCODE_API_KEY"] },
          })
        })
        yield* (yield* Provider.Service).transform((editor) =>
          ConfigProviderPlugin.integrate(
            editor,
            new ConfigIntegration.Document({
              type: "document",
              integrationID: Integration.ID.make("opencode"),
              connection: { type: "env", name: "OPENCODE_API_KEY" },
              info: decode({
                providers: { "google-ix": { canonical: "google", package: INTERACTIONS, models: { [gemini]: {} } } },
              }),
            }),
          ),
        )
        expect(yield* request("google-ix", gemini, "high")).toEqual(interactionsHigh)
      }),
    ),
  )

  it.effect.failing("spells a custom model under an alias for the alias's host", () =>
    Effect.gen(function* () {
      yield* seed()
      yield* configure([doc({ "my-nvidia": { canonical: "nvidia", models: { "qwen/custom": {} } } })])
      expect(yield* request("my-nvidia", "qwen/custom", "thinking")).toEqual({
        package: "@opencode/ai/providers/openai-compatible",
        variants: ["none", "thinking"],
        variant: { id: "thinking", body: { chat_template_kwargs: { enable_thinking: true } } },
        headers: undefined,
        wire: {},
      })
    }),
  )
})
