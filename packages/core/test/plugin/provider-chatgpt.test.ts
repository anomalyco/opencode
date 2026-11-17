import { Money } from "@opencode/schema/money"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/core/session"
import { OpenAIResponses } from "@opencode/ai/protocols/openai-responses"
import { ai, AIError, HttpContext, Message, RateLimitError } from "@opencode/ai/effect"
import { classifyProviderFailure } from "@opencode/ai/route"
import { compileRequest } from "@opencode/ai/testing"
import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Schedule } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { App } from "@opencode/core/app"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { GithubCopilotPlugin } from "@opencode/core/plugin/provider/github-copilot"
import { ChatGPTPlugin, fetchModels, verifyIDToken } from "@opencode/core/plugin/provider/chatgpt"
import { OpenAIPlugin } from "@opencode/core/plugin/provider/openai"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { advance, drain } from "../lib/clock"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const unavailableModels = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({}, { status: 503 }))),
)

const addPlugin = Effect.fn(function* (http = unavailableModels) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, ChatGPTPlugin.id)
  yield* ChatGPTPlugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
})

const addLegacyPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, OpenAIPlugin.id)
  yield* OpenAIPlugin.effect(host)
})

const addGithubCopilotPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "test")
  yield* GithubCopilotPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const remote = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  display_name: slug.toUpperCase(),
  visibility: "list",
  supported_in_api: true,
  context_window: 272_000,
  input_modalities: ["text"],
  ...extra,
})

const sharingCredential = (access: string) =>
  Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make("chatgpt-token-sharing"),
    access,
    refresh: "refresh",
    expires: Date.now() + 60 * 60_000,
    metadata: { clientID: "oaiapp_issued" },
  })

const fallback = ["gpt-5.5", "gpt-6.2-astra", "gpt-6.2-sol"]

const addCatalog = Effect.gen(function* () {
  const catalog = yield* Provider.Service
  yield* catalog.transform((editor) => {
    editor.update(Provider.ID.openai, (provider) => {
      provider.package = "@opencode/ai/providers/openai"
    })
    for (const id of [...fallback, "gpt-4.1"]) editor.models.update(Provider.ID.openai, Model.ID.make(id), () => {})
  })
})

const openaiModels = Effect.gen(function* () {
  const models = yield* Model.Service
  return (yield* models.available())
    .filter((model) => model.providerID === Provider.ID.openai)
    .map((model) => String(model.id))
    .sort()
})

// Account lists arrive through background fibers and provider reloads, which need real turns but no timers.
const until = <E, R>(check: Effect.Effect<boolean, E, R>) =>
  Effect.gen(function* () {
    const deadline = performance.now() + 15_000
    while (!(yield* check)) {
      if (performance.now() > deadline) return yield* Effect.die(new Error("condition never became true within 15s"))
      yield* TestClock.withLive(Effect.sleep("1 millis"))
    }
  })

const authorize = Effect.fn(function* () {
  const integrations = yield* Integration.Service
  const integrationID = Integration.ID.make("openai")
  const attempt = yield* integrations.oauth.connect({
    integrationID,
    methodID: Integration.MethodID.make("chatgpt-token-sharing"),
  })
  yield* integrations.oauth.cancel({ integrationID, attemptID: attempt.attemptID })
  return new URL(attempt.url)
})

