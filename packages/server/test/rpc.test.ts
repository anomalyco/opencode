import { expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { Plugin } from "@opencode-ai/plugin/effect"
import { fromPromise } from "@opencode-ai/plugin/promise/adapter"
import { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import { Rpc } from "@opencode-ai/schema/rpc"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Context, Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

type RpcEvent = Extract<OpenCodeEvent, { type: `rpc.${string}` }>

const authorization = `Basic ${btoa("opencode:secret")}`

const fixture = Effect.fn(function* (plugins: readonly Plugin.Plugin[]) {
  const tmp = yield* Effect.acquireRelease(
    Effect.promise(() => tmpdir("opencode-rpc-server-")),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )
  const first = path.join(tmp.path, "first")
  const second = path.join(tmp.path, "second")
  const config = path.join(tmp.path, "config")
  yield* Effect.promise(() => Promise.all([first, second, config].map((directory) => mkdir(directory))))
  const context = yield* Layer.build(
    createRoutes({
      password: "secret",
      database: { path: ":memory:" },
      config: { directory: config, project: false, content: "{}" },
      fs: { filewatcher: false },
    }).pipe(Layer.provide(HttpServer.layerServices)),
  )
  const sdk = Context.get(context, SdkPlugins.Service)
  yield* Effect.forEach(plugins, (plugin) => sdk.register(plugin))
  const locations = Context.get(context, LocationServiceMap.Service)
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  return {
    first,
    second,
    handler,
    boot: (directory: string) =>
      Effect.gen(function* () {
        const supervisor = yield* PluginSupervisor.Service
        yield* supervisor.flush
      }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) })))),
    call: (
      route: string,
      body: unknown = {},
      options: { directory?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
    ) =>
      Effect.promise(() => {
        const url = new URL(`/api/rpc/${route}`, "http://opencode.local")
        if (options.directory) url.searchParams.set("location[directory]", options.directory)
        return handler(
          new Request(url, {
            method: "POST",
            headers: { authorization, "content-type": "application/json", ...options.headers },
            body: JSON.stringify(body),
            signal: options.signal,
          }),
        )
      }),
  }
})

