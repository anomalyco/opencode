import { describe, expect } from "bun:test"
import { LLM } from "@opencode-ai/llm"
import { LLMClient } from "@opencode-ai/llm/route"
import { ConfigProvider, DateTime, Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionV2 } from "@opencode-ai/core/session"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { it } from "./lib/effect"

type Api =
  | {
      readonly type: "aisdk"
      readonly package: string
      readonly url?: string
      readonly settings?: Record<string, unknown>
    }
  | { readonly type: "native"; readonly url?: string; readonly settings: Record<string, unknown> }

const model = (api: Api, variants: ModelV2.Info["variants"] = []) =>
  new ModelV2.Info({
    id: ModelV2.ID.make("test-model"),
    providerID: ProviderV2.ID.make("test-provider"),
    name: "Test model",
    api: { id: ModelV2.ID.make("api-test-model"), ...api },
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    request: {
      headers: { "x-test": "header" },
      body: { apiKey: "secret", custom_extension: { enabled: true } },
      generation: { temperature: 0.7 },
      options: { store: false, serviceTier: "priority" },
    },
    variants,
    time: { released: DateTime.makeUnsafe(0) },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 100, output: 20 },
  })

const provider = (api: ProviderV2.Info["api"]) =>
  new ProviderV2.Info({
    id: ProviderV2.ID.make("test-provider"),
    name: "Test provider",
    api,
    request: { headers: {}, body: {} },
  })

