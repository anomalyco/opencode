import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { make } from "@opencode/core/plugin/provider/openai-compatible"
import { Provider } from "@opencode/core/provider"
import { Document, Event, Info } from "@opencode/schema/config"
import { describe, expect } from "bun:test"
import { type Duration, Effect, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))
const decode = Schema.decodeUnknownSync(Info)

// Registers the config plugin first, matching production order, so discovery sees configured providers.
const addPlugins = Effect.fn(function* (interval: Duration.Input = "1 hour") {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* ConfigProviderPlugin.Plugin.effect(host)
  yield* make(interval).effect(host)
})

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 3000,
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

function serve() {
  const state = { failing: false }
  const requests: Array<{ path: string; authorization: string | null; team: string | null }> = []
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      requests.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        team: request.headers.get("x-team"),
      })
      if (state.failing) return new Response(null, { status: 503 })
      // Shaped like LiteLLM, which only sometimes reports a mode.
      return Response.json({
        object: "list",
        data: [
          { id: "configured-model", object: "model" },
          { id: "discovered-model", object: "model", mode: "chat" },
          { id: "untyped-model", object: "model", mode: null },
          { id: "embedding-model", object: "model", mode: "embedding" },
        ],
      })
    },
  })
  return { state, requests, server }
}

function configuration(providers: Record<string, unknown>) {
  return new Document({ type: "document", info: decode({ providers }) })
}