it.live("dispatches RPC wrappers with query, header and default locations and generic failures", () =>
  Effect.gen(function* () {
    const Echo = Rpc.define({
      id: "transport.echo",
      methods: {
        echo: { input: Schema.String, output: Schema.String },
        json: { input: Schema.Json, output: Schema.Json },
        empty: { input: Schema.Undefined, output: Schema.Undefined },
        fail: {
          input: Schema.Undefined,
          output: Schema.String,
          errors: { rejected: Schema.Struct({ reason: Schema.String }) },
        },
        defect: { input: Schema.Undefined, output: Schema.String },
        invalid: { input: Schema.Undefined, output: { type: "string" } },
      },
      events: {},
    })
    const server = yield* fixture([
      Plugin.define({
        id: "transport-implementer",
        effect: (ctx) =>
          Effect.gen(function* () {
            const location = (yield* ctx.agent.list()).location
            yield* ctx.rpc.register(Echo, {
              echo: (input) => Effect.succeed(`${location.directory}:${input}`),
              json: (input) => Effect.succeed(input),
              empty: () => Effect.succeed(undefined),
              fail: (_input, context) =>
                Effect.fail(context.error("rejected", "handler failed", { reason: "declared" })),
              defect: () => Effect.die(new Error("handler defect")),
              invalid: () => Effect.succeed(123),
            })
          }).pipe(Effect.orDie),
      }),
    ])
    yield* server.boot(server.first)
    yield* server.boot(server.second)
    yield* server.boot(process.cwd())
    const selected = yield* server.call(
      "transport.echo/echo",
      { input: "selected" },
      {
        directory: server.first,
        headers: { "x-opencode-directory": encodeURIComponent(server.second) },
      },
    )
    expect(selected.status).toBe(200)
    expect(yield* Effect.promise(() => selected.json())).toEqual({ output: `${server.first}:selected` })
    const header = yield* server.call(
      "transport.echo/echo",
      { input: "header" },
      {
        headers: { "x-opencode-directory": encodeURIComponent(server.second) },
      },
    )
    expect(yield* Effect.promise(() => header.json())).toEqual({ output: `${server.second}:header` })
    const fallback = yield* server.call("transport.echo/echo", { input: "default" })
    expect(yield* Effect.promise(() => fallback.json())).toEqual({ output: `${process.cwd()}:default` })
    const empty = yield* server.call("transport.echo/empty")
    expect(empty.status).toBe(200)
    expect(yield* Effect.promise(() => empty.json())).toEqual({})
    yield* Effect.forEach([null, false, 42, ["array"], { location: "ordinary input" }], (input) =>
      Effect.gen(function* () {
        const response = yield* server.call("transport.echo/json", { input })
        expect(response.status).toBe(200)
        expect(yield* Effect.promise(() => response.json())).toEqual({ output: input })
      }),
    )
    const denied = yield* server.call("transport.echo/empty", {}, { headers: { authorization: "" } })
    expect(denied.status).toBe(401)
    yield* Effect.forEach(
      [
        {
          route: "missing/echo",
          body: {},
          error: { type: "rpc.unavailable", message: "RPC is unavailable: missing" },
        },
        {
          route: "transport.echo/missing",
          body: {},
          error: { type: "rpc.method_not_found", message: "Unknown RPC method: transport.echo.missing" },
        },
        {
          route: "transport.echo/fail",
          body: {},
          error: { type: "rejected", message: "handler failed", data: { reason: "declared" } },
        },
        { route: "transport.echo/echo", body: { input: 123 }, error: { type: "rpc.invalid_input" } },
      ],
      (item) =>
        Effect.gen(function* () {
          const response = yield* server.call(item.route, item.body)
          expect(response.status).toBe(400)
          expect(yield* Effect.promise(() => response.json())).toMatchObject({
            _tag: "RpcError",
            message: expect.any(String),
            ...item.error,
          })
        }),
    )
    const defect = yield* server.call("transport.echo/defect")
    expect(defect.status).toBe(500)
    expect(yield* Effect.promise(() => defect.json())).toEqual({
      _tag: "RpcInternalError",
      type: "rpc.internal",
      message: "handler defect",
    })
    const invalid = yield* server.call("transport.echo/invalid")
    expect(invalid.status).toBe(500)
    expect(yield* Effect.promise(() => invalid.json())).toMatchObject({
      _tag: "RpcInternalError",
      type: "rpc.invalid_output",
      message: expect.any(String),
    })
    const malformed = yield* server.call("transport.echo/echo", "not a wrapper")
    expect(malformed.status).toBe(400)
    expect(yield* Effect.promise(() => malformed.json())).toMatchObject({
      _tag: "InvalidRequestError",
      message: expect.any(String),
    })
  }),
)

it.live("request cancellation interrupts Effect RPC handlers and signals Promise RPC handlers", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const stopped = yield* Deferred.make<void>()
    const promiseStarted = Promise.withResolvers<void>()
    const promiseStopped = Promise.withResolvers<void>()
    const Blocking = Rpc.define({
      id: "blocking",
      methods: { wait: { input: Schema.Undefined, output: Schema.Undefined } },
      events: {},
    })
    const PromiseBlocking = Rpc.define({
      id: "promise-blocking",
      methods: { wait: { input: { type: "null" }, output: { type: "null" } } },
      events: {},
    })
    const server = yield* fixture([
      Plugin.define({
        id: "effect-blocking",
        effect: (ctx) =>
          ctx.rpc
            .register(Blocking, {
              wait: () =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.ensuring(Deferred.succeed(stopped, undefined)),
                ),
            })
            .pipe(Effect.asVoid, Effect.orDie),
      }),
      fromPromise({
        id: "promise-blocking",
        async setup(ctx) {
          await ctx.rpc.register(PromiseBlocking, {
            wait: (_input, call) =>
              new Promise<null>((resolve) => {
                promiseStarted.resolve()
                call.signal.addEventListener(
                  "abort",
                  () => {
                    promiseStopped.resolve()
                    resolve(null)
                  },
                  { once: true },
                )
              }),
          })
        },
      }),
    ])
    yield* server.boot(server.first)
    const controller = new AbortController()
    const pending = yield* server
      .call(
        "blocking/wait",
        {},
        {
          directory: server.first,
          signal: controller.signal,
        },
      )
      .pipe(Effect.forkScoped)
    yield* Deferred.await(started)
    controller.abort()
    yield* Deferred.await(stopped)
    expect((yield* Fiber.join(pending)).status).not.toBe(400)
    const promiseController = new AbortController()
    const promisePending = yield* server
      .call(
        "promise-blocking/wait",
        { input: null },
        {
          directory: server.first,
          signal: promiseController.signal,
        },
      )
      .pipe(Effect.forkScoped)
    yield* Effect.promise(() => promiseStarted.promise)
    promiseController.abort()
    yield* Effect.promise(() => promiseStopped.promise)
    expect((yield* Fiber.join(promisePending)).status).not.toBe(400)
  }),
)

