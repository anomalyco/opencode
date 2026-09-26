import { describe, expect } from "bun:test"
import { LLM } from "@opencode/ai"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import { Money } from "@opencode/schema/money"
import { Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { App } from "@opencode/core/app"
import { Config } from "@opencode/core/config"
import { ConfigPolicyPlugin } from "@opencode/core/config/plugin/policy"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { Mcp } from "@opencode/core/mcp/index"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { OpencodePlugin } from "@opencode/core/plugin/provider/opencode"
import { Provider } from "@opencode/core/provider"
import { WebSearch } from "@opencode/core/websearch"
import { withEnv } from "../fixture/env"
import { emptyMcp } from "../fixture/mcp"
import { drain } from "../lib/clock"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* OpencodePlugin.effect(host)
})

const noRemoteConfig = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
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
              ...(state.advertised ? { websearch: { providerID: "opencode" } } : {}),
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
          yield* addPlugin()
          yield* drain
          const initial = { ...rebuilds }
          expect(state.requests).toBe(1)
          expect(yield* websearch.default()).toBeUndefined()

          state.advertised = true
          yield* TestClock.adjust("50 seconds")
          yield* drain
          expect(state.requests).toBe(1)
          expect(rebuilds).toEqual(initial)
          expect(yield* websearch.default()).toBeUndefined()

          yield* TestClock.adjust("10 seconds")
          yield* drain
          expect(state.requests).toBe(2)
          expect(rebuilds).toEqual({ provider: initial.provider + 1, websearch: initial.websearch + 1 })
          expect(yield* websearch.default()).toEqual({ id: WebSearch.ID.make("opencode"), name: "OpenCode Web Search" })

          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(state.requests).toBe(3)
          expect(rebuilds).toEqual({ provider: initial.provider + 1, websearch: initial.websearch + 1 })
          expect(yield* websearch.default()).toEqual({ id: WebSearch.ID.make("opencode"), name: "OpenCode Web Search" })

          state.failing = true
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(state.requests).toBe(4)
          expect(rebuilds).toEqual({ provider: initial.provider + 1, websearch: initial.websearch + 1 })
          expect(yield* websearch.default()).toEqual({ id: WebSearch.ID.make("opencode"), name: "OpenCode Web Search" })

          state.failing = false
          state.advertised = false
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(state.requests).toBe(5)
          expect(rebuilds).toEqual({ provider: initial.provider + 2, websearch: initial.websearch + 2 })
          expect(yield* websearch.providers()).toEqual([])
          expect(yield* websearch.default()).toBeUndefined()
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("registers the Console's MCP servers as sent, attaching the credential only where asked", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { advertised: true }
        const server = Bun.serve({
          port: 0,
          fetch: (request) =>
            Response.json({
              providers: {},
              ...(state.advertised
                ? {
                    mcp: {
                      servers: {
                        opencode_console: {
                          type: "remote",
                          url: `${new URL(request.url).origin}/console/mcp`,
                          headers: { "x-client": "opencode", authorization: "Bearer forged" },
                          oauth: false,
                          auth: "console",
                        },
                        opencode_console_oauth: {
                          type: "remote",
                          url: `${new URL(request.url).origin}/console/oauth/mcp`,
                          oauth: { scope: "workspace" },
                          timeout: { startup: 5000 },
                        },
                      },
                    },
                  }
                : {}),
            }),
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const transforms: Array<(editor: Mcp.Editor) => void> = []
          const reloads = { count: 0 }
          const servers = () => {
            const configured = new Map<string, unknown>()
            transforms.forEach((transform) =>
              transform({
                list: () => [],
                get: (name) => (configured.has(name) ? { type: "remote", url: "user" } : undefined),
                set: (name, config) => configured.set(name, config),
                update: () => {},
                remove: (name) => configured.delete(name),
              }),
            )
            return Object.fromEntries(configured)
          }
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              metadata: { server: server.url.origin, orgID: "org-a" },
            }),
          })
          yield* addPlugin().pipe(
            Effect.provideService(
              Mcp.Service,
              Mcp.Service.of({
                ...emptyMcp,
                transform: (transform) =>
                  Effect.sync(() => {
                    transforms.push(transform)
                    return { dispose: Effect.void }
                  }),
                reload: () =>
                  Effect.sync(() => {
                    reloads.count++
                  }),
              }),
            ),
          )
          yield* drain

          expect(servers()).toEqual({
            opencode_console: {
              type: "remote",
              url: `${server.url.origin}/console/mcp`,
              headers: { "x-client": "opencode", authorization: "Bearer secret", "x-org-id": "org-a" },
              oauth: false,
            },
            opencode_console_oauth: {
              type: "remote",
              url: `${server.url.origin}/console/oauth/mcp`,
              oauth: { scope: "workspace" },
              timeout: { startup: 5000 },
            },
          })

          state.advertised = false
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(servers()).toEqual({})
          expect(reloads.count).toBe(1)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("enforces organization policy statements from the Console", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: () =>
            Response.json({
              providers: { opencode: {} },
              experimental: {
                policies: [
                  { action: "provider.use", resource: "*", effect: "deny" },
                  { action: "provider.use", resource: "opencode", effect: "allow" },
                  { action: "permission", resource: "shell:sudo *", effect: "deny", audience: "ignored" },
                ],
                unknown: true,
              },
            }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const catalog = yield* Provider.Service
          const managed = yield* ManagedPolicy.Service
          const plugins = yield* Plugin.Service
          yield* catalog.transform((catalog) => catalog.update(Provider.ID.anthropic, () => {}))
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              metadata: { server: server.url.origin, orgID: "org_test", orgName: "Acme" },
            }),
          })
          const host = yield* PluginHost.make(plugins)
          yield* OpencodePlugin.effect(host)
          yield* ConfigPolicyPlugin.Plugin.effect(host).pipe(Effect.provide(Config.testLayer([])))

          expect(managed.current()).toEqual({
            statements: [
              { action: "provider.use", resource: "*", effect: "deny" },
              { action: "provider.use", resource: "opencode", effect: "allow" },
              { action: "permission", resource: "shell:sudo *", effect: "deny" },
            ],
            organization: "Acme",
          })
          expect(yield* catalog.get(Provider.ID.anthropic)).toBeUndefined()
          expect(yield* catalog.get(Provider.ID.opencode)).toBeDefined()
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("keeps policy statements bound to the connected Console account", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state: { status: number; policies: Record<string, unknown[]>; requests: number } = {
          status: 200,
          policies: {},
          requests: 0,
        }
        const server = Bun.serve({
          port: 0,
          fetch: (request) => {
            state.requests++
            if (state.status !== 200) return new Response("Unavailable", { status: state.status })
            const policies = state.policies[request.headers.get("x-org-id") ?? ""]
            return Response.json({ providers: {}, ...(policies ? { experimental: { policies } } : {}) })
          },
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const providers = yield* Provider.Service
          const managed = yield* ManagedPolicy.Service
          const rebuilds = { count: 0 }
          const account = (orgID: string, orgName: string) =>
            credentials.create({
              integrationID: Integration.ID.make("opencode"),
              value: Credential.Key.make({
                type: "key",
                key: orgID,
                metadata: { server: server.url.origin, orgID, orgName },
              }),
            })
          const sudo: ConfigPolicy.Info = { action: "permission", resource: "shell:sudo *", effect: "deny" }
          const env: ConfigPolicy.Info = { action: "permission", resource: "edit:*.env", effect: "deny" }
          yield* providers.transform(() => {
            rebuilds.count++
          })
          const alpha = yield* account("org_alpha", "Alpha")
          yield* addPlugin()
          yield* drain
          const initial = rebuilds.count
          expect(state.requests).toBe(1)
          expect(managed.current()).toEqual({ statements: [], organization: "Alpha" })

          state.policies.org_alpha = [sudo]
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(state.requests).toBe(2)
          expect(managed.current()).toEqual({ statements: [sudo], organization: "Alpha" })
          expect(rebuilds.count).toBe(initial + 1)

          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(state.requests).toBe(3)
          expect(rebuilds.count).toBe(initial + 1)

          // An outage for the same connection keeps the last statements instead of lifting them.
          state.status = 503
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(state.requests).toBe(4)
          expect(managed.current()).toEqual({ statements: [sudo], organization: "Alpha" })
          expect(rebuilds.count).toBe(initial + 1)

          state.status = 200
          state.policies.org_beta = [env]
          const beta = yield* account("org_beta", "Beta")
          yield* eventually(
            Effect.sync(() => managed.current()),
            (current) => current.organization === "Beta",
          )
          expect(managed.current()).toEqual({ statements: [env], organization: "Beta" })

          state.status = 404
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(managed.current()).toEqual({ statements: [], organization: "Beta" })

          state.status = 200
          yield* credentials.remove(beta.id)
          yield* eventually(
            Effect.sync(() => managed.current()),
            (current) => current.organization === "Alpha",
          )
          expect(managed.current()).toEqual({ statements: [sudo], organization: "Alpha" })

          yield* credentials.remove(alpha.id)
          yield* eventually(
            Effect.sync(() => managed.current()),
            (current) => current.organization === undefined,
          )
          expect(managed.current()).toEqual({ statements: [], organization: undefined })
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
                      websearch: {
                        providerID: "opencode",
                      },
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
          expect(yield* websearch.default()).toEqual({ id: WebSearch.ID.make("opencode"), name: "OpenCode Web Search" })
          expect(yield* websearch.query({ query: "effect web search" })).toEqual(
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
          yield* websearch.query({ query: "fresh credential" })
          expect(requests.at(-1)).toMatchObject({
            method: "POST",
            authorization: "Bearer replacement",
            body: { query: "fresh credential", providerID: "opencode" },
          })

          yield* credentials.update(initial.id, {
            value: account("moved", `${server.url.origin}/other///?ignored=true#ignored`),
          })
          yield* websearch.query({ query: "updated server" })
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
          expect((yield* websearch.query({ query: "wrong provider" }).pipe(Effect.flip))._tag).toBe("WebSearch.Request")

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
          expect((yield* websearch.query({ query: "switch race" }).pipe(Effect.flip))._tag).toBe("WebSearch.Request")
          expect(requests.filter((request) => request.path === "/api/websearch")).toHaveLength(searchCount)
          gate.resolve()
          yield* eventually(websearch.providers(), (providers) =>
            providers.every((provider) => provider.id !== WebSearch.ID.make("opencode")),
          )
          expect(yield* websearch.default()).toBeUndefined()
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

  it.live("derives hosted search identity and the default Console endpoint locally", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: (request) => {
            if (new URL(request.url).pathname === "/console/api/v2/config") {
              return Response.json({
                providers: {},
                websearch: {
                  providerID: "managed-search",
                  name: "Remote name",
                  url: "https://example.invalid/search",
                },
              })
            }
            return Response.json({ providerID: "managed-search", results: [] })
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

          expect(yield* websearch.default()).toEqual({
            id: WebSearch.ID.make("managed-search"),
            name: "OpenCode Web Search",
          })
          expect(yield* websearch.query({ query: "default Console" })).toEqual(
            new WebSearch.Response({ providerID: WebSearch.ID.make("managed-search"), results: [] }),
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
                websearch: {
                  providerID: "opencode",
                },
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

          expect((yield* websearch.query({ query: "private search" }).pipe(Effect.flip))._tag).toBe("WebSearch.Request")
          expect(requests).toEqual(["/console/api/v2/config", "/console/api/websearch"])

          state.crossOrigin = true
          expect((yield* websearch.query({ query: "private search" }).pipe(Effect.flip))._tag).toBe("WebSearch.Request")
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
                websearch: {
                  providerID: "opencode",
                },
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

          const error = yield* websearch.query({ query: "rejected search" }).pipe(Effect.flip)
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
