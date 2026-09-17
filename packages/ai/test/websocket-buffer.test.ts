import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { Headers } from "effect/unstable/http"
import { WebSocketTransport } from "../src/route.js"
import { it } from "./lib/effect.js"

class TestSocket extends EventTarget {
  readyState: number = WebSocket.OPEN
  closes: number[] = []
  listeners = new Set<string>()
  send() {}
  close(code: number) {
    this.closes.push(code)
    this.readyState = WebSocket.CLOSING
  }
  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {
    this.listeners.add(args[0])
    super.addEventListener(...args)
  }
  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) {
    this.listeners.delete(args[0])
    super.removeEventListener(...args)
  }
  receive(data: string | Uint8Array) {
    this.dispatchEvent(new MessageEvent("message", { data }))
  }
}

const open = (socket: TestSocket) =>
  Effect.acquireRelease(
    WebSocketTransport.fromWebSocket(
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- deterministic native-event adapter fixture.
      socket as unknown as WebSocket,
      { url: "wss://provider.test/responses", headers: Headers.empty },
    ),
    (connection) => connection.close,
  )

describe("WebSocket inbound buffering", () => {
  it.live("preserves a burst while the consumer is paused", () =>
    Effect.gen(function* () {
      const frames = Array.from({ length: 1_024 }, (_, index) => `frame:${index}`)
      const arrived = Deferred.makeUnsafe<void>()
      const paused = Deferred.makeUnsafe<void>()
      const resume = Deferred.makeUnsafe<void>()
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch(request, server) {
              if (server.upgrade(request)) return
              return new Response("WebSocket required", { status: 400 })
            },
            websocket: {
              message(socket, message) {
                if (message === "start") return void socket.send("start")
                frames.forEach((frame) => socket.send(frame))
              },
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}`)
      const connection = yield* Effect.acquireRelease(
        WebSocketTransport.fromWebSocket(socket, { url: socket.url, headers: Headers.empty }),
        (connection) => connection.close,
      )
      socket.addEventListener("message", (event) => {
        if (event.data === frames.at(-1)) Effect.runSync(Deferred.succeed(arrived, undefined))
      })
      const consumer = yield* connection.messages.pipe(
        Stream.mapEffect((frame) =>
          frame === "start"
            ? Deferred.succeed(paused, undefined).pipe(Effect.andThen(Deferred.await(resume)), Effect.as(frame))
            : Effect.succeed(frame),
        ),
        Stream.take(frames.length + 1),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* connection.sendText("start")
      yield* Deferred.await(paused)
      yield* connection.sendText("burst")
      yield* Deferred.await(arrived)
      yield* Deferred.succeed(resume, undefined)
      expect(Array.from(yield* Fiber.join(consumer))).toEqual(["start", ...frames])
      yield* connection.sendText("burst")
      expect(Array.from(yield* connection.messages.pipe(Stream.take(frames.length), Stream.runCollect))).toEqual(frames)
    }),
  )

  it.effect("bounds retained text bytes before the frame count limit and preserves the accepted prefix", () =>
    Effect.gen(function* () {
      const socket = new TestSocket()
      const connection = yield* open(socket)
      const frame = "x".repeat(1024 * 1024)
      Array.from({ length: 32 }, () => socket.receive(frame))
      socket.receive("late")
      let received = 0
      const error = yield* connection.messages.pipe(
        Stream.tap(() => Effect.sync(() => received++)),
        Stream.runDrain,
        Effect.flip,
      )
      expect(received).toBe(31)
      expect(error.reason).toMatchObject({ _tag: "Transport", code: "queue-overflow", body: frame })
      expect(socket.closes).toEqual([1009])
    }),
  )

  it.effect("bounds empty-frame overhead and ignores further frames after overflow", () =>
    Effect.gen(function* () {
      const socket = new TestSocket()
      const connection = yield* open(socket)
      Array.from({ length: 4_097 }, () => socket.receive(""))
      socket.receive("late")
      let received = 0
      const error = yield* connection.messages.pipe(
        Stream.tap(() => Effect.sync(() => received++)),
        Stream.runDrain,
        Effect.flip,
      )
      expect(received).toBe(4_096)
      expect(error.reason).toMatchObject({ _tag: "Transport", code: "queue-overflow", body: "" })
      expect(socket.closes).toEqual([1009])
      yield* connection.close
      expect(socket.listeners.size).toBe(0)
      expect(socket.closes).toEqual([1009])
    }),
  )

  it.effect("reclaims byte capacity as frames are consumed", () =>
    Effect.gen(function* () {
      const socket = new TestSocket()
      const connection = yield* open(socket)
      const frame = "x".repeat(1024 * 1024)
      for (const _ of [0, 1]) {
        Array.from({ length: 31 }, () => socket.receive(frame))
        const received = yield* connection.messages.pipe(Stream.take(31), Stream.runCollect)
        expect(received).toHaveLength(31)
        expect(received.every((message) => message === frame)).toBe(true)
      }
      expect(socket.closes).toEqual([])
    }),
  )

  it.effect("preserves mixed text and binary frame boundaries, including a maximum-sized frame", () =>
    Effect.gen(function* () {
      const socket = new TestSocket()
      const connection = yield* open(socket)
      const frames = ["first", new Uint8Array([1, 2, 3]), "x".repeat(16 * 1024 * 1024), new Uint8Array([4])]
      frames.forEach((frame) => socket.receive(frame))
      expect(Array.from(yield* connection.messages.pipe(Stream.take(frames.length), Stream.runCollect))).toEqual(frames)
      expect(socket.closes).toEqual([])
    }),
  )

  it.effect("charges a binary view for the backing buffer it retains", () =>
    Effect.gen(function* () {
      const socket = new TestSocket()
      const connection = yield* open(socket)
      socket.receive(new Uint8Array(new ArrayBuffer(64 * 1024 * 1024), 0, 1))
      const error = yield* connection.messages.pipe(Stream.runDrain, Effect.flip)
      expect(error.reason).toMatchObject({ _tag: "Transport", code: "queue-overflow" })
      expect(socket.closes).toEqual([1009])
    }),
  )

  it.effect("retains the UTF-8 frame-size guard for text and the binary size guard", () =>
    Effect.gen(function* () {
      for (const frame of [
        "\u0800".repeat(Math.floor((16 * 1024 * 1024) / 3) + 1),
        new Uint8Array(16 * 1024 * 1024 + 1),
      ]) {
        const socket = new TestSocket()
        const connection = yield* open(socket)
        socket.receive(frame)
        const error = yield* connection.messages.pipe(Stream.runDrain, Effect.flip)
        expect(error.reason).toMatchObject({ _tag: "Transport", code: "message-too-large" })
        expect(socket.closes).toEqual([1009])
      }
    }),
  )

  it.effect("cleans up a cancelled consumer with a buffered burst", () =>
    Effect.gen(function* () {
      const socket = new TestSocket()
      const paused = Deferred.makeUnsafe<void>()
      const resume = Deferred.makeUnsafe<void>()
      const consumer = yield* Effect.gen(function* () {
        const connection = yield* open(socket)
        yield* connection.messages.pipe(
          Stream.runForEach(() => Deferred.succeed(paused, undefined).pipe(Effect.andThen(Deferred.await(resume)))),
        )
      }).pipe(Effect.scoped, Effect.forkChild({ startImmediately: true }))
      socket.receive("first")
      yield* Deferred.await(paused)
      Array.from({ length: 1_024 }, (_, index) => socket.receive(`frame:${index}`))
      yield* Fiber.interrupt(consumer)
      expect(socket.listeners.size).toBe(0)
      expect(socket.closes).toEqual([1000])
      socket.receive("late")
      expect(socket.closes).toEqual([1000])
    }),
  )
})
