import { describe, expect } from "bun:test"
import { LLM } from "@opencode/ai/effect"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import { Money } from "@opencode/schema/money"
import { Effect, Layer, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Agent } from "@opencode/core/agent"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigIntegration } from "@opencode/core/config/integration"
import { ConfigPolicyPlugin } from "@opencode/core/config/plugin/policy"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { ConfigWebSearchPlugin } from "@opencode/core/config/plugin/websearch"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { OpenAIPlugin } from "@opencode/core/plugin/provider/openai"
import { OpencodePlugin } from "@opencode/core/plugin/provider/opencode"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { WebSearch } from "@opencode/core/websearch"
import { withEnv } from "../fixture/env"
import { drain } from "../lib/clock"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* OpencodePlugin.effect(host)
})

// The Console's config merges as an integration document; its policies are what organization policy the member gets.
const consoleDocument = (config: Config.Interface) =>
  config
    .entries()
    .pipe(
      Effect.map((entries) =>
        entries.find((entry): entry is ConfigIntegration.Document => entry instanceof ConfigIntegration.Document),
      ),
    )
const consoleSearch = { id: WebSearch.ID.make("opencode"), name: "OpenCode Web Search" }
const consolePolicies = (config: Config.Interface) =>
  consoleDocument(config).pipe(Effect.map((document) => document?.info.policies ?? []))

const noRemoteConfig = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
)

// Periodic Console checks run on TestClock, but a loopback request takes real time that `drain` does not wait for.
// Calling the server's handler in-process keeps each check within `drain`.
const inProcess = (server: { fetch: (request: Request) => Response | Promise<Response> }) =>
  Effect.provideService(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      HttpClientRequest.toWeb(request).pipe(
        Effect.orDie,
        Effect.flatMap((web) => Effect.promise(async () => server.fetch(web))),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      ),
    ),
  )

function consoleServer(orgID: string | null | undefined, unavailable = false) {
  const config: { authorization: string | null; orgID: string | null }[] = []
  const requests: string[] = []
  const agents: (string | null)[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      requests.push(path)
      agents.push(request.headers.get("user-agent"))
      if (path === "/auth/device/code") {
        expect(await request.json()).toEqual({ client_id: "opencode-cli", supports_org_scope: true })
        return Response.json({
          device_code: "device",
          user_code: "user",
          verification_uri_complete: "/device?user_code=user",
          expires_in: 60,
          interval: 0,
        })
      }
      if (path === "/auth/device/token") {
        return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 600, org_id: orgID })
      }
      if (unavailable && (path === "/api/user" || path === "/api/orgs")) {
        return new Response("Unavailable", { status: 503 })
      }
      if (path === "/api/user") return Response.json({ id: "user", email: "user@example.com" })
      if (path === "/api/orgs") {
        return Response.json([
          { id: "org-z", name: "Zebra" },
          { id: "org-a", name: "Alpha" },
        ])
      }
      if (path === "/api/v2/config") {
        config.push({ authorization: request.headers.get("authorization"), orgID: request.headers.get("x-org-id") })
        if (orgID === "org-missing") return new Response("Forbidden", { status: 403 })
        return Response.json({ providers: {} })
      }
      return new Response("Not found", { status: 404 })
    },
  })
  return { server, config, requests, agents }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function eventually<A, E>(
  effect: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  remaining = 1000,
): Effect.Effect<A, E | Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

const cost = (input: number, output = 0) => [
  {
    input: Money.USDPerMillionTokens.make(input),
    output: Money.USDPerMillionTokens.make(output),
    cache: {
      read: Money.USDPerMillionTokens.zero,
      write: Money.USDPerMillionTokens.zero,
    },
  },
]

