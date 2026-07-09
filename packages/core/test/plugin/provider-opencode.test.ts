import { describe, expect } from "bun:test"
import { Money } from "@opencode-ai/schema/money"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OpencodePlugin } from "@opencode-ai/core/plugin/provider/opencode"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  const events = yield* EventV2.Service
  const integration = yield* Integration.Service
  yield* OpencodePlugin.effect(host).pipe(
    Effect.provideService(EventV2.Service, events),
    Effect.provideService(Integration.Service, integration),
  )
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

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
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
      expect((yield* (yield* Integration.Service).get(Integration.ID.make("opencode")))?.methods).toEqual([
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
                verification_uri_complete: `${url.origin}/verify`,
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
          const attempt = yield* integrations.connection.oauth({
            integrationID: Integration.ID.make("opencode"),
            methodID: Integration.MethodID.make("device"),
            inputs: { server: `${server.url.origin}/console///?ignored=true#ignored` },
          })
          expect(attempt.url).toBe(`${server.url.origin}/verify`)
          yield* eventually(integrations.attempt.status(attempt.attemptID), (status) => status.status === "complete")

          expect(requests).toContain("POST /console/auth/device/code")
          expect(requests).toContain("POST /console/auth/device/token")
          expect(requests).toContain("GET /console/api/user")
          expect(requests).toContain("GET /console/api/orgs")
          expect((yield* (yield* Credential.Service).list(Integration.ID.make("opencode")))[0]?.value).toMatchObject({
            metadata: { server: `${server.url.origin}/console` },
          })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("rejects non-HTTP OpenCode servers", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const error = yield* (yield* Integration.Service).connection
        .oauth({
          integrationID: Integration.ID.make("opencode"),
          methodID: Integration.MethodID.make("device"),
          inputs: { server: "ftp://console.example.com" },
        })
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(Integration.AuthorizationError)
      expect(String(error.cause)).toContain("Invalid OpenCode server URL: expected HTTP(S)")
    }),
  )

  it.live("loads providers and models from the connected OpenCode server", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const authorization: Array<string | null> = []
        const gate = Promise.withResolvers<void>()
        return {
          authorization,
          release: gate.resolve,
          server: Bun.serve({
            port: 0,
            fetch: async (request) => {
              await gate.promise
              authorization.push(request.headers.get("authorization"))
              const origin = new URL(request.url).origin
              return Response.json({
                config: {
                  enterprise: { url: origin },
                  provider: {
                    remote: {
                      name: "Remote",
                      npm: "@ai-sdk/openai-compatible",
                      api: `${origin}/v1`,
                      env: ["REMOTE_API_KEY"],
                      options: {
                        apiKey: "{env:REMOTE_API_KEY}",
                        headers: { "x-org-id": "org" },
                        custom: "value",
                      },
                      models: {
                        model: {
                          name: "Remote Model",
                          family: "remote",
                          release_date: "2026-01-02",
                          tool_call: true,
                          modalities: { input: ["text", "image"], output: ["text"] },
                          options: { apiKey: "model-secret", temperature: 0.5 },
                          variants: { high: { apiKey: "variant-secret", temperature: 0.2 } },
                          cost: { input: 1, output: 2, cache_read: 0.1 },
                          limit: { context: 1000, output: 100 },
                        },
                        disabled: { name: "Disabled", status: "deprecated" },
                      },
                    },
                  },
                },
              })
            },
          }),
        }
      }),
      ({ authorization, release, server }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const catalog = yield* Catalog.Service
          yield* catalog.transform((draft) => {
            draft.provider.update(ProviderV2.ID.make("remote"), () => {})
            draft.model.update(ProviderV2.ID.make("remote"), ModelV2.ID.make("model"), (model) => {
              model.variants = [
                {
                  id: ModelV2.VariantID.make("custom"),
                  settings: {},
                  headers: { "x-custom": "true" },
                  body: { custom: true },
                },
              ]
            })
            draft.model.update(ProviderV2.ID.make("remote"), ModelV2.ID.make("stale"), () => {})
          })
          yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              metadata: { server: server.url.origin },
            }),
          })

          yield* addPlugin()
          expect(authorization).toEqual([])
          release()

          const provider = required(
            yield* eventually(
              catalog.provider.get(ProviderV2.ID.make("remote")),
              (item) => item?.integrationID === Integration.ID.make("opencode"),
            ),
          )
          expect(provider).toMatchObject({
            name: "Remote",
            integrationID: "opencode",
            package: ProviderV2.aisdk("@ai-sdk/openai-compatible"),
            settings: { baseURL: `${server.url.origin}/v1`, custom: "value" },
            headers: { "x-org-id": "org" },
          })
          expect(yield* (yield* Integration.Service).get(Integration.ID.make("remote"))).toBeUndefined()

          const model = required(yield* catalog.model.get(ProviderV2.ID.make("remote"), ModelV2.ID.make("model")))
          expect(model).toMatchObject({
            name: "Remote Model",
            family: "remote",
            capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
            cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0 } }],
            limit: { context: 1000, output: 100 },
            package: ProviderV2.aisdk("@ai-sdk/openai-compatible"),
            settings: { baseURL: `${server.url.origin}/v1`, custom: "value", temperature: 0.5 },
            headers: { "x-org-id": "org" },
          })
          expect(model.variants).toEqual([
            {
              id: ModelV2.VariantID.make("custom"),
              settings: {},
              headers: { "x-custom": "true" },
              body: { custom: true },
            },
            {
              id: ModelV2.VariantID.make("high"),
              settings: { temperature: 0.2 },
              headers: {},
            },
          ])
          expect(
            required(yield* catalog.model.get(ProviderV2.ID.make("remote"), ModelV2.ID.make("disabled"))).enabled,
          ).toBe(false)
          expect(yield* catalog.model.get(ProviderV2.ID.make("remote"), ModelV2.ID.make("stale"))).toBeDefined()
          expect(authorization).toContain("Bearer secret")
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("uses a public key and disables paid models without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const provider = ProviderV2.Info.make({
            ...ProviderV2.Info.empty(ProviderV2.ID.opencode),
            package: ProviderV2.aisdk("test-provider"),
          })
          const model = ModelV2.Info.make({
            ...ModelV2.Info.empty(provider.id, ModelV2.ID.make("paid")),
            modelID: ModelV2.ID.make("paid"),
            package: ProviderV2.aisdk("test-provider"),
            cost: cost(1),
          })
          catalog.provider.update(provider.id, () => {})
          catalog.model.update(provider.id, model.id, (draft) => {
            draft.cost = [...model.cost]
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.opencode)).settings?.apiKey).toBe("public")
        expect(required(yield* catalog.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("paid"))).enabled).toBe(false)
      }),
    ),
  )

  it.effect("keeps free models without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const provider = ProviderV2.Info.make({
            ...ProviderV2.Info.empty(ProviderV2.ID.opencode),
            package: ProviderV2.aisdk("test-provider"),
          })
          const model = ModelV2.Info.make({
            ...ModelV2.Info.empty(provider.id, ModelV2.ID.make("free")),
            modelID: ModelV2.ID.make("free"),
            package: ProviderV2.aisdk("test-provider"),
            cost: cost(0),
          })
          catalog.provider.update(provider.id, () => {})
          catalog.model.update(provider.id, model.id, (draft) => {
            draft.cost = [...model.cost]
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.opencode)).settings?.apiKey).toBe("public")
        expect(required(yield* catalog.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("free"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("treats output-only cost as free without credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const provider = ProviderV2.Info.make({
            ...ProviderV2.Info.empty(ProviderV2.ID.opencode),
            package: ProviderV2.aisdk("test-provider"),
          })
          const model = ModelV2.Info.make({
            ...ModelV2.Info.empty(provider.id, ModelV2.ID.make("output-only")),
            modelID: ModelV2.ID.make("output-only"),
            package: ProviderV2.aisdk("test-provider"),
            cost: cost(0, 1),
          })
          catalog.provider.update(provider.id, () => {})
          catalog.model.update(provider.id, model.id, (draft) => {
            draft.cost = [...model.cost]
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.opencode)).settings?.apiKey).toBe("public")
        expect(required(yield* catalog.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("output-only"))).enabled).toBe(
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
          const provider = ProviderV2.Info.make({
            ...ProviderV2.Info.empty(ProviderV2.ID.opencode),
            package: ProviderV2.aisdk("test-provider"),
          })
          const model = ModelV2.Info.make({
            ...ModelV2.Info.empty(provider.id, ModelV2.ID.make("paid")),
            modelID: ModelV2.ID.make("paid"),
            package: ProviderV2.aisdk("test-provider"),
            cost: cost(1),
          })
          catalog.provider.update(provider.id, () => {})
          catalog.model.update(provider.id, model.id, (draft) => {
            draft.cost = [...model.cost]
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.opencode)).settings?.apiKey).toBeUndefined()
        expect(required(yield* catalog.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("paid"))).enabled).toBe(true)
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
          const provider = ProviderV2.Info.make({
            ...ProviderV2.Info.empty(ProviderV2.ID.opencode),
            package: ProviderV2.aisdk("test-provider"),
          })
          const model = ModelV2.Info.make({
            ...ModelV2.Info.empty(provider.id, ModelV2.ID.make("paid")),
            modelID: ModelV2.ID.make("paid"),
            package: ProviderV2.aisdk("test-provider"),
            cost: cost(1),
          })
          catalog.provider.update(provider.id, () => {})
          catalog.model.update(provider.id, model.id, (draft) => {
            draft.cost = [...model.cost]
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.opencode)).settings?.apiKey).toBeUndefined()
        expect(required(yield* catalog.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("uses configured apiKey as credentials", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const provider = ProviderV2.Info.make({
            ...ProviderV2.Info.empty(ProviderV2.ID.opencode),
            package: ProviderV2.aisdk("test-provider"),
            settings: { apiKey: "configured" },
          })
          const model = ModelV2.Info.make({
            ...ModelV2.Info.empty(provider.id, ModelV2.ID.make("paid")),
            modelID: ModelV2.ID.make("paid"),
            package: ProviderV2.aisdk("test-provider"),
            cost: cost(1),
          })
          catalog.provider.update(provider.id, (draft) => {
            draft.package = provider.package
            draft.settings = { apiKey: "configured" }
          })
          catalog.model.update(provider.id, model.id, (draft) => {
            draft.cost = [...model.cost]
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.opencode)).settings?.apiKey).toBe("configured")
        expect(required(yield* catalog.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("ignores non-opencode providers and models", () =>
    withEnv({ OPENCODE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          const provider = ProviderV2.Info.make({
            ...ProviderV2.Info.empty(ProviderV2.ID.openai),
            package: ProviderV2.aisdk("test-provider"),
          })
          const model = ModelV2.Info.make({
            ...ModelV2.Info.empty(provider.id, ModelV2.ID.make("paid")),
            modelID: ModelV2.ID.make("paid"),
            package: ProviderV2.aisdk("test-provider"),
            cost: cost(1),
          })
          catalog.provider.update(provider.id, () => {})
          catalog.model.update(provider.id, model.id, (draft) => {
            draft.cost = [...model.cost]
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.openai)).settings?.apiKey).toBeUndefined()
        expect(required(yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("prefers gpt-5-nano as the opencode small model", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.opencode

      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("cheap-mini"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [...cost(1, 1)]
          model.time.released = Date.now()
        })
        catalog.model.update(providerID, ModelV2.ID.make("gpt-5-nano"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [...cost(10, 10)]
          model.time.released = Date.now()
        })
      })

      const selected = yield* catalog.model.small(providerID)

      expect(selected?.id).toBe(ModelV2.ID.make("gpt-5-nano"))
    }),
  )
})
