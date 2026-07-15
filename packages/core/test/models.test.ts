import { describe, expect, beforeAll, beforeEach, afterAll } from "bun:test"
import { Money } from "@opencode-ai/schema/money"
import { Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { ModelV2 } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { it } from "./lib/effect"
import { readFile, rm, writeFile, utimes, mkdir } from "fs/promises"
import path from "path"

// test/preload.ts pins OPENCODE_MODELS_PATH to a fixture so other tests can
// resolve providers without network. These tests need to drive the on-disk
// cache themselves and silence the eager refresh fork. Save/restore around
// the suite — never leak the mutation to subsequent test files in the same
// bun process.
const ORIGINAL_MODELS_PATH = Flag.OPENCODE_MODELS_PATH
const ORIGINAL_DISABLE_FETCH = Flag.OPENCODE_DISABLE_MODELS_FETCH
beforeAll(() => {
  Flag.OPENCODE_MODELS_PATH = undefined
  Flag.OPENCODE_DISABLE_MODELS_FETCH = true
})
afterAll(() => {
  Flag.OPENCODE_MODELS_PATH = ORIGINAL_MODELS_PATH
  Flag.OPENCODE_DISABLE_MODELS_FETCH = ORIGINAL_DISABLE_FETCH
})

const cacheFile = path.join(Global.Path.cache, "models.json")

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
        limit: { context: 128000, output: 8192 },
      },
    },
  },
}

const fixtureSnapshot = [
  {
    info: {
      id: ProviderV2.ID.make("acme"),
      name: "Acme",
      package: ProviderV2.aisdk("@ai-sdk/openai-compatible"),
    },
    models: [
      {
        id: ModelV2.ID.make("acme-1"),
        modelID: ModelV2.ID.make("acme-1"),
        providerID: ProviderV2.ID.make("acme"),
        name: "Acme One",
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
      id: ProviderV2.ID.make("beta"),
      name: "Beta",
      package: ProviderV2.aisdk("@ai-sdk/openai-compatible"),
    },
    models: [
      {
        id: ModelV2.ID.make("beta-1"),
        modelID: ModelV2.ID.make("beta-1"),
        providerID: ProviderV2.ID.make("beta"),
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

const buildLayer = (state: Ref.Ref<MockState>) =>
  // Layer.fresh is required because the ModelsDev implementation is a module-level Layer constant,
  // and Effect.provide uses a process-global MemoMap by default — without fresh,
  // every test would reuse the cachedInvalidateWithTTL state from the first run.
  Layer.fresh(
    AppNodeBuilder.build(ModelsDev.node, [
      [LayerNodePlatform.httpClient, Layer.succeed(HttpClient.HttpClient, makeMockClient(state))],
    ]),
  )

const writeCacheText = (text: string, mtimeMs?: number) =>
  Effect.promise(async () => {
    await mkdir(Global.Path.cache, { recursive: true })
    await writeFile(cacheFile, text)
    if (mtimeMs !== undefined) {
      const t = mtimeMs / 1000
      await utimes(cacheFile, t, t)
    }
  })

const writeCache = (data: object, mtimeMs?: number) => writeCacheText(JSON.stringify(data), mtimeMs)

const provided = <A, E>(state: Ref.Ref<MockState>, eff: Effect.Effect<A, E, ModelsDev.Service>) =>
  eff.pipe(Effect.provide(buildLayer(state)))

beforeEach(async () => {
  await rm(cacheFile, { force: true })
})

afterAll(async () => {
  await rm(cacheFile, { force: true })
})

const initialState: MockState = {
  body: JSON.stringify(fixture),
  status: 200,
  calls: [],
}

describe("ModelsDev Service", () => {
  it.live("get() returns normalized snapshots from disk when cache file exists", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result).toEqual(fixtureSnapshot)
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("get() returns empty catalog when disk empty, fetch disabled, and no bundled snapshot is injected", () =>
    Effect.gen(function* () {
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result).toEqual([])
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("get() recovers from a corrupted cache file by fetching a fresh catalog", () =>
    Effect.gen(function* () {
      yield* writeCacheText("{")
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const context = yield* Layer.build(buildLayer(state))
      const result = yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          Flag.OPENCODE_DISABLE_MODELS_FETCH = false
        }),
        () => ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(context)),
        () =>
          Effect.sync(() => {
            Flag.OPENCODE_DISABLE_MODELS_FETCH = true
          }),
      )
      expect(result).toEqual(fixture2Snapshot)
      expect(yield* Effect.promise(() => readFile(cacheFile, "utf8"))).toBe(JSON.stringify(fixture2))
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
    }),
  )

  it.live("get() is single-flight under concurrent calls", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const state = yield* Ref.make(initialState)
      const results = yield* provided(
        state,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          return yield* Effect.all([svc.get(), svc.get(), svc.get(), svc.get(), svc.get()], {
            concurrency: "unbounded",
          })
        }),
      )
      for (const result of results) expect(result).toEqual(fixtureSnapshot)
    }),
  )

  it.live("get() caches across calls (later disk writes are ignored until invalidate)", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const state = yield* Ref.make(initialState)
      const first = yield* provided(
        state,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const a = yield* svc.get()
          // mutate disk between calls — cache should mask the change
          yield* writeCache(fixture2)
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
      yield* writeCache(fixture)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const result = yield* provided(
        state,
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
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(final.calls[0].url).toContain("/api.json")
      expect(final.calls[0].userAgent).toContain("/cli")
    }),
  )

  it.live("refresh(false) skips fetch when on-disk file is fresh", () =>
    Effect.gen(function* () {
      // Fresh: mtime within the 5-minute TTL.
      yield* writeCache(fixture, Date.now() - 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      yield* provided(
        state,
        ModelsDev.Service.use((s) => s.refresh(false)),
      )
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("refresh(false) fetches when on-disk file is stale", () =>
    Effect.gen(function* () {
      // Stale: mtime 10 minutes ago, beyond the 5-minute TTL.
      yield* writeCache(fixture, Date.now() - 10 * 60 * 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const after = yield* provided(
        state,
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
      yield* writeCache(fixture)
      const state = yield* Ref.make({ ...initialState, status: 500, body: "boom" })
      const result = yield* provided(
        state,
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
