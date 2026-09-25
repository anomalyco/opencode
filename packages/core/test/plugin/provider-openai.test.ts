import { Money } from "@opencode/schema/money"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/core/session"
import { OpenAIResponses } from "@opencode/ai/protocols/openai-responses"
import { AIError, HttpContext, RateLimitError } from "@opencode/ai"
import { classifyProviderFailure } from "@opencode/ai/provider-error"
import { describe, expect } from "bun:test"
import { ConfigProvider, DateTime, Effect } from "effect"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { App } from "@opencode/core/app"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { GithubCopilotPlugin } from "@opencode/core/plugin/provider/github-copilot"
import { OpenAIPlugin, fetchModels, verifyIDToken } from "@opencode/core/plugin/provider/openai"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* OpenAIPlugin.effect(host)
})

const addGithubCopilotPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* GithubCopilotPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const authorize = Effect.fn(function* () {
  const integrations = yield* Integration.Service
  const integrationID = Integration.ID.make("openai")
  const attempt = yield* integrations.oauth.connect({
    integrationID,
    methodID: Integration.MethodID.make("chatgpt-browser"),
  })
  yield* integrations.oauth.cancel({ integrationID, attemptID: attempt.attemptID })
  return new URL(attempt.url)
})

const request = Effect.fn(function* (providerID: Provider.ID, baseURL: string) {
  const hooks = yield* PluginHooks.Service
  const event = yield* hooks.trigger("session", "model.request", {
    sessionID: Session.ID.make("ses_test"),
    agent: Agent.ID.make("build"),
    model: Model.Ref.make({ providerID, id: Model.ID.make("gpt-5.5") }),
    kind: "primary",
    baseURL,
    headers: {},
  })
  return {
    baseURL: event.baseURL,
    headers: event.headers,
    hasHttpHooks:
      (yield* hooks.has("session", "http.request", providerID)) ||
      (yield* hooks.has("session", "http.response", providerID)),
  }
})