describe("OpencodePlugin", () => {
  it.effect("registers account and service account methods", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      expect((yield* integrations.get(Integration.ID.make("opencode")))?.methods).toEqual([
        {
          id: Integration.MethodID.make("device"),
          type: "oauth",
          label: "OpenCode Console account",
          form: [
            { key: "server", type: "string", format: "uri", hidden: true, default: "https://opencode.ai/console" },
          ],
        },
        { type: "key", label: "API key (service account)" },
      ])
    }),
  )

  it.live("uses a canonical custom server throughout device authorization", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests: string[] = []
        const server = Bun.serve({
          port: 0,
          fetch: (request) => {
            const url = new URL(request.url)
            requests.push(`${request.method} ${url.pathname}`)
            if (url.pathname.endsWith("/auth/device/code")) {
              return Response.json({
                device_code: "device",
                user_code: "user",
                verification_uri_complete: "/console/device?user_code=user&client_id=opencode-cli",
                expires_in: 60,
                interval: 0,
              })
            }
            if (url.pathname.endsWith("/auth/device/token")) {
              return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 600 })
            }
            if (url.pathname.endsWith("/api/user")) return Response.json({ id: "user", email: "user@example.com" })
            if (url.pathname.endsWith("/api/orgs")) return Response.json([{ id: "org", name: "Org" }])
            return new Response("Not found", { status: 404 })
          },
        })
        return { requests, server }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          yield* addPlugin()
          const integrations = yield* Integration.Service
          const integrationID = Integration.ID.make("opencode")
          const attempt = yield* integrations.oauth.connect({
            integrationID,
            methodID: Integration.MethodID.make("device"),
            answer: { server: `${server.url.origin}/console///?ignored=true#ignored` },
          })
          expect(attempt.url).toBe(`${server.url.origin}/console/device?user_code=user&client_id=opencode-cli`)
          yield* eventually(
            integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }),
            (status) => status.status === "complete",
          )

          expect(requests).toContain("POST /console/auth/device/code")
          expect(requests).toContain("POST /console/auth/device/token")
          expect(requests).toContain("GET /console/api/user")
          expect(requests).toContain("GET /console/api/orgs")
          const credentials = yield* Credential.Service
          expect((yield* credentials.list(Integration.ID.make("opencode")))[0]?.value).toMatchObject({
            metadata: { server: `${server.url.origin}/console` },
          })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("rejects malformed device verification URLs", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: () =>
            Response.json({
              device_code: "device",
              user_code: "user",
              verification_uri_complete: "http://[::1",
              expires_in: 60,
              interval: 0,
            }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          yield* addPlugin()
          const integrations = yield* Integration.Service
          const error = yield* integrations.oauth
            .connect({
              integrationID: Integration.ID.make("opencode"),
              methodID: Integration.MethodID.make("device"),
              answer: { server: server.url.origin },
            })
            .pipe(Effect.flip)
          expect(error).toBeInstanceOf(Integration.AuthorizationError)
          expect(String(error.cause)).toContain("Invalid device verification URL")
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  for (const orgID of ["org-z", undefined, null, "org-missing"]) {
    it.live(`uses the device token organization during authorization: ${orgID}`, () =>
      Effect.acquireUseRelease(
        Effect.sync(() => consoleServer(orgID)),
        ({ server, config }) =>
          Effect.gen(function* () {
            yield* addPlugin()
            const integrations = yield* Integration.Service
            const credentials = yield* Credential.Service
            const integrationID = Integration.ID.make("opencode")
            const attempt = yield* integrations.oauth.connect({
              integrationID,
              methodID: Integration.MethodID.make("device"),
              answer: { server: server.url.origin },
            })
            const status = yield* eventually(
              integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }),
              (status) => status.status !== "pending",
            )
            if (orgID === "org-missing") {
              expect(status).toMatchObject({
                status: "failed",
                message: "OpenCode organization not found: org-missing",
              })
              expect(yield* credentials.list(integrationID)).toEqual([])
              expect(config).toEqual([])
              return
            }
            expect(status.status).toBe("complete")
            expect((yield* credentials.list(integrationID))[0]).toMatchObject({
              label: orgID === "org-z" ? "Zebra" : "Alpha",
              value: {
                type: "oauth",
                access: "access",
                refresh: "refresh",
                metadata: {
                  server: server.url.origin,
                  accountID: "user",
                  email: "user@example.com",
                  orgID: orgID ?? "org-a",
                  orgName: orgID === "org-z" ? "Zebra" : "Alpha",
                },
              },
            })
            yield* eventually(
              Effect.sync(() => config.length),
              (count) => count > 0,
            )
            expect(config).toEqual([{ authorization: "Bearer access", orgID: orgID ?? "org-a" }])
          }),
        ({ server }) => Effect.promise(() => server.stop(true)),
      ),
    )
  }

  for (const scenario of [
    { orgID: "org-z" },
    { orgID: undefined },
    { orgID: null },
    { orgID: "org-missing" },
    { orgID: "org-z", unavailable: true },
    { orgID: "org-a", unavailable: true },
  ]) {
    it.live(
      `persists rotated credentials for ${scenario.orgID}${scenario.unavailable ? " with discovery unavailable" : ""}`,
      () =>
        Effect.acquireUseRelease(
          Effect.sync(() => consoleServer(scenario.orgID, scenario.unavailable)),
          ({ server, config, requests, agents }) =>
            Effect.gen(function* () {
              const credentials = yield* Credential.Service
              const initial = yield* credentials.create({
                integrationID: Integration.ID.make("opencode"),
                label: "Custom label",
                value: Credential.OAuth.make({
                  type: "oauth",
                  methodID: Integration.MethodID.make("device"),
                  access: "expired-access",
                  refresh: "old-refresh",
                  expires: 0,
                  metadata: { server: server.url.origin, orgID: "org-a", orgName: "Alpha", custom: "preserved" },
                }),
              })
              yield* addPlugin()
              const stored = required(yield* credentials.get(initial.id))
              expect(stored).toMatchObject({
                label: "Custom label",
                value: {
                  access: "access",
                  refresh: "refresh",
                  metadata: {
                    server: server.url.origin,
                    orgID: scenario.orgID ?? "org-a",
                    orgName: scenario.orgID === "org-a" ? "Alpha" : (scenario.orgID ?? "Alpha"),
                    custom: "preserved",
                  },
                },
              })
              if (stored.value.type !== "oauth") throw new Error("Expected OAuth credential")
              expect(stored.value.expires).toBeGreaterThan(Date.now())
              if (scenario.orgID == null) expect(stored.value.metadata).toEqual(initial.value.metadata)
              expect(config).toEqual([{ authorization: "Bearer access", orgID: scenario.orgID ?? "org-a" }])
              const integrations = yield* Integration.Service
              expect(
                yield* integrations.connection.resolve({
                  type: "credential",
                  method: "oauth",
                  id: initial.id,
                  label: initial.label,
                }),
              ).toEqual(stored.value)
              expect(requests).toEqual(["/auth/device/token", "/api/v2/config"])
              // The refresh and the config fetch both say which OpenCode is asking.
              expect(agents).toEqual(["opencode/beta/1.2.3/test", "opencode/beta/1.2.3/test"])
            }).pipe(Effect.provideService(App.Metadata, App.make({ name: "test", version: "1.2.3", channel: "beta" }))),
          ({ server }) => Effect.promise(() => server.stop(true)),
        ),
    )
  }

  it.effect("rejects non-HTTP OpenCode servers", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const error = yield* integrations.oauth
        .connect({
          integrationID: Integration.ID.make("opencode"),
          methodID: Integration.MethodID.make("device"),
          answer: { server: "ftp://console.example.com" },
        })
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(Integration.AuthorizationError)
      expect(String(error.cause)).toContain("Invalid OpenCode server URL: expected HTTP(S)")
    }),
  )

  it.effect("rejects non-string OpenCode servers", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const error = yield* integrations.oauth
        .connect({
          integrationID: Integration.ID.make("opencode"),
          methodID: Integration.MethodID.make("device"),
          answer: { server: true },
        })
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(Integration.AuthorizationError)
      expect(String(error.cause)).toContain("Expected string for form field: server")
    }),
  )

  it.live("loads native V2 providers and models from the connected OpenCode server", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const authorization: Array<string | null> = []
        const requests: string[] = []
        return {
          authorization,
          requests,
          server: Bun.serve({
            port: 0,
            fetch: (request) => {
              authorization.push(request.headers.get("authorization"))
              requests.push(`${request.method} ${new URL(request.url).pathname}`)
              const origin = new URL(request.url).origin
              return Response.json({
                providers: {
                  remote: {
                    canonical: "openai",
                    name: "Remote",
                    package: "aisdk:@ai-sdk/openai-compatible",
                    env: ["REMOTE_API_KEY"],
                    settings: {
                      baseURL: `${origin}/v1`,
                      apiKey: "{env:REMOTE_API_KEY}",
                      authToken: "provider-auth",
                      accessToken: "provider-access",
                      custom: "value",
                    },
                    headers: { "x-org-id": "org" },
                    models: {
                      model: {
                        modelID: "api-model",
                        name: "Remote Model",
                        family: "remote",
                        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                        settings: {
                          apiKey: "model-secret",
                          authToken: "model-auth",
                          accessToken: "model-access",
                          temperature: 0.5,
                        },
                        variants: [
                          {
                            id: "high",
                            settings: {
                              apiKey: "variant-secret",
                              authToken: "variant-auth",
                              accessToken: "variant-access",
                              temperature: 0.2,
                            },
                            headers: { "x-variant": "high" },
                          },
                        ],
                        cost: { input: 1, output: 2, cache: { read: 0.1 } },
                        limit: { context: 1000, output: 100 },
                      },
                      override: {
                        name: "Override",
                        package: "aisdk:@ai-sdk/anthropic",
                        settings: { baseURL: `${origin}/anthropic` },
                      },
                      disabled: { name: "Disabled", disabled: true },
                    },
                  },
                },
              })
            },
          }),
        }
      }),
      ({ authorization, requests, server }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const providers = yield* Provider.Service
          const models = yield* Model.Service
          const integrations = yield* Integration.Service
          yield* providers.transform((editor) => {
            editor.update(Provider.ID.openai, (provider) => {
              provider.package = "@opencode/ai/providers/openai"
              provider.integrationID = Integration.ID.make("openai")
            })
            editor.models.update(Provider.ID.openai, Model.ID.make("api-model"), (model) => {
              model.package = "@opencode/ai/providers/openai"
              model.settings = { baseURL: "https://upstream.example/v1" }
              model.variants = [
                {
                  id: Model.VariantID.make("custom"),
                  settings: {},
                  headers: { "x-custom": "true" },
                  body: { custom: true },
                },
              ]
            })
            editor.models.update(Provider.ID.make("remote"), Model.ID.make("stale"), () => {})
          })
          const initial = yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              metadata: { server: server.url.origin },
            }),
          })

          yield* addPlugin()
          expect(authorization).toEqual(["Bearer secret"])
          expect(requests).toEqual(["GET /api/v2/config"])

          const provider = required(yield* providers.get(Provider.ID.make("remote")))
          expect(provider).toMatchObject({
            id: "remote",
            canonical: "openai",
            name: "Remote",
            integrationID: "opencode",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `${server.url.origin}/v1`, custom: "value" },
            headers: { "x-org-id": "org" },
          })
          expect(yield* integrations.get(Integration.ID.make("remote"))).toBeUndefined()

          const model = required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("model")))
          expect(model).toMatchObject({
            id: "model",
            modelID: "api-model",
            providerID: "remote",
            canonical: "openai",
            name: "Remote Model",
            family: "remote",
            capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
            cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0 } }],
            limit: { context: 1000, output: 100 },
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `${server.url.origin}/v1`, custom: "value", temperature: 0.5 },
            headers: { "x-org-id": "org" },
          })
          expect(model.settings).toEqual({
            baseURL: `${server.url.origin}/v1`,
            custom: "value",
            temperature: 0.5,
            provider: "openai",
          })
          const override = required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("override")))
          expect(override.package).toBe("@opencode/ai/providers/anthropic")
          expect(override.settings?.baseURL).toBe(`${server.url.origin}/anthropic`)
          expect(model.variants).toEqual([
            {
              id: Model.VariantID.make("custom"),
              settings: {},
              headers: { "x-custom": "true" },
              body: { custom: true },
            },
            {
              id: Model.VariantID.make("high"),
              settings: { temperature: 0.2 },
              headers: { "x-variant": "high" },
            },
          ])
          expect(required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("disabled"))).enabled).toBe(false)
          expect(yield* models.get(Provider.ID.make("remote"), Model.ID.make("stale"))).toBeDefined()
          expect(
            (yield* providers.snapshot()).records.get(Provider.ID.openai)?.models.get(Model.ID.make("api-model"))
              ?.settings?.baseURL,
          ).toBe("https://upstream.example/v1")
          expect(yield* models.get(Provider.ID.openai, Model.ID.make("api-model"))).toBeUndefined()

          yield* credentials.update(initial.id, { label: "Renamed" })
          yield* Effect.yieldNow
          expect(authorization).toEqual(["Bearer secret"])

          const replacement = yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "replacement",
              metadata: { server: server.url.origin },
            }),
          })
          yield* eventually(
            Effect.sync(() => authorization.length),
            (count) => count === 2,
          )
          expect(authorization).toEqual(["Bearer secret", "Bearer replacement"])
          expect(requests).toEqual(["GET /api/v2/config", "GET /api/v2/config"])

          yield* credentials.remove(initial.id)
          yield* Effect.yieldNow
          expect(authorization).toEqual(["Bearer secret", "Bearer replacement"])
          expect((yield* credentials.list(Integration.ID.make("opencode"))).at(-1)?.id).toBe(replacement.id)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("builds Console reasoning variants after provider and model package normalization", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: () =>
            Response.json({
              providers: {
                remote: {
                  name: "Remote",
                  package: "aisdk:@ai-sdk/openai",
                  models: {
                    reasoner: {
                      releaseDate: "2026-02-03",
                      capabilities: { reasoning: { supported: true, effort: ["default", "low", "high"] } },
                      variants: [{ id: "high", headers: { "x-tier": "high" } }],
                    },
                    gpt: {
                      package: "aisdk:@ai-sdk/openai",
                      capabilities: { reasoning: { supported: true, effort: ["low", "high"] } },
                      variants: [{ id: "high", headers: { "x-tier": "high" } }],
                    },
                    "claude-sonnet-4-5": {
                      package: "aisdk:@ai-sdk/anthropic",
                      capabilities: { reasoning: { supported: true, budget: { min: 1024 } } },
                      limit: { output: 64_000 },
                    },
                    "gemini-3.1-pro": {
                      package: "aisdk:@ai-sdk/google",
                      capabilities: { reasoning: { supported: true, effort: ["low", "high"] } },
                    },
                    "magistral-medium": {
                      package: "aisdk:@ai-sdk/mistral",
                      capabilities: { reasoning: { supported: true, effort: ["low", "high"] } },
                    },
                  },
                },
              },
            }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const models = yield* Model.Service
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: server.url.origin } }),
          })

          yield* addPlugin()

          const reasoner = required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("reasoner")))
          expect(reasoner.time.released).toBe(Date.UTC(2026, 1, 3))
          expect(reasoner.variants).toEqual([
            {
              id: Model.VariantID.make("low"),
              settings: { reasoningEffort: "low", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
            },
            {
              id: Model.VariantID.make("high"),
              settings: { reasoningEffort: "high", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
              headers: { "x-tier": "high" },
            },
          ])
          const gpt = required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("gpt")))
          expect(gpt.package).toBe("@opencode/ai/providers/openai")
          expect(gpt.variants).toEqual(reasoner.variants)
          const claude = required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("claude-sonnet-4-5")))
          expect(claude.package).toBe("@opencode/ai/providers/anthropic")
          expect(claude.variants).toEqual([
            { id: Model.VariantID.make("high"), settings: { thinking: { type: "enabled", budgetTokens: 16_000 } } },
            { id: Model.VariantID.make("max"), settings: { thinking: { type: "enabled", budgetTokens: 31_999 } } },
          ])
          const gemini = required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("gemini-3.1-pro")))
          expect(gemini.package).toBe("@opencode/ai/providers/google")
          expect(gemini.variants).toEqual([
            {
              id: Model.VariantID.make("low"),
              settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } },
            },
            {
              id: Model.VariantID.make("high"),
              settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
            },
          ])
          const magistral = required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("magistral-medium")))
          expect(magistral.package).toBe("@opencode/ai/providers/mistral")
          expect(magistral.variants).toEqual([
            { id: Model.VariantID.make("low"), settings: { reasoningEffort: "low" } },
            { id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } },
          ])
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("refreshes hosted search with Console config, retains it on failure, and skips unchanged snapshots", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { advertised: false, failing: false, requests: 0 }
        const server = Bun.serve({
          port: 0,
          fetch: () => {
            state.requests++
            if (state.failing) return new Response("Unavailable", { status: 502 })
            return Response.json({
              providers: {},
              ...(state.advertised ? { websearch: { provider: "opencode" } } : {}),
            })
          },
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const providers = yield* Provider.Service
          const websearch = yield* WebSearch.Service
          const rebuilds = { provider: 0, websearch: 0 }
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: server.url.origin } }),
          })
          yield* providers.transform(() => {
            rebuilds.provider++
          })
          yield* websearch.transform(() => {
            rebuilds.websearch++
          })
          yield* addPlugin().pipe(inProcess(server))
          yield* drain
          const initial = { ...rebuilds }
          expect(state.requests).toBe(1)
          expect(yield* websearch.providers()).toEqual([])

          state.advertised = true
          yield* TestClock.adjust("50 seconds")
          yield* drain
          expect(state.requests).toBe(1)
          expect(rebuilds).toEqual(initial)
          expect(yield* websearch.providers()).toEqual([])

          yield* TestClock.adjust("10 seconds")
          yield* drain
          expect(state.requests).toBe(2)
          expect(rebuilds).toEqual({ provider: initial.provider + 1, websearch: initial.websearch + 1 })
          expect(yield* websearch.providers()).toContainEqual(consoleSearch)

          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(state.requests).toBe(3)
          expect(rebuilds).toEqual({ provider: initial.provider + 1, websearch: initial.websearch + 1 })
          expect(yield* websearch.providers()).toContainEqual(consoleSearch)

          state.failing = true
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(state.requests).toBe(4)
          expect(rebuilds).toEqual({ provider: initial.provider + 1, websearch: initial.websearch + 1 })
          expect(yield* websearch.providers()).toContainEqual(consoleSearch)

          state.failing = false
          state.advertised = false
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(state.requests).toBe(5)
          expect(rebuilds).toEqual({ provider: initial.provider + 2, websearch: initial.websearch + 2 })
          expect(yield* websearch.providers()).toEqual([])
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("refreshes past future-only policies while retaining config on malformed statements", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state: { policies: unknown[] } = {
          policies: [{ action: "tool.use", resource: "shell:sudo *", effect: "deny" }],
        }
        const server = Bun.serve({
          port: 0,
          fetch: () => Response.json({ providers: { opencode: {} }, policies: state.policies }),
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const config = yield* Config.Service
          const providers = yield* Provider.Service
          const sudo: ConfigPolicy.Info = { action: "tool.use", resource: "shell:sudo *", effect: "deny" }
          const env: ConfigPolicy.Info = { action: "tool.use", resource: "edit:*.env", effect: "deny" }
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              metadata: { server: server.url.origin, orgID: "org_acme", orgName: "Acme" },
            }),
          })
          yield* addPlugin().pipe(inProcess(server))
          yield* drain
          expect(yield* consolePolicies(config)).toEqual([sudo])

          for (const malformed of [
            { action: "tool.use", resource: 42, effect: "deny" },
            { action: "tool.use", effect: "deny" },
            null,
            {},
          ]) {
            state.policies = [env, malformed]
            yield* TestClock.adjust("1 minute")
            yield* drain
            expect(yield* consolePolicies(config)).toEqual([sudo])
            expect(yield* providers.get(Provider.ID.opencode)).toBeDefined()
          }

          state.policies = [env, { action: "tool.use", resource: "shell:*", effect: "future-effect" }]
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(yield* consolePolicies(config)).toEqual([env])

          state.policies = [{ action: "future.use", future: { values: [true] } }]
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(yield* consolePolicies(config)).toEqual([])
          expect(yield* providers.get(Provider.ID.opencode)).toBeDefined()

          state.policies = [{ action: "future.use", effect: { next: true } }, env]
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(yield* consolePolicies(config)).toEqual([env])
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("reports Console SSO sign-in, keeps the last config, and clears once Console accepts again", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { sso: false }
        const server = Bun.serve({
          port: 0,
          fetch: () => {
            if (state.sso)
              return Response.json(
                { _tag: "SsoRequired", orgId: "org_acme", connectionId: "ssoconn/1" },
                { status: 403 },
              )
            return Response.json({
              providers: {},
              policies: [{ action: "tool.use", resource: "shell:sudo *", effect: "deny" }],
            })
          },
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const integrations = yield* Integration.Service
          const config = yield* Config.Service
          const status = () =>
            integrations
              .get(Integration.ID.make("opencode"))
              .pipe(Effect.map((integration) => integration?.connections[0]?.status))
          const sudo: ConfigPolicy.Info = { action: "tool.use", resource: "shell:sudo *", effect: "deny" }
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              metadata: { server: `${server.url.origin}/console`, orgID: "org_acme", orgName: "Acme" },
            }),
          })
          yield* addPlugin().pipe(inProcess(server))
          yield* drain
          expect(yield* status()).toBeUndefined()

          state.sso = true
          yield* TestClock.adjust("1 minute")
          yield* drain
          const url = `${server.url.origin}/console/auth/sso/ssoconn%2F1/start?redirectTo=%2Fconsole%2F`
          expect(yield* status()).toEqual({ status: "needs_auth", message: "Sign in with SSO again to use Acme", url })
          expect(yield* consolePolicies(config)).toEqual([sudo])

          state.sso = false
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(yield* status()).toBeUndefined()
          expect(yield* consolePolicies(config)).toEqual([sudo])
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("explains rejected Console inference from at most one config check per 30 seconds", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { sso: false, requests: 0 }
        const server = Bun.serve({
          port: 0,
          fetch: () => {
            state.requests++
            if (state.sso)
              return Response.json(
                { _tag: "SsoRequired", orgId: "org_acme", connectionId: "ssoconn_1" },
                { status: 403 },
              )
            return Response.json({ providers: { remote: { canonical: "openai" } } })
          },
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const hooks = yield* PluginHooks.Service
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              metadata: { server: server.url.origin, orgID: "org_acme", orgName: "Acme" },
            }),
          })
          yield* addPlugin().pipe(inProcess(server))
          yield* drain
          const rejected = (providerID: Provider.ID) =>
            hooks
              .trigger("session", "http.response", {
                sessionID: Session.ID.make("ses_console"),
                agent: Agent.ID.make("build"),
                model: Model.Ref.make({ providerID, id: Model.ID.make("model") }),
                kind: "primary",
                request: new Request("https://inference.example/v1/responses"),
                response: Response.json({ error: { message: "Workspace access denied" } }, { status: 403 }),
              })
              .pipe(
                Effect.flatMap((event) =>
                  Effect.promise(async () => ({ status: event.response.status, body: await event.response.json() })),
                ),
                inProcess(server),
              )
          const denied = { status: 403, body: { error: { message: "Workspace access denied" } } }
          const explained = {
            status: 403,
            body: { error: { type: "authentication_error", message: "Sign in with SSO again to use Acme." } },
          }
          expect(state.requests).toBe(1)

          expect(yield* rejected(Provider.ID.make("remote"))).toEqual(denied)
          expect(state.requests).toBe(1)

          state.sso = true
          yield* TestClock.adjust("30 seconds")
          expect(
            yield* Effect.all(
              Array.from({ length: 10 }, () => rejected(Provider.ID.make("remote"))),
              { concurrency: "unbounded" },
            ),
          ).toEqual(Array.from({ length: 10 }, () => explained))
          expect(state.requests).toBe(2)

          expect(
            yield* Effect.forEach(Array.from({ length: 20 }), () =>
              TestClock.adjust("1 second").pipe(Effect.andThen(rejected(Provider.ID.make("remote")))),
            ),
          ).toEqual(Array.from({ length: 20 }, () => explained))
          expect(yield* rejected(Provider.ID.opencode)).toEqual(explained)
          expect(yield* rejected(Provider.ID.anthropic)).toEqual(denied)
          expect(state.requests).toBe(2)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("ignores 403 responses that are not a Console SSO error", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state: { body: Response | undefined } = { body: undefined }
        const server = Bun.serve({
          port: 0,
          fetch: () =>
            state.body ??
            Response.json({
              providers: {},
              policies: [{ action: "tool.use", resource: "shell:sudo *", effect: "deny" }],
            }),
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const integrations = yield* Integration.Service
          const config = yield* Config.Service
          const sudo: ConfigPolicy.Info = { action: "tool.use", resource: "shell:sudo *", effect: "deny" }
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: server.url.origin } }),
          })
          yield* addPlugin().pipe(inProcess(server))
          yield* drain

          for (const body of [
            () => new Response("<html>Forbidden</html>", { status: 403, headers: { "content-type": "text/html" } }),
            () => Response.json({ _tag: "Forbidden", orgId: "org", connectionId: "ssoconn" }, { status: 403 }),
          ]) {
            state.body = body()
            yield* TestClock.adjust("1 minute")
            yield* drain
            expect((yield* integrations.get(Integration.ID.make("opencode")))?.connections[0]?.status).toBeUndefined()
            expect(yield* consolePolicies(config)).toEqual([sudo])
          }
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("releases unread Console config responses when the fetch completes", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const signals: AbortSignal[] = []
      const state = { status: 404 }
      const http = HttpClient.make((request, _url, signal) => {
        signals.push(signal)
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("unavailable", state)))
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("opencode"),
        value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: "https://console.test" } }),
      })
      yield* addPlugin().pipe(Effect.provideService(HttpClient.HttpClient, http))
      yield* drain
      state.status = 503
      yield* TestClock.adjust("1 minute")
      yield* drain

      // An unreleased response is only aborted when garbage collected, which fails outside a request on workerd.
      expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
    }),
  )

  it.effect("sends credentials saved with the retired console.opencode.ai host to the default Console", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const requests: string[] = []
      const http = HttpClient.make((request) => {
        requests.push(request.url)
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 })))
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("opencode"),
        value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: "https://console.opencode.ai" } }),
      })
      yield* addPlugin().pipe(Effect.provideService(HttpClient.HttpClient, http))
      yield* drain

      expect(requests).toEqual(["https://opencode.ai/console/api/v2/config"])
    }),
  )

  it.effect("reports a rejected Console refresh token as signed out without removing the credential", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: (request) => {
            if (new URL(request.url).pathname === "/auth/device/token")
              return Response.json(
                { error: "invalid_grant", error_description: "refresh token revoked" },
                { status: 400 },
              )
            return Response.json({ providers: {} })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const integrations = yield* Integration.Service
          const credential = yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.OAuth.make({
              type: "oauth",
              methodID: Integration.MethodID.make("device"),
              access: "expired",
              refresh: "revoked",
              expires: 0,
              metadata: { server: server.url.origin, orgID: "org_acme", orgName: "Acme" },
            }),
          })
          yield* addPlugin()
          yield* drain

          expect((yield* integrations.get(Integration.ID.make("opencode")))?.connections[0]?.status).toEqual({
            status: "needs_auth",
            message: "Reconnect OpenCode Console to continue",
          })
          expect((yield* credentials.get(credential.id))?.value).toMatchObject({ refresh: "revoked" })
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("reports a Console session rejected before its token expires as signed out", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { revoked: true, refreshes: 0 }
        const server = Bun.serve({
          port: 0,
          fetch: (request) => {
            if (new URL(request.url).pathname === "/auth/device/token") state.refreshes++
            if (state.revoked)
              return Response.json({ _tag: "Unauthorized", message: "Invalid or expired session" }, { status: 401 })
            return Response.json({ providers: {} })
          },
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const integrations = yield* Integration.Service
          const credential = yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.OAuth.make({
              type: "oauth",
              methodID: Integration.MethodID.make("device"),
              access: "revoked",
              refresh: "refresh",
              expires: Number.MAX_SAFE_INTEGER,
              metadata: { server: server.url.origin, orgID: "org_acme", orgName: "Acme" },
            }),
          })
          const status = () =>
            integrations.get(Integration.ID.make("opencode")).pipe(Effect.map((item) => item?.connections[0]?.status))
          yield* addPlugin().pipe(inProcess(server))
          yield* drain

          expect(yield* status()).toEqual({ status: "needs_auth", message: "Reconnect OpenCode Console to continue" })
          expect((yield* credentials.get(credential.id))?.value).toMatchObject({ access: "revoked" })

          state.revoked = false
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(yield* status()).toBeUndefined()
          expect(state.refreshes).toBe(0)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("loads and executes hosted web search from the connected OpenCode server", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests: Array<{
          method: string
          path: string
          authorization: string | null
          orgID: string | null
          body?: unknown
        }> = []
        const gate = Promise.withResolvers<void>()
        const state = { advertised: true, providerID: "opencode", waitForConfig: false }
        const server = Bun.serve({
          port: 0,
          fetch: async (request) => {
            const path = new URL(request.url).pathname
            const body = request.method === "POST" ? await request.json() : undefined
            requests.push({
              method: request.method,
              path,
              authorization: request.headers.get("authorization"),
              orgID: request.headers.get("x-org-id"),
              ...(body === undefined ? {} : { body }),
            })
            if (path === "/api/v2/config") {
              if (state.waitForConfig) await gate.promise
              return Response.json({
                providers: {},
                ...(state.advertised
                  ? {
                      websearch: { provider: "opencode" },
                    }
                  : {}),
              })
            }
            if (path === "/api/websearch" || path === "/other/api/websearch") {
              return Response.json({
                providerID: state.providerID,
                results: [
                  {
                    url: "https://github.com/anomalyco/opencode",
                    title: "OpenCode",
                    content: "Open source AI coding agent.",
                    time: { published: 1_700_000_000_000 },
                  },
                ],
              })
            }
            return new Response("Not found", { status: 404 })
          },
        })
        return { gate, requests, server, state }
      }),
      ({ gate, requests, server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const websearch = yield* WebSearch.Service
          const account = (access: string, serverURL = server.url.origin, orgID = "org_test") =>
            Credential.OAuth.make({
              type: "oauth",
              methodID: Integration.MethodID.make("device"),
              access,
              refresh: "refresh",
              expires: Date.now() + 600_000,
              metadata: { server: serverURL, orgID },
            })
          const initial = yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: account("secret"),
          })

          yield* addPlugin()
          expect(yield* websearch.providers()).toContainEqual({
            id: WebSearch.ID.make("opencode"),
            name: "OpenCode Web Search",
          })
          expect(yield* websearch.providers()).toContainEqual(consoleSearch)
          expect(yield* websearch.query({ query: "effect web search", providerID: consoleSearch.id })).toEqual(
            new WebSearch.Response({
              providerID: WebSearch.ID.make("opencode"),
              results: [
                {
                  url: "https://github.com/anomalyco/opencode",
                  title: "OpenCode",
                  content: "Open source AI coding agent.",
                  time: { published: 1_700_000_000_000 },
                },
              ],
            }),
          )
          expect(requests).toEqual([
            {
              method: "GET",
              path: "/api/v2/config",
              authorization: "Bearer secret",
              orgID: "org_test",
            },
            {
              method: "POST",
              path: "/api/websearch",
              authorization: "Bearer secret",
              orgID: "org_test",
              body: { query: "effect web search", providerID: "opencode" },
            },
          ])

          yield* credentials.update(initial.id, {
            value: account("replacement"),
          })
          yield* websearch.query({ query: "fresh credential", providerID: consoleSearch.id })
          expect(requests.at(-1)).toMatchObject({
            method: "POST",
            authorization: "Bearer replacement",
            body: { query: "fresh credential", providerID: "opencode" },
          })

          yield* credentials.update(initial.id, {
            value: account("moved", `${server.url.origin}/other///?ignored=true#ignored`),
          })
          yield* websearch.query({ query: "updated server", providerID: consoleSearch.id })
          expect(requests.at(-1)).toMatchObject({
            method: "POST",
            path: "/other/api/websearch",
            authorization: "Bearer moved",
            orgID: "org_test",
            body: { query: "updated server", providerID: "opencode" },
          })
          yield* credentials.update(initial.id, {
            value: account("replacement"),
          })

          state.providerID = "unexpected"
          expect(
            (yield* websearch.query({ query: "wrong provider", providerID: consoleSearch.id }).pipe(Effect.flip))._tag,
          ).toBe("WebSearch.Request")

          state.advertised = false
          state.waitForConfig = true
          const searchCount = requests.filter((request) => request.path === "/api/websearch").length
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: account("switched", server.url.origin, "org_switched"),
          })
          yield* eventually(
            Effect.sync(() => requests),
            (requests) => requests.some((request) => request.authorization === "Bearer switched"),
          )
          expect(
            (yield* websearch.query({ query: "switch race", providerID: consoleSearch.id }).pipe(Effect.flip))._tag,
          ).toBe("WebSearch.Request")
          expect(requests.filter((request) => request.path === "/api/websearch")).toHaveLength(searchCount)
          gate.resolve()
          yield* eventually(websearch.providers(), (providers) =>
            providers.every((provider) => provider.id !== WebSearch.ID.make("opencode")),
          )
          expect(requests.at(-1)).toMatchObject({
            method: "GET",
            path: "/api/v2/config",
            authorization: "Bearer switched",
            orgID: "org_switched",
          })
        }),
      ({ gate, server }) =>
        Effect.sync(() => gate.resolve()).pipe(Effect.andThen(Effect.promise(() => server.stop(true)))),
    ),
  )

  it.live("sends hosted search to the default Console when the credential names none", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: (request) => {
            if (new URL(request.url).pathname === "/console/api/v2/config") {
              return Response.json({
                providers: {},
                websearch: { provider: "opencode" },
              })
            }
            return Response.json({ providerID: "opencode", results: [] })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const websearch = yield* WebSearch.Service
          const http = yield* HttpClient.HttpClient
          const requests: string[] = []
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({ type: "key", key: "secret" }),
          })
          yield* addPlugin().pipe(
            Effect.provideService(
              HttpClient.HttpClient,
              http.pipe(
                HttpClient.mapRequest((request) => {
                  requests.push(request.url)
                  return HttpClientRequest.setUrl(request, `${server.url.origin}${new URL(request.url).pathname}`)
                }),
              ),
            ),
          )

          expect(yield* websearch.query({ query: "default Console", providerID: consoleSearch.id })).toEqual(
            new WebSearch.Response({ providerID: WebSearch.ID.make("opencode"), results: [] }),
          )
          expect(requests).toEqual([
            "https://opencode.ai/console/api/v2/config",
            "https://opencode.ai/console/api/websearch",
          ])
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("does not forward hosted search credentials through redirects", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests: string[] = []
        const state = { crossOrigin: false }
        const server = Bun.serve({
          port: 0,
          fetch: (request) => {
            const url = new URL(request.url)
            requests.push(url.pathname)
            if (url.pathname === "/console/api/v2/config") {
              return Response.json({
                providers: {},
                websearch: { provider: "opencode" },
              })
            }
            if (url.pathname === "/console/api/websearch") {
              if (state.crossOrigin) url.hostname = "127.0.0.1"
              return Response.redirect(`${url.origin}/outside-console`, 307)
            }
            return Response.json({ providerID: "opencode", results: [] })
          },
        })
        return { requests, server, state }
      }),
      ({ requests, server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const websearch = yield* WebSearch.Service
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              metadata: { server: `${server.url.origin}/console`, orgID: "org_test" },
            }),
          })
          yield* addPlugin()

          expect(
            (yield* websearch.query({ query: "private search", providerID: consoleSearch.id }).pipe(Effect.flip))._tag,
          ).toBe("WebSearch.Request")
          expect(requests).toEqual(["/console/api/v2/config", "/console/api/websearch"])

          state.crossOrigin = true
          expect(
            (yield* websearch.query({ query: "private search", providerID: consoleSearch.id }).pipe(Effect.flip))._tag,
          ).toBe("WebSearch.Request")
          expect(requests).toEqual(["/console/api/v2/config", "/console/api/websearch", "/console/api/websearch"])
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("closes a rejected hosted search response without waiting for its body", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { cancelled: false }
        const server = Bun.serve({
          port: 0,
          fetch: (request) => {
            const url = new URL(request.url)
            if (url.pathname === "/api/v2/config") {
              return Response.json({
                providers: {},
                websearch: { provider: "opencode" },
              })
            }
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("temporarily unavailable"))
                },
                cancel() {
                  state.cancelled = true
                },
              }),
              { status: 503 },
            )
          },
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const websearch = yield* WebSearch.Service
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              metadata: { server: server.url.origin, orgID: "org_test" },
            }),
          })
          yield* addPlugin()

          const error = yield* websearch
            .query({ query: "rejected search", providerID: consoleSearch.id })
            .pipe(Effect.flip)
          expect(error._tag).toBe("WebSearch.Request")
          yield* eventually(
            Effect.sync(() => state.cancelled),
            (cancelled) => cancelled,
          )
          // Callers can retain errors, so response cleanup must not depend on garbage collection.
          expect(error).toBeInstanceOf(WebSearch.RequestError)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("preserves native Console OpenAI variant bodies in inference requests", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const variants = [
          {
            id: "effort-only",
            body: { reasoning: { effort: "low" } },
          },
          {
            id: "summary-only",
            body: { reasoning: { summary: "detailed" } },
          },
          {
            id: "native",
            body: { reasoning: { effort: "high", summary: "auto" } },
          },
          { id: "plain", body: {} },
        ]
        const models = {
          astra: {
            modelID: "api-astra",
            variants: variants.map((variant) => ({
              id: variant.id,
              headers: { "x-variant": variant.id },
              body: {
                ...variant.body,
                include: ["reasoning.encrypted_content"],
                metadata: { custom: "unchanged" },
              },
            })),
          },
        }
        const requests: { body: unknown; variant: string | null }[] = []
        return {
          variants,
          requests,
          server: Bun.serve({
            port: 0,
            fetch: async (request) => {
              if (new URL(request.url).pathname === "/responses") {
                requests.push({ body: await request.json(), variant: request.headers.get("x-variant") })
                return new Response('data: {"type":"response.completed","response":{"id":"resp_test"}}\n\n', {
                  headers: { "content-type": "text/event-stream" },
                })
              }
              return Response.json({
                providers: {
                  remote: {
                    canonical: "openai",
                    package: "aisdk:@ai-sdk/openai",
                    settings: { baseURL: new URL(request.url).origin },
                    models: {
                      ...models,
                      override: { ...models.astra, package: "aisdk:@ai-sdk/openai-compatible" },
                    },
                  },
                  compatible: {
                    canonical: "openai",
                    package: "aisdk:@ai-sdk/openai-compatible",
                    models,
                  },
                },
              })
            },
          }),
        }
      }),
      ({ variants, requests, server }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const models = yield* Model.Service
          const credential = Credential.Key.make({
            type: "key",
            key: "secret",
            metadata: { server: server.url.origin },
          })
          yield* credentials.create({ integrationID: Integration.ID.make("opencode"), value: credential })
          yield* addPlugin()
          const model = required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("astra")))
          expect(model.canonical).toBe(Provider.ID.openai)
          yield* Effect.forEach(variants, (variant, index) =>
            Effect.gen(function* () {
              const projected = required(model.variants.find((item) => item.id === variant.id))
              expect(projected.body).toEqual({
                ...variant.body,
                include: ["reasoning.encrypted_content"],
                metadata: { custom: "unchanged" },
              })
              expect(projected.settings).toBeUndefined()
              const resolved = yield* ModelResolver.resolveModel(model, Model.VariantID.make(variant.id), credential)
              yield* LLMClient.stream(LLM.request({ model: resolved, prompt: "Hello" })).pipe(
                Stream.runDrain,
                Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer))),
              )
              expect(requests).toHaveLength(index + 1)
              const request = required(requests.at(-1))
              expect(request.variant).toBe(variant.id)
              expect(request.body).toMatchObject({
                ...variant.body,
                model: "api-astra",
                include: ["reasoning.encrypted_content"],
                metadata: { custom: "unchanged" },
              })
              expect(request.body).not.toHaveProperty("reasoningEffort")
              expect(request.body).not.toHaveProperty("reasoningSummary")
              if (variant.id === "plain") expect(request.body).not.toHaveProperty("reasoning")
            }),
          )
          const compatible = required(yield* models.get(Provider.ID.make("compatible"), Model.ID.make("astra")))
          const override = required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("override")))
          for (const model of [compatible, override]) {
            expect(model.variants.find((variant) => variant.id === "native")?.body).toEqual({
              reasoning: { effort: "high", summary: "auto" },
              include: ["reasoning.encrypted_content"],
              metadata: { custom: "unchanged" },
            })
          }
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("uses a public key and disables paid models without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.opencode, () => {})
          catalog.models.update(Provider.ID.opencode, Model.ID.make("paid"), (draft) => {
            draft.cost = cost(1)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(Provider.ID.opencode)).settings?.apiKey).toBe("public")
        expect(required(yield* models.get(Provider.ID.opencode, Model.ID.make("paid"))).enabled).toBe(false)
      }),
    ),
  )

  it.effect("keeps free models without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.opencode, () => {})
          catalog.models.update(Provider.ID.opencode, Model.ID.make("free"), (draft) => {
            draft.cost = cost(0)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(Provider.ID.opencode)).settings?.apiKey).toBe("public")
        expect(required(yield* catalog.get(Provider.ID.opencode)).activation).toBe("enabled")
        expect((yield* catalog.available()).map((provider) => provider.id)).toContain(Provider.ID.opencode)
        expect(required(yield* models.get(Provider.ID.opencode, Model.ID.make("free"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("treats output-only cost as free without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.opencode, () => {})
          catalog.models.update(Provider.ID.opencode, Model.ID.make("output-only"), (draft) => {
            draft.cost = cost(0, 1)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(Provider.ID.opencode)).settings?.apiKey).toBe("public")
        expect(required(yield* models.get(Provider.ID.opencode, Model.ID.make("output-only"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("uses OPENCODE_API_KEY as credentials", () =>
    withEnv({ OPENCODE_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        const integrations = yield* Integration.Service
        yield* integrations.transform((editor) =>
          editor.method.update({
            integrationID: Integration.ID.make("opencode"),
            method: { type: "env", names: ["OPENCODE_API_KEY"] },
          }),
        )
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.opencode, () => {})
          catalog.models.update(Provider.ID.opencode, Model.ID.make("paid"), (draft) => {
            draft.cost = cost(1)
          })
        })
        yield* addPlugin().pipe(Effect.provideService(HttpClient.HttpClient, noRemoteConfig))
        expect(required(yield* catalog.get(Provider.ID.opencode)).settings?.apiKey).toBeUndefined()
        expect(required(yield* models.get(Provider.ID.opencode, Model.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("uses configured provider env vars as credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined, CUSTOM_OPENCODE_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        const integrations = yield* Integration.Service
        yield* integrations.transform((editor) => {
          editor.method.update({
            integrationID: Integration.ID.make("opencode"),
            method: { type: "env", names: ["CUSTOM_OPENCODE_API_KEY"] },
          })
        })
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.opencode, () => {})
          catalog.models.update(Provider.ID.opencode, Model.ID.make("paid"), (draft) => {
            draft.cost = cost(1)
          })
        })
        // An env credential has no server metadata, so the plugin would ask the
        // default Console for remote config; answer 404 (no remote config) locally.
        yield* addPlugin().pipe(Effect.provideService(HttpClient.HttpClient, noRemoteConfig))
        expect(required(yield* catalog.get(Provider.ID.opencode)).settings?.apiKey).toBeUndefined()
        expect(required(yield* models.get(Provider.ID.opencode, Model.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("uses configured apiKey as credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.opencode, (draft) => {
            draft.package = Provider.aisdk("test-provider")
            draft.settings = { apiKey: "configured" }
            draft.activation = "enabled"
          })
          catalog.models.update(Provider.ID.opencode, Model.ID.make("paid"), (draft) => {
            draft.cost = cost(1)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(Provider.ID.opencode)).settings?.apiKey).toBe("configured")
        expect(required(yield* models.get(Provider.ID.opencode, Model.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("ignores non-opencode providers and models", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.openai, () => {})
          catalog.models.update(Provider.ID.openai, Model.ID.make("paid"), (draft) => {
            draft.cost = cost(1)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(Provider.ID.openai)).settings?.apiKey).toBeUndefined()
        expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )
})

describe("OpencodePlugin with a Console config", () => {
  const $schema = "https://opencode.ai/config.json"
  const deny: ConfigPolicy.Info = { action: "tool.use", resource: "shell:*", effect: "deny" }

  it.effect("merges the Console response as config, with its policy named after the organization", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: () => Response.json({ $schema, providers: { remote: { name: "Remote" } }, policies: [deny] }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const config = yield* Config.Service
          const hooks = yield* PluginHooks.Service
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              metadata: { server: server.url.origin, orgID: "org_acme", orgName: "Acme" },
            }),
          })
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* OpencodePlugin.effect(host).pipe(inProcess(server))
          yield* ConfigPolicyPlugin.Plugin.effect(host)

          const document = required(yield* consoleDocument(config))
          expect(document.info.providers?.remote?.name).toBe("Remote")
          expect(document.organization).toBe("Acme")
          expect(
            yield* hooks.trigger("permission", "evaluate", {
              sessionID: Session.ID.make("ses_console_policy"),
              action: "shell",
              resources: ["ls"],
              effect: "allow",
            }),
          ).toMatchObject({ effect: "deny", message: "Blocked by Acme's policy" })
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect(
    "passes only providers, remote MCP servers, policies, and the web search selection, without credentials",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch: () =>
              Response.json({
                $schema,
                providers: {
                  remote: {
                    env: ["REMOTE_API_KEY"],
                    settings: { apiKey: "key", authToken: "auth", accessToken: "access", baseURL: "https://remote" },
                    models: {
                      chat: {
                        settings: { apiKey: "key", temperature: 0.1 },
                        variants: [{ id: "high", settings: { accessToken: "access", temperature: 0.2 } }],
                      },
                    },
                  },
                },
                mcp: {
                  servers: {
                    remote: { type: "remote", url: "https://remote/mcp" },
                    local: { type: "local", command: ["/tmp/console-mcp"] },
                  },
                },
                policies: [deny],
                websearch: { provider: "opencode" },
                plugins: ["file:///tmp/console-plugin"],
                shell: "/tmp/console-shell",
                agents: { console: { prompt: "Console agent" } },
                commands: { console: { template: "Console command" } },
                permissions: [{ action: "shell", resource: "*", effect: "allow" }],
                formatter: { console: { command: ["/tmp/console-formatter"] } },
                instructions: ["/tmp/console-instructions.md"],
              }),
          }),
        ),
        (server) =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            const config = yield* Config.Service
            yield* credentials.create({
              integrationID: Integration.ID.make("opencode"),
              value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: server.url.origin } }),
            })
            yield* addPlugin().pipe(inProcess(server))

            const info = required(yield* consoleDocument(config)).info
            expect(Object.keys(Schema.encodeSync(Info)(info)).toSorted()).toEqual([
              "mcp",
              "policies",
              "providers",
              "websearch",
            ])
            expect(Object.keys(info.mcp?.servers ?? {})).toEqual(["remote"])
            const remote = required(info.providers?.remote)
            expect(remote.env).toBeUndefined()
            expect(remote.settings).toEqual({ baseURL: "https://remote" })
            expect(remote.models?.chat?.settings).toEqual({ temperature: 0.1 })
            expect(remote.models?.chat?.variants?.[0]?.settings).toEqual({ temperature: 0.2 })
          }),
        (server) => Effect.promise(() => server.stop(true)),
      ),
  )

  it.effect("keeps a newer Console config loadable despite values this version does not know", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: () =>
            Response.json({
              $schema,
              providers: { remote: { name: "Remote" } },
              policies: [{ action: "future.use", resource: "anything", effect: "deny" }, deny],
              shell: 123,
              future: { shape: 42 },
            }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const config = yield* Config.Service
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: server.url.origin } }),
          })
          yield* addPlugin().pipe(inProcess(server))

          const info = required(yield* consoleDocument(config)).info
          expect(info.providers?.remote?.name).toBe("Remote")
          expect(info.policies).toEqual([deny])
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("layers Console providers below user config, bound to the Console connection", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: (request) =>
            Response.json({
              $schema,
              providers: {
                remote: {
                  name: "Console",
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { baseURL: `${new URL(request.url).origin}/v1`, apiKey: "console-key", custom: "console" },
                  headers: { "x-org-id": "console", "x-console": "true" },
                  models: {
                    chat: { name: "Console Chat", settings: { temperature: 0.1 } },
                    other: { name: "Console Other" },
                  },
                },
              },
            }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const providers = yield* Provider.Service
          const models = yield* Model.Service
          const config = yield* Config.Test
          yield* config.setEntries([
            new Document({
              type: "document",
              info: Schema.decodeUnknownSync(Info)({
                providers: {
                  remote: {
                    name: "Mine",
                    settings: { apiKey: "my-key" },
                    headers: { "x-org-id": "mine" },
                    models: { chat: { name: "My Chat" } },
                  },
                },
              }),
            }),
          ])
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: server.url.origin } }),
          })
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* OpencodePlugin.effect(host)
          yield* ConfigProviderPlugin.Plugin.effect(host)

          const provider = required(yield* providers.get(Provider.ID.make("remote")))
          expect(provider.name).toBe("Mine")
          expect(provider.integrationID).toBe(Integration.ID.make("opencode"))
          expect(provider.headers).toEqual({ "x-org-id": "mine", "x-console": "true" })
          expect(provider.settings).toEqual({
            baseURL: `${server.url.origin}/v1`,
            custom: "console",
            apiKey: "my-key",
            provider: "remote",
          })
          const chat = required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("chat")))
          expect(chat.name).toBe("My Chat")
          expect(chat.settings).toMatchObject({ temperature: 0.1 })
          expect(required(yield* models.get(Provider.ID.make("remote"), Model.ID.make("other"))).name).toBe(
            "Console Other",
          )
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("applies Console providers before provider plugins tune their canonical provider", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: () =>
            Response.json({
              $schema,
              providers: { "console-openai": { canonical: "openai", name: "Console OpenAI" } },
            }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const providers = yield* Provider.Service
          yield* providers.transform((catalog) =>
            catalog.update(Provider.ID.openai, (provider) => {
              provider.package = "aisdk:@ai-sdk/openai"
            }),
          )
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: server.url.origin } }),
          })
          const host = yield* PluginHost.make(yield* Plugin.Service)
          // Registered in production order: the OpenCode and OpenAI provider plugins, then config in `post`.
          yield* OpencodePlugin.effect(host).pipe(inProcess(server))
          yield* OpenAIPlugin.effect(host)
          yield* ConfigProviderPlugin.Plugin.effect(host)

          expect(required(yield* providers.get(Provider.ID.openai)).settings?.transport).toBe("websocket")
          const consoleOpenAI = required(yield* providers.get(Provider.ID.make("console-openai")))
          expect(consoleOpenAI.name).toBe("Console OpenAI")
          expect(consoleOpenAI.integrationID).toBe(Integration.ID.make("opencode"))
          expect(consoleOpenAI.settings?.transport).toBeUndefined()
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("offers Console web search only when the Console selects it, and user config still wins", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { selected: false }
        const server = Bun.serve({
          port: 0,
          fetch: (request) => {
            if (new URL(request.url).pathname === "/api/websearch")
              return Response.json({ providerID: "opencode", results: [] })
            return Response.json({ $schema, ...(state.selected ? { websearch: { provider: "opencode" } } : {}) })
          },
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const websearch = yield* WebSearch.Service
          const config = yield* Config.Test
          const bus = yield* Bus.Service
          const opencode = { id: WebSearch.ID.make("opencode"), name: "OpenCode Web Search" }
          // Config.testLayer does not announce integration changes the way config reloads do.
          const announced = (expected: typeof opencode | undefined) =>
            bus
              .publish(Event.Updated, {})
              .pipe(Effect.andThen(eventually(websearch.default(), (value) => value?.id === expected?.id)))
          yield* websearch.transform((editor) =>
            editor.add({ id: WebSearch.ID.make("mine"), name: "Mine", execute: () => Effect.succeed([]) }),
          )
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: server.url.origin } }),
          })
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* OpencodePlugin.effect(host).pipe(inProcess(server))
          yield* ConfigWebSearchPlugin.Plugin.effect(host)
          // A workspace without hosted search, or a member its policy denies, would get only failed searches.
          expect(yield* websearch.providers()).not.toContainEqual(opencode)
          expect(yield* websearch.default()).toBeUndefined()

          state.selected = true
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(yield* announced(opencode)).toEqual(opencode)
          expect(yield* websearch.providers()).toContainEqual(opencode)
          expect((yield* websearch.query({ query: "console" })).providerID).toBe(opencode.id)

          yield* config.setEntries([
            new Document({
              type: "document",
              info: Schema.decodeUnknownSync(Info)({ websearch: { provider: "mine" } }),
            }),
          ])
          expect(yield* announced({ id: WebSearch.ID.make("mine"), name: "Mine" })).toEqual({
            id: WebSearch.ID.make("mine"),
            name: "Mine",
          })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("replaces the Console config on an account switch and clears it on sign-out", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: (request) => {
            const orgID = request.headers.get("x-org-id") ?? "none"
            return Response.json({
              $schema,
              providers: { [orgID]: {} },
              mcp: { servers: { [orgID]: { type: "remote", url: `https://${orgID}/mcp` } } },
              policies: [{ action: "tool.use", resource: `shell:${orgID}`, effect: "deny" }],
              websearch: { provider: "opencode" },
            })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const config = yield* Config.Service
          const account = (orgID: string) =>
            credentials.create({
              integrationID: Integration.ID.make("opencode"),
              value: Credential.Key.make({
                type: "key",
                key: orgID,
                metadata: { server: server.url.origin, orgID, orgName: orgID },
              }),
            })
          const contents = consoleDocument(config).pipe(
            Effect.map(
              (document) =>
                document && {
                  organization: document.organization,
                  providers: Object.keys(document.info.providers ?? {}),
                  mcp: Object.keys(document.info.mcp?.servers ?? {}),
                  policies: document.info.policies?.map((policy) => policy.resource),
                  websearch: document.info.websearch && String(document.info.websearch.provider),
                },
            ),
          )
          const expected = (orgID: string) => ({
            organization: orgID,
            providers: [orgID],
            mcp: [orgID],
            policies: [`shell:${orgID}`],
            websearch: "opencode",
          })
          const alpha = yield* account("alpha")
          yield* addPlugin().pipe(inProcess(server))
          expect(yield* contents).toEqual(expected("alpha"))

          const beta = yield* account("beta")
          expect(yield* eventually(contents, (value) => value?.organization === "beta")).toEqual(expected("beta"))

          yield* credentials.remove(beta.id)
          expect(yield* eventually(contents, (value) => value?.organization === "alpha")).toEqual(expected("alpha"))

          yield* credentials.remove(alpha.id)
          expect(yield* eventually(contents, (value) => value === undefined)).toBeUndefined()
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )
})

