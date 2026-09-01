import { describe, expect } from "bun:test"
import { Bus } from "@opencode-ai/core/bus"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OpencodePlugin } from "@opencode-ai/core/plugin/provider/opencode"
import { Provider } from "@opencode-ai/core/provider"
import { State } from "@opencode-ai/core/state"
import { Effect, Fiber, Option, Stream } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("example")
const modelID = Model.ID.make("chat")
const hiddenID = Model.ID.make("hidden")

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, OpencodePlugin.id)
  yield* State.batch(OpencodePlugin.effect(host))
})

const connect = Effect.fn(function* (respond: (request: Request, attempt: number) => Response | Promise<Response>) {
  const requests: number[] = []
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) => {
          requests.push(performance.now())
          return respond(request, requests.length)
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
  const credentials = yield* Credential.Service
  yield* credentials.create({
    integrationID: Integration.ID.make("opencode"),
    value: Credential.Key.make({ type: "key", key: "test-key", metadata: { server: server.url.origin } }),
  })
  return requests
})

const inventory = () =>
  Response.json({
    config: {
      provider: {
        example: {
          name: "Example",
          npm: "@ai-sdk/openai-compatible",
          models: { chat: { name: "Example Chat" }, hidden: { name: "Hidden Chat" } },
        },
      },
    },
  })

describe("OpencodePlugin source recovery", () => {
  it.live("retries an initial 503 before plugin setup completes", () =>
    Effect.gen(function* () {
      const requests = yield* connect((_request, attempt) =>
        attempt === 1 ? new Response("Unavailable", { status: 503 }) : inventory(),
      )
      const catalog = yield* Catalog.Service

      yield* addPlugin().pipe(Effect.timeout("6 seconds"))

      expect(requests).toHaveLength(2)
      expect(requests.at(1)).toBeGreaterThanOrEqual((requests.at(0) ?? Infinity) + 180)
      expect((yield* catalog.model.get(providerID, modelID))?.name).toBe("Example Chat")
    }),
  )

  it.live(
    "backs off repeated background failures before recovering",
    () =>
      Effect.gen(function* () {
        const requests = yield* connect((_request, attempt) =>
          attempt < 7 ? new Response("Unavailable", { status: 503 }) : inventory(),
        )
        const catalog = yield* Catalog.Service
        const bus = yield* Bus.Service
        yield* addPlugin()
        const published = yield* bus
          .subscribe(Catalog.Event.Updated)
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))

        yield* Fiber.join(published)

        expect(requests).toHaveLength(7)
        expect(requests.at(6)).toBeGreaterThanOrEqual((requests.at(5) ?? Infinity) + 9800)
        expect((yield* catalog.model.get(providerID, modelID))?.name).toBe("Example Chat")
      }),
    20_000,
  )

  it.live(
    "recovers after setup without changing credentials and replays later catalog policy",
    () =>
      Effect.gen(function* () {
        const requested = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const retried = Promise.withResolvers<void>()
        const requests = yield* connect(async (_request, attempt) => {
          if (attempt <= 3) return new Response("Unavailable", { status: 503 })
          if (attempt > 4) retried.resolve()
          requested.resolve()
          await release.promise
          return inventory()
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        const catalog = yield* Catalog.Service
        const credentials = yield* Credential.Service
        const bus = yield* Bus.Service
        const before = yield* credentials.list(Integration.ID.make("opencode"))

        yield* addPlugin().pipe(Effect.timeout("6 seconds"))
        const ready = performance.now()
        expect(requests).toHaveLength(3)
        expect(requests.at(1)).toBeGreaterThanOrEqual((requests.at(0) ?? Infinity) + 180)
        expect(requests.at(2)).toBeGreaterThanOrEqual((requests.at(1) ?? Infinity) + 380)
        expect(yield* catalog.model.get(providerID, modelID)).toBeUndefined()
        yield* catalog.transform((draft) => {
          draft.model.remove(providerID, hiddenID)
          if (!draft.model.get(providerID, modelID)) return
          draft.model.update(providerID, modelID, (model) => {
            model.name = "Policy Chat"
          })
        })

        const published = yield* bus
          .subscribe(Catalog.Event.Updated)
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
        yield* Effect.promise(() => requested.promise).pipe(Effect.timeout("6 seconds"))
        expect(requests).toHaveLength(4)
        expect(requests.at(3)).toBeGreaterThanOrEqual(ready + 4800)
        expect(yield* catalog.model.get(providerID, modelID)).toBeUndefined()
        release.resolve()
        yield* Fiber.join(published).pipe(Effect.timeout("2 seconds"))

        expect((yield* catalog.model.get(providerID, modelID))?.name).toBe("Policy Chat")
        expect(yield* catalog.model.get(providerID, hiddenID)).toBeUndefined()
        expect((yield* catalog.model.available()).map((model) => model.id)).toEqual([modelID])
        expect(yield* credentials.list(Integration.ID.make("opencode"))).toEqual(before)
        expect(yield* Effect.promise(() => retried.promise).pipe(Effect.timeoutOption("5500 millis"))).toEqual(
          Option.none(),
        )
      }),
    15_000,
  )

  Object.entries({
    "401": () => new Response("Unauthorized", { status: 401 }),
    "403": () => new Response("Forbidden", { status: 403 }),
    "schema decode failure": () => Response.json({ config: { provider: false } }),
  }).forEach(([name, respond]) => {
    it.live(`does not retry ${name} during initial load`, () =>
      Effect.gen(function* () {
        const requests = yield* connect(respond)
        const catalog = yield* Catalog.Service

        yield* addPlugin()

        expect(requests).toHaveLength(1)
        expect(yield* catalog.model.get(providerID, modelID)).toBeUndefined()
      }),
    )
  })

  it.live(
    "stops background retries when an exhausted outage becomes nonretryable",
    () =>
      Effect.gen(function* () {
        const rejected = Promise.withResolvers<void>()
        const retried = Promise.withResolvers<void>()
        const requests = yield* connect((_request, attempt) => {
          if (attempt <= 3) return new Response("Unavailable", { status: 503 })
          if (attempt > 4) retried.resolve()
          rejected.resolve()
          return new Response("Unauthorized", { status: 401 })
        })
        const catalog = yield* Catalog.Service

        yield* addPlugin().pipe(Effect.timeout("6 seconds"))
        expect(requests).toHaveLength(3)
        yield* Effect.promise(() => rejected.promise).pipe(Effect.timeout("6 seconds"))
        expect(requests).toHaveLength(4)
        expect(yield* Effect.promise(() => retried.promise).pipe(Effect.timeoutOption("5500 millis"))).toEqual(
          Option.none(),
        )
        expect(yield* catalog.model.get(providerID, modelID)).toBeUndefined()
      }),
    15_000,
  )

  it.live(
    "bounds a pending initial load and aborts its request",
    () =>
      Effect.gen(function* () {
        const aborted = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const requests = yield* connect(async (request) => {
          request.signal.addEventListener("abort", () => aborted.resolve(), { once: true })
          await release.promise
          return inventory()
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        const catalog = yield* Catalog.Service

        yield* addPlugin().pipe(Effect.timeout("6 seconds"))

        expect(requests).toHaveLength(1)
        expect(performance.now()).toBeGreaterThanOrEqual((requests.at(0) ?? Infinity) + 4800)
        yield* Effect.promise(() => aborted.promise).pipe(Effect.timeout("1 second"))
        expect(yield* catalog.model.get(providerID, modelID)).toBeUndefined()
      }),
    10_000,
  )
})
