import { describe, expect, test } from "bun:test"
import { Money } from "@opencode/schema/money"
import { Effect, Fiber, Layer, Ref, Scope, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { bodyDigest, ModelsDev } from "@opencode/core/models-dev"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { it } from "./lib/effect"

const cacheKey = "models-dev:v2:catalog"
const metaKey = `${cacheKey}:meta`

test("normalizes permissive interleaved values to compatibility", () => {
  expect(Model.compatibility("reasoning_text")).toEqual({ reasoningField: "reasoning_text" })
  expect(Model.compatibility({ field: "vendor_reasoning" })).toEqual({ reasoningField: "vendor_reasoning" })
  expect(Model.compatibility(true)).toBeUndefined()
  expect(Model.compatibility(false)).toBeUndefined()
})

// A chat model in the models.dev v2 shape, served over one OpenAI-compatible API.
const sourceModel = (id: string, input: Record<string, unknown> = {}) => ({
  id,
  type: "chat",
  name: id,
  description: "A model",
  release_date: "2026-01-01",
  modalities: { input: ["text"], output: ["text"] },
  capabilities: { tools: { supported: true }, reasoning: { supported: false }, temperature: true },
  limit: { context: 128000, output: 8192 },
  api: {
    "chat-completions": {
      base_url: "https://api.example.test/v1",
      sdk: { aisdk: "@ai-sdk/openai-compatible", opencodeai: "@opencode/ai/providers/openai-compatible" },
    },
  },
  ...input,
})

const fixture = {
  acme: {
    id: "acme",
    name: "Acme",
    env: ["ACME_API_KEY"],
    models: {
      "acme-1": sourceModel("acme-1", {
        name: "Acme One",
        api: {
          "chat-completions": {
            base_url: "https://api.acme.test/v1",
            sdk: { aisdk: "@ai-sdk/openai-compatible", opencodeai: "@opencode/ai/providers/openai-compatible" },
            compatibility: { reasoning_field: "vendor_reasoning" },
          },
        },
      }),
    },
  },
}

const zeroCost = [
  {
    input: Money.USDPerMillionTokens.zero,
    output: Money.USDPerMillionTokens.zero,
    cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
  },
]

const fixtureSnapshot = [
  {
    info: {
      id: Provider.ID.make("acme"),
      name: "Acme",
      activation: "auto",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: "https://api.acme.test/v1" },
    },
    models: [
      {
        id: Model.ID.make("acme-1"),
        modelID: Model.ID.make("acme-1"),
        providerID: Provider.ID.make("acme"),
        type: "chat",
        name: "Acme One",
        compatibility: { reasoningField: "vendor_reasoning" },
        family: undefined,
        package: undefined,
        settings: { provider: "acme" },
        capabilities: { tools: true, input: ["text"], output: ["text"], temperature: true },
        variants: [],
        time: { released: Date.parse("2026-01-01") },
        cost: zeroCost,
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
    models: {
      "beta-1": sourceModel("beta-1", {
        name: "Beta One",
        release_date: "2026-02-01",
        capabilities: { tools: { supported: false }, reasoning: { supported: false }, temperature: false },
        limit: { context: 64000, output: 4096 },
      }),
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
      settings: { baseURL: "https://api.example.test/v1" },
    },
    models: [
      {
        id: Model.ID.make("beta-1"),
        modelID: Model.ID.make("beta-1"),
        providerID: Provider.ID.make("beta"),
        type: "chat",
        name: "Beta One",
        compatibility: undefined,
        family: undefined,
        package: undefined,
        settings: { provider: "beta" },
        capabilities: { tools: false, input: ["text"], output: ["text"], temperature: false },
        variants: [],
        time: { released: Date.parse("2026-02-01") },
        cost: zeroCost,
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

  it.live("takes each model's package from its first API and skips URLs packages build themselves", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const azureAPI = (protocol: string, opencodeai: string) => ({
        [protocol]: {
          base_url: "https://${AZURE_RESOURCE_NAME}.openai.azure.com/openai/v1",
          sdk: { aisdk: "@ai-sdk/azure", opencodeai },
        },
      })
      writeCache(cache, {
        acme: {
          ...fixture.acme,
          models: {
            ...fixture.acme.models,
            "acme-responses": sourceModel("acme-responses", {
              api: {
                responses: {
                  base_url: "https://api.acme.test/v1",
                  sdk: { aisdk: "@ai-sdk/openai", opencodeai: "@opencode/ai/providers/openai/responses" },
                },
                "chat-completions": { base_url: "https://other.acme.test/v1", sdk: { aisdk: "@ai-sdk/openai" } },
              },
            }),
            "acme-fallback": sourceModel("acme-fallback", {
              api: { messages: { base_url: "https://claude.acme.test/v1", sdk: { aisdk: "@ai-sdk/anthropic" } } },
            }),
          },
        },
        azure: {
          id: "azure",
          name: "Azure",
          env: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
          models: {
            "gpt-5": sourceModel("gpt-5", { api: azureAPI("responses", "@opencode/ai/providers/azure/responses") }),
            "custom-chat": sourceModel("custom-chat", {
              api: azureAPI("chat-completions", "@opencode/ai/providers/azure/chat"),
            }),
            claude: sourceModel("claude", {
              api: {
                messages: {
                  base_url: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1",
                  sdk: { aisdk: "@ai-sdk/anthropic", opencodeai: "@opencode/ai/providers/anthropic-compatible" },
                },
              },
            }),
          },
        },
      })
      const state = yield* Ref.make(initialState)
      const [acme, azure] = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((service) => service.get()),
      )
      const acmeModel = (id: string) => acme?.models.find((model) => model.id === id)
      expect(acmeModel("acme-responses")?.package).toBe("@opencode/ai/providers/openai/responses")
      expect(acmeModel("acme-responses")?.settings).toBeUndefined()
      // Without an opencode package, the AI SDK package maps to the native one as before.
      expect(acmeModel("acme-fallback")?.package).toBe("@opencode/ai/providers/anthropic")
      expect(acmeModel("acme-fallback")?.settings).toEqual({ baseURL: "https://claude.acme.test/v1" })

      const azureModel = (id: string) => azure?.models.find((model) => model.id === id)
      expect(azure?.info.package).toBe("@opencode/ai/providers/azure/responses")
      expect(azure?.info.settings).toBeUndefined()
      expect(azureModel("gpt-5")?.package).toBeUndefined()
      expect(azureModel("gpt-5")?.settings).toBeUndefined()
      expect(azureModel("custom-chat")?.package).toBe("@opencode/ai/providers/azure/chat")
      expect(azureModel("custom-chat")?.settings).toBeUndefined()
      expect(azureModel("claude")?.settings).toEqual({
        baseURL: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1",
        provider: "azure",
      })
    }),
  )

  it.live("keeps non-chat models with their type, maps MIME modalities, and skips malformed models", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, {
        acme: {
          ...fixture.acme,
          models: {
            ...fixture.acme.models,
            "acme-image": sourceModel("acme-image", {
              type: "image",
              modalities: { input: ["text", "image/png", "application/pdf"], output: ["image/png", "image/webp"] },
              api: {
                "chat-completions": {
                  base_url: "https://api.example.test/v1",
                  sdk: { aisdk: "@acme/ai-sdk-provider" },
                },
                images: {
                  base_url: "https://api.example.test/v1",
                  sdk: { aisdk: "@acme/ai-sdk-provider", opencodeai: "@opencode/ai/protocols/openai-images" },
                },
              },
              experimental: { modes: { fast: {} } },
              future_field: { anything: true },
            }),
            "acme-broken": { id: "acme-broken", type: "chat" },
            "acme-sdk-image": sourceModel("acme-sdk-image", {
              type: "image",
              api: { images: { base_url: "https://api.example.test/v1", sdk: { aisdk: "@acme/ai-sdk-provider" } } },
            }),
          },
        },
      })
      const state = yield* Ref.make(initialState)
      const [acme] = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((service) => service.get()),
      )
      expect(acme?.models.map((model) => [model.id, model.type])).toEqual([
        ["acme-1", "chat"],
        ["acme-image", "image"],
        ["acme-image-fast", "image"],
      ])
      expect(acme?.models[1]?.capabilities).toMatchObject({ input: ["text", "image", "pdf"], output: ["image"] })
      expect(acme?.models[1]?.package).toBe("@opencode/ai/protocols/openai-images")
      // Without an opencode package a non-chat model is left out ("acme-sdk-image" above).
    }),
  )

  it.live("maps per-token text prices, context tiers, and mode multipliers onto cost", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, {
        acme: {
          ...fixture.acme,
          models: {
            "acme-1": sourceModel("acme-1", {
              cost: {
                text: {
                  input: {
                    price: 2,
                    cache: { read: 0.2, write: { "5m": 2.5, "1h": 4 } },
                    overrides: [
                      { when: { context: { gt: 200000 } }, price: 4, cache: { read: 0.4 } },
                      { when: { service_tier: { equals: "flex" } }, price: 1 },
                    ],
                  },
                  output: { price: 10, overrides: [{ when: { context: { gt: 200000 } }, price: 15 }] },
                },
                image: { output: { unit: "image", price: 0.04 } },
                multipliers: [{ when: { service_tier: { equals: "priority" } }, factor: { text: 2 } }],
              },
              experimental: { modes: { fast: { service_tier: "priority", body: { service_tier: "priority" } } } },
            }),
          },
        },
      })
      const state = yield* Ref.make(initialState)
      const [acme] = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((service) => service.get()),
      )
      const price = Money.USDPerMillionTokens.make
      const tier = {
        tier: { type: "context" as const, size: 200000 },
        input: price(4),
        output: price(15),
        cache: { read: price(0.4), write: price(2.5) },
      }
      expect(acme?.models[0]?.cost).toEqual([
        { input: price(2), output: price(10), cache: { read: price(0.2), write: price(2.5) } },
        tier,
      ])
      expect(acme?.models[1]?.cost).toEqual([
        { input: price(4), output: price(20), cache: { read: price(0.4), write: price(5) } },
        tier,
      ])
      expect(acme?.models[1]?.body).toEqual({ service_tier: "priority" })
    }),
  )

  it.live("drops model types opencode doesn't keep", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const api = {
        images: { base_url: "https://api.acme.test/v1", sdk: { opencodeai: "@opencode/ai/providers/openai" } },
      }
      const model = (id: string, type: string) => ({
        id,
        type,
        name: id,
        release_date: "2026-01-01",
        modalities: { input: ["text"], output: ["image"] },
        capabilities: { tools: { supported: false }, reasoning: { supported: false } },
        api,
      })
      writeCache(cache, {
        acme: {
          id: "acme",
          name: "Acme",
          env: ["ACME_API_KEY"],
          models: { "acme-image": model("acme-image", "image"), "acme-video": model("acme-video", "video") },
        },
      })
      const state = yield* Ref.make(initialState)
      const [acme] = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((service) => service.get()),
      )
      expect(acme?.models.map((item) => item.id)).toEqual([Model.ID.make("acme-image")])
    }),
  )

  it.live("skips API entries and modes it can't read and keeps the model", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, {
        acme: {
          id: "acme",
          name: "Acme",
          env: ["ACME_API_KEY"],
          models: {
            "acme-1": {
              id: "acme-1",
              type: "chat",
              name: "Acme One",
              release_date: "2026-01-01",
              modalities: { input: ["text"], output: ["text"] },
              capabilities: { tools: { supported: true }, reasoning: { supported: false } },
              api: {
                future: { url: 42 },
                "chat-completions": {
                  base_url: "https://api.acme.test/v1",
                  sdk: { opencodeai: "@opencode/ai/providers/openai-compatible" },
                },
              },
              experimental: {
                modes: { future: { cost: "free" }, fast: { body: { service_tier: "priority" } } },
              },
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
      expect(acme?.info).toMatchObject({
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: "https://api.acme.test/v1" },
      })
      expect(acme?.models.map((model) => model.id)).toEqual([Model.ID.make("acme-1"), Model.ID.make("acme-1-fast")])
    }),
  )

  it.live("reads a models.dev v1 catalog by converting it to v2", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, {
        acme: {
          id: "acme",
          name: "Acme",
          env: ["ACME_API_KEY"],
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.acme.test/v1",
          models: {
            "acme-1": {
              id: "acme-1",
              name: "Acme One",
              release_date: "2026-01-01",
              attachment: false,
              reasoning: true,
              reasoning_options: [
                { type: "effort", values: [null, "low", "high"] },
                { type: "budget_tokens", min: 1024 },
              ],
              temperature: true,
              tool_call: true,
              interleaved: { field: "vendor_reasoning" },
              cost: { input: 1, output: 2, tiers: [{ tier: { type: "context", size: 200000 }, input: 3, output: 4 }] },
              limit: { context: 128000, output: 8192 },
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
      expect(acme?.info).toMatchObject({
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: "https://api.acme.test/v1" },
      })
      expect(acme?.models[0]).toMatchObject({
        type: "chat",
        compatibility: { reasoningField: "vendor_reasoning" },
        capabilities: { tools: true, input: ["text"], output: ["text"], temperature: true },
      })
      expect(acme?.models[0]?.variants.map((variant) => String(variant.id))).toEqual(["low", "high"])
      expect(acme?.models[0]?.cost.map((item) => [item.tier?.size, item.input, item.output])).toEqual([
        [undefined, 1, 2],
        [200000, 3, 4],
      ])
    }),
  )

  it.live("falls back to /api.json when a custom mirror has no v2 catalog", () =>
    Effect.gen(function* () {
      const v1Catalog = {
        beta: {
          id: "beta",
          name: "Beta",
          env: ["BETA_API_KEY"],
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.beta.test/v1",
          models: {
            "beta-1": {
              id: "beta-1",
              name: "Beta One",
              release_date: "2026-02-01",
              tool_call: true,
              limit: { context: 64000, output: 4096 },
            },
          },
        },
      }
      const urls: string[] = []
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          urls.push(request.url)
          const v1 = request.url.endsWith("/api.json")
          return HttpClientResponse.fromWeb(
            request,
            new Response(v1 ? JSON.stringify(v1Catalog) : null, { status: v1 ? 200 : 404 }),
          )
        }),
      )
      const layer = Layer.fresh(
        AppNodeBuilder.build(ModelsDev.node, [
          ModelsDev.node.replace(ModelsDev.configured({ url: "https://mirror.example", fetch: true, snapshot: false })),
          LayerNodePlatform.httpClient.replace(Layer.succeed(HttpClient.HttpClient, client)),
          KV.node.replace(makeMockKV(makeCache())),
        ]),
      )
      const [beta] = yield* ModelsDev.Service.use((service) => service.get()).pipe(Effect.provide(layer))
      expect(urls).toEqual([
        "https://mirror.example/experimental/v2.0/api.json?type=chat,decision,image",
        "https://mirror.example/api.json",
      ])
      expect(beta?.models.map((model) => model.id)).toEqual([Model.ID.make("beta-1")])
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
      expect(cache.values.get(cacheKey)).toMatchObject({
        body: JSON.stringify(fixture2),
        digest: bodyDigest(JSON.stringify(fixture2)),
      })
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
      expect((yield* Ref.get(state)).calls[0]?.url).toBe(
        "https://models.opencode.ai/experimental/v2.0/api.json?type=chat,decision,image",
      )
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
      expect(final.calls[0].url).toContain(ModelsDev.catalogPath)
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
                  yield* svc
                    .refresh(true)
                    .pipe(
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