for (const key of [undefined, "secret"]) {
  testEffect(Layer.empty).effect(
    `disabled free models with ${key ? "an API key" : "a Console login after startup"}`,
    () =>
      withEnv({ OPENCODE_DISABLE_FREE_MODELS: "true", OPENCODE_API_KEY: key }, () =>
        Effect.gen(function* () {
          const catalog = yield* Provider.Service
          const models = yield* Model.Service
          const integrations = yield* Integration.Service
          const credentials = yield* Credential.Service
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID: Integration.ID.make("opencode"),
              method: { type: "env", names: ["OPENCODE_API_KEY"] },
            }),
          )
          yield* catalog.transform((editor) => {
            editor.update(Provider.ID.opencode, () => {})
            editor.models.update(Provider.ID.opencode, Model.ID.make("free"), (model) => {
              model.cost = cost(0)
            })
            editor.models.update(Provider.ID.opencode, Model.ID.make("paid"), (model) => {
              model.cost = cost(1)
            })
          })
          yield* addPlugin().pipe(Effect.provideService(HttpClient.HttpClient, noRemoteConfig))
          if (!key) {
            expect(yield* catalog.available()).toEqual([])
            expect(yield* models.all()).toEqual([])
            expect(yield* models.default()).toBeUndefined()
            expect((yield* integrations.get(Integration.ID.make("opencode")))?.methods.length).toBeGreaterThan(0)
            yield* credentials.create({
              integrationID: Integration.ID.make("opencode"),
              value: Credential.OAuth.make({
                type: "oauth",
                methodID: Integration.MethodID.make("device"),
                access: "access",
                refresh: "refresh",
                expires: Date.now() + 600_000,
              }),
            })
          }
          const available = yield* eventually(models.available(), (models) =>
            models.some((model) => model.providerID === Provider.ID.opencode),
          )
          expect((yield* catalog.available()).map((provider) => provider.id)).toContain(Provider.ID.opencode)
          expect(available.map((model) => model.id)).toEqual([Model.ID.make("paid")])
          expect(yield* models.all()).toEqual(available)
          expect((yield* models.default())?.id).toBe(Model.ID.make("paid"))
          expect(yield* models.get(Provider.ID.opencode, Model.ID.make("free"))).toBeUndefined()
        }).pipe(Effect.provide(PluginTestLayer)),
      ),
  )
}
