import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Provider } from "@/provider/provider"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const DISCOVER = ProviderV2.ID.make("discover-test")
const it = testEffect(LayerNode.compile(Provider.node))

const withFetch = <A, E, R>(handler: (url: string) => Promise<Response>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const original = globalThis.fetch
      globalThis.fetch = ((input: RequestInfo | URL) =>
        handler(typeof input === "string" ? input : input.toString())) as unknown as typeof fetch
      return original
    }),
    () => effect,
    (original) =>
      Effect.sync(() => {
        globalThis.fetch = original
      }),
  )

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

it.instance(
  "discovers models from an openai-compatible provider's /models endpoint when opted in",
  () => {
    const requestedUrls: string[] = []
    return withFetch(
      async (url) => {
        requestedUrls.push(url)
        return jsonResponse({ data: [{ id: "model-a" }, { id: "model-b" }] })
      },
      Effect.gen(function* () {
        const providers = yield* Provider.use.list()
        const models = providers[DISCOVER].models
        expect(requestedUrls).toEqual(["http://localhost:9999/v1/models"])
        expect(models["model-a"]).toBeDefined()
        expect(models["model-a"].api.npm).toBe("@ai-sdk/openai-compatible")
        expect(models["model-a"].name).toBe("model-a")
        expect(models["model-b"]).toBeDefined()
      }),
    )
  },
  {
    config: {
      provider: {
        "discover-test": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://localhost:9999/v1" },
          enable_model_discovery: true,
        },
      },
    },
  },
)

it.instance(
  "does not discover models unless enable_model_discovery is set",
  () => {
    let calls = 0
    return withFetch(
      async () => {
        calls++
        return jsonResponse({ data: [{ id: "model-a" }] })
      },
      Effect.gen(function* () {
        const providers = yield* Provider.use.list()
        const models = providers[DISCOVER].models
        expect(Object.keys(models)).toEqual(["manual-model"])
        expect(calls).toBe(0)
      }),
    )
  },
  {
    config: {
      provider: {
        "discover-test": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://localhost:9999/v1" },
          models: { "manual-model": { name: "Manual Model" } },
        },
      },
    },
  },
)

it.instance(
  "manually configured models take precedence over discovered ones",
  () =>
    withFetch(
      async () => jsonResponse({ data: [{ id: "model-a" }, { id: "model-c" }] }),
      Effect.gen(function* () {
        const providers = yield* Provider.use.list()
        const models = providers[DISCOVER].models
        expect(models["model-a"].name).toBe("Custom Name")
        expect(models["model-c"]).toBeDefined()
      }),
    ),
  {
    config: {
      provider: {
        "discover-test": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://localhost:9999/v1" },
          enable_model_discovery: true,
          models: { "model-a": { name: "Custom Name" } },
        },
      },
    },
  },
)

it.instance(
  "disable_model_discovery overrides enable_model_discovery",
  () => {
    let calls = 0
    return withFetch(
      async () => {
        calls++
        return jsonResponse({ data: [{ id: "model-b" }] })
      },
      Effect.gen(function* () {
        const providers = yield* Provider.use.list()
        const models = providers[DISCOVER].models
        expect(Object.keys(models)).toEqual(["model-a"])
        expect(calls).toBe(0)
      }),
    )
  },
  {
    config: {
      provider: {
        "discover-test": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://localhost:9999/v1" },
          models: { "model-a": { name: "Manual Model" } },
          enable_model_discovery: true,
          disable_model_discovery: true,
        },
      },
    },
  },
)

it.instance(
  "skips discovery when baseURL is not configured, even when opted in",
  () => {
    let calls = 0
    return withFetch(
      async () => {
        calls++
        return jsonResponse({ data: [{ id: "model-a" }] })
      },
      Effect.gen(function* () {
        const providers = yield* Provider.use.list()
        expect(providers[DISCOVER]).toBeUndefined()
        expect(calls).toBe(0)
      }),
    )
  },
  {
    config: {
      provider: {
        "discover-test": {
          npm: "@ai-sdk/openai-compatible",
          enable_model_discovery: true,
        },
      },
    },
  },
)
