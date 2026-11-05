import { expect } from "bun:test"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Plugin } from "@opencode/plugin"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import { Rpc } from "@opencode/plugin/rpc"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createEmbeddedRoutes } from "../src/routes"

const Vibeguard = Rpc.define({
  id: "vibeguard",
  methods: {
    status: {
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, count: { type: "number" } },
        required: ["ok", "count"],
        additionalProperties: false,
      },
    },
    notify: {
      input: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    reset: {},
  },
})

it.live("dispatches HTTP RPC calls for methods without input, output, or events", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const context = yield* Layer.build(
      createEmbeddedRoutes({
        database: { path: ":memory:" },
        models: { fetch: false },
        config: { directory: directory.path, project: false, content: "{}" },
        fs: { filewatcher: false },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const messages: string[] = []
    const TextInput = Schema.Struct({ text: Schema.String })
    const sdk = Context.get(context, SdkPlugins.Service)
    yield* sdk.register(
      fromPromise(
        Plugin.define({
          id: "vibeguard-plugin",
          async setup(ctx) {
            await ctx.rpc.register(Vibeguard, {
              status: async () => ({ ok: true, count: messages.length }),
              notify: async (input) => {
                messages.push(Schema.decodeUnknownSync(TextInput)(input).text)
              },
              reset: async () => {
                messages.length = 0
              },
            })
          },
        }),
      ),
    )

    const webHandler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))

    const post = (method: string, body: unknown) => {
      const url = new URL(`/api/rpc/vibeguard/${method}`, "http://opencode.local")
      url.searchParams.set("location[directory]", directory.path)
      return Effect.promise(async () => {
        const response = await webHandler(
          new Request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        )
        return { status: response.status, json: await response.json() }
      })
    }

    expect(yield* post("status", {})).toEqual({
      status: 200,
      json: { output: { ok: true, count: 0 } },
    })

    const invalidInput = yield* post("status", { input: {} })
    expect(invalidInput.status).toBe(400)
    expect(invalidInput.json).toMatchObject({ _tag: "RpcError", type: "rpc.invalid_input" })

    expect(yield* post("notify", { input: { text: "alpha" } })).toEqual({ status: 200, json: {} })
    expect(yield* post("status", {})).toEqual({ status: 200, json: { output: { ok: true, count: 1 } } })
    expect(yield* post("reset", {})).toEqual({ status: 200, json: {} })
    expect(yield* post("status", {})).toEqual({ status: 200, json: { output: { ok: true, count: 0 } } })
  }),
)
