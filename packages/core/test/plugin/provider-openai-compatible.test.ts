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
import { Effect, Layer, Schema } from "effect"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))
const decode = Schema.decodeUnknownSync(Info)

// Registers the config plugin first, matching production order, so discovery sees configured providers.
const addPlugins = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* ConfigProviderPlugin.Plugin.effect(host)
  yield* make("1 hour").effect(host)
})

// Bounded by elapsed time rather than attempts, so a slow plugin start on a busy machine still fits.
function eventually<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  predicate: (value: A) => boolean,
  deadline = Date.now() + 10_000,
): Effect.Effect<A, E | Error, R> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (Date.now() > deadline) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, deadline)
  })
}

// Shaped like LiteLLM, which only sometimes reports a mode.
const litellm = [
  { id: "configured-model", object: "model" },
  { id: "discovered-model", object: "model", mode: "chat" },
  { id: "untyped-model", object: "model", mode: null },
  { id: "embedding-model", object: "model", mode: "embedding" },
]

function serve(data: readonly Record<string, unknown>[] = litellm) {
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
      return Response.json({ object: "list", data })
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
          expect(discovered).toMatchObject({
            modelID: "discovered-model",
            name: "discovered-model",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
          })
          expect(yield* models.get(providerID, Model.ID.make("untyped-model"))).toBeDefined()
          expect(yield* models.get(providerID, Model.ID.make("embedding-model"))).toBeUndefined()
          expect(yield* models.get(providerID, Model.ID.make("configured-model"))).toMatchObject({
            name: "Configured",
            capabilities: Model.Capabilities.default(),
          })
          expect(requests).toEqual([{ path: "/litellm/v1/models", authorization: "Bearer secret", team: "core" }])
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("reads advertised modalities and tool support", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        serve([
          {
            id: "vision-model",
            architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
            supported_parameters: ["tools", "temperature"],
          },
          { id: "text-model", input_modalities: ["text"], supported_parameters: ["temperature"] },
        ]),
      ),
      ({ server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const models = yield* Model.Service
          const providerID = Provider.ID.make("gateway")
          yield* config.setEntries([
            configuration({
              gateway: { package: "@ai-sdk/openai-compatible", settings: { baseURL: `${server.url.origin}/v1` } },
            }),
          ])
          yield* addPlugins()

          const vision = yield* eventually(
            models.get(providerID, Model.ID.make("vision-model")),
            (model) => model !== undefined,
          )
          expect(vision).toMatchObject({ capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] } })
          expect(yield* models.get(providerID, Model.ID.make("text-model"))).toMatchObject({
            capabilities: { tools: false, input: ["text"], output: ["text"] },
          })
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
          yield* addPlugins()
          yield* eventually(models.get(providerID, Model.ID.make("discovered-model")), (model) => model !== undefined)

          // Config events refresh one at a time, so the second failed request proves the first refresh finished.
          state.failing = true
          const before = requests.length
          yield* bus.publish(Event.Updated, {})
          yield* bus.publish(Event.Updated, {})
          yield* eventually(
            Effect.sync(() => requests.length),
            (count) => count >= before + 2,
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