describe("OpenAIPlugin", () => {
  it.live("loads only visible API-supported ChatGPT models", () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch: (request) => {
              if (new URL(request.url).pathname === "/error/models") return new Response(null, { status: 503 })
              if (new URL(request.url).pathname === "/empty/models") return Response.json({ models: [] })
              expect(request.headers.get("authorization")).toBe("Bearer test-token")
              expect(request.headers.get("x-openai-chatpass-test")).toBe("codex-direct")
              return Response.json({
                models: [
                  {
                    slug: "gpt-5.6-sol",
                    display_name: "GPT-5.6-Sol",
                    visibility: "list",
                    supported_in_api: true,
                    context_window: 272_000,
                    input_modalities: ["text", "image"],
                    supported_reasoning_levels: [{ effort: "low" }],
                    model_messages: { base_instructions: "not retained" },
                  },
                  {
                    slug: "gpt-reserve",
                    display_name: "GPT-Reserve",
                    visibility: "hide",
                    supported_in_api: true,
                    context_window: 272_000,
                    input_modalities: ["text"],
                  },
                  {
                    slug: "not-in-api",
                    display_name: "Not in API",
                    visibility: "list",
                    supported_in_api: false,
                    context_window: 272_000,
                    input_modalities: ["text"],
                  },
                ],
              })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop()),
      )
      const baseURL = `http://localhost:${server.port}`
      expect(yield* fetchModels("test-token", App.make(), baseURL)).toEqual([
        {
          slug: "gpt-5.6-sol",
          display_name: "GPT-5.6-Sol",
          visibility: "list",
          supported_in_api: true,
          context_window: 272_000,
          input_modalities: ["text", "image"],
          supported_reasoning_levels: [{ effort: "low" }],
        },
      ])
      expect(yield* Effect.flip(fetchModels("test-token", App.make(), `${baseURL}/empty`))).toBeInstanceOf(Error)
      expect(yield* Effect.flip(fetchModels("test-token", App.make(), `${baseURL}/error`))).toBeInstanceOf(Error)
    }),
  )

  it.live("verifies a signed ID token against OpenAI's issuer, client ID, expiry, and sign-in nonce", () =>
    Effect.gen(function* () {
      const keys = yield* Effect.promise(() => generateKeyPair("RS256"))
      const publicKey = yield* Effect.promise(() => exportJWK(keys.publicKey))
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch: () => Response.json({ keys: [{ ...publicKey, kid: "sign-in", alg: "RS256", use: "sig" }] }),
          }),
        ),
        (server) => Effect.sync(() => server.stop()),
      )
      const jwksURL = new URL(`http://localhost:${server.port}/jwks`)
      const sign = (nonce: string, audience: string, expires: number, key = keys.privateKey) =>
        new SignJWT({ nonce })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://auth.openai.com")
          .setAudience(audience)
          .setSubject("user_123")
          .setExpirationTime(expires)
          .sign(key)
      const expires = Math.floor(Date.now() / 1000) + 60
      const valid = yield* Effect.promise(() => sign("expected", "oaiapp_issued", expires))
      yield* verifyIDToken(valid, "oaiapp_issued", "expected", jwksURL)
      const missingSubject = yield* Effect.promise(() =>
        new SignJWT({ nonce: "expected" })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://auth.openai.com")
          .setAudience("oaiapp_issued")
          .setExpirationTime(expires)
          .sign(keys.privateKey),
      )
      expect(yield* Effect.flip(verifyIDToken(missingSubject, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(
        Error,
      )
      const blankSubject = yield* Effect.promise(() =>
        new SignJWT({ nonce: "expected" })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://auth.openai.com")
          .setAudience("oaiapp_issued")
          .setSubject(" ")
          .setExpirationTime(expires)
          .sign(keys.privateKey),
      )
      expect(yield* Effect.flip(verifyIDToken(blankSubject, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(
        Error,
      )
      expect(yield* Effect.flip(verifyIDToken(valid, "oaiapp_issued", "wrong", jwksURL))).toBeInstanceOf(Error)
      expect(yield* Effect.flip(verifyIDToken(valid, "wrong-client", "expected", jwksURL))).toBeInstanceOf(Error)
      const wrongIssuer = yield* Effect.promise(() =>
        new SignJWT({ nonce: "expected" })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://someone-else.example")
          .setAudience("oaiapp_issued")
          .setSubject("user_123")
          .setExpirationTime(expires)
          .sign(keys.privateKey),
      )
      expect(yield* Effect.flip(verifyIDToken(wrongIssuer, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(Error)
      const noExpiry = yield* Effect.promise(() =>
        new SignJWT({ nonce: "expected" })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://auth.openai.com")
          .setAudience("oaiapp_issued")
          .setSubject("user_123")
          .sign(keys.privateKey),
      )
      expect(yield* Effect.flip(verifyIDToken(noExpiry, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(Error)
      const expired = yield* Effect.promise(() => sign("expected", "oaiapp_issued", expires - 120))
      expect(yield* Effect.flip(verifyIDToken(expired, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(Error)
      const other = yield* Effect.promise(() => generateKeyPair("RS256"))
      const forged = yield* Effect.promise(() => sign("expected", "oaiapp_issued", expires, other.privateKey))
      expect(yield* Effect.flip(verifyIDToken(forged, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(Error)
    }),
  )

  it.effect("registers the ChatGPT OAuth method", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      expect((yield* integrations.get(Integration.ID.make("openai")))?.methods).toEqual([
        {
          id: Integration.MethodID.make("chatgpt-browser"),
          type: "oauth",
          label: "Sign in with ChatGPT",
        },
      ])
    }),
  )

  for (const source of ["http", "stream"] as const) {
    it.effect(`stops retries for ChatGPT usage limits from ${source} failures`, () =>
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("chatgpt-browser"),
            access: "chatgpt-token",
            refresh: "refresh",
            expires: Date.now() + 60 * 60_000,
            metadata: { clientID: "oaiapp_issued" },
          }),
        })
        yield* addPlugin()
        const hooks = yield* PluginHooks.Service
        const body =
          source === "http"
            ? JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded" } })
            : JSON.stringify({
                type: "response.failed",
                response: { error: { code: "subscription_sharing_usage_limit_exceeded" } },
              })
        const cause = new AIError({
          reason: new RateLimitError({
            message: "Rate limit exceeded",
            body,
            ...(source === "http"
              ? { http: new HttpContext({ url: "https://api.openai.com/v1/responses", status: 429, headers: {} }) }
              : {}),
          }),
        })
        const decide = yield* SessionRunnerRetry.policy(Session.ID.make("ses_usage_limit"))
        const input = {
          cause,
          error: toSessionError(cause),
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
          hook: (event: PluginHooks.Domains["session"]["retry"]) =>
            hooks.trigger("session", "retry", event).pipe(Effect.asVoid),
          retry: SessionRunnerRetry.isRetryable(cause),
        }
        expect(input.error.response?.body).toBe(body)
        expect(input.retry).toBe(true)
        expect(yield* decide(input)).toEqual({ retry: false })

        const other = new AIError({ reason: new RateLimitError({ message: "Rate limit exceeded", body: "{}" }) })
        expect(yield* decide({ ...input, cause: other, error: toSessionError(other) })).toMatchObject({ retry: true })
      }),
    )
  }

  it.effect("leaves API-key OpenAI retries alone", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.Key.make({ type: "key", key: "sk-test" }),
      })
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const event = yield* hooks.trigger("session", "retry", {
        sessionID: Session.ID.make("ses_api_key_retry"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
        error: {
          type: "provider.rate-limit",
          message: "Rate limit exceeded",
          status: 429,
          response: { body: '{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}' },
        },
        attempt: 2,
        decision: { retry: true, delay: 1000 },
      })
      expect(event.decision).toEqual({ retry: true, delay: 1000 })
    }),
  )

  it.effect("stops deterministic ChatGPT stream failures while retrying temporary unavailability", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued" },
        }),
      })
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const decide = yield* SessionRunnerRetry.policy(Session.ID.make("ses_sharing_errors"))
      const cases = [
        ["subscription_sharing_v2_user_not_eligible", false],
        ["subscription_sharing_unsupported_capability", false],
        ["subscription_sharing_v2_client_not_enabled", false],
        ["subscription_sharing_v2_route_not_supported", false],
        ["subscription_sharing_v2_invalid_user", false],
        ["subscription_sharing_usage_unavailable", true],
        ["subscription_sharing_v2_user_unavailable", true],
      ] as const
      for (const [code, retry] of cases) {
        const cause = new AIError({
          reason: classifyProviderFailure({
            message: "Request failed",
            rawBody: JSON.stringify({ type: "response.failed", response: { error: { code } } }),
          }),
        })
        expect(SessionRunnerRetry.isRetryable(cause)).toBe(true)
        const decision = yield* decide({
          cause,
          error: toSessionError(cause),
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
          hook: (event) => hooks.trigger("session", "retry", event).pipe(Effect.asVoid),
          retry: true,
        })
        expect(decision.retry).toBe(retry)
      }
    }),
  )

  it.effect("registers a new ChatGPT agent on first sign-in with a loopback callback", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const url = yield* authorize()
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
      expect(`${url.origin}${url.pathname}`).toBe("https://auth.openai.com/api/accounts/authorize")
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        client_id: "dynamic_agent_client",
        agent_name_hint: "OpenCode",
        response_type: "code",
        scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        resource: "https://api.openai.com/v1",
        code_challenge_method: "S256",
      })
      expect(url.searchParams.get("state")).toBeTruthy()
      expect(url.searchParams.get("nonce")).toBeTruthy()
      expect(url.searchParams.get("code_challenge")).toBeTruthy()
      expect(redirect.hostname).toBe("localhost")
      expect(redirect.pathname).toBe("/auth/callback")
      expect(Number(redirect.port)).toBeGreaterThan(0)
    }),
  )

  it.live("waits to show browser success until the sign-in callback succeeds", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.oauth.connect({
        integrationID: Integration.ID.make("openai"),
        methodID: Integration.MethodID.make("chatgpt-browser"),
      })
      const authorization = new URL(attempt.url)
      const callback = new URL(authorization.searchParams.get("redirect_uri") ?? "")
      callback.searchParams.set("code", "test-code")
      callback.searchParams.set("state", authorization.searchParams.get("state") ?? "")
      const response = yield* Effect.promise(() => fetch(callback))
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.text())).toContain("did not return a client ID")
    }),
  )

  it.effect("reauthorizes with the client ID issued to an existing ChatGPT connection", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued" },
        }),
      })
      yield* addPlugin()
      const url = yield* authorize()
      expect(url.searchParams.get("client_id")).toBe("oaiapp_issued")
      expect(url.searchParams.has("agent_name_hint")).toBe(false)
    }),
  )

  it.effect("merges account models with catalog metadata and leaves input budgeting to compaction", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((editor) => {
        editor.update(Provider.ID.openai, (provider) => {
          provider.package = "@opencode/ai/providers/openai"
        })
        editor.models.update(Provider.ID.openai, Model.ID.make("gpt-5.6-sol"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
          model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
          model.variants = [
            { id: Model.VariantID.make("low"), settings: { reasoningEffort: "low" } },
            { id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } },
          ]
        })
        editor.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), () => {})
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: {
            clientID: "oaiapp_issued",
            models: [
              {
                slug: "gpt-5.6-sol",
                display_name: "GPT-5.6-Sol",
                visibility: "list",
                supported_in_api: true,
                context_window: 272_000,
                max_context_window: 872_000,
                input_modalities: ["text", "image"],
                supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }],
              },
              {
                slug: "gpt-6-future",
                display_name: "GPT-6-Future",
                visibility: "list",
                supported_in_api: true,
                context_window: 272_000,
                input_modalities: ["text"],
                supported_reasoning_levels: [],
              },
            ],
          },
        }),
      })
      yield* addPlugin()

      const available = (yield* models.available()).filter((model) => model.providerID === Provider.ID.openai)
      expect(available.map((model) => model.id).sort()).toEqual([
        Model.ID.make("gpt-5.6-sol"),
        Model.ID.make("gpt-6-future"),
      ])
      const sol = required(available.find((model) => model.id === "gpt-5.6-sol"))
      expect(sol.name).toBe("GPT-5.6-Sol")
      expect(sol.capabilities.input).toEqual(["text", "image"])
      expect(sol.variants.map((variant) => variant.id)).toEqual([
        Model.VariantID.make("low"),
        Model.VariantID.make("ultra"),
      ])
      expect(sol.limit).toEqual({ context: 272_000, output: 128_000 })
      expect(sol.cost).toEqual([])
      expect(sol.settings?.compaction).toEqual({ type: "summary" })
      const future = required(available.find((model) => model.id === "gpt-6-future"))
      expect(future.name).toBe("GPT-6-Future")
      expect(future.package).toBe("@opencode/ai/providers/openai")
      expect(future.limit).toEqual({ context: 272_000, output: 32_000 })
    }),
  )

  it.effect("routes ChatGPT connections to the Responses API over HTTP with codex-eligible models", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openai, (draft) => {
          draft.package = "@opencode/ai/providers/openai"
          draft.settings = { transport: "websocket" }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
          model.cost = [
            {
              input: Money.USDPerMillionTokens.make(1),
              output: Money.USDPerMillionTokens.make(2),
              cache: {
                read: Money.USDPerMillionTokens.make(0.1),
                write: Money.USDPerMillionTokens.zero,
              },
            },
          ]
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5-pro"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.4"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 64_000 }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.4-pro"), (model) => {
          model.modelID = Model.ID.make("gpt-5.4")
          model.body = { reasoning: { mode: "pro" } }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.6"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.6-sol"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-4.1"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-6-astra"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.10"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.04-astra"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-4.99"), () => {})
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
        }),
      })
      yield* addPlugin()

      const direct = yield* request(Provider.ID.openai, "https://api.openai.com/v1")

      const provider = required(yield* catalog.get(Provider.ID.openai))
      expect(provider.package).toBe("@opencode/ai/providers/openai")
      expect(provider.settings?.transport).toBe("http")
      expect(provider.settings?.baseURL).toBeUndefined()
      expect(provider.headers).toEqual({ "x-openai-chatpass-test": "codex-direct" })
      expect(direct.baseURL).toBe("https://api.openai.com/v1")
      expect(direct.headers).toEqual({})
      expect(direct.hasHttpHooks).toBe(false)
      const eligible = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.5")))
      expect(eligible.package).toBe("@opencode/ai/providers/openai")
      expect(eligible.headers).toEqual({ "x-openai-chatpass-test": "codex-direct" })
      expect(eligible.cost).toEqual([])
      expect(eligible.limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
      expect(eligible.enabled).toBe(true)
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.5-pro"))).enabled).toBe(false)
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.4-pro"))).enabled).toBe(false)
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.4"))).enabled).toBe(false)
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.6"))).enabled).toBe(false)
      const gpt56 = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.6-sol")))
      expect(gpt56.enabled).toBe(true)
      expect(gpt56.limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-4.1"))).enabled).toBe(false)
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-6-astra"))).enabled).toBe(true)
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.10"))).enabled).toBe(true)
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5"))).enabled).toBe(false)
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.04-astra"))).enabled).toBe(false)
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-4.99"))).enabled).toBe(false)
    }),
  )

  it.effect("keeps the full OpenAI catalog under an API key connection", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openai, (draft) => {
          draft.package = "@opencode/ai/providers/openai"
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-4.1"), () => {})
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.Key.make({ type: "key", key: "sk-test" }),
      })
      yield* addPlugin()

      const direct = yield* request(Provider.ID.openai, "https://api.openai.com/v1")

      const provider = required(yield* catalog.get(Provider.ID.openai))
      const model = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.5")))
      expect(model.package).toBe("@opencode/ai/providers/openai")
      expect(model.enabled).toBe(true)
      expect(model.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
      expect(provider.settings?.transport).toBe("websocket")
      expect(model.settings?.transport).toBeUndefined()
      expect(direct.baseURL).toBe("https://api.openai.com/v1")
      expect(direct.hasHttpHooks).toBe(false)
      expect(provider.headers).not.toHaveProperty("x-openai-chatpass-test")
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-4.1"))).enabled).toBe(true)
    }),
  )

  it.effect("omits the default output limit from OpenAI steps and compaction", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const maxTokens = (providerID: Provider.ID) =>
        Effect.gen(function* () {
          const draft = {
            sessionID: Session.ID.make("ses_test"),
            model: Model.Ref.make({ providerID, id: Model.ID.make("gpt-5.5") }),
            system: [],
            messages: [],
            options: { maxTokens: 128_000 },
          }
          const events = [
            yield* hooks.trigger("session", "context", { ...draft, agent: Agent.ID.make("build"), tools: {} }),
            yield* hooks.trigger("session", "compaction", { ...draft, agent: Agent.ID.make("build"), tools: {} }),
          ]
          return events.map((event) => event.options.maxTokens)
        })

      expect(yield* maxTokens(Provider.ID.openai)).toEqual([undefined, undefined])
      expect(yield* maxTokens(Provider.ID.azure)).toEqual([128_000, 128_000])
    }),
  )

  for (const connection of ["chatgpt", "key"] as const) {
    it.effect(`${connection} compaction uses plugin defaults but allows later model and variant overrides`, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        const credentials = yield* Credential.Service
        const providerID = Provider.ID.openai
        const baseID = Model.ID.make("gpt-5.5")
        const modelID = Model.ID.make("gpt-5.5-model")
        const variantID = Model.ID.make("gpt-5.5-variant")
        yield* catalog.transform((editor) => {
          editor.update(providerID, (provider) => {
            provider.package = "@opencode/ai/providers/openai/responses"
          })
          for (const id of [baseID, modelID, variantID])
            editor.models.update(providerID, id, (model) => {
              model.modelID = baseID
            })
          editor.models.update(providerID, modelID, (model) => {
            model.settings = { compaction: { type: "native" } }
          })
        })
        yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          value:
            connection === "chatgpt"
              ? Credential.OAuth.make({
                  type: "oauth",
                  methodID: Integration.MethodID.make("chatgpt-browser"),
                  access: "chatgpt-token",
                  refresh: "refresh",
                  expires: Date.now() + 60_000,
                })
              : Credential.Key.make({ type: "key", key: "sk-test" }),
        })
        yield* addPlugin()
        const resolver = yield* ModelResolver.Service
        const resolve = (id: Model.ID, variant?: Model.VariantID) =>
          models.get(providerID, id).pipe(
            Effect.flatMap((model) => resolver.resolveModel(required(model), variant)),
            Effect.map((result) => result.compaction),
          )

        expect(yield* resolve(baseID)).toEqual(connection === "chatgpt" ? { type: "summary" } : undefined)
        expect(yield* resolve(modelID)).toEqual({ type: connection === "chatgpt" ? "summary" : "native" })

        // A later provider default does not override the ChatGPT model policy.
        yield* catalog.transform((editor) => {
          editor.update(providerID, (provider) => {
            provider.settings = { compaction: { type: "native" } }
          })
        })
        expect(yield* resolve(baseID)).toEqual({ type: connection === "chatgpt" ? "summary" : "native" })

        yield* catalog.transform((editor) => {
          editor.update(providerID, (provider) => {
            provider.settings = { compaction: { type: "summary" } }
          })
        })
        yield* models.transform((editor) => {
          editor.update(providerID, modelID, (model) => {
            model.settings = { compaction: { type: "native" } }
          })
          editor.update(providerID, variantID, (model) => {
            model.settings = { compaction: { type: "summary" } }
            model.variants = [{ id: Model.VariantID.make("high"), settings: { compaction: { type: "native" } } }]
          })
        })
        expect(yield* resolve(baseID)).toEqual({ type: "summary" })
        expect(yield* resolve(modelID)).toEqual({ type: "native" })
        expect(yield* resolve(variantID, Model.VariantID.make("high"))).toEqual({ type: "native" })
      }).pipe(Effect.provide(ModelResolver.layer)),
    )
  }

  it.effect("selects WebSocket only from explicit policy", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.Key.make({ type: "key", key: "sk-test" }),
      })
      yield* addPlugin()
      yield* addGithubCopilotPlugin()
      const executor = { execute: () => Effect.die("unused WebSocket execution") }
      const transport = SessionModelTransport.Service.of({
        bind: () => executor,
        close: () => Effect.void,
        closeAll: Effect.void,
      })
      const sessionID = Session.ID.make("ses_websocket_hooks")
      const agentID = Agent.ID.make("build")
      const route = OpenAIResponses.route.with({
        id: "deployment-responses",
        provider: Provider.ID.azure,
      })
      const prepare = (preference?: Provider.Transport) =>
        Effect.gen(function* () {
          const model = SessionRunnerModel.resolved(route.model({ id: "gpt-5.5" }), {
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            cost: [],
            limit: { context: 200_000, output: 32_000 },
            transport: preference,
          })
          const requests = yield* SessionModelRequest.Service
          return yield* requests.primary({
            session: Session.Info.make({
              id: sessionID,
              projectID: Project.ID.global,
              cost: Money.USD.zero,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
              location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
            }),
            agent: agentID,
            model,
            tools: { definitions: [], execute: () => Effect.die("unused tool execution") },
            system: [],
            messages: [],
            webSocket: "session",
          })
        }).pipe(
          Effect.provide(SessionModelRequest.layer),
          Effect.provideService(SessionModelTransport.Service, transport),
        )

      const prepared = yield* prepare("websocket")
      const defaulted = yield* prepare()
      const disabled = yield* prepare("http")

      expect(prepared.options.webSocket).toBe(executor)
      expect(prepared.options.http).toBeUndefined()
      expect(defaulted.options.webSocket).toBeUndefined()
      expect(disabled.options.webSocket).toBeUndefined()
    }),
  )
})
