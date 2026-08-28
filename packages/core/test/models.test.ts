import { describe, expect, test } from "bun:test"
import { Money } from "@opencode-ai/schema/money"
import path from "path"
import { Deferred, Effect, Fiber, Layer, Ref, Scope, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/util/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Model } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ModelsDevCache } from "@opencode-ai/core/models-dev/cache"
import { Provider } from "@opencode-ai/core/provider"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const source = "https://models.opencode.ai"

test("normalizes permissive interleaved values to compatibility", () => {
  expect(Model.compatibility("reasoning_text")).toEqual({ reasoningField: "reasoning_text" })
  expect(Model.compatibility({ field: "vendor_reasoning" })).toEqual({ reasoningField: "vendor_reasoning" })
  expect(Model.compatibility(true)).toBeUndefined()
  expect(Model.compatibility(false)).toBeUndefined()
})

const fixture = {
  acme: {
    id: "acme",
    name: "Acme",
    env: ["ACME_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    models: {
      "acme-1": {
        id: "acme-1",
        name: "Acme One",
        release_date: "2026-01-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        interleaved: { field: "vendor_reasoning" },
        limit: { context: 128000, output: 8192 },
      },
    },
  },
}

const fixtureSnapshot = [
  {
    info: {
      id: Provider.ID.make("acme"),
      name: "Acme",
      activation: "auto",
      package: Provider.aisdk("@ai-sdk/openai-compatible"),
    },
    models: [
      {
        id: Model.ID.make("acme-1"),
        modelID: Model.ID.make("acme-1"),
        providerID: Provider.ID.make("acme"),
        name: "Acme One",
        compatibility: { reasoningField: "vendor_reasoning" },
        family: undefined,
        package: undefined,
        settings: undefined,
        capabilities: { tools: true, input: [], output: [] },
        variants: [],
        time: { released: Date.parse("2026-01-01") },
        cost: [
          {
            input: Money.USDPerMillionTokens.zero,
            output: Money.USDPerMillionTokens.zero,
            cache: {
              read: Money.USDPerMillionTokens.zero,
              write: Money.USDPerMillionTokens.zero,
            },
          },
        ],
        status: "active",
        enabled: true,
        limit: { context: 128000, input: undefined, output: 8192 },
        headers: undefined,
        body: undefined,
      },
    ],
    environment: ["ACME_API_KEY"],
  },
] satisfies readonly ModelsDev.Snapshot[]

const fixture2 = {
  beta: {
    id: "beta",
    name: "Beta",
    env: ["BETA_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    models: {
      "beta-1": {
        id: "beta-1",
        name: "Beta One",
        release_date: "2026-02-01",
        attachment: false,
        reasoning: true,
        temperature: false,
        tool_call: false,
        limit: { context: 64000, output: 4096 },
      },
    },
  },
}

const fixture2Snapshot = [
  {
    info: {
      id: Provider.ID.make("beta"),
      name: "Beta",
      activation: "auto",
      package: Provider.aisdk("@ai-sdk/openai-compatible"),
    },
    models: [
      {
        id: Model.ID.make("beta-1"),
        modelID: Model.ID.make("beta-1"),
        providerID: Provider.ID.make("beta"),
        name: "Beta One",
        family: undefined,
        package: undefined,
        settings: undefined,
        capabilities: { tools: false, input: [], output: [] },
        variants: [],
        time: { released: Date.parse("2026-02-01") },
        cost: [
          {
            input: Money.USDPerMillionTokens.zero,
            output: Money.USDPerMillionTokens.zero,
            cache: {
              read: Money.USDPerMillionTokens.zero,
              write: Money.USDPerMillionTokens.zero,
            },
          },
        ],
        status: "active",
        enabled: true,
        limit: { context: 64000, input: undefined, output: 4096 },
        headers: undefined,
        body: undefined,
      },
    ],
    environment: ["BETA_API_KEY"],
  },
] satisfies readonly ModelsDev.Snapshot[]

interface MockState {
  body: string
  status: number
  calls: Array<{ url: string; userAgent: string | null }>
}

