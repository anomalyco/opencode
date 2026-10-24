import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Location as LocationSchema } from "@opencode/schema/location"
import { Model as ModelSchema } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Deferred, Effect, Layer, Schema } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { startServer } from "./fixture/server"

const decodeModelList = Schema.decodeUnknownSync(LocationSchema.response(Schema.Array(ModelSchema.Info)))
const decodeModelDefault = Schema.decodeUnknownSync(LocationSchema.response(Schema.UndefinedOr(ModelSchema.Info)))
const customProvider = Provider.ID.make("custom")
const chatModel = ModelSchema.ID.make("chat")
const chatV1 = ModelSchema.ID.make("chat-v1")
const chatV2 = ModelSchema.ID.make("chat-v2")

it.live("waits for plugin initialization before listing models", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-model-endpoint-")))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(tmp.path, "opencode.json"),
        JSON.stringify({
          providers: {
            custom: {
              package: "aisdk:@ai-sdk/openai-compatible",
              settings: { apiKey: "secret" },
              models: { chat: {} },
            },
          },
        }),
      ),
    )
    const server = yield* startServer(tmp.path)
    const url = new URL("/api/model", server.base)
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))

    expect(response.status).toBe(200)
    const body = decodeModelList(yield* Effect.promise(() => response.json()))
    expect(body.data.some((model) => model.providerID === customProvider && model.id === chatModel)).toBeTrue()
  }),
)

it.live("serves the last settled model list and default model while plugins reload", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-model-reload-")))
    const configPath = path.join(tmp.path, "opencode.json")
    yield* Effect.promise(() => fs.writeFile(configPath, "{}"))

    let revision = "v1"
    const reloading = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    const reloaded = yield* Deferred.make<void>()

    const handler = yield* ServerFetch.make(
      {
        app: { version: "test-version" },
        database: { path: ":memory:" },
        config: { directory: tmp.path, file: configPath },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      {
        overrides: [
          SdkPlugins.node.replace(
            Layer.succeed(
              SdkPlugins.Service,
              SdkPlugins.Service.of({
                register: () => Effect.void,
                all: () => [
                  {
                    id: "reload-gate",
                    revision,
                    effect: Effect.fnUntraced(function* (ctx) {
                      const modelID = revision === "v2" ? chatV2 : chatV1
                      if (revision === "v2") {
                        yield* Deferred.succeed(reloading, undefined)
                        yield* Deferred.await(gate)
                      }
                      yield* ctx.provider.transform((providers) => {
                        providers.update(customProvider, (provider) => {
                          provider.activation = "enabled"
                          provider.package = "aisdk:@ai-sdk/openai-compatible"
                        })
                        providers.models.update(customProvider, modelID, () => {})
                      })
                      yield* ctx.model.transform((models) => {
                        models.default.set(customProvider, modelID)
                      })
                      if (revision === "v2") {
                        yield* Deferred.succeed(reloaded, undefined)
                      }
                    }),
                  },
                ],
              }),
            ),
          ),
        ],
      },
    )

    const getModels = () =>
      Effect.promise(async () => {
        const res = await handler(
          new Request(`http://opencode.local/api/model?location[directory]=${encodeURIComponent(tmp.path)}`),
        )
        return { status: res.status, body: decodeModelList(await res.json()) }
      })

    const getDefault = () =>
      Effect.promise(async () => {
        const res = await handler(
          new Request(`http://opencode.local/api/model/default?location[directory]=${encodeURIComponent(tmp.path)}`),
        )
        return { status: res.status, body: decodeModelDefault(await res.json()) }
      })

    const initialList = yield* getModels()
    expect(initialList.status).toBe(200)
    expect(initialList.body.data.some((model) => model.providerID === customProvider && model.id === chatV1)).toBeTrue()

    const initialDefault = yield* getDefault()
    expect(initialDefault.status).toBe(200)
    expect(initialDefault.body.data?.providerID).toBe(customProvider)
    expect(initialDefault.body.data?.id).toBe(chatV1)

    revision = "v2"
    const patched = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/experimental/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencode-directory": encodeURIComponent(tmp.path),
          },
          body: JSON.stringify({ shell: "/bin/zsh" }),
        }),
      ),
    )
    expect(patched.status).toBe(204)
    yield* Deferred.await(reloading)

    // While the reload is mid-batch (after closing v1's scope, before v2 registers its transforms),
    // /api/model and /api/model/default immediately serve the last settled snapshot instead of 503.
    const duringReloadList = yield* getModels()
    expect(duringReloadList.status).toBe(200)
    expect(
      duringReloadList.body.data.some((model) => model.providerID === customProvider && model.id === chatV1),
    ).toBeTrue()

    const duringReloadDefault = yield* getDefault()
    expect(duringReloadDefault.status).toBe(200)
    expect(duringReloadDefault.body.data?.id).toBe(chatV1)

    yield* Deferred.succeed(gate, undefined)
    yield* Deferred.await(reloaded)
    const settledResponse = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/integration?location[directory]=${encodeURIComponent(tmp.path)}`)),
    )
    expect(settledResponse.status).toBe(200)

    const updatedList = yield* getModels()
    expect(updatedList.status).toBe(200)
    expect(updatedList.body.data.some((model) => model.providerID === customProvider && model.id === chatV2)).toBeTrue()
    expect(
      updatedList.body.data.some((model) => model.providerID === customProvider && model.id === chatV1),
    ).toBeFalse()

    const updatedDefault = yield* getDefault()
    expect(updatedDefault.status).toBe(200)
    expect(updatedDefault.body.data?.id).toBe(chatV2)
  }),
)
