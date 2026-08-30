import { expect, test } from "bun:test"
import { Rpc } from "@opencode-ai/schema/rpc"
import { Cause, Context, Effect, Exit, Fiber, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { OpenCode } from "../src/effect/index"

const definition = Rpc.define({
  id: "example",
  methods: {
    count: {
      input: Schema.Struct({ count: Schema.FiniteFromString }),
      output: Schema.FiniteFromString,
      errors: { too_large: Schema.Struct({ limit: Schema.FiniteFromString }) },
    },
    echo: { input: Schema.Json, output: Schema.Json },
    empty: { input: Schema.Undefined, output: Schema.Undefined },
    raw: { input: { type: "string" }, output: { type: "number" } },
  },
  events: {
    progress: { schema: Schema.Struct({ count: Schema.FiniteFromString }) },
    message: { schema: Schema.Struct({ text: Schema.String }) },
  },
})

const connected = { id: "evt_connected", type: "server.connected", data: {} }

function rpcEvent(count: unknown, directory = "/project/one", rpcID = "example", name = "progress") {
  return {
    id: "evt_progress",
    created: 123,
    type: `rpc.${rpcID}.${name}`,
    location: { directory },
    metadata: { origin: "test" },
    data: { count },
  }
}

function eventSource() {
  const requests: HttpClientRequest.HttpClientRequest[] = []
  const opened = Promise.withResolvers<{
    controller: ReadableStreamDefaultController<Uint8Array>
    signal: AbortSignal
  }>()
  const cancelled = Promise.withResolvers<void>()
  return {
    requests,
    opened: opened.promise,
    cancelled: cancelled.promise,
    async push(event: unknown) {
      const source = await opened.promise
      source.controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    },
    httpClient: HttpClient.make((request, _url, signal) => {
      requests.push(request)
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                opened.resolve({ controller, signal })
              },
              cancel() {
                cancelled.resolve()
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
      )
    }),
  }
}

test("Effect RPC calls retain encoded inputs, decode outputs, and preserve raw native RPC calls", async () => {
  const requests: Array<{ url: string; body: unknown }> = []
  const httpClient = HttpClient.make((request) => {
    const body = request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : {}
    requests.push({ url: request.url, body })
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          output: request.url.endsWith("/count") ? "42" : request.url.endsWith("/raw") ? 7 : body.input,
        }),
      ),
    )
  })
  const result = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: new URL("http://localhost:3000") })
    const rpc = client.rpc(definition)
    const count = yield* rpc.count({ count: "2" })
    const primitives = yield* Effect.forEach([null, false, 0, "hello", [1, "two"]], (value) => rpc.echo(value))
    const empty = yield* rpc.empty()
    const raw = yield* rpc.raw("input")
    const native = yield* client.rpc.call({ rpcID: "example", method: "count", input: null })
    expect(Object.keys(rpc.events)).toEqual(["subscribe"])
    return { count, primitives, empty, raw, native }
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(result).toEqual({
    count: 42,
    primitives: [null, false, 0, "hello", [1, "two"]],
    empty: undefined,
    raw: 7,
    native: { output: "42" },
  })
  expect(requests[0]).toEqual({ url: "http://localhost:3000/api/rpc/example/count", body: { input: { count: "2" } } })
  expect(requests.find((request) => request.url.endsWith("/empty"))?.body).toEqual({})
})

test("Effect RPC trusts server-side Standard Schema transforms for outputs and events", async () => {
  const validations: unknown[] = []
  const standard = {
    "~standard": {
      version: 1 as const,
      vendor: "fixture",
      validate(value: unknown) {
        validations.push(value)
        return { value: String(value) + " transformed" }
      },
    },
  }
  const service = Rpc.define({
    id: "standard",
    methods: { transform: { input: standard, output: standard } },
    events: {
      transformed: {
        schema: {
          "~standard": {
            version: 1 as const,
            vendor: "fixture",
            validate(value: unknown) {
              validations.push(value)
              return { value: { text: String(value) + " transformed" } }
            },
          },
        },
      },
    },
  })
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        request.url.endsWith("/api/event")
          ? new Response(
              `data: ${JSON.stringify({ ...rpcEvent(1), type: "rpc.standard.transformed", data: { text: "done" } })}\n\n`,
              { headers: { "content-type": "text/event-stream" } },
            )
          : Response.json({ output: "done" }),
      ),
    ),
  )
  const result = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    const rpc = client.rpc(service)
    return {
      output: yield* rpc.transform("input"),
      events: yield* Stream.runCollect(rpc.events.subscribe("transformed")),
    }
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(result.output).toBe("done")
  expect(result.events[0].data).toEqual({ text: "done" })
  expect(validations).toEqual([])
})

