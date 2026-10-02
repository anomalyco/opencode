import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { Socket } from "effect/socket"
import { existsSync } from "node:fs"
import { HttpRecorder } from "../src"
import { layerSocketWithMode } from "../src/websocket/recorder"
import { failureText, readCassette, seedCassetteDirectory, tempDirectory, withEnvironment } from "./support"

const unavailableSocket = Socket.make({
  reader: Effect.die(new Error("unexpected live WebSocket run")),
  writer: Effect.succeed({
    write: () => Effect.die(new Error("unexpected live WebSocket write")),
    writeAll: () => Effect.die(new Error("unexpected live WebSocket write")),
  }),
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
         Layer.succeed(Socket.WebSocketConstructor, (url) => new EchoWebSocket(url) as unknown as Socket.WebSocketLike),
      ),
    )

    await withEnvironment("CI", undefined, () =>
      Effect.runPromise(
        Effect.gen(function* () {
           const socket = yield* Socket.makeWebSocket("wss://echo.example.test/one", { protocols: ["echo.v1"] })
           const reader = yield* Socket.readerString(socket)
           const writer = yield* socket.writer
           yield* writer.write("hello")
           expect(yield* reader).toEqual(["hello"])
           yield* writer.write(new Socket.CloseEvent(1000, "complete"))
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

  test("constructor recording forwards handshake options", async () => {
    using directory = tempDirectory("http-recorder-websocket-constructor-")
    let received: unknown
    const recorder = HttpRecorder.layerWebSocketConstructor("websocket/constructor-options", {
      directory: directory.path,
    }).pipe(
      Layer.provide(
        Layer.succeed(Socket.WebSocketConstructor, (url, options) => {
          received = options
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- the fixture implements the WebSocket surface used by the recorder.
           return new EchoWebSocket(url) as unknown as Socket.WebSocketLike
        }),
      ),
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const constructor = yield* Socket.WebSocketConstructor
        const options = { headers: { authorization: "Bearer fixture" } }
        // oxlint-disable-next-line no-restricted-globals -- This test intentionally passes runtime constructor options absent from the public socket type.
        const socket = Reflect.apply(constructor, undefined, ["wss://echo.example.test/options", options])
        yield* Effect.callback<void>((resume) => {
          socket.addEventListener("open", () => {
            socket.close()
            resume(Effect.void)
          })
        })
      }).pipe(Effect.scoped, Effect.provide(recorder)),
    )

    expect(received).toEqual({ headers: { authorization: "Bearer fixture" } })
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
         })
         const pull = yield* Socket.readerString(socket)
         const writer = yield* socket.writer
         yield* writer.write('{"type":"subscribe"}')
         return yield* pull
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
         yield* socket.reader
      }).pipe(Effect.scoped, Effect.exit, Effect.provide(recorder)),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("records WebSocket frames in observed client/server order", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    const batches: Array<ReadonlyArray<string | Uint8Array>> = []
    const response = JSON.stringify({
      type: "response.completed",
      token: "server-secret",
    })
    const upstream = Socket.make({
      reader: Effect.succeed({ pull: Effect.succeed([response] as const), upgrade: Socket.SocketUpgradeError.unsupported }),
      writer: Effect.succeed({
        write: () => Effect.void,
        writeAll: (messages) => Effect.sync(() => { batches.push(messages) }),
      }),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const reader = yield* socket.reader
        const writer = yield* socket.writer
        yield* writer.write(JSON.stringify({ type: "response.create", token: "client-secret" }))
        yield* writer.writeAll(["first", "second"])
        yield* reader.pull
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
            { direction: "client", kind: "text", body: "first" },
            { direction: "client", kind: "text", body: "second" },
            {
              direction: "server",
              kind: "text",
              body: '{"type":"response.completed","token":"[REDACTED]"}',
            },
          ],
        },
      ],
    })
    expect(batches).toEqual([["first", "second"]])
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
        const reader = yield* socket.reader
        const writer = yield* socket.writer
        received.push(...(yield* reader.pull).filter((message): message is string => typeof message === "string"))
        yield* writer.write('{"prompt":"hello","type":"response.create"}')
        received.push(...(yield* reader.pull).filter((message): message is string => typeof message === "string"))
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
        const pull = yield* Socket.readerString(socket)
        const writer = yield* socket.writer
        received.push(...(yield* pull))
        yield* writer.write('{"prompt":"first","type":"response.create"}')
        received.push(...(yield* pull))
        yield* writer.write('{"prompt":"second","type":"response.create"}')
        received.push(...(yield* pull))
        yield* writer.write(new Socket.CloseEvent(1000, "done"))
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

  test("WebSocket replay pulls consecutive server frames in one batch", async () => {
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
        const pull = yield* Socket.readerString(socket)
        expect(yield* pull).toEqual(["first", "second"])
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
        const first = yield* Effect.scoped(
          Effect.gen(function* () {
            const pull = yield* Socket.readerString(socket)
            received.push(...(yield* pull))
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
          }),
        ).pipe(Effect.forkChild)
        yield* Deferred.await(started)

        const concurrent = yield* Effect.exit(Effect.scoped(socket.reader))
        expect(failureText(concurrent)).toContain("Concurrent runs")

        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const pull = yield* Socket.readerString(socket)
            received.push(...(yield* pull))
          }),
        )
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
        const reader = yield* socket.reader
        const writer = yield* socket.writer
        return yield* Effect.exit(
          writer.write(new Socket.CloseEvent(1000)).pipe(Effect.andThen(reader.pull)),
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
        return yield* Effect.exit(socket.reader)
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/failed-run", { directory: directory.path, mode: "record" }).pipe(
            Layer.provide(
              Layer.succeed(
                Socket.Socket,
                Socket.make({
                  reader: Effect.die(new Error("connection failed")),
                  writer: Effect.succeed({ write: () => Effect.void, writeAll: () => Effect.void }),
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

  test("a failed reader scope does not record a completed WebSocket interaction", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    const upstream = Socket.make({
      reader: Effect.succeed({ pull: Effect.succeed(["received"] as const), upgrade: Socket.SocketUpgradeError.unsupported }),
      writer: Effect.succeed({ write: () => Effect.void, writeAll: () => Effect.void }),
    })

    const exit = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const socket = yield* Socket.Socket
          const reader = yield* socket.reader
          yield* reader.pull
          return yield* Effect.fail(new Error("consumer failed"))
        }),
      ).pipe(
        Effect.exit,
        Effect.provide(
          layerSocketWithMode("websocket/failed-consumer", { directory: directory.path, mode: "record" }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, upstream)),
          ),
        ),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(existsSync(`${directory.path}/websocket/failed-consumer.json`)).toBe(false)
  })

  test("closing a replay reader scope releases a suspended pull", async () => {
    using directory = tempDirectory("http-recorder-websocket-")
    await seedCassetteDirectory(directory.path, "websocket/waiting", [
      { transport: "websocket", events: [{ direction: "client", kind: "text", body: "expected" }] },
    ])

    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const scope = yield* Scope.make()
        const reader = yield* Scope.provide(socket.reader, scope)
        const waiting = yield* reader.pull.pipe(Effect.exit, Effect.forkChild)
        yield* Scope.close(scope, Exit.void)
        expect(failureText(yield* Fiber.join(waiting))).toContain("SocketError: 1000")
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/waiting", { directory: directory.path, mode: "replay" }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      ),
    )
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
        const run = Effect.scoped(
          Effect.gen(function* () {
            const reader = yield* socket.reader
            const writer = yield* socket.writer
            yield* writer.writeAll([new Uint8Array([1, 2])])
            for (const message of yield* reader.pull) {
              if (typeof message === "string") throw new Error("Expected a binary WebSocket frame")
              received.push([...message])
            }
          }),
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
