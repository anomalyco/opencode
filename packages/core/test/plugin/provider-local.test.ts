import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { createLocalProviderPlugin } from "@opencode/core/plugin/provider/local"
import { make } from "@opencode/core/plugin/provider/ollama"
import { Provider } from "@opencode/core/provider"
import { Document, Event, Info } from "@opencode/schema/config"
import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.provideMerge(ModelResolver.layer, PluginTestLayer))
const origin = "http://ollama.test/proxy"
const providerID = Provider.ID.make("ollama")
const modelID = Model.ID.make("configured")
const entry = (baseURL: string) =>
  new Document({
    type: "document",
    info: Schema.decodeUnknownSync(Info)({
      providers: { ollama: { settings: { baseURL }, models: { configured: {} } } },
    }),
  })

it.effect("resolves a configured Ollama model when discovery fails", () =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    const root = `http://ollama.test${location.directory}`
    const baseURL = `${root}/v1`
    const config = yield* Config.Test
    const models = yield* Model.Service
    const resolver = yield* ModelResolver.Service
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    const requested = yield* Deferred.make<string>()
    const http = HttpClient.make((request) =>
      Deferred.succeed(requested, request.url).pipe(
        Effect.as(HttpClientResponse.fromWeb(request, new Response(null, { status: 503 }))),
      ),
    )
    yield* config.setEntries([entry(baseURL)])
    yield* make(root).effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
    yield* ConfigProviderPlugin.Plugin.effect(host)
    expect(yield* Deferred.await(requested)).toBe(`${root}/api/tags`)
    const model = yield* models.get(providerID, modelID)
    if (!model) return yield* Effect.die("Configured model missing")
    const resolved = yield* resolver.resolveModel(model)
    expect(model.package).toBe("@opencode/ai/providers/openai-compatible")
    expect(resolved.model.route.endpoint.baseURL).toBe(baseURL)
  }),
)

it.effect("same-endpoint config reload preserves pending discovery", () =>
  Effect.gen(function* () {
    const config = yield* Config.Test
    const bus = yield* Bus.Service
    const models = yield* Model.Service
    const providers = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<readonly { id: string }[]>()
    const local = createLocalProviderPlugin({
      id: "test.local.discovery",
      providerID,
      name: "Ollama",
      origin,
      discover: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
      model: (item) => item,
    })
    yield* local().effect(host)
    yield* ConfigProviderPlugin.Plugin.effect(host)
    yield* Deferred.await(started)
    expect(yield* providers.get(providerID)).toBeUndefined()

    const changed = (id: Model.ID, present: boolean) =>
      bus.subscribe([Model.Event.Updated]).pipe(
        Stream.filterEffect(() =>
          models.get(providerID, id).pipe(Effect.map((model) => Boolean(model?.package) === present)),
        ),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkScoped({ startImmediately: true }),
      )
    const configured = yield* changed(modelID, true)
    yield* config.setEntries([entry(`${origin}/v1`)])
    yield* bus.publish(Event.Updated, {})
    yield* Fiber.join(configured)
    expect((yield* providers.get(providerID))?.package).toBe("@opencode/ai/providers/openai-compatible")

    const removed = yield* changed(modelID, false)
    yield* config.setEntries([])
    yield* bus.publish(Event.Updated, {})
    yield* Fiber.join(removed)
    expect(yield* providers.get(providerID)).toBeUndefined()

    const discoveredID = Model.ID.make("discovered")
    const discovered = yield* changed(discoveredID, true)
    yield* Deferred.succeed(release, [{ id: discoveredID }])
    yield* Fiber.join(discovered)
    expect(yield* models.get(providerID, discoveredID)).toBeDefined()
  }),
)
