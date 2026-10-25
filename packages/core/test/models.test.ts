import { describe, expect, beforeAll, beforeEach, afterAll } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@bolt-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@bolt-ai/core/effect/app-node-platform"
import { LayerNode } from "@bolt-ai/core/effect/layer-node"
import { Flag } from "@bolt-ai/core/flag/flag"
import { Global } from "@bolt-ai/core/global"
import { ModelsDev } from "@bolt-ai/core/models-dev"
import { it } from "./lib/effect"

// test/preload.ts pins BOLT_MODELS_PATH to a fixture so other tests can
// resolve providers without network. These tests need to drive the on-disk
// cache themselves and silence the eager refresh fork. Save/restore around
// the suite — never leak the mutation to subsequent test files in the same
// bun process.
const ORIGINAL_MODELS_PATH = Flag.BOLT_MODELS_PATH
const ORIGINAL_DISABLE_FETCH = Flag.BOLT_DISABLE_MODELS_FETCH
beforeAll(() => {
  Flag.BOLT_MODELS_PATH = undefined
  Flag.BOLT_DISABLE_MODELS_FETCH = true
})
afterAll(() => {
  Flag.BOLT_MODELS_PATH = ORIGINAL_MODELS_PATH
  Flag.BOLT_DISABLE_MODELS_FETCH = ORIGINAL_DISABLE_FETCH
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
      package: "@opencode/ai/providers/openai-compatible",
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
        settings: { provider: "acme" },
        capabilities: { tools: true, input: [], output: [], temperature: true },
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
    types: new Map(),
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
      package: "@opencode/ai/providers/openai-compatible",
    },
    models: [
      {
        id: Model.ID.make("beta-1"),
        modelID: Model.ID.make("beta-1"),
        providerID: Provider.ID.make("beta"),
        name: "Beta One",
        family: undefined,
        package: undefined,
        settings: { provider: "beta" },
        capabilities: { tools: false, input: [], output: [], temperature: false },
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
    types: new Map(),
  },
] satisfies readonly ModelsDev.Snapshot[]

interface MockState {
  body: string
  status: number
  etag?: string
  calls: Array<{ url: string; userAgent: string | null; ifNoneMatch?: string }>
}

const makeMockClient = (state: Ref.Ref<MockState>) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(state, (s) => ({
        ...s,
        calls: [
          ...s.calls,
          {
            url: request.url,
            userAgent: request.headers["user-agent"] ?? null,
            ifNoneMatch: request.headers["if-none-match"],
          },
        ],
      }))
      const s = yield* Ref.get(state)
      return HttpClientResponse.fromWeb(
        request,
        new Response(s.status === 304 ? null : s.body, {
          status: s.status,
          headers: s.etag ? { etag: s.etag } : {},
        }),
      )
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
    AppNodeBuilder.build(LayerNode.group([ModelsDev.node, Bus.node]), [
      ModelsDev.node.replace(ModelsDev.configured(options)),
      LayerNodePlatform.httpClient.replace(Layer.succeed(HttpClient.HttpClient, makeMockClient(state))),
      KV.node.replace(makeMockKV(cache)),
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
  cache.values.set(cacheKey, { updatedAt, digest: bodyDigest(text), body: text })

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

  it.live("maps models.dev npm packages onto native packages", () =>
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
        "cloudflare-workers-ai": {
          id: "cloudflare-workers-ai",
          name: "Cloudflare Workers AI",
          env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
          models: {},
        },
        azure: {
          id: "azure",
          name: "Azure",
          env: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
          npm: "@ai-sdk/azure",
          models: {
            "gpt-5": {
              ...fixture.acme.models["acme-1"],
              id: "gpt-5",
            },
            "custom-chat": {
              ...fixture.acme.models["acme-1"],
              id: "custom-chat",
              provider: { shape: "completions" },
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
      expect(result[0]?.info.package).toBe("@opencode/ai/providers/openai-compatible")
      expect(result[0]?.models[0]?.package).toBe("@opencode/ai/providers/openai")
      expect(result[1]?.info.package).toBe("@opencode/ai/providers/cloudflare-workers-ai")
      expect(result[1]?.info.settings).toBeUndefined()
      expect(result[2]?.info.package).toBe("@opencode/ai/providers/azure/responses")
      expect(result[2]?.models.find((model) => model.id === "gpt-5")?.package).toBeUndefined()
      expect(result[2]?.models.find((model) => model.id === "custom-chat")?.package).toBe(
        "@opencode/ai/providers/azure/chat",
      )
    }),
  )

  it.live("keeps typed models in the snapshot with their models.dev type", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, {
        acme: {
          ...fixture.acme,
          models: {
            ...fixture.acme.models,
            "acme-live": {
              ...fixture.acme.models["acme-1"],
              id: "acme-live",
              type: "realtime",
              experimental: { modes: { fast: {} } },
            },
          },
        },
      })
      const state = yield* Ref.make(initialState)
      const [acme] = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((service) => service.get()),
      )
      expect(acme?.models.map((model) => model.id)).toEqual(
        ["acme-1", "acme-live", "acme-live-fast"].map((id) => Model.ID.make(id)),
      )
      expect(Object.fromEntries(acme?.types ?? [])).toEqual({ "acme-live": "realtime", "acme-live-fast": "realtime" })
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
      const context = yield* Layer.build(buildLayer(state))
      const result = yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          Flag.BOLT_DISABLE_MODELS_FETCH = false
        }),
        () => ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(context)),
        () =>
          Effect.sync(() => {
            Flag.BOLT_DISABLE_MODELS_FETCH = true
          }),
      )
      expect(result).toEqual(fixture2)
      expect(yield* Effect.promise(() => readFile(cacheFile, "utf8"))).toBe(JSON.stringify(fixture2))
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
          ModelsDev.node.replace(ModelsDev.configured({ fetch: true, snapshot: false })),
          LayerNodePlatform.httpClient.replace(Layer.succeed(HttpClient.HttpClient, makeMockClient(state))),
          KV.node.replace(makeFailingWriteKV(cache)),
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
      expect(cache.values.get(cacheKey)).toMatchObject({
        body: JSON.stringify(fixture2),
        digest: bodyDigest(JSON.stringify(fixture2)),
      })
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
      expect(cache.values.get(cacheKey)).toMatchObject({
        body: JSON.stringify(fixture2),
        digest: bodyDigest(JSON.stringify(fixture2)),
      })
    }),
  )

  it.live("refresh publishes Refreshed globally across locations", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 10 * 60 * 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const bus = yield* Bus.Service
          const refreshed = yield* bus
            .subscribe(ModelsDev.Event.Refreshed)
            .pipe(
              Stream.take(1),
              Stream.runCollect,
              Effect.provideService(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make("/other-location") })),
              ),
              Effect.forkScoped,
            )
            .pipe(
              Effect.flatMap((fiber) =>
                Effect.gen(function* () {
                  yield* Effect.yieldNow
                  yield* svc.refresh(true).pipe(
                    Effect.provideService(
                      Location.Service,
                      Location.Service.of(location({ directory: AbsolutePath.make("/initial-location") })),
                    ),
                  )
                  return yield* Fiber.join(fiber)
                }),
              ),
            )
          expect(refreshed.length).toBe(1)
          expect(refreshed[0]?.location).toBeUndefined()
        }),
      )
    }),
  )

  it.live("refresh(false) stays quiet when the fetched body matches the cached digest", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 10 * 60 * 1000)
      const body = cache.values.get(cacheKey)
      // The server serves a byte-identical body, so the refresh still hits
      // the network but must only record the check time, not publish Refreshed.
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
      expect(cache.values.get(cacheKey)).toBe(body)
      expect(cache.values.get(metaKey)).toMatchObject({ digest: bodyDigest(JSON.stringify(fixture)) })
      expect(Date.now() - (cache.values.get(metaKey) as { updatedAt: number }).updatedAt).toBeLessThan(60 * 1000)
    }),
  )

  it.live("refresh(false) revalidates with the stored ETag and treats 304 as unchanged", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make<MockState>({ ...initialState, etag: 'W/"v1"' })
      const body = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          const meta = cache.values.get(metaKey) as { updatedAt: number }
          cache.values.set(metaKey, { ...meta, updatedAt: Date.now() - 10 * 60 * 1000 })
          const body = cache.values.get(cacheKey)
          yield* Ref.update(state, (s) => ({ ...s, status: 304 }))
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
          expect(yield* svc.get()).toEqual(fixtureSnapshot)
          return body
        }),
      )
      const final = yield* Ref.get(state)
      expect(final.calls.map((call) => call.ifNoneMatch)).toEqual([undefined, 'W/"v1"'])
      expect(cache.values.get(cacheKey)).toBe(body)
      expect(cache.values.get(metaKey)).toMatchObject({ etag: 'W/"v1"' })
      expect(Date.now() - (cache.values.get(metaKey) as { updatedAt: number }).updatedAt).toBeLessThan(60 * 1000)
    }),
  )

  it.live("refresh(false) republishes once for legacy cache entries without a digest", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      cache.values.set(cacheKey, { updatedAt: Date.now() - 10 * 60 * 1000, body: JSON.stringify(fixture) })
      const state = yield* Ref.make(initialState)
      yield* provided(
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
        }),
      )
      // The rewritten entry now carries a digest, so later identical bodies stay quiet.
      expect(cache.values.get(cacheKey)).toMatchObject({ digest: bodyDigest(JSON.stringify(fixture)) })
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