describe("SessionRunnerModel", () => {
  it.effect("maps catalog OpenAI AI SDK models into native Responses routes", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model({ type: "aisdk", package: "@ai-sdk/openai", url: "https://openai.example/v1" }),
      )

      expect(resolved).toMatchObject({ id: "api-test-model", provider: "test-provider" })
      expect(resolved.route).toMatchObject({
        id: "openai-responses",
        endpoint: { baseURL: "https://openai.example/v1" },
        defaults: {
          headers: { "x-test": "header" },
          limits: { context: 100, output: 20 },
          generation: { temperature: 0.7 },
          providerOptions: { openai: { store: false, serviceTier: "priority" } },
          http: { body: { custom_extension: { enabled: true } } },
        },
      })
    }),
  )

  it.effect("keeps catalog apiKey credentials out of provider JSON", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model({ type: "aisdk", package: "@ai-sdk/openai", url: "https://openai.example/v1" }),
      )
      const prepared = yield* LLMClient.prepare(LLM.request({ model: resolved, prompt: "Hello" }))

      expect(JSON.stringify(prepared.body)).not.toContain("apiKey")
      expect(JSON.stringify(prepared.body)).not.toContain("secret")
    }),
  )

  it.effect("uses merged API settings for OpenAI-compatible auth and request defaults", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        new ModelV2.Info({
          ...model({
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://compatible.example/v1",
            settings: { apiKey: "settings-secret", compatibility: "strict" },
          }),
          request: { headers: {}, body: {}, generation: {}, options: {} },
        }),
      )
      const request = LLM.request({ model: resolved, prompt: "Hello" })
      const headers = yield* resolved.route.auth.apply({
        request,
        method: "POST",
        url: "https://compatible.example/v1/chat/completions",
        body: "{}",
        headers: Headers.empty,
      })

      expect(headers.authorization).toBe("Bearer settings-secret")
      expect(resolved.route.defaults.http?.body).toEqual({})
    }),
  )

  it.effect("lowers selected OpenAI Session variants into Responses options", () =>
    Effect.gen(function* () {
      const base = model({ type: "aisdk", package: "@ai-sdk/openai", url: "https://openai.example/v1" }, [
        {
          id: ModelV2.VariantID.make("high"),
          headers: { "x-variant": "high" },
          body: {},
          generation: { temperature: 0.2 },
          options: { reasoningEffort: "high" },
        },
      ])
      const catalog = new ModelV2.Info({
        ...base,
        request: { ...base.request, options: { ...base.request.options, reasoningEffort: "medium" } },
      })
      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_model_variant"),
        projectID: ProjectV2.ID.global,
        title: "test",
        model: {
          id: catalog.id,
          providerID: catalog.providerID,
          variant: ModelV2.VariantID.make("high"),
        },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const resolved = yield* SessionRunnerModel.resolve(session, catalog)
      const prepared = yield* LLMClient.prepare(LLM.request({ model: resolved, prompt: "Hello" }))

      expect(resolved.route.defaults.headers).toMatchObject({ "x-test": "header", "x-variant": "high" })
      expect(resolved.route.defaults.http?.body).toEqual({ custom_extension: { enabled: true } })
      expect(prepared.body).toMatchObject({
        store: false,
        service_tier: "priority",
        temperature: 0.2,
        reasoning: { effort: "high" },
      })
      expect(prepared.body).not.toHaveProperty("reasoningEffort")
    }),
  )

  it.effect("lowers selected OpenAI-compatible Session variants into Chat options", () =>
    Effect.gen(function* () {
      const catalog = model(
        { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://compatible.example/v1" },
        [
          {
            id: ModelV2.VariantID.make("high"),
            headers: {},
            body: {},
            generation: {},
            options: { reasoningEffort: "high" },
          },
        ],
      )
      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_compatible_variant"),
        projectID: ProjectV2.ID.global,
        title: "test",
        model: { id: catalog.id, providerID: catalog.providerID, variant: ModelV2.VariantID.make("high") },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const resolved = yield* SessionRunnerModel.resolve(session, catalog)
      const prepared = yield* LLMClient.prepare(LLM.request({ model: resolved, prompt: "Hello" }))

      expect(resolved.route.defaults.http?.body).toEqual({ custom_extension: { enabled: true } })
      expect(prepared.body).toMatchObject({
        store: false,
        reasoning_effort: "high",
      })
      expect(prepared.body).not.toHaveProperty("reasoningEffort")
    }),
  )

  it.effect("lowers selected Anthropic Session variants into Messages options", () =>
    Effect.gen(function* () {
      const catalog = model({ type: "aisdk", package: "@ai-sdk/anthropic", url: "https://anthropic.example/v1" }, [
        {
          id: ModelV2.VariantID.make("high"),
          headers: {},
          body: {},
          generation: {},
          options: { thinking: { type: "enabled", budgetTokens: 12000 } },
        },
      ])
      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_anthropic_variant"),
        projectID: ProjectV2.ID.global,
        title: "test",
        model: { id: catalog.id, providerID: catalog.providerID, variant: ModelV2.VariantID.make("high") },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const resolved = yield* SessionRunnerModel.resolve(session, catalog)
      const prepared = yield* LLMClient.prepare(LLM.request({ model: resolved, prompt: "Hello" }))

      expect(resolved.route.defaults.http?.body).toEqual({ custom_extension: { enabled: true } })
      expect(prepared.body).toMatchObject({
        thinking: { type: "enabled", budget_tokens: 12000 },
      })
      expect(JSON.stringify(prepared.body)).not.toContain("budgetTokens")
    }),
  )

  it.effect("maps catalog Anthropic AI SDK models into native routes", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model({ type: "aisdk", package: "@ai-sdk/anthropic", url: "https://anthropic.example/v1" }),
      )

      expect(resolved.route).toMatchObject({
        id: "anthropic-messages",
        endpoint: { baseURL: "https://anthropic.example/v1" },
      })
    }),
  )

  it.effect("preserves environment-backed bearer auth", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        new ModelV2.Info({
          ...model({ type: "aisdk", package: "@ai-sdk/openai", url: "https://openai.example/v1" }),
          request: { headers: {}, body: {}, generation: {}, options: {} },
        }),
        { type: "env", name: "TEST_PROVIDER_API_KEY" },
      )
      const request = LLM.request({ model: resolved, prompt: "Hello" })
      const headers = yield* resolved.route.auth
        .apply({
          request,
          method: "POST",
          url: "https://openai.example/v1/responses",
          body: "{}",
          headers: Headers.empty,
        })
        .pipe(
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { TEST_PROVIDER_API_KEY: "secret" } }))),
        )

      expect(headers.authorization).toBe("Bearer secret")
    }),
  )

  it.effect("prefers stored credentials over configured auth", () =>
    Effect.gen(function* () {
      const credential = new Credential.Stored({
        id: Credential.ID.create(),
        integrationID: Integration.ID.make("test-provider"),
        label: "Work",
        value: new Credential.Key({ type: "key", key: "stored-secret", metadata: { tenant: "work" } }),
      })
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        new ModelV2.Info({
          ...model({ type: "aisdk", package: "@ai-sdk/openai", url: "https://openai.example/v1" }),
          request: { headers: {}, body: { apiKey: "configured-secret" }, generation: {}, options: {} },
        }),
        { type: "credential", id: credential.id, label: credential.label },
        credential,
      )
      const headers = yield* resolved.route.auth.apply({
        request: LLM.request({ model: resolved, prompt: "Hello" }),
        method: "POST",
        url: "https://openai.example/v1/responses",
        body: "{}",
        headers: Headers.empty,
      })

      expect(headers.authorization).toBe("Bearer stored-secret")
      expect(resolved.route.defaults.http?.body).toEqual({ tenant: "work" })
    }),
  )

  it.effect("rejects catalog APIs without a native route", () =>
    Effect.gen(function* () {
      const failure = yield* SessionRunnerModel.fromCatalogModel(
        model({ type: "aisdk", package: "@ai-sdk/google", url: "https://google.example/v1" }),
      ).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionRunnerModel.UnsupportedApiError",
        providerID: "test-provider",
        modelID: "test-model",
        api: "aisdk:@ai-sdk/google",
      })
    }),
  )

  it.effect("reports whether a catalog model has a supported native route", () =>
    Effect.sync(() => {
      expect(
        SessionRunnerModel.supported(
          model({ type: "aisdk", package: "@ai-sdk/openai", url: "https://openai.example/v1" }),
        ),
      ).toBe(true)
      expect(
        SessionRunnerModel.supported(
          model({ type: "aisdk", package: "@ai-sdk/google", url: "https://google.example/v1" }),
        ),
      ).toBe(false)
      expect(SessionRunnerModel.supported(model({ type: "native", settings: {} }))).toBe(false)
    }),
  )
})
