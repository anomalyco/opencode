import { describe, expect } from "bun:test"
import { LLM } from "@opencode-ai/ai"
import { LLMClient, RequestExecutor } from "@opencode-ai/ai/route"
import { Money } from "@opencode-ai/schema/money"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OpencodePlugin } from "@opencode-ai/core/plugin/provider/opencode"
import { Provider } from "@opencode-ai/core/provider"
import { WebSearch } from "@opencode-ai/core/websearch"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* OpencodePlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 1000,
): Effect.Effect<A, Error> {
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
      expect(String(error.cause)).toContain("Invalid OpenCode server URL: expected string")
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
          const catalog = yield* Catalog.Service
          const integrations = yield* Integration.Service
          yield* catalog.transform((editor) => {
            editor.provider.update(Provider.ID.openai, (provider) => {
              provider.package = Provider.aisdk("@ai-sdk/openai")
              provider.integrationID = Integration.ID.make("openai")
            })
            editor.model.update(Provider.ID.openai, Model.ID.make("api-model"), (model) => {
              model.package = Provider.aisdk("@ai-sdk/openai")
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
            editor.model.update(Provider.ID.make("remote"), Model.ID.make("stale"), () => {})
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

          const provider = required(yield* catalog.provider.get(Provider.ID.make("remote")))
          expect(provider).toMatchObject({
            id: "remote",
            canonical: "openai",
            name: "Remote",
            integrationID: "opencode",
            package: Provider.aisdk("@ai-sdk/openai-compatible"),
            settings: { baseURL: `${server.url.origin}/v1`, custom: "value" },
            headers: { "x-org-id": "org" },
          })
          expect(yield* integrations.get(Integration.ID.make("remote"))).toBeUndefined()

          const model = required(yield* catalog.model.get(Provider.ID.make("remote"), Model.ID.make("model")))
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
            package: Provider.aisdk("@ai-sdk/openai-compatible"),
            settings: { baseURL: `${server.url.origin}/v1`, custom: "value", temperature: 0.5 },
            headers: { "x-org-id": "org" },
          })
          expect(model.settings).toEqual({ baseURL: `${server.url.origin}/v1`, custom: "value", temperature: 0.5 })
          const override = required(yield* catalog.model.get(Provider.ID.make("remote"), Model.ID.make("override")))
          expect(override.package).toBe(Provider.aisdk("@ai-sdk/anthropic"))
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
          expect(
            required(yield* catalog.model.get(Provider.ID.make("remote"), Model.ID.make("disabled"))).enabled,
          ).toBe(false)
          expect(yield* catalog.model.get(Provider.ID.make("remote"), Model.ID.make("stale"))).toBeDefined()
          expect((yield* catalog.model.get(Provider.ID.openai, Model.ID.make("api-model")))?.settings?.baseURL).toBe(
            "https://upstream.example/v1",
          )

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
                        name: "OpenCode",
                        url: `${new URL(request.url).origin}/api/websearch`,
                      },
                    }
                  : {}),
              })
            }
            if (path === "/api/websearch") {
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
          expect(yield* websearch.providers()).toContainEqual({ id: WebSearch.ID.make("opencode"), name: "OpenCode" })
          expect(yield* websearch.default()).toEqual({ id: WebSearch.ID.make("opencode"), name: "OpenCode" })
          expect(yield* websearch.query({ query: "effect code search" })).toEqual(
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
              body: { query: "effect code search", providerID: "opencode" },
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

          const requestCount = requests.length
          yield* credentials.update(initial.id, {
            value: account("moved", `${server.url.origin}/other`),
          })
          expect((yield* websearch.query({ query: "stale server" }).pipe(Effect.flip))._tag).toBe("WebSearch.Request")
          expect(requests).toHaveLength(requestCount)
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
                  name: "OpenCode",
                  url: `${url.origin}/console/api/websearch`,
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

  it.live("normalizes legacy Console OpenAI variant bodies without changing native bodies", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const variants = [
          {
            id: "legacy",
            body: { reasoningEffort: "high", reasoningSummary: "auto" },
            expected: { reasoning: { effort: "high", summary: "auto" } },
          },
          {
            id: "effort-only",
            body: { reasoningEffort: "low" },
            expected: { reasoning: { effort: "low" } },
          },
          {
            id: "summary-only",
            body: { reasoningSummary: "detailed" },
            expected: { reasoning: { summary: "detailed" } },
          },
          {
            id: "native",
            body: { reasoning: { effort: "high", summary: "auto" } },
            expected: { reasoning: { effort: "high", summary: "auto" } },
          },
          {
            id: "mixed",
            body: {
              reasoningEffort: "low",
              reasoningSummary: "auto",
              reasoning: { effort: "high", summary: "detailed" },
            },
            expected: { reasoning: { effort: "high", summary: "detailed" } },
          },
          { id: "plain", body: {}, expected: {} },
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
          const catalog = yield* Catalog.Service
          const credential = Credential.Key.make({
            type: "key",
            key: "secret",
            metadata: { server: server.url.origin },
          })
          yield* credentials.create({ integrationID: Integration.ID.make("opencode"), value: credential })
          yield* addPlugin()
          const model = required(yield* catalog.model.get(Provider.ID.make("remote"), Model.ID.make("astra")))
          expect(model.canonical).toBe(Provider.ID.openai)
          yield* Effect.forEach(variants, (variant, index) =>
            Effect.gen(function* () {
              const projected = required(model.variants.find((item) => item.id === variant.id))
              expect(projected.body).toEqual({
                ...variant.expected,
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
                ...variant.expected,
                model: "api-astra",
                include: ["reasoning.encrypted_content"],
                metadata: { custom: "unchanged" },
              })
              expect(request.body).not.toHaveProperty("reasoningEffort")
              expect(request.body).not.toHaveProperty("reasoningSummary")
              if (variant.id === "plain") expect(request.body).not.toHaveProperty("reasoning")
            }),
          )
          const compatible = required(yield* catalog.model.get(Provider.ID.make("compatible"), Model.ID.make("astra")))
          const override = required(yield* catalog.model.get(Provider.ID.make("remote"), Model.ID.make("override")))
          for (const model of [compatible, override]) {
            expect(model.variants.find((variant) => variant.id === "legacy")?.body).toEqual({
              reasoningEffort: "high",
              reasoningSummary: "auto",
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
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.opencode, () => {})
          catalog.model.update(Provider.ID.opencode, Model.ID.make("paid"), (draft) => {
            draft.cost = cost(1)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.opencode)).settings?.apiKey).toBe("public")
        expect(required(yield* catalog.model.get(Provider.ID.opencode, Model.ID.make("paid"))).enabled).toBe(false)
      }),
    ),
  )

  it.effect("keeps free models without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.opencode, () => {})
          catalog.model.update(Provider.ID.opencode, Model.ID.make("free"), (draft) => {
            draft.cost = cost(0)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.opencode)).settings?.apiKey).toBe("public")
        expect(required(yield* catalog.provider.get(Provider.ID.opencode)).activation).toBe("enabled")
        expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(Provider.ID.opencode)
        expect(required(yield* catalog.model.get(Provider.ID.opencode, Model.ID.make("free"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("treats output-only cost as free without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.opencode, () => {})
          catalog.model.update(Provider.ID.opencode, Model.ID.make("output-only"), (draft) => {
            draft.cost = cost(0, 1)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.opencode)).settings?.apiKey).toBe("public")
        expect(required(yield* catalog.model.get(Provider.ID.opencode, Model.ID.make("output-only"))).enabled).toBe(
          true,
        )
      }),
    ),
  )

  it.effect("uses OPENCODE_API_KEY as credentials", () =>
    withEnv({ OPENCODE_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.opencode, () => {})
          catalog.model.update(Provider.ID.opencode, Model.ID.make("paid"), (draft) => {
            draft.cost = cost(1)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.opencode)).settings?.apiKey).toBeUndefined()
        expect(required(yield* catalog.model.get(Provider.ID.opencode, Model.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("uses configured provider env vars as credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined, CUSTOM_OPENCODE_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        const integrations = yield* Integration.Service
        yield* integrations.transform((editor) => {
          editor.method.update({
            integrationID: Integration.ID.make("opencode"),
            method: { type: "env", names: ["CUSTOM_OPENCODE_API_KEY"] },
          })
        })
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.opencode, () => {})
          catalog.model.update(Provider.ID.opencode, Model.ID.make("paid"), (draft) => {
            draft.cost = cost(1)
          })
        })
        // An env credential has no server metadata, so the plugin would ask the
        // default Console for remote config; answer 404 (no remote config) locally.
        yield* addPlugin().pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
            ),
          ),
        )
        expect(required(yield* catalog.provider.get(Provider.ID.opencode)).settings?.apiKey).toBeUndefined()
        expect(required(yield* catalog.model.get(Provider.ID.opencode, Model.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("uses configured apiKey as credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.opencode, (draft) => {
            draft.package = Provider.aisdk("test-provider")
            draft.settings = { apiKey: "configured" }
          })
          catalog.model.update(Provider.ID.opencode, Model.ID.make("paid"), (draft) => {
            draft.cost = cost(1)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.opencode)).settings?.apiKey).toBe("configured")
        expect(required(yield* catalog.model.get(Provider.ID.opencode, Model.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("ignores non-opencode providers and models", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.openai, () => {})
          catalog.model.update(Provider.ID.openai, Model.ID.make("paid"), (draft) => {
            draft.cost = cost(1)
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.openai)).settings?.apiKey).toBeUndefined()
        expect(required(yield* catalog.model.get(Provider.ID.openai, Model.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )
})