const request = Effect.fn(function* (
  providerID: Provider.ID,
  baseURL: string,
  sessionID = Session.ID.make("ses_test"),
) {
  const hooks = yield* PluginHooks.Service
  const event = yield* hooks.trigger("session", "model.request", {
    sessionID,
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

describe("ChatGPTPlugin", () => {
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
              expect(request.headers.has("x-openai-chatpass-test")).toBe(false)
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
          id: Integration.MethodID.make("chatgpt-token-sharing"),
          type: "oauth",
          label: "Sign in with ChatGPT",
        },
      ])
    }),
  )

  it.effect("keeps the Codex browser and headless methods alongside token sharing", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      yield* addLegacyPlugin()
      const integrations = yield* Integration.Service
      expect(
        (yield* integrations.get(Integration.ID.make("openai")))?.methods.map(
          (method) => method.type === "oauth" && method.id,
        ),
      ).toEqual([
        Integration.MethodID.make("chatgpt-token-sharing"),
        Integration.MethodID.make("chatgpt-browser"),
        Integration.MethodID.make("chatgpt-headless"),
      ])
    }),
  )

  for (const [source, code] of [
    ["http", "subscription_sharing_usage_limit_exceeded"],
    ["stream", "subscription_sharing_usage_limit_exceeded"],
    ["http", "subscription_sharing_workplace_individual_usage_limit_exceeded"],
  ] as const) {
    it.effect(`stops retries for ${code} from ${source} failures`, () =>
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("chatgpt-token-sharing"),
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
            ? JSON.stringify({ error: { code } })
            : JSON.stringify({
                type: "response.failed",
                response: { error: { code } },
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
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
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
        ["subscription_sharing_user_not_eligible", false],
        ["subscription_sharing_unsupported_capability", false],
        ["subscription_sharing_route_not_supported", false],
        ["subscription_sharing_invalid_user", false],
        ["chatpass_v2_scope_not_authorized", false],
        ["chatpass_v2_invalid_authorization_context", false],
        ["subscription_sharing_usage_unavailable", true],
        ["subscription_sharing_user_unavailable", true],
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
      const hostID = url.searchParams.get("ext_agent_host_id")
      expect(hostID).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      const kv = yield* KV.Service
      const storage = PluginHost.storage(kv, ChatGPTPlugin.id)
      expect(yield* storage.get("chatgpt-agent-host-id")).toBe(hostID)
      expect((yield* authorize()).searchParams.get("ext_agent_host_id")).toBe(hostID)
      expect(redirect.hostname).toBe("127.0.0.1")
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
        methodID: Integration.MethodID.make("chatgpt-token-sharing"),
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
      const kv = yield* KV.Service
      const hostID = "urn:uuid:00000000-0000-4000-8000-000000000000"
      yield* PluginHost.storage(kv, ChatGPTPlugin.id).set("chatgpt-agent-host-id", hostID)
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
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
      expect(url.searchParams.get("ext_agent_host_id")).toBe(hostID)
      expect(new URL(url.searchParams.get("redirect_uri") ?? "").hostname).toBe("127.0.0.1")
    }),
  )

  it.live("rejects a reauthorization callback that returns a different client ID", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued" },
        }),
      })
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.oauth.connect({
        integrationID: Integration.ID.make("openai"),
        methodID: Integration.MethodID.make("chatgpt-token-sharing"),
      })
      const authorization = new URL(attempt.url)
      expect(authorization.searchParams.get("client_id")).toBe("oaiapp_issued")
      const callback = new URL(authorization.searchParams.get("redirect_uri") ?? "")
      callback.searchParams.set("code", "test-code")
      callback.searchParams.set("state", authorization.searchParams.get("state") ?? "")
      callback.searchParams.set("client_id", "oaiapp_other")
      const response = yield* Effect.promise(() => fetch(callback))
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.text())).toContain("different client")
      expect(yield* credentials.list(Integration.ID.make("openai"))).toHaveLength(1)
    }),
  )

  it.effect("moves only token-sharing credentials to the new method ID without keeping their saved models", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const legacy = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "codex-token",
          refresh: "codex-refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { accountID: "acct_123" },
        }),
      })
      const sharing = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "sharing-token",
          refresh: "sharing-refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued", models: [remote("gpt-5.5")] },
        }),
      })

      yield* addPlugin()
      expect((yield* credentials.get(legacy.id))?.value).toMatchObject({ methodID: "chatgpt-browser" })
      const migrated = (yield* credentials.get(sharing.id))?.value
      expect(migrated).toMatchObject({
        methodID: "chatgpt-token-sharing",
        access: "sharing-token",
        metadata: { clientID: "oaiapp_issued" },
      })
      expect(migrated?.type === "oauth" ? migrated.metadata : undefined).not.toHaveProperty("models")
      expect(yield* PluginHost.storage(kv, ChatGPTPlugin.id).get(`models:${sharing.id}:oaiapp_issued`)).toBeUndefined()
    }),
  )

  it.effect("merges account models with catalog metadata and leaves input budgeting to compaction", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      yield* catalog.transform((editor) => {
        editor.update(Provider.ID.openai, (provider) => {
          provider.package = "@opencode/ai/providers/openai"
        })
        editor.models.update(Provider.ID.openai, Model.ID.make("gpt-6.2-sol"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
          model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
          model.variants = [
            { id: Model.VariantID.make("low"), settings: { reasoningEffort: "low" } },
            { id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } },
          ]
        })
        editor.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), () => {})
      })
      const sharing = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: sharingCredential("chatgpt-token"),
      })
      yield* PluginHost.storage(kv, ChatGPTPlugin.id).set(`models:${sharing.id}:oaiapp_issued`, [
        remote("gpt-6.2-sol", {
          input_modalities: ["text", "image"],
          supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }],
        }),
        remote("gpt-6.3-nova", { supported_reasoning_levels: [] }),
      ])
      // The startup refresh fails, so the saved list stays.
      yield* addPlugin()
      yield* drain

      const available = (yield* models.available()).filter((model) => model.providerID === Provider.ID.openai)
      expect(available.map((model) => model.id).sort()).toEqual([
        Model.ID.make("gpt-6.2-sol"),
        Model.ID.make("gpt-6.3-nova"),
      ])
      const sol = required(available.find((model) => model.id === "gpt-6.2-sol"))
      expect(sol.name).toBe("GPT-6.2-SOL")
      expect(sol.capabilities.input).toEqual(["text", "image"])
      expect(sol.variants.map((variant) => variant.id)).toEqual([
        Model.VariantID.make("low"),
        Model.VariantID.make("ultra"),
      ])
      expect(sol.limit).toEqual({ context: 272_000, output: 128_000 })
      expect(sol.cost).toEqual([])
      expect(sol.settings?.compaction).toEqual({ type: "summary" })
      const nova = required(available.find((model) => model.id === "gpt-6.3-nova"))
      expect(nova.name).toBe("GPT-6.3-NOVA")
      expect(nova.package).toBe("@opencode/ai/providers/openai")
      expect(nova.limit).toEqual({ context: 272_000, output: 32_000 })
    }),
  )

  it.effect("shows the fallback list while a new sign-in discovers its models, then saves only listed API models", () =>
    Effect.gen(function* () {
      yield* addCatalog
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const release = yield* Deferred.make<void>()
      const requests: string[] = []
      yield* addPlugin(
        HttpClient.make((request) =>
          Effect.gen(function* () {
            requests.push(`${request.url} ${request.headers.authorization}`)
            yield* Deferred.await(release)
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                models: [
                  remote("gpt-6.2-sol"),
                  remote("gpt-6.3-nova"),
                  remote("gpt-reserve", { visibility: "hide" }),
                  remote("codex-auto-review", { supported_in_api: false }),
                ],
              }),
            )
          }),
        ),
      )
      const sharing = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: sharingCredential("chatgpt-token"),
      })
      yield* advance(() => requests.length > 0)
      // The startup refresh may also see the new credential, so expect one or two identical requests.
      expect(new Set(requests)).toEqual(new Set(["https://api.openai.com/v1/models Bearer chatgpt-token"]))
      expect(yield* openaiModels).toEqual(fallback)
      const storage = PluginHost.storage(kv, ChatGPTPlugin.id)
      expect(yield* storage.get(`models:${sharing.id}:oaiapp_issued`)).toBeUndefined()

      yield* Deferred.succeed(release, undefined)
      yield* until(openaiModels.pipe(Effect.map((ids) => ids.join() === "gpt-6.2-sol,gpt-6.3-nova")))
      expect(yield* storage.get(`models:${sharing.id}:oaiapp_issued`)).toEqual([
        remote("gpt-6.2-sol"),
        remote("gpt-6.3-nova"),
      ])
    }),
  )

  it.effect("keeps the last good account list when a refresh fails, times out or returns no usable models", () =>
    Effect.gen(function* () {
      yield* addCatalog
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const first = [remote("gpt-6.2-sol"), remote("gpt-6.3-nova")]
      const responses: ReadonlyArray<Effect.Effect<Response>> = [
        Effect.succeed(Response.json({ models: first })),
        Effect.succeed(Response.json({ models: [] })),
        Effect.succeed(
          Response.json({
            models: [remote("gpt-reserve", { visibility: "hide" }), remote("codex", { supported_in_api: false })],
          }),
        ),
        Effect.succeed(Response.json({}, { status: 503 })),
        Effect.succeed(Response.json({ models: [{ slug: "gpt-6.2-sol" }] })),
        Effect.never,
        Effect.succeed(Response.json({ models: [remote("gpt-6.2-astra"), remote("gpt-6.2-sol")] })),
      ]
      let requests = 0
      const sharing = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: sharingCredential("chatgpt-token"),
      })
      yield* addPlugin(
        HttpClient.make((request) =>
          Effect.suspend(() => required(responses[requests++])).pipe(
            Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
          ),
        ),
      )
      const storage = PluginHost.storage(kv, ChatGPTPlugin.id)
      yield* until(openaiModels.pipe(Effect.map((ids) => ids.join() === "gpt-6.2-sol,gpt-6.3-nova")))
      expect(yield* storage.get(`models:${sharing.id}:oaiapp_issued`)).toEqual(first)

      // Empty, filtered to empty, 503 and bad bodies, then a request that never answers.
      for (const count of [2, 3, 4, 5, 6]) {
        yield* TestClock.adjust("15 minutes")
        yield* advance(() => requests === count)
        if (count === 6) yield* TestClock.adjust("15 seconds")
        yield* drain
        expect(yield* openaiModels).toEqual(["gpt-6.2-sol", "gpt-6.3-nova"])
        expect(yield* storage.get(`models:${sharing.id}:oaiapp_issued`)).toEqual(first)
      }

      yield* TestClock.adjust("15 minutes")
      yield* until(openaiModels.pipe(Effect.map((ids) => ids.join() === "gpt-6.2-astra,gpt-6.2-sol")))
      expect(yield* storage.get(`models:${sharing.id}:oaiapp_issued`)).toEqual([
        remote("gpt-6.2-astra"),
        remote("gpt-6.2-sol"),
      ])
    }),
  )

  it.effect("keeps the fallback list until a first refresh succeeds and never saves an unusable response", () =>
    Effect.gen(function* () {
      yield* addCatalog
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const responses = [
        Response.json({ models: [] }),
        Response.json({}, { status: 503 }),
        Response.json({ models: [remote("gpt-6.2-sol")] }),
      ]
      let requests = 0
      const sharing = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: sharingCredential("chatgpt-token"),
      })
      yield* addPlugin(
        HttpClient.make((request) =>
          Effect.sync(() => HttpClientResponse.fromWeb(request, required(responses[requests++]))),
        ),
      )
      const storage = PluginHost.storage(kv, ChatGPTPlugin.id)
      yield* advance(() => requests === 1)
      yield* drain
      expect(yield* openaiModels).toEqual(fallback)
      yield* TestClock.adjust("15 minutes")
      yield* advance(() => requests === 2)
      yield* drain
      expect(yield* openaiModels).toEqual(fallback)
      expect(yield* storage.get(`models:${sharing.id}:oaiapp_issued`)).toBeUndefined()

      yield* TestClock.adjust("15 minutes")
      yield* until(openaiModels.pipe(Effect.map((ids) => ids.join() === "gpt-6.2-sol")))
    }),
  )

  it.effect("never shows one account's models under another account", () =>
    Effect.gen(function* () {
      yield* addCatalog
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const gate = yield* Deferred.make<void>()
      const requests: string[] = []
      const first = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: sharingCredential("first-token"),
      })
      yield* addPlugin(
        HttpClient.make((request) =>
          Effect.gen(function* () {
            const token = request.headers.authorization
            requests.push(token)
            // The first account's startup refresh answers only after the switch, and later ones never answer.
            if (token === "Bearer first-token") yield* requests.length === 1 ? Deferred.await(gate) : Effect.never
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                models: [remote(token === "Bearer first-token" ? "gpt-6.3-nova" : "gpt-6.2-astra")],
              }),
            )
          }),
        ),
      )
      yield* advance(() => requests.length === 1)
      const second = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: sharingCredential("second-token"),
      })
      yield* until(openaiModels.pipe(Effect.map((ids) => ids.join() === "gpt-6.2-astra")))

      yield* Deferred.succeed(gate, undefined)
      yield* drain
      expect(yield* openaiModels).toEqual(["gpt-6.2-astra"])
      const storage = PluginHost.storage(kv, ChatGPTPlugin.id)
      expect(yield* storage.get(`models:${first.id}:oaiapp_issued`)).toBeUndefined()
      expect(yield* storage.get(`models:${second.id}:oaiapp_issued`)).toEqual([remote("gpt-6.2-astra")])

      yield* credentials.activate(first.id)
      yield* advance(() => requests.filter((token) => token === "Bearer first-token").length === 2)
      yield* drain
      expect(yield* openaiModels).toEqual(fallback)
      yield* credentials.activate(second.id)
      yield* until(openaiModels.pipe(Effect.map((ids) => ids.join() === "gpt-6.2-astra")))
    }),
  )

  it.effect("routes ChatGPT over HTTP with only the listed catalog fallback models", () =>
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
        for (const id of [
          "gpt-5.5-fast",
          "gpt-5.6-luna",
          "gpt-5.6-luna-fast",
          "gpt-5.6-sol-fast",
          "gpt-5.6-terra",
          "gpt-5.6-terra-fast",
          "gpt-6-astra-fast",
          "gpt-6-luna",
          "gpt-6-luna-fast",
          "gpt-6-sol",
          "gpt-6-sol-fast",
          "gpt-6.1-sol",
          "gpt-6.1-sol-fast",
          "gpt-6.1-terra",
          "gpt-6.1-terra-fast",
        ])
          catalog.models.update(Provider.ID.openai, Model.ID.make(id), () => {})
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
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
      expect(provider.settings?.baseURL).toBe("https://api.openai.com/v1")
      expect(provider.headers).not.toHaveProperty("x-openai-chatpass-test")
      expect(direct.baseURL).toBe("https://api.openai.com/v1")
      expect(direct.headers).toEqual({
        "session-id": "ses_test",
        "thread-id": "ses_test",
        "x-client-request-id": "ses_test",
      })
      expect(direct.hasHttpHooks).toBe(false)
      const sessions = yield* Session.Service
      const location = yield* Location.Service
      const parent = yield* sessions.create({ location: { directory: location.directory } })
      const child = yield* sessions.create({ parentID: parent.id })
      expect((yield* request(Provider.ID.openai, "https://api.openai.com/v1", child.id)).headers).toEqual({
        "session-id": parent.id,
        "thread-id": child.id,
        "x-client-request-id": child.id,
      })
      const eligible = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.5")))
      expect(eligible.package).toBe("@opencode/ai/providers/openai")
      expect(eligible.headers).not.toHaveProperty("x-openai-chatpass-test")
      expect(eligible.cost).toEqual([])
      expect(eligible.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
      expect(eligible.enabled).toBe(true)
      const gpt56 = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.6-sol")))
      expect(gpt56.enabled).toBe(true)
      expect(gpt56.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-6-astra"))).enabled).toBe(true)
      for (const id of [
        "gpt-5.5-pro",
        "gpt-5.4-pro",
        "gpt-5.4",
        "gpt-5.6",
        "gpt-4.1",
        "gpt-5.10",
        "gpt-5",
        "gpt-5.04-astra",
        "gpt-4.99",
      ])
        expect(yield* models.get(Provider.ID.openai, Model.ID.make(id))).toBeUndefined()
      expect(
        (yield* models.available())
          .filter((model) => model.providerID === Provider.ID.openai)
          .map((model) => model.id)
          .sort(),
      ).toEqual(
        [
          "gpt-5.5",
          "gpt-5.5-fast",
          "gpt-5.6-luna",
          "gpt-5.6-luna-fast",
          "gpt-5.6-sol",
          "gpt-5.6-sol-fast",
          "gpt-5.6-terra",
          "gpt-5.6-terra-fast",
          "gpt-6-astra",
          "gpt-6-astra-fast",
          "gpt-6-luna",
          "gpt-6-luna-fast",
          "gpt-6-sol",
          "gpt-6-sol-fast",
          "gpt-6.1-sol",
          "gpt-6.1-sol-fast",
          "gpt-6.1-terra",
          "gpt-6.1-terra-fast",
        ].map((id) => Model.ID.make(id)),
      )
    }),
  )

  it.effect("keeps the token-sharing safeguards when the token cannot be refreshed at load", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openai, (draft) => {
          draft.package = "@opencode/ai/providers/openai"
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-6-astra"), () => {})
      })
      // An expired token without a registered client ID cannot be refreshed.
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "stale-token",
          refresh: "refresh",
          expires: 1,
        }),
      })
      yield* addPlugin()
      yield* addLegacyPlugin()

      const provider = required(yield* catalog.get(Provider.ID.openai))
      expect(provider.settings?.transport).toBe("http")
      expect(provider.settings?.compaction).toEqual({ type: "summary" })
      const model = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-6-astra")))
      expect(model.compatibility?.supportsEffortUpdates).toBe(false)
      expect(model.settings?.compaction).toEqual({ type: "summary" })
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
      yield* addLegacyPlugin()

      const direct = yield* request(Provider.ID.openai, "https://api.openai.com/v1")

      const provider = required(yield* catalog.get(Provider.ID.openai))
      const model = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.5")))
      expect(model.package).toBe("@opencode/ai/providers/openai")
      expect(model.enabled).toBe(true)
      expect(model.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
      expect(provider.settings?.transport).toBe("websocket")
      expect(model.settings?.transport).toBeUndefined()
      expect(direct.baseURL).toBe("https://api.openai.com/v1")
      expect(direct.headers).toEqual({})
      expect(direct.hasHttpHooks).toBe(false)
      expect(provider.headers).not.toHaveProperty("x-openai-chatpass-test")
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-4.1"))).enabled).toBe(true)
    }),
  )

  it.live("switches between token-sharing and Codex credentials without mixing their routes", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      yield* catalog.transform((editor) => {
        editor.update(Provider.ID.openai, (provider) => {
          provider.package = "@opencode/ai/providers/openai"
        })
        editor.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), () => {})
      })
      const legacy = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "codex-token",
          refresh: "codex-refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { accountID: "acct_123" },
        }),
      })
      yield* PluginHost.storage(kv, ChatGPTPlugin.id).set("models:oaiapp_issued", [
        {
          slug: "gpt-5.5",
          display_name: "GPT-5.5",
          visibility: "list",
          supported_in_api: true,
          context_window: 272_000,
          input_modalities: ["text"],
        },
      ])
      const sharing = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "sharing-token",
          refresh: "sharing-refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued" },
        }),
      })
      yield* addPlugin()
      yield* addLegacyPlugin()
      expect((yield* catalog.get(Provider.ID.openai))?.settings?.baseURL).toBe("https://api.openai.com/v1")

      yield* credentials.activate(legacy.id)
      const codex = yield* catalog.get(Provider.ID.openai).pipe(
        Effect.repeat({
          until: (item) => item?.settings?.baseURL === "https://chatgpt.com/backend-api/codex",
          schedule: Schedule.spaced("10 millis"),
        }),
        Effect.timeout("2 seconds"),
      )
      expect(codex?.headers?.["chatgpt-account-id"]).toBe("acct_123")

      yield* credentials.activate(sharing.id)
      const direct = yield* catalog.get(Provider.ID.openai).pipe(
        Effect.repeat({
          until: (item) => item?.settings?.baseURL === "https://api.openai.com/v1",
          schedule: Schedule.spaced("10 millis"),
        }),
        Effect.timeout("2 seconds"),
      )
      expect(direct?.settings?.transport).toBe("http")
      expect(direct?.headers?.["chatgpt-account-id"]).toBeUndefined()
    }),
  )

  it.effect("omits the default output limit from OpenAI steps and compaction", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      yield* addLegacyPlugin()
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
        const modelID = Model.ID.make("gpt-5.6-sol")
        const variantID = Model.ID.make("gpt-6-astra")
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
                  methodID: Integration.MethodID.make("chatgpt-token-sharing"),
                  access: "chatgpt-token",
                  refresh: "refresh",
                  expires: Date.now() + 60_000,
                  metadata: { clientID: "oaiapp_issued" },
                })
              : Credential.Key.make({ type: "key", key: "sk-test" }),
        })
        yield* addPlugin()
        yield* addLegacyPlugin()
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

  for (const connection of ["chatgpt", "key"] as const) {
    it.effect(`${connection} sends mid-session reasoning effort switches in a form its backend accepts`, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        const credentials = yield* Credential.Service
        const modelID = Model.ID.make("gpt-6.1-sol")
        yield* catalog.transform((editor) => {
          editor.update(Provider.ID.openai, (provider) => {
            provider.package = "@opencode/ai/providers/openai"
          })
          editor.models.update(Provider.ID.openai, modelID, (model) => {
            model.variants = ["high", "max"].map((effort) => ({
              id: Model.VariantID.make(effort),
              settings: { reasoningEffort: effort },
            }))
          })
        })
        yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          value:
            connection === "chatgpt"
              ? Credential.OAuth.make({
                  type: "oauth",
                  methodID: Integration.MethodID.make("chatgpt-token-sharing"),
                  access: "chatgpt-token",
                  refresh: "refresh",
                  expires: Date.now() + 60_000,
                  metadata: { clientID: "oaiapp_issued" },
                })
              : Credential.Key.make({ type: "key", key: "sk-test" }),
        })
        yield* addPlugin()
        yield* addLegacyPlugin()
        const resolver = yield* ModelResolver.Service
        const model = required(yield* models.get(Provider.ID.openai, modelID))
        const body = (variant: string, messages: ReadonlyArray<Message>) =>
          resolver.resolveModel(model, Model.VariantID.make(variant)).pipe(
            Effect.flatMap((resolved) => compileRequest(ai.request({ model: resolved.model, messages }))),
            Effect.map((compiled) => compiled.body),
          )
        const switched = [
          Message.user("a"),
          Message.assistant("b"),
          Message.effort({ effort: "max", previous: "high" }),
          Message.user("c"),
        ]
        const switchedBack = [
          ...switched,
          Message.assistant("d"),
          Message.effort({ effort: "high", previous: "max" }),
          Message.user("e"),
        ]
        const user = (text: string) => ({ role: "user", content: [{ type: "input_text", text }] })
        const assistant = (text: string) => ({ role: "assistant", content: [{ type: "output_text", text }] })
        const update = (effort: string) => ({ type: "configuration_update", reasoning: { effort } })

        expect([yield* body("max", switched), yield* body("high", switchedBack)]).toMatchObject(
          {
            chatgpt: [
              { reasoning: { effort: "max" }, input: [user("a"), assistant("b"), user("c")] },
              {
                reasoning: { effort: "high" },
                input: [user("a"), assistant("b"), user("c"), assistant("d"), user("e")],
              },
            ],
            key: [
              { reasoning: { effort: "high" }, input: [user("a"), assistant("b"), update("max"), user("c")] },
              {
                reasoning: { effort: "high" },
                input: [user("a"), assistant("b"), update("max"), user("c"), assistant("d"), update("high"), user("e")],
              },
            ],
          }[connection],
        )
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