describe("OpenAICompatiblePlugin", () => {
  it.live("adds discovered models to configured OpenAI-compatible providers without replacing configured ones", () =>
    Effect.acquireUseRelease(
      Effect.sync(serve),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const models = yield* Model.Service
          const providerID = Provider.ID.make("litellm")
          yield* config.setEntries([
            configuration({
              litellm: {
                package: "@ai-sdk/openai-compatible",
                settings: { baseURL: `${server.url.origin}/litellm/v1/`, apiKey: "secret" },
                headers: { "x-team": "core" },
                models: { "configured-model": { name: "Configured" } },
              },
              mistral: { package: "@ai-sdk/mistral", settings: { baseURL: `${server.url.origin}/mistral` } },
              ollama: { package: "@ai-sdk/openai-compatible", settings: { baseURL: `${server.url.origin}/ollama/v1` } },
            }),
          ])
          yield* addPlugins()

          const discovered = yield* eventually(
            models.get(providerID, Model.ID.make("discovered-model")),
            (model) => model !== undefined,
          )
          expect(discovered).toMatchObject({ modelID: "discovered-model", name: "discovered-model" })
          expect(yield* models.get(providerID, Model.ID.make("untyped-model"))).toBeDefined()
          expect(yield* models.get(providerID, Model.ID.make("embedding-model"))).toBeUndefined()
          expect(yield* models.get(providerID, Model.ID.make("configured-model"))).toMatchObject({
            name: "Configured",
          })
          expect(requests).toEqual([{ path: "/litellm/v1/models", authorization: "Bearer secret", team: "core" }])
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("lets config disable a discovered model that reports no mode", () =>
    Effect.acquireUseRelease(
      Effect.sync(serve),
      ({ server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const models = yield* Model.Service
          const providerID = Provider.ID.make("litellm")
          yield* config.setEntries([
            configuration({
              litellm: {
                package: "@ai-sdk/openai-compatible",
                settings: { baseURL: `${server.url.origin}/v1` },
                models: { "untyped-model": { disabled: true } },
              },
            }),
          ])
          yield* addPlugins()

          yield* eventually(models.get(providerID, Model.ID.make("discovered-model")), (model) => model !== undefined)
          expect(yield* models.get(providerID, Model.ID.make("untyped-model"))).toMatchObject({ enabled: false })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("discovers keyless providers and prefers a stored key over the configured one", () =>
    Effect.acquireUseRelease(
      Effect.sync(serve),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const credentials = yield* Credential.Service
          const models = yield* Model.Service
          yield* config.setEntries([
            configuration({
              local: { package: "@ai-sdk/openai-compatible", settings: { baseURL: `${server.url.origin}/local/v1` } },
              gateway: {
                package: "@opencode/ai/providers/openai-compatible",
                settings: { baseURL: `${server.url.origin}/gateway/v1`, apiKey: "configured" },
              },
            }),
          ])
          yield* credentials.create({
            integrationID: Integration.ID.make("gateway"),
            value: Credential.Key.make({ type: "key", key: "stored" }),
          })
          yield* addPlugins()

          yield* eventually(
            models.get(Provider.ID.make("gateway"), Model.ID.make("discovered-model")),
            (model) => model !== undefined,
          )
          expect(yield* models.get(Provider.ID.make("local"), Model.ID.make("discovered-model"))).toBeDefined()
          expect(requests).toContainEqual({ path: "/local/v1/models", authorization: null, team: null })
          expect(requests).toContainEqual({ path: "/gateway/v1/models", authorization: "Bearer stored", team: null })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("uses the key from the provider's configured environment variable", () =>
    withEnv({ DISCOVERY_ACME_KEY: "from-env" }, () =>
      Effect.acquireUseRelease(
        Effect.sync(serve),
        ({ requests, server }) =>
          Effect.gen(function* () {
            const config = yield* Config.Test
            const models = yield* Model.Service
            yield* config.setEntries([
              configuration({
                acme: {
                  env: ["DISCOVERY_ACME_KEY"],
                  package: "@opencode/ai/providers/openai-compatible",
                  settings: { baseURL: `${server.url.origin}/v1` },
                },
              }),
            ])
            yield* addPlugins()

            yield* eventually(
              models.get(Provider.ID.make("acme"), Model.ID.make("discovered-model")),
              (model) => model !== undefined,
            )
            expect(requests).toContainEqual({ path: "/v1/models", authorization: "Bearer from-env", team: null })
          }),
        ({ server }) => Effect.promise(() => server.stop(true)),
      ),
    ),
  )

  it.live("discovers models for providers migrated from a V1 config", () =>
    Effect.acquireUseRelease(
      Effect.sync(serve),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const models = yield* Model.Service
          const normalized = ConfigNormalize.normalize({
            provider: {
              litellm: {
                npm: "@ai-sdk/openai-compatible",
                options: { baseURL: `${server.url.origin}/v1`, apiKey: "secret" },
              },
            },
          })
          if (normalized.type !== "normalized") return yield* Effect.fail(new Error("V1 config was rejected"))
          const info = decode(normalized.encoded)
          expect(info.providers?.litellm?.package).toBe("aisdk:@ai-sdk/openai-compatible")
          yield* config.setEntries([new Document({ type: "document", info })])
          yield* addPlugins()

          yield* eventually(
            models.get(Provider.ID.make("litellm"), Model.ID.make("discovered-model")),
            (model) => model !== undefined,
          )
          expect(requests).toContainEqual({ path: "/v1/models", authorization: "Bearer secret", team: null })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("keeps the last inventory through outages and drops it when the endpoint changes", () =>
    Effect.acquireUseRelease(
      Effect.sync(serve),
      ({ state, requests, server }) =>
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          const config = yield* Config.Test
          const models = yield* Model.Service
          const providerID = Provider.ID.make("litellm")
          const entries = (path: string) => [
            configuration({
              litellm: {
                package: "@ai-sdk/openai-compatible",
                settings: { baseURL: `${server.url.origin}${path}` },
              },
            }),
          ]
          yield* config.setEntries(entries("/first/v1"))
          yield* addPlugins("5 millis")
          yield* eventually(models.get(providerID, Model.ID.make("discovered-model")), (model) => model !== undefined)

          state.failing = true
          const failed = requests.length
          yield* eventually(
            Effect.sync(() => requests.length),
            (count) => count > failed + 2,
          )
          expect(yield* models.get(providerID, Model.ID.make("discovered-model"))).toBeDefined()

          yield* config.setEntries(entries("/second/v1"))
          yield* bus.publish(Event.Updated, {})
          yield* eventually(models.get(providerID, Model.ID.make("discovered-model")), (model) => model === undefined)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
})
