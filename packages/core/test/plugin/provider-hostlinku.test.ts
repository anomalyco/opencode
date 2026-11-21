import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { HostlinkuPlugin } from "@opencode/core/plugin/provider/hostlinku"
import { Money } from "@opencode/schema/money"
import { drain } from "../lib/clock"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("hostlinku")
const integrationID = Integration.ID.make("hostlinku")

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "test")
  yield* HostlinkuPlugin.effect(host)
})

const createKey = Effect.fn(function* (key: string, metadata?: Record<string, string>) {
  const credentials = yield* Credential.Service
  return yield* credentials.create({
    integrationID,
    value: Credential.Key.make({ type: "key", key, ...(metadata ? { metadata } : {}) }),
  })
})

const setup = Effect.gen(function* () {
  const providers = yield* Provider.Service
  const models = yield* Model.Service
  const integrations = yield* Integration.Service

  yield* providers.transform((draft) => {
    draft.update(providerID, (provider) => {
      provider.name = "Hostlinku"
      provider.package = "@opencode/ai/providers/openai-compatible"
      provider.settings = { baseURL: "https://api.hostlinku.com/v1" }
    })
    draft.models.update(providerID, Model.ID.make("claude-sonnet-5"), (model) => {
      model.name = "Claude Sonnet 5 (Catalog)"
      model.family = Model.Family.make("claude-sonnet")
      model.package = "@opencode/ai/providers/anthropic-compatible"
      model.variants = [{ id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } }]
      model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
      model.limit = { context: 1_000_000, output: 128_000 }
    })
    draft.models.update(providerID, Model.ID.make("catalog-only-excluded"), () => {})
  })

  const remote: {
    status: number
    body: unknown
    requests: HttpClientRequest.HttpClientRequest[]
    responder?: (request: HttpClientRequest.HttpClientRequest) => Response
  } = {
    status: 200,
    body: {
      service_mode: "economy",
      data: [
        {
          id: "claude-sonnet-5",
          display_name: "Claude Sonnet 5",
          context_window: 1_000_000,
          max_output_tokens: 128_000,
          capabilities: ["chat", "tool-calling", "vision"],
          service_mode: "economy",
          pricing: { input: 1.5, output: 7.5, cache_read: 0.15, cache_write: 1.875 },
        },
        {
          id: "deepseek-v3",
          service_mode: "economy",
          pricing: { input: 0.25, output: 1.0, cache_read: 0.025, cache_write: null },
        },
      ],
    },
    requests: [],
  }

  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      remote.requests.push(request)
      if (remote.responder) return HttpClientResponse.fromWeb(request, remote.responder(request))
      return HttpClientResponse.fromWeb(request, Response.json(remote.body, { status: remote.status }))
    }),
  )

  return {
    providers,
    models,
    integrations,
    remote,
    install: addPlugin().pipe(Effect.provideService(HttpClient.HttpClient, http)),
  }
})