test("Effect RPC validates decoded outputs in the failure channel", async () => {
  const requests: string[] = []
  const httpClient = HttpClient.make((request) => {
    requests.push(request.url)
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ output: "not a number" })))
  })
  const error = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    return yield* Effect.flip(client.rpc(definition).count({ count: "1" }))
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(Schema.isSchemaError(error)).toBe(true)
  expect(requests).toEqual(["http://localhost:3000/api/rpc/example/count"])
})

test("Effect RPC decodes declared errors and removes the generic transport wrapper", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          { _tag: "RpcError", type: "too_large", message: "Too large", data: { limit: "3" } },
          { status: 400 },
        ),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    return yield* client.rpc(definition).count({ count: "4" }).pipe(Effect.flip)
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(error).toEqual({ type: "too_large", message: "Too large", data: { limit: 3 } })
})

test("Effect RPC removes the internal transport wrapper", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          { _tag: "RpcInternalError", type: "rpc.internal", message: "Failed" },
          { status: 500 },
        ),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    return yield* client.rpc(definition).count({ count: "4" }).pipe(Effect.flip)
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(error).toEqual({ type: "rpc.internal", message: "Failed" })
})

test("Effect RPC isolates per-call location and headers while preserving configured defaults and native behavior", async () => {
  const requests: Array<{ url: URL; headers: HttpClientRequest.HttpClientRequest["headers"] }> = []
  const release = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const httpClient = HttpClient.make((request, url) => {
    requests.push({ url, headers: request.headers })
    if (requests.length === 1) started.resolve()
    return Effect.promise(() => release.promise).pipe(
      Effect.as(
        HttpClientResponse.fromWeb(
          request,
          url.pathname.endsWith("/health")
            ? Response.json({ healthy: true, version: "test", pid: 1 })
            : Response.json({ output: "3" }),
        ),
      ),
    )
  }).pipe(HttpClient.mapRequest(HttpClientRequest.setHeaders({ authorization: "Bearer base", "x-default": "base" })))
  const client = await Effect.runPromise(
    OpenCode.make({ baseUrl: "http://localhost:3000" }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
  )
  const rpc = client.rpc(definition)
  const first = Effect.runPromise(
    rpc.count(
      { count: "1" },
      { location: { directory: "/project/one", workspace: "one" }, headers: { "x-call": "one" } },
    ),
  )
  await started.promise
  const second = Effect.runPromise(
    rpc.count(
      { count: "2" },
      { location: { directory: "/project/two" }, headers: new Headers({ "x-call": "two", "x-default": "override" }) },
    ),
  )
  const native = Effect.runPromise(client.health.get())
  release.resolve()
  expect(await Promise.all([first, second])).toEqual([3, 3])
  expect(await native).toEqual({ healthy: true, version: "test", pid: 1 })
  expect(requests.map((request) => request.headers.authorization)).toEqual([
    "Bearer base",
    "Bearer base",
    "Bearer base",
  ])
  expect(requests.map((request) => request.headers["x-call"])).toEqual(["one", "two", undefined])
  expect(requests.map((request) => request.headers["x-default"])).toEqual(["base", "override", "base"])
  expect(requests.map((request) => request.url.searchParams.get("location[directory]"))).toEqual([
    "/project/one",
    "/project/two",
    null,
  ])
  expect(requests.map((request) => request.url.searchParams.get("location[workspace]"))).toEqual(["one", null, null])
})

test("RPC signals and consumer interruption abort only their own HTTP calls", async () => {
  const started: Array<ReturnType<typeof Promise.withResolvers<AbortSignal>>> = [
    Promise.withResolvers<AbortSignal>(),
    Promise.withResolvers<AbortSignal>(),
  ]
  const signals: AbortSignal[] = []
  const finalized: number[] = []
  const httpClient = HttpClient.make((_request, _url, signal) => {
    const index = signals.length
    signals.push(signal)
    started[index].resolve(signal)
    return Effect.never.pipe(Effect.ensuring(Effect.sync(() => finalized.push(index))))
  })
  const client = await Effect.runPromise(
    OpenCode.make({ baseUrl: "http://localhost:3000" }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
  )
  const rpc = client.rpc(definition)
  const abort = new AbortController()
  const first = Effect.runFork(rpc.count({ count: "1" }, { signal: abort.signal }))
  const second = Effect.runFork(rpc.count({ count: "2" }))
  await Promise.all(started.map((entry) => entry.promise))
  abort.abort()
  const exit = await Effect.runPromise(Fiber.await(first))
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
  expect(signals.map((signal) => signal.aborted)).toEqual([true, false])
  expect(finalized).toEqual([0])
  await Effect.runPromise(Fiber.interrupt(second))
  expect(signals[1].aborted).toBe(true)
  expect(finalized).toEqual([0, 1])

  const preAborted = await Effect.runPromiseExit(rpc.count({ count: "3" }, { signal: abort.signal }))
  expect(Exit.isFailure(preAborted) && Cause.hasInterruptsOnly(preAborted.cause)).toBe(true)
  expect(signals).toHaveLength(2)
})

test("native and RPC Effect streams share one lazy source, cache connected, and filter across all locations", async () => {
  const source = eventSource()
  const client = await Effect.runPromise(
    OpenCode.make({ baseUrl: "http://localhost:3000" }).pipe(
      Effect.provideService(HttpClient.HttpClient, source.httpClient),
    ),
  )
  const rpc = client.rpc(definition)
  const native = Stream.toAsyncIterable(client.event.subscribe())[Symbol.asyncIterator]()
  const progress = Stream.toAsyncIterable(rpc.events.subscribe("progress"))[Symbol.asyncIterator]()
  expect(source.requests).toHaveLength(0)
  const marker = native.next()
  await source.push(connected)
  expect((await marker).value).toEqual(connected)

  const first = progress.next()
  const late = Stream.toAsyncIterable(client.event.subscribe())[Symbol.asyncIterator]()
  expect((await late.next()).value).toEqual(connected)
  await native.return?.()
  await late.return?.()
  await source.push(rpcEvent("ignored", "/project/one", "other"))
  await source.push(rpcEvent("ignored", "/project/one", "example", "message"))
  await source.push(rpcEvent("1"))
  expect((await first).value).toEqual({
    id: "evt_progress",
    created: 123,
    type: "rpc.example.progress",
    metadata: { origin: "test" },
    data: { count: 1 },
    location: { directory: "/project/one" },
  })
  const second = progress.next()
  await source.push(rpcEvent("2", "/project/two"))
  expect((await second).value).toEqual(
    expect.objectContaining({ data: { count: 2 }, location: { directory: "/project/two" } }),
  )
  expect(source.requests).toHaveLength(1)

  expect((await source.opened).signal.aborted).toBe(false)
  const third = progress.next()
  await source.push(rpcEvent("3"))
  expect((await third).value.data).toEqual({ count: 3 })
  const pending = progress.next()
  await progress.return?.()
  expect((await pending).done).toBe(true)
  await source.cancelled
  expect((await source.opened).signal.aborted).toBe(true)
})

test("interrupting a native Effect stream leaves an active RPC consumer running", async () => {
  const source = eventSource()
  const client = await Effect.runPromise(
    OpenCode.make({ baseUrl: "http://localhost:3000" }).pipe(
      Effect.provideService(HttpClient.HttpClient, source.httpClient),
    ),
  )
  const native = Effect.runFork(Stream.runCollect(client.event.subscribe()))
  const progress = Stream.toAsyncIterable(client.rpc(definition).events.subscribe("progress"))[Symbol.asyncIterator]()
  const first = progress.next()
  await source.push(rpcEvent("1"))
  expect((await first).value.data).toEqual({ count: 1 })
  await Effect.runPromise(Fiber.interrupt(native))
  expect((await source.opened).signal.aborted).toBe(false)
  const second = progress.next()
  await source.push(rpcEvent("2"))
  expect((await second).value.data).toEqual({ count: 2 })
  await progress.return?.()
  await source.cancelled
})

test("shared Effect streams preserve EOF without reconnecting", async () => {
  const source = eventSource()
  const client = await Effect.runPromise(
    OpenCode.make({ baseUrl: "http://localhost:3000" }).pipe(
      Effect.provideService(HttpClient.HttpClient, source.httpClient),
    ),
  )
  const native = Effect.runPromise(Stream.runCollect(client.event.subscribe()))
  const progress = Effect.runPromise(Stream.runCollect(client.rpc(definition).events.subscribe("progress")))
  await source.push(connected)
  await source.push(rpcEvent("1"))
  const connection = await source.opened
  connection.controller.close()
  expect((await native).map((event) => event.type)).toEqual(["server.connected", "rpc.example.progress"])
  expect((await progress).map((event) => event.data)).toEqual([{ count: 1 }])
  expect(source.requests).toHaveLength(1)
})

test("native protocol failures reach both native and RPC streams as ClientError", async () => {
  const source = eventSource()
  const client = await Effect.runPromise(
    OpenCode.make({ baseUrl: "http://localhost:3000" }).pipe(
      Effect.provideService(HttpClient.HttpClient, source.httpClient),
    ),
  )
  const native = Effect.runPromise(Effect.flip(Stream.runCollect(client.event.subscribe())))
  const progress = Effect.runPromise(
    Effect.flip(Stream.runCollect(client.rpc(definition).events.subscribe("progress"))),
  )
  await source.push({ type: "server.connected" })
  expect((await native)._tag).toBe("ClientError")
  expect(await progress).toBe(await native)
  expect(source.requests).toHaveLength(1)
})

test("HTTP source failures reach every Effect consumer", async () => {
  const source = eventSource()
  const client = await Effect.runPromise(
    OpenCode.make({ baseUrl: "http://localhost:3000" }).pipe(
      Effect.provideService(HttpClient.HttpClient, source.httpClient),
    ),
  )
  const native = Effect.runPromise(Effect.flip(Stream.runCollect(client.event.subscribe())))
  const progress = Effect.runPromise(
    Effect.flip(Stream.runCollect(client.rpc(definition).events.subscribe("progress"))),
  )
  await source.push(connected)
  const connection = await source.opened
  connection.controller.error(new Error("connection lost"))
  expect((await native)._tag).toBe("ClientError")
  expect(await progress).toBe(await native)
  expect(source.requests).toHaveLength(1)
})

test("RPC payload decoding fails only the matching consumer, not the native event stream", async () => {
  const source = eventSource()
  const client = await Effect.runPromise(
    OpenCode.make({ baseUrl: "http://localhost:3000" }).pipe(
      Effect.provideService(HttpClient.HttpClient, source.httpClient),
    ),
  )
  const native = Stream.toAsyncIterable(client.event.subscribe())[Symbol.asyncIterator]()
  const raw = native.next()
  const progress = Effect.runPromise(
    Effect.flip(Stream.runCollect(client.rpc(definition).events.subscribe("progress"))),
  )
  await source.push(rpcEvent("not a number"))
  expect((await raw).value.type).toBe("rpc.example.progress")
  expect(Schema.isSchemaError(await progress)).toBe(true)
  expect((await source.opened).signal.aborted).toBe(false)
  const next = native.next()
  await source.push(connected)
  expect((await next).value.type).toBe("server.connected")
  await native.return?.()
  await source.cancelled
})

test("shared event source runs with the Effect context captured by make", async () => {
  const Token = Context.Reference("test/rpc-effect/token", { defaultValue: () => "missing" })
  const httpClient = HttpClient.make((request) =>
    Effect.gen(function* () {
      const token = yield* Token
      expect(token).toBe("captured")
      return HttpClientResponse.fromWeb(
        request,
        new Response(`data: ${JSON.stringify(connected)}\n\n`, { headers: { "content-type": "text/event-stream" } }),
      )
    }),
  )
  const client = await Effect.runPromise(
    OpenCode.make({ baseUrl: "http://localhost:3000" }).pipe(
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.provideService(Token, "captured"),
    ),
  )
  expect((await Effect.runPromise(Stream.runCollect(client.event.subscribe())))[0]).toEqual(connected)
})

test("Effect RPC rejects inherited event names without opening the source", async () => {
  const requests: string[] = []
  const httpClient = HttpClient.make((request) => {
    requests.push(request.url)
    return Effect.die(new Error("Unexpected request"))
  })
  const error = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    const broad: Rpc.Definition = definition
    return yield* client.rpc(broad).events.subscribe("toString").pipe(Stream.runDrain, Effect.flip)
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(error).toEqual(new Error("Unknown RPC event: rpc.example.toString"))
  expect(requests).toEqual([])
})
