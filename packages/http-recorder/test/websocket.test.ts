import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Socket } from "effect/unstable/socket"
import { existsSync } from "node:fs"
import { HttpRecorder } from "../src"
import { layerSocketWithMode } from "../src/websocket/recorder"
import { failureText, readCassette, seedCassetteDirectory, tempDirectory, withEnvironment } from "./support"

const unavailableSocket = Socket.make({
  runRaw: () => Effect.die(new Error("unexpected live WebSocket run")),
  writer: Effect.succeed(() => Effect.die(new Error("unexpected live WebSocket write"))),
})

class EchoWebSocket extends EventTarget {
  readonly protocol = ""
  readonly extensions = ""
  bufferedAmount = 0
  binaryType: BinaryType = "blob"
  readyState = 0

  constructor(readonly url: string) {
    super()
    queueMicrotask(() => {
      this.readyState = 1
      this.dispatchEvent(new Event("open"))
    })
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })))
  }

  close(code = 1000, reason = "") {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean: code === 1000 }))
  }
}

describe("WebSocket", () => {
  test("constructor recording is complete when the recorder layer closes", async () => {
    using directory = tempDirectory("http-recorder-websocket-constructor-")
    const recorder = HttpRecorder.layerWebSocketConstructor("websocket/constructor-record", {
      directory: directory.path,
    }).pipe(
      Layer.provide(
        Layer.succeed(Socket.WebSocketConstructor, (url) => new EchoWebSocket(url) as unknown as globalThis.WebSocket),
      ),
    )

    await withEnvironment("CI", undefined, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const socket = yield* Socket.makeWebSocket("wss://echo.example.test/one", {
            protocols: ["echo.v1"],
            closeCodeIsError: () => false,
          })
          const write = yield* socket.writer
          yield* socket.runString(() => write(new Socket.CloseEvent(1000, "complete")).pipe(Effect.orDie), {
            onOpen: write("hello").pipe(Effect.orDie),
          })
        }).pipe(Effect.scoped, Effect.provide(recorder)),
      ),
    )

    expect(readCassette(`${directory.path}/websocket/constructor-record.json`).interactions).toEqual([
      {
        transport: "websocket",
        connection: {
          sequence: 0,
          url: "wss://echo.example.test/one",
          protocols: ["echo.v1"],
          close: { code: 1000, reason: "complete" },
        },
        events: [
          { direction: "client", kind: "text", body: "hello" },
          { direction: "server", kind: "text", body: "hello" },
        ],
      },
    ])
  })

  test("constructor replay validates dynamic URLs and protocols without opening a live socket", async () => {
    using directory = tempDirectory("http-recorder-websocket-constructor-")
    await seedCassetteDirectory(directory.path, "websocket/constructor", [
      {
        transport: "websocket",
        connection: {
          sequence: 0,
          url: "wss://events.example.test/workspaces/one",
          protocols: ["events.v1"],
          close: { code: 1000, reason: "complete" },
        },
        events: [
          { direction: "client", kind: "text", body: '{"type":"subscribe"}' },
          { direction: "server", kind: "text", body: '{"type":"ready"}' },
        ],
      },
    ])
    const unavailableConstructor = () => {
      throw new Error("unexpected live WebSocket construction")
    }
    const recorder = HttpRecorder.layerWebSocketConstructor("websocket/constructor", {
      directory: directory.path,
    }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, unavailableConstructor)))

    const received = await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.makeWebSocket("wss://events.example.test/workspaces/one", {
          protocols: ["events.v1"],
          closeCodeIsError: () => false,
        })
        const write = yield* socket.writer
        const received: string[] = []
        yield* socket.runString(
          (message) => {
            received.push(message)
          },
          {
            onOpen: write('{"type":"subscribe"}').pipe(Effect.orDie),
          },
        )
        return received
      }).pipe(Effect.scoped, Effect.provide(recorder)),
    )

    expect(received).toEqual(['{"type":"ready"}'])
  })

  test("constructor replay rejects a different dynamic URL", async () => {
    using directory = tempDirectory("http-recorder-websocket-constructor-")
    await seedCassetteDirectory(directory.path, "websocket/constructor-mismatch", [
      {
        transport: "websocket",
        connection: {
          sequence: 0,
          url: "wss://events.example.test/workspaces/one",
          protocols: [],
          close: { code: 1000, reason: "complete" },
        },
        events: [],
      },
    ])
    const recorder = HttpRecorder.layerWebSocketConstructor("websocket/constructor-mismatch", {
      directory: directory.path,
    }).pipe(
      Layer.provide(
        Layer.succeed(Socket.WebSocketConstructor, () => {
          throw new Error("unexpected live WebSocket construction")
        }),
      ),
    )

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.makeWebSocket("wss://events.example.test/workspaces/two")
        yield* socket.runString(() => {})
      }).pipe(Effect.scoped, Effect.exit, Effect.provide(recorder)),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("records WebSocket frames in observed client/server order", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    const response = JSON.stringify({
      type: "response.completed",
      token: "server-secret",
    })
    const upstream = Socket.make({
      runRaw: (handler, options) =>
        Effect.gen(function* () {
          if (options?.onOpen) yield* options.onOpen
          const result = handler(response)
          if (Effect.isEffect(result)) yield* result
        }),
      writer: Effect.succeed(() => Effect.void),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        yield* socket.runRaw(() => {}, {
          onOpen: write(JSON.stringify({ type: "response.create", token: "client-secret" })).pipe(Effect.orDie),
        })
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/record", {
            directory: directory.path,
            metadata: { provider: "test" },
            mode: "record",
          }).pipe(Layer.provide(Layer.succeed(Socket.Socket, upstream))),
        ),
      ),
    )

    expect(readCassette(`${directory.path}/websocket/record.json`)).toMatchObject({
      interactions: [
        {
          transport: "websocket",
          events: [
            {
              direction: "client",
              kind: "text",
              body: '{"type":"response.create","token":"[REDACTED]"}',
            },
            {
              direction: "server",
              kind: "text",
              body: '{"type":"response.completed","token":"[REDACTED]"}',
            },
          ],
        },
      ],
    })
  })

  test("WebSocket replay preserves causal frame ordering", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    await seedCassetteDirectory(directory.path, "websocket/replay", [
      {
        transport: "websocket",
        events: [
          {
            direction: "server",
            kind: "text",
            body: '{"type":"session.created"}',
          },
          {
            direction: "client",
            kind: "text",
            body: '{"type":"response.create","prompt":"hello"}',
          },
          {
            direction: "server",
            kind: "text",
            body: '{"type":"response.completed"}',
          },
        ],
      },
    ])

    const received: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        yield* socket.runRaw((message) =>
          Effect.gen(function* () {
            if (typeof message !== "string") return
            received.push(message)
            const event: unknown = JSON.parse(message)
            if (typeof event !== "object" || event === null || !("type" in event)) return
            if (event.type === "session.created") yield* write('{"prompt":"hello","type":"response.create"}')
          }),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/replay", {
            directory: directory.path,
            compareClientMessagesAsJson: true,
            mode: "replay",
          }).pipe(Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket))),
        ),
      ),
    )

    expect(received).toEqual(['{"type":"session.created"}', '{"type":"response.completed"}'])
  })

  test("the public socket decorator replays a causal provider conversation", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    await seedCassetteDirectory(directory.path, "websocket/public-layer", [
      {
        transport: "websocket",
        events: [
          {
            direction: "server",
            kind: "text",
            body: '{"type":"session.created"}',
          },
          {
            direction: "client",
            kind: "text",
            body: '{"type":"response.create","prompt":"first"}',
          },
          {
            direction: "server",
            kind: "text",
            body: '{"type":"response.completed","id":"first"}',
          },
          {
            direction: "client",
            kind: "text",
            body: '{"type":"response.create","prompt":"second"}',
          },
          {
            direction: "server",
            kind: "text",
            body: '{"type":"response.completed","id":"second"}',
          },
        ],
      },
    ])

    const received: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        yield* socket.runString((message) =>
          Effect.gen(function* () {
            received.push(message)
            const event: unknown = JSON.parse(message)
            if (typeof event !== "object" || event === null) return
            if ("type" in event && event.type === "session.created") {
              yield* write('{"prompt":"first","type":"response.create"}')
              return
            }
            if ("id" in event && event.id === "first") {
              yield* write('{"prompt":"second","type":"response.create"}')
              return
            }
            yield* write(new Socket.CloseEvent(1000, "done"))
          }),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          HttpRecorder.layerSocket("websocket/public-layer", { directory: directory.path }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      ),
    )

    expect(received).toEqual([
      '{"type":"session.created"}',
      '{"type":"response.completed","id":"first"}',
      '{"type":"response.completed","id":"second"}',
    ])
  })

  test("WebSocket replay runs message handlers concurrently", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    await seedCassetteDirectory(directory.path, "websocket/concurrent-handlers", [
      {
        transport: "websocket",
        events: [
          { direction: "server", kind: "text", body: "first" },
          { direction: "server", kind: "text", body: "second" },
        ],
      },
    ])

    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const second = yield* Deferred.make<void>()
        yield* socket.runString((message) =>
          message === "first" ? Deferred.await(second) : Deferred.succeed(second, undefined),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/concurrent-handlers", { directory: directory.path, mode: "replay" }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      ),
    )
  })

  test("rejected concurrent replay does not consume the next interaction", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    await seedCassetteDirectory(directory.path, "websocket/concurrent-runs", [
      { transport: "websocket", events: [{ direction: "server", kind: "text", body: "first" }] },
      { transport: "websocket", events: [{ direction: "server", kind: "text", body: "second" }] },
    ])

    const received: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const first = yield* socket
          .runString((message) =>
            Effect.gen(function* () {
              received.push(message)
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
            }),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)

        const concurrent = yield* Effect.exit(socket.runString(() => Effect.void))
        expect(failureText(concurrent)).toContain("Concurrent runs")

        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        yield* socket.runString((message) => Effect.sync(() => received.push(message)))
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/concurrent-runs", { directory: directory.path, mode: "replay" }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      ),
    )

    expect(received).toEqual(["first", "second"])
  })

  test("WebSocket replay rejects close with unconsumed events", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    await seedCassetteDirectory(directory.path, "websocket/early-close", [
      {
        transport: "websocket",
        events: [{ direction: "client", kind: "text", body: "expected" }],
      },
    ])

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        return yield* Effect.exit(
          socket.runRaw(() => {}, {
            onOpen: write(new Socket.CloseEvent(1000)).pipe(Effect.orDie),
          }),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/early-close", { directory: directory.path, mode: "replay" }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      ),
    )

    expect(failureText(exit)).toContain("closed with unconsumed events")
  })

  test("failed WebSocket runs do not write complete cassettes", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        return yield* Effect.exit(socket.runRaw(() => {}))
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/failed-run", { directory: directory.path, mode: "record" }).pipe(
            Layer.provide(
              Layer.succeed(
                Socket.Socket,
                Socket.make({
                  runRaw: () => Effect.die(new Error("connection failed")),
                  writer: Effect.succeed(() => Effect.void),
                }),
              ),
            ),
          ),
        ),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(existsSync(`${directory.path}/websocket/failed-run.json`)).toBe(false)
  })

  test("WebSocket replay preserves binary frame kinds across reconnects", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    const interaction = {
      transport: "websocket" as const,
      events: [
        {
          direction: "client" as const,
          kind: "binary" as const,
          body: Buffer.from([1, 2]).toString("base64"),
          bodyEncoding: "base64" as const,
        },
        {
          direction: "server" as const,
          kind: "binary" as const,
          body: Buffer.from([3, 4]).toString("base64"),
          bodyEncoding: "base64" as const,
        },
      ],
    }
    await seedCassetteDirectory(directory.path, "websocket/binary", [interaction, interaction])

    const received: number[][] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        const run = socket.runRaw(
          (message) => {
            if (typeof message === "string") throw new Error("Expected a binary WebSocket frame")
            received.push([...message])
          },
          { onOpen: write(new Uint8Array([1, 2])).pipe(Effect.orDie) },
        )
        yield* run
        yield* run
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/binary", { directory: directory.path, mode: "replay" }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      ),
    )

    expect(received).toEqual([
      [3, 4],
      [3, 4],
    ])
  })
})
