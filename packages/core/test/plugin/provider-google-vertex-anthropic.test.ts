import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { GoogleVertexAnthropicPlugin } from "@opencode-ai/core/plugin/provider/google-vertex"
import { fakeSelectorSdk, it, model, provider, withEnv } from "./provider-helper"

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
          yield* plugin.add(GoogleVertexAnthropicPlugin)
          const result = yield* plugin.trigger(
            "provider.update",
            {},
            { provider: provider("google-vertex-anthropic"), cancel: false },
          )
          expect(result.provider.options.aisdk.provider.project).toBe("cloud-project")
          expect(result.provider.options.aisdk.provider.location).toBe("cloud-location")
        }),
    ),
  )

  it.effect("keeps configured project and location over env fallback", () =>
    withEnv({ GOOGLE_CLOUD_PROJECT: "env-project", GOOGLE_CLOUD_LOCATION: "env-location" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(GoogleVertexAnthropicPlugin)
        const result = yield* plugin.trigger(
          "provider.update",
          {},
          {
            provider: provider("google-vertex-anthropic", {
              options: {
                headers: {},
                body: {},
                aisdk: { provider: { project: "configured-project", location: "configured-location" }, request: {} },
              },
            }),
            cancel: false,
          },
        )
        expect(result.provider.options.aisdk.provider.project).toBe("configured-project")
        expect(result.provider.options.aisdk.provider.location).toBe("configured-location")
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
