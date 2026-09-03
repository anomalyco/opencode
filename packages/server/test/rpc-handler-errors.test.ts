import { expect } from "bun:test"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Rpc } from "@opencode-ai/schema/rpc"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createEmbeddedRoutes } from "../src/routes"

const Broken = Rpc.define({
  id: "broken",
  methods: {
    handler: { input: Schema.String, output: Schema.String },
    schema: {
      input: Schema.String.check(
        Schema.makeFilter(() => {
          throw new Error("private schema detail")
        }),
      ),
      output: Schema.String,
    },
  },
  events: {},
})

for (const method of ["handler", "schema"] as const) {
  it.live(`returns HTTP 500 without exposing the ${method} defect`, () =>
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
      const sdk = Context.get(context, SdkPlugins.Service)
      yield* sdk.register(
        define({
          id: "broken-rpc",
          effect: (ctx) =>
            ctx.rpc
              .register(Broken, {
                handler: () => Effect.die(new Error("private handler detail")),
                schema: Effect.succeed,
              })
              .pipe(Effect.asVoid, Effect.orDie),
        }),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const url = new URL(`/api/rpc/broken/${method}`, "http://opencode.local")
      url.searchParams.set("location[directory]", directory.path)
      const response = yield* Effect.promise(() =>
        handler(
          new Request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ input: "hello" }),
          }),
        ),
      )
      expect(response.status).toBe(500)
      expect(yield* Effect.promise(() => response.json())).toEqual({
        _tag: "RpcInternalError",
        type: "rpc.internal",
        message: "RPC call failed",
      })
    }),
  )
}
