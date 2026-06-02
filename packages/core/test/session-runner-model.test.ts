import { describe, expect } from "bun:test"
import { LLM } from "@opencode-ai/llm"
import { ConfigProvider, DateTime, Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionV2 } from "@opencode-ai/core/session"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { it } from "./lib/effect"

const model = (endpoint: ModelV2.Info["endpoint"], variants: ModelV2.Info["variants"] = []) =>
  new ModelV2.Info({
    id: ModelV2.ID.make("test-model"),
    apiID: ModelV2.ID.make("api-test-model"),
    providerID: ProviderV2.ID.make("test-provider"),
    name: "Test model",
    endpoint,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    options: {
      headers: { "x-test": "header" },
      body: { store: false },
      aisdk: { provider: { apiKey: "secret" }, request: {} },
    },
    variants,
    time: { released: DateTime.makeUnsafe(0) },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 100, output: 20 },
  })

const provider = (endpoint: ProviderV2.Info["endpoint"]) =>
  new ProviderV2.Info({
    id: ProviderV2.ID.make("test-provider"),
    name: "Test provider",
    enabled: { via: "env", name: "TEST_PROVIDER_API_KEY" },
    env: ["TEST_PROVIDER_API_KEY"],
    endpoint,
    options: { headers: {}, body: {}, aisdk: { provider: {}, request: {} } },
  })

describe("SessionRunnerModel", () => {
  it.effect("maps catalog OpenAI Responses models into native routes", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model({ type: "openai/responses", url: "https://openai.example/v1/responses" }),
      )

      expect(resolved).toMatchObject({ id: "api-test-model", provider: "test-provider" })
      expect(resolved.route).toMatchObject({
        id: "openai-responses",
        endpoint: { baseURL: "https://openai.example/", path: "/v1/responses" },
        defaults: {
          headers: { "x-test": "header" },
          limits: { context: 100, output: 20 },
          http: { body: { store: false } },
        },
      })
    }),
  )

  it.effect("applies the selected Session variant to native request options", () =>
    Effect.gen(function* () {
      const catalog = model(
        { type: "openai/responses", url: "https://openai.example/v1/responses" },
        [{
          id: ModelV2.VariantID.make("high"),
          headers: { "x-variant": "high" },
          body: { include: "extra" },
          aisdk: { provider: {}, request: { reasoningEffort: "high" } },
        }],
      )
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

      expect(resolved.route.defaults).toMatchObject({
        headers: { "x-test": "header", "x-variant": "high" },
        http: { body: { store: false, include: "extra" } },
        providerOptions: { openai: { reasoningEffort: "high" } },
      })
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
        model({ type: "openai/responses", url: "https://openai.example/v1" }),
        provider({ type: "openai/responses", url: "https://openai.example/v1" }),
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
        .pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { TEST_PROVIDER_API_KEY: "secret" } }))))

      expect(headers.authorization).toBe("Bearer secret")
    }),
  )

  it.effect("rejects catalog endpoints without a native route", () =>
    Effect.gen(function* () {
      const failure = yield* SessionRunnerModel.fromCatalogModel(
        model({ type: "aisdk", package: "@ai-sdk/google", url: "https://google.example/v1" }),
      ).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionRunnerModel.UnsupportedEndpointError",
        providerID: "test-provider",
        modelID: "test-model",
        endpoint: "aisdk:@ai-sdk/google",
      })
    }),
  )

  it.effect("rejects OpenAI Responses websocket endpoints instead of silently downgrading to HTTP", () =>
    Effect.gen(function* () {
      const failure = yield* SessionRunnerModel.fromCatalogModel(
        model({ type: "openai/responses", url: "https://openai.example/v1/responses", websocket: true }),
      ).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionRunnerModel.UnsupportedEndpointError",
        endpoint: "openai/responses:websocket",
      })
    }),
  )

  it.effect("reports whether a catalog model has a supported native route", () =>
    Effect.sync(() => {
      expect(SessionRunnerModel.supported(model({ type: "openai/responses", url: "https://openai.example/v1/responses" }))).toBe(true)
      expect(SessionRunnerModel.supported(model({ type: "aisdk", package: "@ai-sdk/google", url: "https://google.example/v1" }))).toBe(false)
    }),
  )
})
