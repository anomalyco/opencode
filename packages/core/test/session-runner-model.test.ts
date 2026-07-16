import { describe, expect } from "bun:test"
import { LLM, Model } from "@opencode-ai/ai"
import { LLMClient } from "@opencode-ai/ai/route"
import { DateTime, Effect } from "effect"
import { Money } from "@opencode-ai/schema/money"
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

interface ModelOptions {
  readonly modelID?: string
  readonly settings?: ModelV2.Info["settings"]
  readonly headers?: ModelV2.Info["headers"]
  readonly body?: ModelV2.Info["body"]
  readonly variants?: ModelV2.Info["variants"]
}

const model = (packageName: string | undefined, options: ModelOptions = {}) =>
  ModelV2.Info.make({
    id: ModelV2.ID.make("test-model"),
    modelID: ModelV2.ID.make(options.modelID ?? "api-test-model"),
    providerID: ProviderV2.ID.make("test-provider"),
    name: "Test model",
    package: packageName,
    settings: options.settings ?? {},
    headers: options.headers ?? { "x-test": "header" },
    body: options.body ?? { custom_extension: { enabled: true } },
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: options.variants ?? [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 100, output: 20 },
  })

describe("SessionRunnerModel", () => {
  it.effect("uses the API modelID instead of the catalog ID for native OpenAI routes", () =>
    Effect.gen(function* () {
      const catalog = model(ProviderV2.aisdk("@ai-sdk/openai"), {
        settings: { baseURL: "https://openai.example/v1" },
      })
      const resolved = yield* SessionRunnerModel.fromCatalogModel(catalog)

      expect(catalog.id).toBe(ModelV2.ID.make("test-model"))
      expect(resolved).toMatchObject({ id: "api-test-model", provider: "test-provider" })
      expect(resolved.route).toMatchObject({
        id: "openai-responses",
        providerMetadataKey: "openai",
        endpoint: { baseURL: "https://openai.example/v1" },
        defaults: {
          headers: { "x-test": "header" },
          limits: { context: 100, output: 20 },
          http: { body: { custom_extension: { enabled: true } } },
        },
      })
    }),
  )

  it.effect("keeps catalog apiKey credentials out of provider JSON", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { apiKey: "secret", baseURL: "https://openai.example/v1" },
        }),
      )
      const prepared = yield* LLMClient.prepare(LLM.request({ model: resolved, prompt: "Hello" }))

      expect(JSON.stringify(prepared.body)).not.toContain("apiKey")
      expect(JSON.stringify(prepared.body)).not.toContain("secret")
    }),
  )

  it.effect("uses merged API settings for OpenAI-compatible auth and request defaults", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai-compatible"), {
          settings: {
            apiKey: "settings-secret",
            baseURL: "https://compatible.example/v1",
            compatibility: "strict",
          },
          headers: {},
          body: {},
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
      expect(resolved.route.id).toBe("openai-compatible-chat")
      expect(resolved.route.endpoint.baseURL).toBe("https://compatible.example/v1")
      expect(resolved.route.defaults.http?.body).toEqual({})
    }),
  )

  it.effect("overlays selected OpenAI Session variant settings and bodies", () =>
    Effect.gen(function* () {
      const catalog = model(ProviderV2.aisdk("@ai-sdk/openai"), {
        settings: { baseURL: "https://openai.example/v1" },
        variants: [
          {
            id: ModelV2.VariantID.make("high"),
            settings: { reasoningEffort: "high" },
            headers: { "x-variant": "high" },
            body: {
              store: false,
              service_tier: "priority",
              temperature: 0.2,
            },
          },
        ],
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
        cost: Money.USD.zero,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const resolved = yield* SessionRunnerModel.resolve(session, catalog)

      expect(resolved.route.defaults.headers).toMatchObject({ "x-test": "header", "x-variant": "high" })
      expect(resolved.route.defaults.http?.body).toEqual({
        custom_extension: { enabled: true },
        store: false,
        service_tier: "priority",
        temperature: 0.2,
      })
      expect(resolved.route.defaults.providerOptions).toEqual({
        openai: { store: false, reasoningEffort: "high" },
      })
    }),
  )

  it.effect("overlays selected OpenAI-compatible Session variant bodies", () =>
    Effect.gen(function* () {
      const catalog = model(ProviderV2.aisdk("@ai-sdk/openai-compatible"), {
        settings: { baseURL: "https://compatible.example/v1" },
        variants: [
          {
            id: ModelV2.VariantID.make("high"),
            settings: {},
            headers: {},
            body: { store: false, reasoning_effort: "high" },
          },
        ],
      })
      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_compatible_variant"),
        projectID: ProjectV2.ID.global,
        title: "test",
        model: { id: catalog.id, providerID: catalog.providerID, variant: ModelV2.VariantID.make("high") },
        cost: Money.USD.zero,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const resolved = yield* SessionRunnerModel.resolve(session, catalog)

      expect(resolved.route.defaults.http?.body).toEqual({
        custom_extension: { enabled: true },
        store: false,
        reasoning_effort: "high",
      })
    }),
  )

  it.effect("rejects an explicit unavailable Session variant during model resolution", () =>
    Effect.gen(function* () {
      const catalog = model(ProviderV2.aisdk("@ai-sdk/openai"), {
        settings: { baseURL: "https://openai.example/v1" },
      })
      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_model_variant_unavailable"),
        projectID: ProjectV2.ID.global,
        title: "test",
        model: {
          id: catalog.id,
          providerID: catalog.providerID,
          variant: ModelV2.VariantID.make("unknown"),
        },
        cost: Money.USD.zero,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const failure = yield* SessionRunnerModel.resolve(session, catalog).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionRunnerModel.VariantUnavailableError",
        providerID: "test-provider",
        modelID: "test-model",
        variant: "unknown",
      })
      expect(failure.message).toBe("Variant unavailable for test-provider/test-model: unknown")
    }),
  )

  it.effect("overlays selected Anthropic Session variant settings", () =>
    Effect.gen(function* () {
      const catalog = model(ProviderV2.aisdk("@ai-sdk/anthropic"), {
        settings: { baseURL: "https://anthropic.example/v1" },
        variants: [
          {
            id: ModelV2.VariantID.make("high"),
            settings: { thinking: { type: "enabled", budgetTokens: 12000 } },
            headers: {},
            body: {},
          },
        ],
      })
      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_anthropic_variant"),
        projectID: ProjectV2.ID.global,
        title: "test",
        model: { id: catalog.id, providerID: catalog.providerID, variant: ModelV2.VariantID.make("high") },
        cost: Money.USD.zero,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const resolved = yield* SessionRunnerModel.resolve(session, catalog)

      expect(resolved.route.defaults.http?.body).toEqual({
        custom_extension: { enabled: true },
      })
      expect(resolved.route.defaults.providerOptions).toEqual({
        anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } },
      })
    }),
  )

  it.effect("maps catalog Anthropic AI SDK models into native routes", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/anthropic"), {
          settings: { baseURL: "https://anthropic.example/v1" },
        }),
      )

      expect(resolved.route).toMatchObject({
        id: "anthropic-messages",
        providerMetadataKey: "anthropic",
        endpoint: { baseURL: "https://anthropic.example/v1" },
      })
    }),
  )

  it.effect("uses resolved credentials for bearer auth", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
          headers: {},
          body: {},
        }),
        Credential.Key.make({ type: "key", key: "secret" }),
      )
      const request = LLM.request({ model: resolved, prompt: "Hello" })
      const headers = yield* resolved.route.auth.apply({
        request,
        method: "POST",
        url: "https://openai.example/v1/responses",
        body: "{}",
        headers: Headers.empty,
      })

      expect(headers.authorization).toBe("Bearer secret")
    }),
  )

  it.effect("prefers stored credentials over configured auth", () =>
    Effect.gen(function* () {
      const credential = Credential.Key.make({ type: "key", key: "stored-secret", metadata: { tenant: "work" } })
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { apiKey: "configured-secret", baseURL: "https://openai.example/v1" },
          headers: {},
          body: {},
        }),
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

  it.effect("does not project OAuth account metadata into the request body", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
          headers: {},
          body: {},
        }),
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "secret",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { server: "https://console.example", orgID: "org_123" },
        }),
      )

      expect(resolved.route.defaults.http?.body).toEqual({})
    }),
  )

  it.effect("routes ChatGPT OAuth credentials to the codex backend", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
          headers: {},
          body: {},
        }),
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { accountID: "acct_123" },
        }),
      )
      const request = LLM.request({ model: resolved, prompt: "Hello" })
      const headers = yield* resolved.route.auth.apply({
        request,
        method: "POST",
        url: "https://chatgpt.com/backend-api/codex/responses",
        body: "{}",
        headers: Headers.empty,
      })

      expect(resolved.route).toMatchObject({
        id: "openai-responses",
        endpoint: { baseURL: "https://chatgpt.com/backend-api/codex" },
      })
      expect(headers.authorization).toBe("Bearer chatgpt-token")
      expect(headers["chatgpt-account-id"]).toBe("acct_123")
    }),
  )

  it.effect("routes native OpenAI provider packages with ChatGPT credentials to the codex backend", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model("@opencode-ai/ai/providers/openai", {
          settings: { baseURL: "https://openai.example/v1" },
        }),
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { accountID: "acct_123" },
        }),
      )
      const headers = yield* resolved.route.auth.apply({
        request: LLM.request({ model: resolved, prompt: "Hello" }),
        method: "POST",
        url: "https://chatgpt.com/backend-api/codex/responses",
        body: "{}",
        headers: Headers.empty,
      })

      expect(resolved.route.endpoint.baseURL).toBe("https://chatgpt.com/backend-api/codex")
      expect(headers.authorization).toBe("Bearer chatgpt-token")
      expect(headers["chatgpt-account-id"]).toBe("acct_123")
    }),
  )

  it.effect("does not route native OpenAI-compatible packages to the codex backend", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model("@opencode-ai/ai/providers/openai-compatible", {
          settings: { baseURL: "https://compatible.example/v1" },
        }),
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { accountID: "acct_123" },
        }),
      )

      expect(resolved.route.id).toBe("openai-compatible-chat")
      expect(resolved.route.endpoint.baseURL).toBe("https://compatible.example/v1")
    }),
  )

  it.effect("maps legacy OpenAI organization and project settings to headers", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { organization: "org_123", project: "proj_123" },
        }),
      )

      expect(resolved.route.defaults.headers).toMatchObject({
        "OpenAI-Organization": "org_123",
        "OpenAI-Project": "proj_123",
      })
    }),
  )

  it.effect("routes ChatGPT OAuth credentials without an account id to the codex backend", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
          headers: {},
          body: {},
        }),
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-headless"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
        }),
      )
      const request = LLM.request({ model: resolved, prompt: "Hello" })
      const headers = yield* resolved.route.auth.apply({
        request,
        method: "POST",
        url: "https://chatgpt.com/backend-api/codex/responses",
        body: "{}",
        headers: Headers.empty,
      })

      expect(resolved.route.endpoint.baseURL).toBe("https://chatgpt.com/backend-api/codex")
      expect(headers.authorization).toBe("Bearer chatgpt-token")
      expect(headers["chatgpt-account-id"]).toBeUndefined()
    }),
  )

  it.effect("keeps non-ChatGPT OAuth credentials on the configured endpoint", () =>
    Effect.gen(function* () {
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
          headers: {},
          body: {},
        }),
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "oauth-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { accountID: "acct_123" },
        }),
      )
      const request = LLM.request({ model: resolved, prompt: "Hello" })
      const headers = yield* resolved.route.auth.apply({
        request,
        method: "POST",
        url: "https://openai.example/v1/responses",
        body: "{}",
        headers: Headers.empty,
      })

      expect(resolved.route.endpoint.baseURL).toBe("https://openai.example/v1")
      expect(headers.authorization).toBe("Bearer oauth-token")
      expect(headers["chatgpt-account-id"]).toBeUndefined()
    }),
  )

  it.effect("loads dynamic native provider packages through the injected package loader", () =>
    Effect.gen(function* () {
      const native = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
        }),
      )
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model("@opencode-ai/ai/providers/custom", {
          settings: { region: "test" },
          headers: { "x-package": "header" },
          body: { custom: true },
        }),
        undefined,
        {
          loadPackage: (specifier) => {
            expect(specifier).toBe("@opencode-ai/ai/providers/custom")
            return Effect.succeed({
              model: (modelID, settings) => {
                expect(modelID).toBe("api-test-model")
                expect(settings).toEqual({
                  region: "test",
                  headers: { "x-package": "header" },
                  body: { custom: true },
                  limits: { context: 100, output: 20 },
                })
                return Model.make({ id: modelID, provider: "package-provider", route: native.route })
              },
            })
          },
        },
      )

      expect(resolved).toMatchObject({ id: "api-test-model", provider: "test-provider" })
    }),
  )

  it.effect("maps OAuth credentials to native provider auth settings", () =>
    Effect.gen(function* () {
      const native = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
        }),
      )
      const credential = Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("device"),
        access: "oauth-token",
        refresh: "refresh",
        expires: Date.now() + 60_000,
      })
      const packages = [
        ["@opencode-ai/ai/providers/google-vertex", "accessToken"],
        ["@opencode-ai/ai/providers/google-vertex/gemini", "accessToken"],
        ["@opencode-ai/ai/providers/google-vertex/chat", "accessToken"],
        ["@opencode-ai/ai/providers/google-vertex/responses", "accessToken"],
        ["@opencode-ai/ai/providers/google-vertex/messages", "accessToken"],
        ["@opencode-ai/ai/providers/anthropic", "authToken"],
        ["@opencode-ai/ai/providers/anthropic-compatible", "authToken"],
      ] as const

      yield* Effect.forEach(packages, ([specifier, key]) =>
        SessionRunnerModel.fromCatalogModel(model(specifier, { settings: { apiKey: "configured-key" } }), credential, {
          loadPackage: () =>
            Effect.succeed({
              model: (modelID, settings) => {
                expect(settings).toMatchObject({ [key]: "oauth-token" })
                expect(settings).not.toHaveProperty("apiKey")
                return Model.make({ id: modelID, provider: "package-provider", route: native.route })
              },
            }),
        }),
      )
    }),
  )

  it.effect("loads arbitrary AISDK packages through the injected AISDK loader", () =>
    Effect.gen(function* () {
      const native = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
        }),
      )
      const resolved = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/google"), {
          modelID: "gemini-api-model",
          settings: { project: "test" },
          headers: { "x-aisdk": "header" },
          body: { custom: true },
        }),
        Credential.Key.make({ type: "key", key: "fallback-secret" }),
        {
          loadAISDK: (runtime) =>
            Effect.sync(() => {
              expect(runtime).toMatchObject({
                id: "test-model",
                modelID: "gemini-api-model",
                providerID: "test-provider",
                package: ProviderV2.aisdk("@ai-sdk/google"),
                settings: { project: "test", apiKey: "fallback-secret" },
                headers: { "x-aisdk": "header" },
                body: { custom: true },
              })
              return Model.make({
                id: runtime.modelID ?? runtime.id,
                provider: runtime.providerID,
                route: native.route,
              })
            }),
        },
      )

      expect(resolved).toMatchObject({ id: "gemini-api-model", provider: "test-provider" })
    }),
  )

  it.effect("rejects AISDK packages without an available loader", () =>
    Effect.gen(function* () {
      const failure = yield* SessionRunnerModel.fromCatalogModel(
        model(ProviderV2.aisdk("@ai-sdk/google"), {
          settings: { baseURL: "https://google.example/v1" },
        }),
      ).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionRunnerModel.UnsupportedPackageError",
        providerID: "test-provider",
        modelID: "test-model",
        package: "aisdk:@ai-sdk/google",
      })
      expect(failure.message).toBe("Unsupported package for test-provider/test-model: aisdk:@ai-sdk/google")
    }),
  )

  it.effect("reports whether a catalog model declares a provider package", () =>
    Effect.sync(() => {
      expect(SessionRunnerModel.supported(model(ProviderV2.aisdk("@ai-sdk/openai")))).toBe(true)
      expect(SessionRunnerModel.supported(model("@opencode-ai/ai/providers/custom"))).toBe(true)
      expect(SessionRunnerModel.supported(model(undefined))).toBe(false)
    }),
  )
})
