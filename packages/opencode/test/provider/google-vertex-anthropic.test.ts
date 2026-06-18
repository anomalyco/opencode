import { afterEach, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { unlink } from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Env } from "../../src/env"
import { Provider } from "@/provider/provider"
import { Filesystem } from "@/util/filesystem"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Provider.defaultLayer, Env.defaultLayer))
const list = Provider.use.list()
const id = ProviderV2.ID.make("google-vertex-anthropic")
const originalEnv = new Map<string, string | undefined>()

const rememberEnv = (key: string) => {
  if (!originalEnv.has(key)) originalEnv.set(key, process.env[key])
}

const set = (key: string, value: string) =>
  Effect.gen(function* () {
    rememberEnv(key)
    process.env[key] = value
    yield* Env.use.set(key, value)
  })

const remove = (key: string) =>
  Effect.gen(function* () {
    rememberEnv(key)
    delete process.env[key]
    yield* Env.use.remove(key)
  })

const withAuthJson = (contents: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const authPath = path.join(Global.Path.data, "auth.json")
      const original = await Filesystem.readText(authPath).catch(() => undefined)
      await Filesystem.write(authPath, contents)
      return { authPath, original }
    }),
    ({ authPath, original }) =>
      Effect.promise(async () => {
        if (original !== undefined) {
          await Filesystem.write(authPath, original)
          return
        }
        await unlink(authPath).catch(() => undefined)
      }),
  )

const generateAuthToken = (options: Record<string, unknown>) =>
  options.generateAuthToken as () => Promise<string | null>

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
  await disposeAllInstances()
})

it.instance("Vertex Anthropic: does not autoload without project or token", () =>
  Effect.gen(function* () {
    yield* withAuthJson("{}")
    yield* remove("GOOGLE_CLOUD_PROJECT")
    yield* remove("GCP_PROJECT")
    yield* remove("GCLOUD_PROJECT")
    yield* remove("VERTEX_ANTHROPIC_TOKEN")
    expect((yield* list)[id]).toBeUndefined()
  }),
)

it.instance("Vertex Anthropic: autoloads with bearer token without project", () =>
  Effect.gen(function* () {
    yield* withAuthJson("{}")
    yield* remove("GOOGLE_CLOUD_PROJECT")
    yield* remove("GCP_PROJECT")
    yield* remove("GCLOUD_PROJECT")
    yield* set("VERTEX_ANTHROPIC_TOKEN", "env-token")
    const providers = yield* list
    expect(yield* Effect.promise(() => generateAuthToken(providers[id].options)())).toBe("env-token")
  }),
)

it.instance("Vertex Anthropic: loads bearer token from auth.json", () =>
  Effect.gen(function* () {
    yield* withAuthJson(JSON.stringify({ "google-vertex-anthropic": { type: "api", key: "auth-json-token" } }))
    yield* set("GOOGLE_CLOUD_PROJECT", "my-project")
    yield* remove("VERTEX_ANTHROPIC_TOKEN")
    const providers = yield* list
    expect(yield* Effect.promise(() => generateAuthToken(providers[id].options)())).toBe("auth-json-token")
  }),
)

it.instance("Vertex Anthropic: VERTEX_ANTHROPIC_TOKEN takes precedence over auth.json", () =>
  Effect.gen(function* () {
    yield* withAuthJson(JSON.stringify({ "google-vertex-anthropic": { type: "api", key: "auth-json-token" } }))
    yield* set("GOOGLE_CLOUD_PROJECT", "my-project")
    yield* set("VERTEX_ANTHROPIC_TOKEN", "env-token")
    const providers = yield* list
    expect(yield* Effect.promise(() => generateAuthToken(providers[id].options)())).toBe("env-token")
  }),
)

it.instance(
  "Vertex Anthropic: configured baseURL is expanded with project and location",
  () =>
    Effect.gen(function* () {
      yield* withAuthJson("{}")
      yield* set("GOOGLE_CLOUD_PROJECT", "my-project")
      yield* set("VERTEX_LOCATION", "us-east5")
      expect((yield* list)[id].options.baseURL).toBe(
        "https://vertex-proxy.example/v1/projects/my-project/locations/us-east5/publishers/anthropic/models",
      )
    }),
  {
    config: {
      provider: {
        "google-vertex-anthropic": {
          options: { baseURL: "https://vertex-proxy.example/v1" },
        },
      },
    },
  },
)

it.instance(
  "Vertex Anthropic: configured full baseURL is preserved",
  () =>
    Effect.gen(function* () {
      yield* withAuthJson("{}")
      yield* set("GOOGLE_CLOUD_PROJECT", "my-project")
      expect((yield* list)[id].options.baseURL).toBe(
        "https://vertex-proxy.example/v1/projects/custom-project/locations/eu/publishers/anthropic/models",
      )
    }),
  {
    config: {
      provider: {
        "google-vertex-anthropic": {
          options: {
            baseURL: "https://vertex-proxy.example/v1/projects/custom-project/locations/eu/publishers/anthropic/models",
          },
        },
      },
    },
  },
)

it.instance("Vertex Anthropic: removes default model suffix from SDK request model ID", () =>
  Effect.gen(function* () {
    yield* withAuthJson("{}")
    yield* set("GOOGLE_CLOUD_PROJECT", "my-project")
    const provider = yield* Provider.Service
    const model = yield* provider.getModel(id, ModelV2.ID.make("claude-opus-4-6@default"))
    const language = yield* provider.getLanguage(model)
    expect((language as { modelId: string }).modelId).toBe("claude-opus-4-6")
  }),
)
