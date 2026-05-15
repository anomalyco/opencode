import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { GoogleVertexPlugin } from "@opencode-ai/core/plugin/provider/google-vertex"
import { fakeSelectorSdk, it, model, provider, withEnv } from "./provider-helper"

const vertexOptions: Record<string, any>[] = []

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
    async getApplicationDefault() {
      return {
        credential: {
          async getAccessToken() {
            return { token: "vertex-token" }
          },
        },
      }
    }
  },
}))

describe("GoogleVertexPlugin", () => {
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
          const plugin = yield* PluginV2.Service
          yield* plugin.add(GoogleVertexPlugin)
          const result = yield* plugin.trigger(
            "provider.update",
            {},
            {
              provider: provider("google-vertex", {
                endpoint: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
                },
              }),
              cancel: false,
            },
          )
          expect(result.provider.options.aisdk.provider.project).toBe("google-cloud-project")
          expect(result.provider.options.aisdk.provider.location).toBe("google-vertex-location")
          expect(result.provider.endpoint).toEqual({
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
          yield* plugin.add(GoogleVertexPlugin)
          const updated = yield* plugin.trigger(
            "provider.update",
            {},
            {
              provider: provider("google-vertex", {
                endpoint: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
                },
              }),
              cancel: false,
            },
          )
          yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("google-vertex", "gemini", {
                endpoint: { type: "aisdk", package: "@ai-sdk/google-vertex" },
              }),
              package: "@ai-sdk/google-vertex",
              options: { name: "google-vertex" },
            },
            {},
          )

          expect(updated.provider.options.aisdk.provider.project).toBe("vertex-project")
          expect(updated.provider.endpoint).toEqual({
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
          const plugin = yield* PluginV2.Service
          yield* plugin.add(GoogleVertexPlugin)
          const result = yield* plugin.trigger(
            "provider.update",
            {},
            {
              provider: provider("google-vertex", {
                endpoint: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
                },
                options: {
                  headers: {},
                  body: {},
                  aisdk: { provider: { project: "config-project", location: "global" }, request: {} },
                },
              }),
              cancel: false,
            },
          )
          expect(result.provider.options.aisdk.provider.project).toBe("config-project")
          expect(result.provider.options.aisdk.provider.location).toBe("global")
          expect(result.provider.endpoint).toEqual({
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://aiplatform.googleapis.com/v1/projects/config-project/locations/global",
          })
        }),
    ),
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
          const plugin = yield* PluginV2.Service
          yield* plugin.add(GoogleVertexPlugin)
          const result = yield* plugin.trigger(
            "provider.update",
            {},
            {
              provider: provider("google-vertex", {
                options: { headers: {}, body: {}, aisdk: { provider: { project: "config-project" }, request: {} } },
              }),
              cancel: false,
            },
          )
          expect(result.provider.options.aisdk.provider.project).toBe("config-project")
          expect(result.provider.options.aisdk.provider.location).toBe("us-central1")
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
          yield* plugin.add(GoogleVertexPlugin)
          yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("google-vertex", "gemini", {
                endpoint: { type: "aisdk", package: "@ai-sdk/google-vertex" },
              }),
              package: "@ai-sdk/google-vertex",
              options: { name: "google-vertex" },
            },
            {},
          )
          expect(vertexOptions).toHaveLength(1)
          expect(vertexOptions[0].project).toBe("env-project")
          expect(vertexOptions[0].location).toBe("env-location")
          expect(vertexOptions[0].fetch).toBeUndefined()
        }),
    ),
  )

  it.effect("keeps Google auth fetch for OpenAI-compatible Vertex endpoints", () =>
    Effect.gen(function* () {
      const fetchCalls: { input: Parameters<typeof fetch>[0]; init?: RequestInit }[] = []
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GoogleVertexPlugin)
      yield* plugin.add({
        id: PluginV2.ID.make("capture-openai-compatible"),
        effect: Effect.succeed({
          "aisdk.sdk": (evt) =>
            Effect.promise(async () => {
              if (evt.model.providerID !== "google-vertex") return
              if (evt.package !== "@ai-sdk/openai-compatible") return
              expect(typeof evt.options.fetch).toBe("function")
              await evt.options.fetch("https://vertex.example", {
                headers: { "x-test": "1" },
              })
            }),
        }),
      })
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
          plugin.trigger(
            "aisdk.sdk",
            {
              model: model("google-vertex", "gemini", {
                endpoint: { type: "aisdk", package: "@ai-sdk/openai-compatible" },
              }),
              package: "@ai-sdk/openai-compatible",
              options: { name: "google-vertex" },
            },
            {},
          ),
        () =>
          Effect.sync(() => {
            ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch
          }),
      )
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0].input).toBe("https://vertex.example")
      expect(new Headers(fetchCalls[0].init?.headers).get("authorization")).toBe("Bearer vertex-token")
      expect(new Headers(fetchCalls[0].init?.headers).get("x-test")).toBe("1")
    }),
  )

  it.effect("trims model IDs before selecting language models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(GoogleVertexPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("google-vertex", " gemini-2.5-pro "),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: {},
        },
        {},
      )
      expect(calls).toEqual(["languageModel:gemini-2.5-pro"])
    }),
  )
})