it.live("public SSE and generic native plugin subscriptions receive RPC events across locations", () =>
  Effect.gen(function* () {
    const Updates = Rpc.define({
      id: "updates",
      methods: { emit: { input: Schema.String, output: Schema.Undefined } },
      events: { updated: { schema: Schema.Struct({ text: Schema.String }) } },
    })
    const received: RpcEvent[] = []
    const observed = yield* Deferred.make<void>()
    const server = yield* fixture([
      Plugin.define({
        id: "updates-implementer",
        effect: (ctx) =>
          Effect.gen(function* () {
            const registration = yield* ctx.rpc.register(Updates, {
              emit: (input): Effect.Effect<undefined> =>
                registration.events.emit("updated", { text: input }).pipe(Effect.as(undefined), Effect.orDie),
            })
          }).pipe(Effect.orDie),
      }),
      Plugin.define({
        id: "native-observer",
        effect: (ctx) =>
          Effect.gen(function* () {
            const directory = (yield* ctx.agent.list()).location.directory
            // One observer instance should see both locations, just like the public native stream.
            if (path.basename(directory) !== "first") return
            yield* ctx.event.subscribe().pipe(
              Stream.filter((event): event is RpcEvent => event.type === "rpc.updates.updated"),
              Stream.take(2),
              Stream.runForEach((event) => Effect.sync(() => received.push(event))),
              Effect.andThen(Deferred.succeed(observed, undefined)),
              Effect.forkScoped({ startImmediately: true }),
            )
          }).pipe(Effect.orDie),
      }),
    ])
    yield* server.boot(server.first)
    yield* server.boot(server.second)
    const response = yield* Effect.promise(() =>
      server.handler(
        new Request("http://opencode.local/api/event", {
          headers: { authorization, "x-opencode-directory": encodeURIComponent(server.first) },
        }),
      ),
    )
    expect(response.status).toBe(200)
    if (!response.body) throw new Error("Expected an SSE body")
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    yield* Effect.addFinalizer(() => Effect.promise(() => reader.cancel()))
    expect((yield* Effect.promise(() => reader.read())).value).toContain('"type":"server.connected"')
    const first = yield* server.call("updates/emit", { input: "first" }, { directory: server.first })
    const second = yield* server.call("updates/emit", { input: "second" }, { directory: server.second })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const events: RpcEvent[] = []
    while (events.length < 2) {
      const chunk = yield* Effect.promise(() => reader.read())
      if (chunk.done) throw new Error("Event stream closed before RPC events arrived")
      events.push(
        ...chunk.value
          .split("\n\n")
          .filter((frame) => frame.startsWith("data: "))
          .map((frame) => Schema.decodeUnknownSync(Schema.fromJsonString(OpenCodeEvent))(frame.slice(6)))
          .filter((event): event is RpcEvent => event.type === "rpc.updates.updated"),
      )
    }
    yield* Deferred.await(observed)
    expect(events).toMatchObject([
      {
        type: "rpc.updates.updated",
        location: { directory: server.first },
        data: { text: "first" },
      },
      {
        type: "rpc.updates.updated",
        location: { directory: server.second },
        data: { text: "second" },
      },
    ])
    expect(received).toEqual(events)
  }),
  15_000,
)
