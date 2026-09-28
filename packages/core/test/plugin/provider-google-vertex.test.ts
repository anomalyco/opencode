import { AISDK } from "@opencode/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { GoogleVertexPlugin } from "@opencode/core/plugin/provider/google-vertex"
import { Provider } from "@opencode/core/provider"
import { fakeSelectorSdk } from "../fixture/selector"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
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

describe("GoogleVertexPlugin", () => {
  it.effect("ignores OpenAI-compatible providers that are not Google Vertex", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) =>
        catalog.update(Provider.ID.opencode, (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { ...provider.settings, baseURL: "https://opencode.ai/zen/v1" }
        }),
      )
      yield* addPlugin()

      const provider = required(yield* catalog.get(Provider.ID.opencode))
      expect(provider.settings).toEqual({ baseURL: "https://opencode.ai/zen/v1" })
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
          const catalog = yield* Provider.Service
          yield* catalog.transform((catalog) =>
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex/chat"
              provider.settings = {
                ...provider.settings,
                baseURL:
                  "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
              }
            }),
          )
          yield* addPlugin()
          const provider = required(yield* catalog.get(Provider.ID.make("google-vertex")))
          expect(provider.settings?.project).toBe("google-cloud-project")
          expect(provider.settings?.location).toBe("google-vertex-location")
          expect(provider).toMatchObject({
            package: "@opencode/ai/providers/google-vertex/chat",
            settings: {
              baseURL:
                "https://google-vertex-location-aiplatform.googleapis.com/v1/projects/google-cloud-project/locations/google-vertex-location",
            },
          })
        }),
    ),
  )

  it.effect("enables the provider when a project resolves and leaves it automatic otherwise", () =>
    withEnv(
      {
        GOOGLE_VERTEX_PROJECT: undefined,
        GOOGLE_CLOUD_PROJECT: undefined,
        GCP_PROJECT: undefined,
        GCLOUD_PROJECT: undefined,
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Provider.Service
          yield* catalog.transform((catalog) =>
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex"
            }),
          )
          yield* addPlugin()

          expect(required(yield* catalog.get(Provider.ID.make("google-vertex"))).activation).toBe("auto")
        }),
    ),
  )

  it.effect("enables the provider when a project resolves from env", () =>
    withEnv(
      {
        GOOGLE_VERTEX_PROJECT: undefined,
        GOOGLE_CLOUD_PROJECT: "adc-project",
        GCP_PROJECT: undefined,
        GCLOUD_PROJECT: undefined,
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Provider.Service
          yield* catalog.transform((catalog) =>
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex"
            }),
          )
          yield* addPlugin()

          expect(required(yield* catalog.get(Provider.ID.make("google-vertex"))).activation).toBe("enabled")
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
          const catalog = yield* Provider.Service
          yield* catalog.transform((catalog) =>
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex/chat"
              provider.settings = {
                ...provider.settings,
                baseURL:
                  "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
              }
            }),
          )
          yield* addPlugin()
          const provider = required(yield* catalog.get(Provider.ID.make("google-vertex")))

          expect(provider.settings?.project).toBe("vertex-project")
          expect(provider).toMatchObject({
            package: "@opencode/ai/providers/google-vertex/chat",
            settings: {
              baseURL:
                "https://europe-west4-aiplatform.googleapis.com/v1/projects/vertex-project/locations/europe-west4",
            },
          })
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
          const catalog = yield* Provider.Service
          const models = yield* Model.Service
          yield* catalog.transform((catalog) => {
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex/chat"
              provider.settings = {
                ...provider.settings,
                baseURL:
                  "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
              }
              provider.settings = { ...provider.settings, project: "config-project", location: "global" }
            })
            catalog.models.update(Provider.ID.make("google-vertex"), Model.ID.make("gemini"), () => {})
          })
          yield* addPlugin()
          const provider = required(yield* catalog.get(Provider.ID.make("google-vertex")))
          const model = required(yield* models.get(Provider.ID.make("google-vertex"), Model.ID.make("gemini")))
          expect(provider.settings?.project).toBe("config-project")
          expect(provider.settings?.location).toBe("global")
          expect(provider).toMatchObject({
            package: "@opencode/ai/providers/google-vertex/chat",
            settings: { baseURL: "https://aiplatform.googleapis.com/v1/projects/config-project/locations/global" },
          })
          expect(model.settings).toEqual(provider.settings)
        }),
    ),
  )

  it.effect("keeps OpenAI-compatible Vertex endpoint templates regional for eu", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) =>
        catalog.update(Provider.ID.make("google-vertex"), (provider) => {
          provider.package = "@opencode/ai/providers/google-vertex/chat"
          provider.settings = {
            ...provider.settings,
            baseURL:
              "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
          }
          provider.settings = { ...provider.settings, project: "config-project", location: "eu" }
        }),
      )
      yield* addPlugin()
      const provider = required(yield* catalog.get(Provider.ID.make("google-vertex")))
      expect(provider).toMatchObject({
        package: "@opencode/ai/providers/google-vertex/chat",
        settings: { baseURL: "https://eu-aiplatform.googleapis.com/v1/projects/config-project/locations/eu" },
      })
    }),
  )

  it.effect("expands endpoint templates on Vertex chat models", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      const modelID = Model.ID.make("meta/llama-maas")
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.googleVertex, (provider) => {
          provider.package = "@opencode/ai/providers/google-vertex"
          provider.settings = { project: "config-project", location: "eu" }
        })
        catalog.models.update(Provider.ID.googleVertex, modelID, (model) => {
          model.package = "@opencode/ai/providers/google-vertex/chat"
          model.settings = {
            baseURL:
              "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}/endpoints/openapi",
          }
        })
      })
      yield* addPlugin()
      expect(required(yield* models.get(Provider.ID.googleVertex, modelID))).toMatchObject({
        package: "@opencode/ai/providers/google-vertex/chat",
        settings: {
          project: "config-project",
          location: "eu",
          baseURL: "https://eu-aiplatform.googleapis.com/v1/projects/config-project/locations/eu/endpoints/openapi",
        },
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
          const catalog = yield* Provider.Service
          yield* catalog.transform((catalog) =>
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex"
              provider.settings = { ...provider.settings, project: "config-project" }
            }),
          )
          yield* addPlugin()
          const provider = required(yield* catalog.get(Provider.ID.make("google-vertex")))
          expect(provider.settings?.project).toBe("config-project")
          expect(provider.settings?.location).toBe("us-central1")
        }),
    ),
  )

  it.effect("trims model IDs before selecting language models", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("google-vertex"), Model.ID.make(" gemini-2.5-pro ")),
          modelID: Model.ID.make(" gemini-2.5-pro "),
          package: "aisdk:test-provider",
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })
      expect(calls).toEqual(["languageModel:gemini-2.5-pro"])
    }),
  )
})
