import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { GoogleVertexPlugin } from "@opencode-ai/core/plugin/provider/google-vertex"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const vertexOptions: Record<string, any>[] = []
const googleAuthOptions: Record<string, any>[] = []
const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* GoogleVertexPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
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

function fakeSelectorSdk(calls: string[]) {
  const make = (method: string) => (id: string) => {
    calls.push(`${method}:${id}`)
    return { modelId: id, provider: method, specificationVersion: "v3" } as unknown as LanguageModelV3
  }
  return {
    responses: make("responses"),
    messages: make("messages"),
    chat: make("chat"),
    languageModel: make("languageModel"),
  }
}

void mock.module("@ai-sdk/google-vertex", () => ({
  createVertex: (options: Record<string, any>) => {
    vertexOptions.push(options)
    return {
      languageModel: (modelID: string) => ({ modelID, provider: "google-vertex", specificationVersion: "v3" }),
    }
  },
}))

void mock.module("google-auth-library", () => ({
  GoogleAuth: class {
    constructor(options: Record<string, any>) {
      googleAuthOptions.push(options)
    }

    async getClient() {
      return {
        async getAccessToken() {
          return { token: "vertex-token" }
        },
      }
    }
  },
}))

describe("GoogleVertexPlugin", () => {
  it.effect("ignores OpenAI-compatible providers that are not Google Vertex", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) =>
        catalog.provider.update(ProviderV2.ID.opencode, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://opencode.ai/zen/v1",
          }
        }),
      )
      yield* addPlugin()

      const provider = required(yield* catalog.provider.get(ProviderV2.ID.opencode))
      expect(provider.request.body).toEqual({})
    }),
  )

  it.effect("resolves project and location from env using legacy precedence", () =>
    withEnv(
      {
        GOOGLE_CLOUD_PROJECT: "google-cloud-project",
        GCP_PROJECT: "gcp-project",
        GCLOUD_PROJECT: "gcloud-project",
        GOOGLE_VERTEX_LOCATION: "google-vertex-location",
        GOOGLE_CLOUD_LOCATION: "google-cloud-location",
        VERTEX_LOCATION: "vertex-location",
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          yield* catalog.transform((catalog) =>
            catalog.provider.update(ProviderV2.ID.make("google-vertex"), (provider) => {
              provider.api = {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
              }
            }),
          )
          yield* addPlugin()
          const provider = required(yield* catalog.provider.get(ProviderV2.ID.make("google-vertex")))
          expect(provider.request.body.project).toBe("google-cloud-project")
          expect(provider.request.body.location).toBe("google-vertex-location")
          expect(provider.api).toEqual({
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://google-vertex-location-aiplatform.googleapis.com/v1/projects/google-cloud-project/locations/google-vertex-location",
          })
        }),
    ),
  )

  it.effect("resolves the advertised GOOGLE_VERTEX_PROJECT env for provider updates and SDKs", () =>
    withEnv(
      {
        GOOGLE_VERTEX_PROJECT: "vertex-project",
        GOOGLE_CLOUD_PROJECT: undefined,
        GCP_PROJECT: undefined,
        GCLOUD_PROJECT: undefined,
        GOOGLE_VERTEX_LOCATION: "europe-west4",
        GOOGLE_CLOUD_LOCATION: undefined,
        VERTEX_LOCATION: undefined,
      },
      () =>
        Effect.gen(function* () {
          vertexOptions.length = 0
          const plugin = yield* PluginV2.Service
          const aisdk = yield* AISDK.Service
          const catalog = yield* Catalog.Service
          yield* catalog.transform((catalog) =>
            catalog.provider.update(ProviderV2.ID.make("google-vertex"), (provider) => {
              provider.api = {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
              }
            }),
          )
          yield* addPlugin()
          const provider = required(yield* catalog.provider.get(ProviderV2.ID.make("google-vertex")))
          yield* aisdk.runSDK({
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("google-vertex"), ModelV2.ID.make("gemini")),
              api: {
                id: ModelV2.ID.make("gemini"),
                type: "aisdk",
                package: "@ai-sdk/google-vertex",
              },
            }),
            package: "@ai-sdk/google-vertex",
            options: { name: "google-vertex" },
          })

          expect(provider.request.body.project).toBe("vertex-project")
          expect(provider.api).toEqual({
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://europe-west4-aiplatform.googleapis.com/v1/projects/vertex-project/locations/europe-west4",
          })
          expect(vertexOptions[0].project).toBe("vertex-project")
          expect(vertexOptions[0].location).toBe("europe-west4")
        }),
    ),
  )

  it.effect("keeps configured project and location over env and uses global endpoint", () =>
    withEnv(
      {
        GOOGLE_CLOUD_PROJECT: "env-project",
        GCP_PROJECT: "env-gcp-project",
        GCLOUD_PROJECT: "env-gcloud-project",
        GOOGLE_VERTEX_LOCATION: "env-location",
        GOOGLE_CLOUD_LOCATION: "env-google-cloud-location",
        VERTEX_LOCATION: "env-vertex-location",
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          yield* catalog.transform((catalog) =>
            catalog.provider.update(ProviderV2.ID.make("google-vertex"), (provider) => {
              provider.api = {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
              }
              provider.request.body.project = "config-project"
              provider.request.body.location = "global"
            }),
          )
          yield* addPlugin()
          const provider = required(yield* catalog.provider.get(ProviderV2.ID.make("google-vertex")))
          expect(provider.request.body.project).toBe("config-project")
          expect(provider.request.body.location).toBe("global")
          expect(provider.api).toEqual({
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://aiplatform.googleapis.com/v1/projects/config-project/locations/global",
          })
        }),
    ),
  )

  it.effect("keeps OpenAI-compatible Vertex endpoint templates regional for eu", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) =>
        catalog.provider.update(ProviderV2.ID.make("google-vertex"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
          }
          provider.request.body.project = "config-project"
          provider.request.body.location = "eu"
        }),
      )
      yield* addPlugin()
      const provider = required(yield* catalog.provider.get(ProviderV2.ID.make("google-vertex")))
      expect(provider.api).toEqual({
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://eu-aiplatform.googleapis.com/v1/projects/config-project/locations/eu",
      })
    }),
  )

  it.effect("defaults location to us-central1 when only project is configured", () =>
    withEnv(
      {
        GOOGLE_CLOUD_PROJECT: undefined,
        GCP_PROJECT: undefined,
        GCLOUD_PROJECT: undefined,
        GOOGLE_VERTEX_LOCATION: undefined,
        GOOGLE_CLOUD_LOCATION: undefined,
        VERTEX_LOCATION: undefined,
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          yield* catalog.transform((catalog) =>
            catalog.provider.update(ProviderV2.ID.make("google-vertex"), (provider) => {
              provider.api = { type: "aisdk", package: "@ai-sdk/google-vertex" }
              provider.request.body.project = "config-project"
            }),
          )
          yield* addPlugin()
          const provider = required(yield* catalog.provider.get(ProviderV2.ID.make("google-vertex")))
          expect(provider.request.body.project).toBe("config-project")
          expect(provider.request.body.location).toBe("us-central1")
        }),
    ),
  )

  it.effect("does not pass Google auth fetch to the native Vertex SDK", () =>
    withEnv(
      {
        GOOGLE_CLOUD_PROJECT: "env-project",
        GOOGLE_VERTEX_LOCATION: "env-location",
      },
      () =>
        Effect.gen(function* () {
          vertexOptions.length = 0
          const plugin = yield* PluginV2.Service
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          yield* aisdk.runSDK({
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("google-vertex"), ModelV2.ID.make("gemini")),
              api: {
                id: ModelV2.ID.make("gemini"),
                type: "aisdk",
                package: "@ai-sdk/google-vertex",
              },
            }),
            package: "@ai-sdk/google-vertex",
            options: { name: "google-vertex" },
          })
          expect(vertexOptions).toHaveLength(1)
          expect(vertexOptions[0].project).toBe("env-project")
          expect(vertexOptions[0].location).toBe("env-location")
          expect(vertexOptions[0].fetch).toBeUndefined()
        }),
    ),
  )

  it.effect("keeps Google auth fetch for OpenAI-compatible Vertex endpoints", () =>
    Effect.gen(function* () {
      googleAuthOptions.length = 0
      const fetchCalls: { input: Parameters<typeof fetch>[0]; init?: RequestInit }[] = []
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      yield* aisdk.hook.sdk((evt) =>
        Effect.promise(async () => {
          if (evt.model.providerID !== "google-vertex") return
          if (evt.package !== "@ai-sdk/openai-compatible") return
          expect(typeof evt.options.fetch).toBe("function")
          await evt.options.fetch("https://vertex.example", {
            headers: { "x-test": "1" },
          })
        }),
      )
      const originalFetch = fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async (
        input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ) => {
        fetchCalls.push({ input, init })
        return new Response("ok")
      }) as typeof fetch
      yield* Effect.acquireUseRelease(
        Effect.void,
        () =>
          aisdk.runSDK({
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("google-vertex"), ModelV2.ID.make("gemini")),
              api: {
                id: ModelV2.ID.make("gemini"),
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
              },
            }),
            package: "@ai-sdk/openai-compatible",
            options: { name: "google-vertex" },
          }),
        () =>
          Effect.sync(() => {
            ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch
          }),
      )
      expect(fetchCalls).toHaveLength(1)
      expect(googleAuthOptions).toEqual([{ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }])
      expect(fetchCalls[0].input).toBe("https://vertex.example")
      expect(new Headers(fetchCalls[0].init?.headers).get("authorization")).toBe("Bearer vertex-token")
      expect(new Headers(fetchCalls[0].init?.headers).get("x-test")).toBe("1")
    }),
  )

  it.effect("trims model IDs before selecting language models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.make("google-vertex"), ModelV2.ID.make(" gemini-2.5-pro ")),
          api: { id: ModelV2.ID.make(" gemini-2.5-pro "), type: "aisdk", package: "test-provider" },
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })
      expect(calls).toEqual(["languageModel:gemini-2.5-pro"])
    }),
  )
})
