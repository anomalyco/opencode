import { expect } from "bun:test"
import { Effect, FileSystem, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ModelsDevCache } from "@opencode-ai/core/models-dev/cache"
import { LayerNodePlatform } from "@opencode-ai/util/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { makeDurableObjectStorage } from "../../core/test/fixture/durable-object-storage"
import { it } from "../../core/test/lib/effect"
import { ServerWorkerd } from "../src/workerd"

// Covers the profile's replacement graph composing and the database booting
// through the injected Durable Object storage.
it.live("boots the workerd profile over durable object storage", () =>
  Effect.gen(function* () {
    const handler = yield* ServerWorkerd.create({
      storage: makeDurableObjectStorage(),
      password: "secret",
      app: { version: "workerd-test" },
      config: { content: "{}" },
    })

    const unauthorized = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/health")))
    expect(unauthorized.status).toBe(401)

    const health = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/health", {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        }),
      ),
    )
    expect(health.status).toBe(200)

    const body: unknown = yield* Effect.promise(() => health.json())
    expect(body).toMatchObject({ healthy: true, version: "workerd-test" })
  }),
)

it.live("refreshes a memory-only catalog without a local filesystem", () =>
  Effect.gen(function* () {
    const name = yield* Ref.make("Acme One")
    const replacements: LayerNode.Replacements = [
      ...ServerWorkerd.replacements({ storage: makeDurableObjectStorage() }),
      [ModelsDev.node, ModelsDev.configured({ fetch: false, snapshot: false })],
      [Global.node, Layer.succeed(Global.Service, Global.make())],
      [LayerNodePlatform.filesystem, FileSystem.layerNoop({})],
      [
        LayerNodePlatform.httpClient,
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.gen(function* () {
              return HttpClientResponse.fromWeb(
                request,
                Response.json({
                  acme: {
                    id: "acme",
                    name: yield* Ref.get(name),
                    env: [],
                    npm: "@ai-sdk/openai-compatible",
                    models: {},
                  },
                }),
              )
            }),
          ),
        ),
      ],
    ]

    yield* Effect.gen(function* () {
      const cache = yield* ModelsDevCache.Service
      const models = yield* ModelsDev.Service
      yield* cache.write("https://models.opencode.ai", "not persisted")
      expect(yield* cache.read("https://models.opencode.ai")).toBeUndefined()
      expect(yield* models.get()).toEqual([])

      yield* models.refresh(true)
      expect((yield* models.get()).map((provider) => provider.info.name)).toEqual(["Acme One"])
      yield* Ref.set(name, "Acme Two")
      yield* models.refresh(true)
      expect((yield* models.get()).map((provider) => provider.info.name)).toEqual(["Acme Two"])
      expect(yield* cache.read("https://models.opencode.ai")).toBeUndefined()
    }).pipe(
      Effect.provide(
        Layer.fresh(LayerNode.compile(LayerNode.group([ModelsDev.node, ModelsDevCache.node]), replacements)),
      ),
    )
  }),
)