describe("HostlinkuPlugin", () => {
  test("is registered in ProviderPlugins", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.hostlinku")
  })

  it.effect("registers Hostlinku integration methods", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      yield* fixture.install
      expect((yield* fixture.integrations.get(integrationID))?.methods).toEqual([
        { type: "env", names: ["HOSTLINKU_API_KEY"] },
        { type: "key", label: "Hostlinku API key" },
      ])
    }),
  )

  it.effect(
    "maps /v1/models onto models.dev catalog entries without guessing capabilities for uncataloged models",
    () =>
      Effect.gen(function* () {
        const fixture = yield* setup
        yield* createKey("sk-hl-economy-key")
        yield* fixture.install
        yield* drain

        expect(fixture.remote.requests).toHaveLength(1)
        expect(fixture.remote.requests[0]).toMatchObject({
          method: "GET",
          url: "https://api.hostlinku.com/v1/models",
          headers: { authorization: "Bearer sk-hl-economy-key", accept: "application/json" },
        })

        const claude = yield* fixture.models.get(providerID, Model.ID.make("claude-sonnet-5"))
        expect(claude).toMatchObject({
          name: "Claude Sonnet 5",
          family: Model.Family.make("claude-sonnet"),
          package: "@opencode/ai/providers/anthropic-compatible",
          capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
          limit: { context: 1_000_000, output: 128_000 },
        })
        expect(claude?.variants.map((v) => v.id)).toEqual([Model.VariantID.make("high")])
        expect(claude?.cost[0]).toMatchObject({
          input: Money.USDPerMillionTokens.make(1.5),
          output: Money.USDPerMillionTokens.make(7.5),
          cache: {
            read: Money.USDPerMillionTokens.make(0.15),
            write: Money.USDPerMillionTokens.make(1.875),
          },
        })

        // Uncataloged model omitting capabilities and context_window must not inherit image input or 200k defaults.
        const deepseek = yield* fixture.models.get(providerID, Model.ID.make("deepseek-v3"))
        expect(deepseek).toMatchObject({
          name: "deepseek-v3",
          compatibility: undefined,
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          limit: { context: 0, output: 0 },
        })
        expect(deepseek?.cost[0]).toMatchObject({
          input: Money.USDPerMillionTokens.make(0.25),
          output: Money.USDPerMillionTokens.make(1.0),
          cache: {
            read: Money.USDPerMillionTokens.make(0.025),
            write: Money.USDPerMillionTokens.zero,
          },
        })

        expect(yield* fixture.models.get(providerID, Model.ID.make("catalog-only-excluded"))).toBeUndefined()
      }),
  )

  it.effect("marks connection as needs_auth on 401 and switches inventory cleanly between keys", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const credentials = yield* Credential.Service
      const first = yield* createKey("sk-hl-valid")
      yield* fixture.install
      yield* drain

      expect(yield* fixture.models.get(providerID, Model.ID.make("claude-sonnet-5"))).toBeDefined()

      fixture.remote.responder = (request) => {
        if (request.headers.authorization === "Bearer sk-hl-invalid") {
          return Response.json({ error: "invalid key" }, { status: 401 })
        }
        if (request.headers.authorization === "Bearer sk-hl-valid") {
          return Response.json(fixture.remote.body)
        }
        return Response.json({
          service_mode: "dedicated",
          data: [
            {
              id: "kimi-k3-1-pro-hyper",
              display_name: "Kimi K3.1 Pro Hyper",
              context_window: 1_048_576,
              max_output_tokens: 131_072,
              pricing: { input: 6.78, output: 33.9 },
            },
          ],
        })
      }

      const invalid = yield* createKey("sk-hl-invalid")
      yield* drain
      expect(yield* fixture.models.get(providerID, Model.ID.make("claude-sonnet-5"))).toBeUndefined()
      const integration = yield* fixture.integrations.get(integrationID)
      const invalidConn = integration?.connections.find((c) => c.type === "credential" && c.id === invalid.id)
      expect(invalidConn?.status).toEqual({
        status: "needs_auth",
        message: "Invalid Hostlinku API key. Reconnect Hostlinku with a valid key.",
      })

      yield* createKey("sk-hl-dedicated", { baseURL: "https://custom.hostlinku.test/v1/" })
      yield* drain
      expect(fixture.remote.requests.at(-1)?.url).toBe("https://custom.hostlinku.test/v1/models")
      expect(yield* fixture.models.get(providerID, Model.ID.make("kimi-k3-1-pro-hyper"))).toMatchObject({
        name: "Kimi K3.1 Pro Hyper",
        settings: { baseURL: "https://custom.hostlinku.test/v1" },
        limit: { context: 1_048_576, output: 131_072 },
      })

      // Switching back to the first key serves cached models immediately (and refreshes in background).
      yield* credentials.activate(first.id)
      yield* drain
      expect(yield* fixture.models.get(providerID, Model.ID.make("claude-sonnet-5"))).toBeDefined()
    }),
  )
})