const makeMockClient = (state: Ref.Ref<MockState>) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(state, (s) => ({
        ...s,
        calls: [...s.calls, { url: request.url, userAgent: request.headers["user-agent"] ?? null }],
      }))
      const s = yield* Ref.get(state)
      return HttpClientResponse.fromWeb(request, new Response(s.body, { status: s.status }))
    }),
  )

interface MockCache {
  readonly values: Map<string, ModelsDevCache.Entry>
}

const makeMockCache = (cache: MockCache) =>
  Layer.succeed(ModelsDevCache.Service, {
    read: (source) => Effect.sync(() => cache.values.get(source)),
    write: (source, body) =>
      Effect.sync(() => cache.values.set(source, { updatedAt: Date.now(), body })).pipe(Effect.asVoid),
  })

const buildLayer = (
  state: Ref.Ref<MockState>,
  cache: MockCache,
  options: ModelsDev.Options = { fetch: false },
  persistence = makeMockCache(cache),
) =>
  Layer.fresh(
    AppNodeBuilder.build(LayerNode.group([ModelsDev.node, Bus.node]), [
      [ModelsDev.node, ModelsDev.configured(options)],
      [LayerNodePlatform.httpClient, Layer.succeed(HttpClient.HttpClient, makeMockClient(state))],
      [ModelsDevCache.node, persistence],
    ]),
  )

const makeFailingWriteCache = (cache: MockCache) =>
  Layer.succeed(ModelsDevCache.Service, {
    read: (source) => Effect.sync(() => cache.values.get(source)),
    write: () => Effect.die(new Error("Cache write failed")),
  })

const makeCache = (): MockCache => ({ values: new Map() })

const writeCacheText = (cache: MockCache, text: string, updatedAt = Date.now()) =>
  cache.values.set(source, { updatedAt, body: text })

const writeCache = (cache: MockCache, data: object, updatedAt?: number) =>
  writeCacheText(cache, JSON.stringify(data), updatedAt)

const provided = <A, E>(
  state: Ref.Ref<MockState>,
  cache: MockCache,
  eff: Effect.Effect<A, E, ModelsDev.Service | Bus.Service | Scope.Scope>,
) => eff.pipe(Effect.provide(buildLayer(state, cache)))

const initialState: MockState = {
  body: JSON.stringify(fixture),
  status: 200,
  calls: [],
}

