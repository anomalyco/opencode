import { Money } from "@opencode/schema/money"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/core/session"
import { OpenAIResponses } from "@opencode/ai/protocols/openai-responses"
import { AIError, RateLimitError } from "@opencode/ai"
import { describe, expect } from "bun:test"
import { ConfigProvider, DateTime, Effect } from "effect"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { Credential } from "@opencode/core/credential"
import { App } from "@opencode/core/app"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { GithubCopilotPlugin } from "@opencode/core/plugin/provider/github-copilot"
import { OpenAIPlugin, fetchSharingModels, verifySharingIDToken } from "@opencode/core/plugin/provider/openai"
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

describe("OpenAIPlugin", () => {
  it.effect("registers ChatGPT token sharing without replacing either Codex OAuth method", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      expect((yield* integrations.get(Integration.ID.make("openai")))?.methods).toEqual([
        {
          id: Integration.MethodID.make("chatgpt-token-sharing"),
          type: "oauth",
          label: "Sign in with ChatGPT",
        },
        {
          id: Integration.MethodID.make("chatgpt-browser"),
          type: "oauth",
          label: "ChatGPT Pro/Plus (browser)",
        },
        {
          id: Integration.MethodID.make("chatgpt-headless"),
          type: "oauth",
          label: "ChatGPT Pro/Plus (headless)",
        },
      ])
    }),
  )

  it.effect("stops deterministic SIWC retries for both HTTP and stream failures", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "sharing-token",
          refresh: "refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued" },
        }),
      })
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const codes = [
        "subscription_sharing_usage_limit_exceeded",
        "subscription_sharing_v2_user_not_eligible",
        "subscription_sharing_unsupported_capability",
        "subscription_sharing_v2_client_not_enabled",
        "subscription_sharing_v2_route_not_supported",
        "subscription_sharing_v2_invalid_user",
      ]
      for (const code of codes) {
        for (const body of [
          JSON.stringify({ error: { code } }),
          JSON.stringify({ type: "response.failed", response: { error: { code } } }),
        ]) {
          const cause = new AIError({ reason: new RateLimitError({ message: "Rate limit exceeded", body }) })
          const decide = yield* SessionRunnerRetry.policy(Session.ID.make("ses_sharing_retry"))
          expect(
            yield* decide({
              cause,
              error: toSessionError(cause),
              agent: Agent.ID.make("build"),
              model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
              hook: (event) => hooks.trigger("session", "retry", event).pipe(Effect.asVoid),
              retry: SessionRunnerRetry.isRetryable(cause),
            }),
          ).toEqual({ retry: false })
        }
      }
      for (const code of ["subscription_sharing_usage_unavailable", "subscription_sharing_v2_user_unavailable"]) {
        const event = yield* hooks.trigger("session", "retry", {
          sessionID: Session.ID.make("ses_sharing_retry"),
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
          error: {
            type: "provider.rate-limit",
            message: "Temporary",
            response: { body: JSON.stringify({ error: { code } }) },
          },
          attempt: 2,
          decision: { retry: true, delay: 1000 },
        })
        expect(event.decision).toEqual({ retry: true, delay: 1000 })
      }
    }),
  )

  for (const method of ["chatgpt-browser", "chatgpt-headless", "key"] as const) {
    it.effect(`does not change ${method} retries for sharing errors`, () =>
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          value:
            method === "key"
              ? Credential.Key.make({ type: "key", key: "sk-test" })
              : Credential.OAuth.make({
                  type: "oauth",
                  methodID: Integration.MethodID.make(method),
                  access: "codex-token",
                  refresh: "refresh",
                  expires: Date.now() + 60 * 60_000,
                }),
        })
        yield* addPlugin()
        const hooks = yield* PluginHooks.Service
        const event = yield* hooks.trigger("session", "retry", {
          sessionID: Session.ID.make("ses_codex_retry"),
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
          error: {
            type: "provider.rate-limit",
            message: "Rate limit exceeded",
            response: { body: '{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}' },
          },
          attempt: 2,
          decision: { retry: true, delay: 1000 },
        })
        expect(event.decision).toEqual({ retry: true, delay: 1000 })
      }),
    )
  }

  it.live("registers a user-owned ChatGPT agent with a separate IPv4 callback", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const signIn = yield* integrations.oauth.connect({
        integrationID: Integration.ID.make("openai"),
        methodID: Integration.MethodID.make("chatgpt-token-sharing"),
      })
      const url = new URL(signIn.url)
      const callback = new URL(url.searchParams.get("redirect_uri") ?? "")
      expect(`${url.origin}${url.pathname}`).toBe("https://auth.openai.com/api/accounts/authorize")
      expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client")
      expect(url.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct")
      expect(url.searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:/)
      expect(url.searchParams.get("nonce")).toBeTruthy()
      expect(callback.hostname).toBe("127.0.0.1")
      expect(Number(callback.port)).toBeGreaterThan(0)
      yield* integrations.oauth.cancel({ integrationID: Integration.ID.make("openai"), attemptID: signIn.attemptID })

      const codex = yield* integrations.oauth.connect({
        integrationID: Integration.ID.make("openai"),
        methodID: Integration.MethodID.make("chatgpt-browser"),
      })
      expect(new URL(codex.url).pathname).toBe("/oauth/authorize")
      yield* integrations.oauth.cancel({ integrationID: Integration.ID.make("openai"), attemptID: codex.attemptID })
    }),
  )

  it.live("discovers only visible ChatGPT Responses models", () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch: (request) =>
              new URL(request.url).pathname === "/error/models"
                ? new Response(null, { status: 500 })
                : Response.json({
                    models: [
                      {
                        slug: "gpt-visible",
                        display_name: "Visible",
                        visibility: "list",
                        supported_in_api: true,
                        context_window: 272_000,
                        input_modalities: ["text"],
                      },
                      {
                        slug: "gpt-hidden",
                        display_name: "Hidden",
                        visibility: "hide",
                        supported_in_api: true,
                        context_window: 272_000,
                        input_modalities: ["text"],
                      },
                    ],
                  }),
          }),
        ),
        (server) => Effect.sync(() => server.stop()),
      )
      expect(
        (yield* fetchSharingModels("test-token", App.make(), `http://127.0.0.1:${server.port}`)).map(
          (model) => model.slug,
        ),
      ).toEqual(["gpt-visible"])
      expect(
        String(
          yield* Effect.flip(fetchSharingModels("test-token", App.make(), `http://127.0.0.1:${server.port}/error`)),
        ),
      ).toContain("ChatGPT model discovery failed: Error: Request failed: 500")
    }),
  )

  it.live("verifies the ChatGPT ID token signature, client ID, and sign-in nonce", () =>
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
      const jwksURL = new URL(`http://127.0.0.1:${server.port}/jwks`)
      const sign = (nonce: string, audience: string) =>
        new SignJWT({ nonce })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://auth.openai.com")
          .setAudience(audience)
          .setSubject("user_123")
          .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
          .sign(keys.privateKey)
      const valid = yield* Effect.promise(() => sign("expected", "oaiapp_issued"))
      yield* verifySharingIDToken(valid, "oaiapp_issued", "expected", jwksURL)
      expect(yield* Effect.flip(verifySharingIDToken(valid, "wrong-client", "expected", jwksURL))).toBeInstanceOf(Error)
      expect(yield* Effect.flip(verifySharingIDToken(valid, "oaiapp_issued", "wrong-nonce", jwksURL))).toBeInstanceOf(
        Error,
      )
    }),
  )

  it.effect("uses account-visible models and HTTP without changing Codex routing", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((editor) => {
        editor.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), () => {})
        editor.models.update(Provider.ID.openai, Model.ID.make("gpt-4.1"), () => {})
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "sharing-token",
          refresh: "sharing-refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: {
            clientID: "oaiapp_issued",
            models: [
              {
                slug: "gpt-4.1",
                display_name: "GPT-4.1",
                visibility: "list",
                supported_in_api: true,
                context_window: 128_000,
                input_modalities: ["text", "image"],
              },
            ],
          },
        }),
      })
      yield* addPlugin()
      const provider = required(yield* catalog.get(Provider.ID.openai))
      expect(provider.settings?.transport).toBe("http")
      expect(provider.settings?.baseURL).toBeUndefined()
      expect(provider.headers).not.toHaveProperty("x-codex-beta-features")
      expect((yield* request(Provider.ID.openai, "https://api.openai.com/v1")).baseURL).toBe(
        "https://api.openai.com/v1",
      )
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-4.1")))).toMatchObject({
        enabled: true,
        cost: [],
        limit: { context: 128_000 },
      })
      expect(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.5"))).toBeUndefined()
    }),
  )

  it.effect("filters the OpenAI catalog to codex-eligible models under a ChatGPT connection", () =>
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
          metadata: { accountID: "acct_123" },
        }),
      })
      yield* addPlugin()

      const direct = yield* request(Provider.ID.openai, "https://api.openai.com/v1")
      const custom = yield* request(Provider.ID.make("custom-openai"), "https://custom.example/v1")
      const proxy = yield* request(Provider.ID.openai, "https://proxy.example/v1?region=us")

      const provider = required(yield* catalog.get(Provider.ID.openai))
      expect(provider.package).toBe("@opencode/ai/providers/openai")
      expect(provider.settings).toMatchObject({ baseURL: "https://chatgpt.com/backend-api/codex" })
      expect(provider.headers).toMatchObject({
        originator: "opencode",
        "chatgpt-account-id": "acct_123",
        "x-codex-beta-features": "remote_compaction_v2",
      })
      expect(direct.baseURL).toBe("https://chatgpt.com/backend-api/codex")
      expect(direct.headers).toMatchObject({ originator: "opencode", "session-id": "ses_test" })
      expect(direct.hasHttpHooks).toBe(false)
      expect(custom.headers).not.toHaveProperty("originator")
      expect(proxy.baseURL).toBe("https://proxy.example/v1?region=us")
      expect(proxy.headers).toMatchObject({ originator: "opencode", "session-id": "ses_test" })
      const sessions = yield* Session.Service
      const location = yield* Location.Service
      const parent = yield* sessions.create({ location: { directory: location.directory } })
      const child = yield* sessions.create({ parentID: parent.id })
      const childRequest = yield* request(Provider.ID.openai, "https://api.openai.com/v1", child.id)
      expect(childRequest.headers).toMatchObject({ "session-id": parent.id })
      const eligible = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.5")))
      expect(eligible.package).toBe("@opencode/ai/providers/openai")
      expect(eligible.headers).toMatchObject({ originator: "opencode", "chatgpt-account-id": "acct_123" })
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
      expect(direct.headers).not.toHaveProperty("originator")
      expect(direct.baseURL).toBe("https://api.openai.com/v1")
      expect(provider.headers).not.toHaveProperty("x-codex-beta-features")
      expect(direct.hasHttpHooks).toBe(false)
      expect(provider.headers).not.toHaveProperty("originator")
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

  it.effect("keeps output limits for token-sharing Responses requests", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "sharing-token",
          refresh: "refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued" },
        }),
      })
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const draft = {
        sessionID: Session.ID.make("ses_sharing_output"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
        system: [],
        messages: [],
        options: { maxTokens: 128_000 },
      }
      expect((yield* hooks.trigger("session", "context", { ...draft, tools: {} })).options.maxTokens).toBe(128_000)
      expect((yield* hooks.trigger("session", "compaction", { ...draft, tools: {} })).options.maxTokens).toBe(128_000)
    }),
  )

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
