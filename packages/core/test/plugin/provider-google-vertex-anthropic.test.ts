import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { GoogleVertexAnthropicPlugin, GoogleVertexPlugin } from "@opencode-ai/core/plugin/provider/google-vertex"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { fakeSelectorSdk, it, model, withEnv } from "./provider-helper"

describe("GoogleVertexAnthropicPlugin", () => {
  it.effect("resolves legacy project and location env on provider update", () =>
    withEnv(
      {
        GOOGLE_CLOUD_PROJECT: "cloud-project",
        GCP_PROJECT: "gcp-project",
        GCLOUD_PROJECT: "gcloud-project",
        GOOGLE_CLOUD_LOCATION: "cloud-location",
        VERTEX_LOCATION: "vertex-location",
        GOOGLE_VERTEX_LOCATION: "google-vertex-location",
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          const catalog = yield* Catalog.Service
          yield* plugin.add(GoogleVertexAnthropicPlugin)
          const transform = yield* catalog.transform()
          yield* transform((catalog) =>
            catalog.provider.update(ProviderV2.ID.make("google-vertex-anthropic"), (provider) => {
              provider.api = { type: "aisdk", package: "@ai-sdk/google-vertex/anthropic" }
            }),
          )
          const provider = yield* catalog.provider.get(ProviderV2.ID.make("google-vertex-anthropic"))
          expect(provider.request.body.project).toBe("cloud-project")
          expect(provider.request.body.location).toBe("cloud-location")
        }),
    ),
  )

  it.effect("keeps configured project and location over env fallback", () =>
    withEnv({ GOOGLE_CLOUD_PROJECT: "env-project", GOOGLE_CLOUD_LOCATION: "env-location" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(GoogleVertexAnthropicPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) =>
          catalog.provider.update(ProviderV2.ID.make("google-vertex-anthropic"), (provider) => {
            provider.api = { type: "aisdk", package: "@ai-sdk/google-vertex/anthropic" }
            provider.request.body.project = "configured-project"
            provider.request.body.location = "configured-location"
          }),
        )
        const provider = yield* catalog.provider.get(ProviderV2.ID.make("google-vertex-anthropic"))
        expect(provider.request.body.project).toBe("configured-project")
        expect(provider.request.body.location).toBe("configured-location")
      }),
    ),
  )

  it.effect("creates SDKs from legacy env fallback and default location", () =>
    withEnv(
      {
        GOOGLE_CLOUD_PROJECT: undefined,
        GCP_PROJECT: "gcp-project",
        GCLOUD_PROJECT: "gcloud-project",
        GOOGLE_CLOUD_LOCATION: undefined,
        VERTEX_LOCATION: undefined,
        GOOGLE_VERTEX_LOCATION: "ignored-location",
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          yield* plugin.add(GoogleVertexAnthropicPlugin)
          const result = yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("google-vertex-anthropic", "claude-sonnet-4-5"),
              package: "@ai-sdk/google-vertex/anthropic",
              options: { name: "google-vertex-anthropic" },
            },
            {},
          )
          expect(result.sdk.languageModel("claude-sonnet-4-5").config.baseURL).toBe(
            "https://aiplatform.googleapis.com/v1/projects/gcp-project/locations/global/publishers/anthropic/models",
          )
        }),
    ),
  )

  it.effect("uses GOOGLE_CLOUD_LOCATION before VERTEX_LOCATION when creating SDKs", () =>
    withEnv(
      { GOOGLE_CLOUD_PROJECT: "project", GOOGLE_CLOUD_LOCATION: "cloud-location", VERTEX_LOCATION: "vertex-location" },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          yield* plugin.add(GoogleVertexAnthropicPlugin)
          const result = yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("google-vertex-anthropic", "claude-sonnet-4-5"),
              package: "@ai-sdk/google-vertex/anthropic",
              options: { name: "google-vertex-anthropic" },
            },
            {},
          )
          expect(result.sdk.languageModel("claude-sonnet-4-5").config.baseURL).toBe(
            "https://cloud-location-aiplatform.googleapis.com/v1/projects/project/locations/cloud-location/publishers/anthropic/models",
          )
        }),
    ),
  )

  it.effect("creates SDKs for google-vertex Anthropic models with multi-region endpoints", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GoogleVertexAnthropicPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("google-vertex", "claude-sonnet-4-5"),
          package: "@ai-sdk/google-vertex/anthropic",
          options: { name: "google-vertex", project: "project", location: "eu" },
        },
        {},
      )
      expect(result.sdk.languageModel("claude-sonnet-4-5").config.baseURL).toBe(
        "https://aiplatform.eu.rep.googleapis.com/v1/projects/project/locations/eu/publishers/anthropic/models",
      )
    }),
  )

  it.effect("keeps configured baseURL for google-vertex Anthropic models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GoogleVertexAnthropicPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("google-vertex", "claude-sonnet-4-5"),
          package: "@ai-sdk/google-vertex/anthropic",
          options: { name: "google-vertex", project: "project", location: "eu", baseURL: "https://proxy.example/v1" },
        },
        {},
      )
      expect(result.sdk.languageModel("claude-sonnet-4-5").config.baseURL).toBe("https://proxy.example/v1")
    }),
  )

  it.effect("selects google-vertex Anthropic language models through V2 plugins", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GoogleVertexPlugin)
      yield* plugin.add(GoogleVertexAnthropicPlugin)
      const sdkResult = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("google-vertex", " claude-sonnet-4-5 "),
          package: "@ai-sdk/google-vertex/anthropic",
          options: { name: "google-vertex", project: "project", location: "us" },
        },
        {},
      )
      const languageResult = yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("google-vertex", " claude-sonnet-4-5 "),
          sdk: sdkResult.sdk,
          options: {},
        },
        {},
      )
      const language = languageResult.language as unknown as { config: { baseURL: string }; modelId: string }
      expect(language.config.baseURL).toBe(
        "https://aiplatform.us.rep.googleapis.com/v1/projects/project/locations/us/publishers/anthropic/models",
      )
      expect(language.modelId).toBe("claude-sonnet-4-5")
    }),
  )

  it.effect("trims model IDs before selecting language models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(GoogleVertexAnthropicPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("google-vertex-anthropic", " claude-sonnet-4-5 "),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: {},
        },
        {},
      )
      expect(calls).toEqual(["languageModel:claude-sonnet-4-5"])
    }),
  )

  it.effect("ignores non Vertex Anthropic providers for language selection", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(GoogleVertexAnthropicPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("google-vertex", "claude-sonnet-4-5"),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: {},
        },
        {},
      )
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})
