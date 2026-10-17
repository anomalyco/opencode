import { expect } from "bun:test"
import { Server } from "node:http"
import { NodeHttpServer, NodeSocket } from "@effect/platform-node"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { define } from "@opencode/plugin/effect/plugin"
import { Rpc } from "@opencode/schema/rpc"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { Socket } from "effect/socket"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

const Binary = Rpc.define({
  id: "binary",
  methods: {
    echo: { websocket: true, input: Schema.Literal("allowed"), output: Schema.Void },
  },
  events: {},
})

it.live(
  "plugin WebSockets require authentication, origin and method validation before upgrade",
  () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const context = yield* Layer.build(
        createRoutes({
          password: "secret",
          database: { path: ":memory:" },
          models: { fetch: false },
          config: { directory: directory.path, project: false, content: "{}" },
          fs: { filewatcher: false },
        }).pipe(Layer.provide(NodeHttpServer.layerHttpServices)),
      )
      const sdk = Context.get(context, SdkPlugins.Service)
      yield* sdk.register(
        define({
          id: "binary-rpc",
          effect: (ctx) =>
            ctx.rpc
              .register(Binary, {
                echo: (_input, call) =>
                  Effect.gen(function* () {
                    const socket = yield* call.socket
                    const reader = yield* socket.reader
                    const writer = yield* socket.writer
                    yield* Effect.forEach(yield* reader.pull, (frame) => writer.write(frame))
                    yield* writer.write(new Socket.CloseEvent(1000))
                  }).pipe(Effect.scoped, Effect.orDie),
              })
              .pipe(Effect.asVoid, Effect.orDie),
        }),
      )
      const http = yield* NodeHttpServer.make(() => new Server(), { port: 0, host: "127.0.0.1" })
      yield* http
        .serve(Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(Effect.provide(context)))
        .pipe(Effect.provide(NodeHttpServer.layerHttpServices))
      const url = new URL("/api/rpc/binary/echo/socket", HttpServer.formatAddress(http.address))
      url.protocol = "ws:"
      url.searchParams.set("location[directory]", directory.path)
      url.searchParams.set("input", JSON.stringify("allowed"))
      const authorization = `Basic ${btoa("opencode:secret")}`
      yield* Effect.promise(async () => {
        for (const scenario of [
          { headers: new Headers(), input: '"allowed"', status: 401 },
          {
            headers: new Headers({ authorization, origin: "https://untrusted.example" }),
            input: '"allowed"',
            status: 403,
          },
          { headers: new Headers({ authorization }), input: "not json", status: 400 },
          { headers: new Headers({ authorization }), input: '"denied"', status: 400 },
        ]) {
          url.searchParams.set("input", scenario.input)
          const response = await fetch(url.toString().replace("ws:", "http:"), { headers: scenario.headers })
          expect(response.status).toBe(scenario.status)
          await response.arrayBuffer()
        }
      })
      url.searchParams.set("input", JSON.stringify("allowed"))
      const socket = yield* Socket.fromWebSocket(
        Effect.acquireRelease(
          Effect.sync(() => new NodeSocket.NodeWS.WebSocket(url, { headers: { authorization } })),
          (ws) => Effect.sync(() => ws.terminate()),
        ),
      )
      const reader = yield* socket.reader
      const writer = yield* socket.writer
      yield* writer.write(new Uint8Array([0, 1, 255, 2]))
      expect(yield* reader.pull).toEqual([new Uint8Array([0, 1, 255, 2])])
      const response = yield* Effect.promise(() =>
        fetch(url.toString().replace("ws:", "http:").replace("/socket", ""), {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({ input: "allowed" }),
        }),
      )
      expect(response.status).toBe(400)
      expect(
        Schema.decodeUnknownSync(Schema.Struct({ type: Schema.String }))(yield* Effect.promise(() => response.json()))
          .type,
      ).toBe("rpc.method_not_found")
    }),
  20_000,
)