describe("ModelsDev Service", () => {
  it.live("get() returns normalized snapshots from the persisted cache", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture)
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result).toEqual(fixtureSnapshot)
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("normalizes provider and model AI SDK packages from models.dev", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, {
        acme: {
          ...fixture.acme,
          models: {
            "acme-1": {
              ...fixture.acme.models["acme-1"],
              provider: { npm: "@ai-sdk/openai" },
            },
          },
        },
      })
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((service) => service.get()),
      )
      expect(result[0]?.info.package).toBe(Provider.aisdk("@ai-sdk/openai-compatible"))
      expect(result[0]?.models[0]?.package).toBe(Provider.aisdk("@ai-sdk/openai"))
    }),
  )

  it.live("get() returns empty catalog when the cache, fetch, and bundled snapshot are unavailable", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make(initialState)
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(
        Effect.provide(buildLayer(state, cache, { fetch: false, snapshot: false })),
      )
      expect(result).toEqual([])
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("get() falls back to the bundled snapshot when the cache is empty and fetch is disabled", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result.length).toBeGreaterThan(0)
      const anthropic = result.find((snapshot) => snapshot.info.id === "anthropic")
      expect(anthropic?.environment).toContain("ANTHROPIC_API_KEY")
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("get() recovers from a corrupted cache by fetching a fresh catalog", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCacheText(cache, "{")
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const context = yield* Layer.build(buildLayer(state, cache, { fetch: true, snapshot: false }))
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(context))
      expect(result).toEqual(fixture2Snapshot)
      expect(cache.values.get(source)).toMatchObject({ body: JSON.stringify(fixture2) })
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
    }),
  )

  it.live("get() still populates the catalog when persistence fails", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const layer = buildLayer(state, cache, { fetch: true, snapshot: false }, makeFailingWriteCache(cache))
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(layer))
      expect(result).toEqual(fixture2Snapshot)
      expect(cache.values.has(source)).toBe(false)
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
    }),
  )

  for (const seeded of [false, true]) {
    it.live(`refresh adopts and publishes the fetched catalog when persistence fails (seeded=${seeded})`, () =>
      Effect.gen(function* () {
        const cache = makeCache()
        if (seeded) writeCache(cache, fixture)
        const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
        yield* Effect.gen(function* () {
          const models = yield* ModelsDev.Service
          const bus = yield* Bus.Service
          expect(yield* models.get()).not.toEqual(fixture2Snapshot)
          const event = yield* bus.subscribe(ModelsDev.Event.Refreshed).pipe(
            Stream.take(1),
            Stream.runDrain,
            Effect.andThen(() => models.get()),
            Effect.forkScoped({ startImmediately: true }),
          )
          yield* models.refresh(true)
          expect(yield* Fiber.join(event)).toEqual(fixture2Snapshot)
          expect(yield* models.get()).toEqual(fixture2Snapshot)
          yield* models.refresh()
          expect((yield* Ref.get(state)).calls).toHaveLength(1)
        }).pipe(Effect.provide(buildLayer(state, cache, { fetch: false }, makeFailingWriteCache(cache))))
        expect(cache.values.get(source)?.body).toBe(seeded ? JSON.stringify(fixture) : undefined)
      }),
    )
  }

  it.live("a failed cache read falls back to the bundled snapshot without blocking refresh", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make(initialState)
      yield* Effect.gen(function* () {
        const models = yield* ModelsDev.Service
        expect((yield* models.get()).length).toBeGreaterThan(0)
        yield* models.refresh(true)
        expect(yield* models.get()).toEqual(fixtureSnapshot)
      }).pipe(
        Effect.provide(
          buildLayer(
            state,
            cache,
            { fetch: false },
            Layer.succeed(ModelsDevCache.Service, {
              read: () => Effect.die(new Error("Cache read failed")),
              write: () => Effect.void,
            }),
          ),
        ),
      )
      expect((yield* Ref.get(state)).calls).toHaveLength(1)
    }),
  )

  it.live("refresh publishes the live catalog while its cache write is still pending", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const writing = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* Effect.gen(function* () {
        const models = yield* ModelsDev.Service
        const bus = yield* Bus.Service
        expect(yield* models.get()).toEqual(fixtureSnapshot)
        const event = yield* bus
          .subscribe(ModelsDev.Event.Refreshed)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        const refresh = yield* models.refresh(true).pipe(Effect.forkScoped)
        yield* Deferred.await(writing)
        yield* Fiber.join(event).pipe(Effect.timeout("1 second"))
        expect(yield* models.get()).toEqual(fixture2Snapshot)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(refresh)
      }).pipe(
        Effect.provide(
          buildLayer(
            state,
            cache,
            { fetch: false },
            Layer.succeed(ModelsDevCache.Service, {
              read: () => Effect.succeed(cache.values.get(source)),
              write: () => Deferred.succeed(writing, undefined).pipe(Effect.andThen(Deferred.await(release))),
            }),
          ),
        ),
      )
    }),
  )

  it.live("get() can use the bundled snapshot while the initial background fetch is pending", () =>
    Effect.gen(function* () {
      const reading = yield* Deferred.make<void>()
      const releaseRead = yield* Deferred.make<void>()
      const fetching = yield* Deferred.make<void>()
      const releaseFetch = yield* Deferred.make<void>()
      const layer = Layer.fresh(
        AppNodeBuilder.build(ModelsDev.node, [
          [ModelsDev.node, ModelsDev.configured({ fetch: true })],
          [
            ModelsDevCache.node,
            Layer.succeed(ModelsDevCache.Service, {
              read: () =>
                Deferred.succeed(reading, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseRead)),
                  Effect.as(undefined),
                ),
              write: () => Effect.void,
            }),
          ],
          [
            LayerNodePlatform.httpClient,
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Deferred.succeed(fetching, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseFetch)),
                  Effect.as(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(fixture)))),
                ),
              ),
            ),
          ],
        ]),
      )
      yield* Effect.gen(function* () {
        const models = yield* ModelsDev.Service
        yield* Deferred.await(reading)
        const get = yield* models.get().pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.succeed(releaseRead, undefined)
        yield* Deferred.await(fetching)
        expect((yield* Fiber.join(get).pipe(Effect.timeout("1 second"))).length).toBeGreaterThan(0)
        yield* Deferred.succeed(releaseFetch, undefined)
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("cancelling a reader during initialization does not poison later reads or refreshes", () =>
    Effect.gen(function* () {
      const reading = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      yield* Effect.gen(function* () {
        const models = yield* ModelsDev.Service
        const first = yield* models.get().pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(reading)
        yield* Fiber.interrupt(first)
        yield* Deferred.succeed(release, undefined)
        expect(yield* models.get()).toEqual(fixtureSnapshot)
        yield* models.refresh(true)
        expect(yield* models.get()).toEqual(fixture2Snapshot)
      }).pipe(
        Effect.provide(
          buildLayer(
            state,
            makeCache(),
            { fetch: false },
            Layer.succeed(ModelsDevCache.Service, {
              read: () =>
                Deferred.succeed(reading, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.as({ body: JSON.stringify(fixture), updatedAt: Date.now() }),
                ),
              write: () => Effect.void,
            }),
          ),
        ),
      )
    }),
  )

  it.live("custom source URLs do not read or overwrite the default source cache", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const result = yield* ModelsDev.Service.use((models) => models.get()).pipe(
        Effect.provide(buildLayer(state, cache, { url: "https://catalog.example", fetch: true, snapshot: false })),
      )
      expect(result).toEqual(fixture2Snapshot)
      expect(cache.values.get(source)?.body).toBe(JSON.stringify(fixture))
      expect(cache.values.get("https://catalog.example")?.body).toBe(JSON.stringify(fixture2))
      expect((yield* Ref.get(state)).calls[0]?.url).toBe("https://catalog.example/api.json")
    }),
  )

  it.live("an explicit file remains authoritative and refresh rereads it without HTTP or cache access", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const file = path.join(dir.path, "catalog.json")
      yield* Effect.promise(() => Bun.write(file, JSON.stringify(fixture)))
      const state = yield* Ref.make(initialState)
      const cacheCalls: string[] = []
      yield* Effect.gen(function* () {
        const models = yield* ModelsDev.Service
        expect(yield* models.get()).toEqual(fixtureSnapshot)
        yield* Effect.promise(() => Bun.write(file, JSON.stringify(fixture2)))
        yield* models.refresh(true)
        expect(yield* models.get()).toEqual(fixture2Snapshot)
      }).pipe(
        Effect.provide(
          buildLayer(
            state,
            makeCache(),
            { file, fetch: false },
            Layer.succeed(ModelsDevCache.Service, {
              read: () =>
                Effect.sync(() => {
                  cacheCalls.push("read")
                  return undefined
                }),
              write: () => Effect.sync(() => void cacheCalls.push("write")),
            }),
          ),
        ),
      )
      expect((yield* Ref.get(state)).calls).toEqual([])
      expect(cacheCalls).toEqual([])
    }),
  )

  it.live("uses the default models URL when the configured URL is empty", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make(initialState)
      yield* ModelsDev.Service.use((service) => service.get()).pipe(
        Effect.provide(buildLayer(state, cache, { url: "", fetch: true, snapshot: false })),
      )
      expect((yield* Ref.get(state)).calls[0]?.url).toBe("https://models.opencode.ai/api.json")
    }),
  )

  it.live("get() is single-flight under concurrent calls", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make(initialState)
      const results = yield* Effect.gen(function* () {
        const svc = yield* ModelsDev.Service
        return yield* Effect.all([svc.get(), svc.get(), svc.get(), svc.get(), svc.get()], {
          concurrency: "unbounded",
        })
      }).pipe(Effect.provide(buildLayer(state, cache, { fetch: true, snapshot: false })))
      for (const result of results) expect(result).toEqual(fixtureSnapshot)
      expect((yield* Ref.get(state)).calls.length).toBe(1)
    }),
  )

  it.live("get() retains the live catalog instead of rereading persistence", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture)
      const state = yield* Ref.make(initialState)
      const first = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const a = yield* svc.get()
          writeCache(cache, fixture2)
          const b = yield* svc.get()
          return { a, b }
        }),
      )
      expect(first.a).toEqual(fixtureSnapshot)
      expect(first.b).toEqual(fixtureSnapshot)
    }),
  )

  it.live("refresh(true) fetches via HttpClient and updates the cache", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const result = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const before = yield* svc.get()
          yield* svc.refresh(true)
          const after = yield* svc.get()
          return { before, after }
        }),
      )
      expect(result.before).toEqual(fixtureSnapshot)
      expect(result.after).toEqual(fixture2Snapshot)
      expect(cache.values.get(source)).toMatchObject({ body: JSON.stringify(fixture2) })
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(final.calls[0].url).toContain("/api.json")
      expect(final.calls[0].userAgent).toContain("/opencode")
    }),
  )

  it.live("refresh(false) skips fetch when the persisted catalog is fresh", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      yield* provided(
        state,
        cache,
        ModelsDev.Service.use((s) => s.refresh(false)),
      )
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("refresh(false) fetches when the persisted catalog is stale", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 10 * 60 * 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const after = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const bus = yield* Bus.Service
          const refreshed = yield* bus.subscribe(ModelsDev.Event.Refreshed).pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped,
            Effect.flatMap((fiber) =>
              Effect.gen(function* () {
                yield* Effect.yieldNow
                yield* svc.refresh(false)
                return yield* Fiber.join(fiber)
              }),
            ),
          )
          expect(refreshed.length).toBe(1)
          return yield* svc.get()
        }),
      )
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(after).toEqual(fixture2Snapshot)
    }),
  )

  it.live("refresh(false) stays quiet when the fetched body matches the cached digest", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 10 * 60 * 1000)
      const seeded = structuredClone(cache.values.get(source))
      // The server serves a byte-identical body, so the refresh still hits
      // the network but must not rewrite the cache or publish Refreshed.
      const state = yield* Ref.make(initialState)
      yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const bus = yield* Bus.Service
          const event = yield* bus.subscribe(ModelsDev.Event.Refreshed).pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped,
            Effect.flatMap((fiber) =>
              Effect.gen(function* () {
                yield* Effect.yieldNow
                yield* svc.refresh(false)
                return yield* Fiber.join(fiber).pipe(Effect.timeoutOption("50 millis"))
              }),
            ),
          )
          expect(event._tag).toBe("None")
        }),
      )
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(cache.values.get(source)).toEqual(seeded)
    }),
  )

  it.live("concurrent refreshes share the freshness check even when the body is unchanged", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 10 * 60 * 1000)
      const state = yield* Ref.make(initialState)
      yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* Effect.all([svc.refresh(), svc.refresh(), svc.refresh()], { concurrency: "unbounded" })
        }),
      )
      expect((yield* Ref.get(state)).calls).toHaveLength(1)
    }),
  )

  it.live("refresh swallows HTTP errors and leaves cache intact", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture)
      const state = yield* Ref.make({ ...initialState, status: 500, body: "boom" })
      const result = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          return yield* svc.get()
        }),
      )
      expect(result).toEqual(fixtureSnapshot)
      // retryTransient retries 5xx, so calls may be > 1.
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBeGreaterThanOrEqual(1)
    }),
  )

  for (const body of ["{", JSON.stringify({ broken: {} })]) {
    it.live(`refresh preserves the live and persisted catalog when the response is invalid: ${body}`, () =>
      Effect.gen(function* () {
        const cache = makeCache()
        writeCache(cache, fixture)
        const state = yield* Ref.make({ ...initialState, body })
        yield* provided(
          state,
          cache,
          Effect.gen(function* () {
            const models = yield* ModelsDev.Service
            const before = yield* models.get()
            yield* models.refresh(true)
            expect(yield* models.get()).toBe(before)
          }),
        )
        expect(cache.values.get(source)?.body).toBe(JSON.stringify(fixture))
      }),
    )
  }
})
