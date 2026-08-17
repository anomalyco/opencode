import { describe, expect, test } from "bun:test"
import { Money } from "@opencode-ai/schema/money"
import { Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/util/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { KV } from "@opencode-ai/core/kv"
import { Model } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@opencode-ai/core/provider"
import { it } from "./lib/effect"

const cacheKey = "models-dev:catalog"

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
  readonly values: Map<string, KV.Value>
}

const makeMockKV = (cache: MockCache) =>
  Layer.mock(KV.Service, {
    get: (key) => Effect.sync(() => cache.values.get(key)),
    set: (key, value) => Effect.sync(() => cache.values.set(key, value)).pipe(Effect.asVoid),
    remove: (key) => Effect.sync(() => cache.values.delete(key)).pipe(Effect.asVoid),
  })

const buildLayer = (state: Ref.Ref<MockState>, cache: MockCache, options: ModelsDev.Options = { fetch: false }) =>
  // Layer.fresh is required because the ModelsDev implementation is a module-level Layer constant,
  // and Effect.provide uses a process-global MemoMap by default — without fresh,
  // every test would reuse the cachedInvalidateWithTTL state from the first run.
  Layer.fresh(
    AppNodeBuilder.build(ModelsDev.node, [
      [ModelsDev.node, ModelsDev.configured(options)],
      [LayerNodePlatform.httpClient, Layer.succeed(HttpClient.HttpClient, makeMockClient(state))],
      [KV.node, makeMockKV(cache)],
    ]),
  )

// Mirrors production KV backends whose writes die as defects (e.g. Durable
// Object SQLite rejecting values over its 2 MB cap with EffectDrizzleQueryError).
const makeFailingWriteKV = (cache: MockCache) =>
  Layer.mock(KV.Service, {
    get: (key) => Effect.sync(() => cache.values.get(key)),
    set: () => Effect.die(new Error('Failed query: insert into "kv"')),
    remove: (key) => Effect.sync(() => cache.values.delete(key)).pipe(Effect.asVoid),
  })

const makeCache = (): MockCache => ({ values: new Map() })

const writeCacheText = (cache: MockCache, text: string, updatedAt = Date.now()) =>
  cache.values.set(cacheKey, { updatedAt, body: text })

const writeCache = (cache: MockCache, data: object, updatedAt?: number) =>
  writeCacheText(cache, JSON.stringify(data), updatedAt)

const provided = <A, E>(state: Ref.Ref<MockState>, cache: MockCache, eff: Effect.Effect<A, E, ModelsDev.Service>) =>
  eff.pipe(Effect.provide(buildLayer(state, cache)))

const initialState: MockState = {
  body: JSON.stringify(fixture),
  status: 200,
  calls: [],
}

describe("ModelsDev Service", () => {
  it.live("get() returns normalized snapshots from KV when a cache entry exists", () =>
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

  it.live("get() returns empty catalog when KV is empty, fetch disabled, and the bundled snapshot is disabled", () =>
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

  it.live("get() falls back to the bundled snapshot when KV is empty and fetch is disabled", () =>
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

  it.live("get() recovers from a corrupted KV entry by fetching a fresh catalog", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCacheText(cache, "{")
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const context = yield* Layer.build(buildLayer(state, cache, { fetch: true, snapshot: false }))
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(context))
      expect(result).toEqual(fixture2Snapshot)
      expect(cache.values.get(cacheKey)).toMatchObject({ body: JSON.stringify(fixture2) })
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
    }),
  )

  it.live("get() still populates the catalog when the KV cache write fails", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const layer = Layer.fresh(
        AppNodeBuilder.build(ModelsDev.node, [
          [ModelsDev.node, ModelsDev.configured({ fetch: true, snapshot: false })],
          [LayerNodePlatform.httpClient, Layer.succeed(HttpClient.HttpClient, makeMockClient(state))],
          [KV.node, makeFailingWriteKV(cache)],
        ]),
      )
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(layer))
      expect(result).toEqual(fixture2Snapshot)
      expect(cache.values.has(cacheKey)).toBe(false)
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
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

  it.live("get() caches across calls (later KV writes are ignored until invalidate)", () =>
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
      expect(cache.values.get(cacheKey)).toMatchObject({ body: JSON.stringify(fixture2) })
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(final.calls[0].url).toContain("/api.json")
      expect(final.calls[0].userAgent).toContain("/opencode")
    }),
  )

  it.live("refresh(false) skips fetch when the KV entry is fresh", () =>
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

  it.live("refresh(false) fetches when the KV entry is stale", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 10 * 60 * 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const after = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(false)
          return yield* svc.get()
        }),
      )
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(after).toEqual(fixture2Snapshot)
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
})
