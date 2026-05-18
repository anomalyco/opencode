import { describe, expect } from "bun:test"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Plugin } from "../../src/plugin"
import { Pty } from "../../src/pty"
import { Duration, Effect, Layer, Queue } from "effect"
import { testEffect } from "../lib/effect"

type Socket = Parameters<Pty.Interface["connect"]>[1]

const it = testEffect(
  Pty.layer.pipe(
    Layer.provideMerge(Bus.layer),
    Layer.provideMerge(Config.defaultLayer),
    Layer.provideMerge(Plugin.defaultLayer),
  ),
)
const ptyTest = process.platform === "win32" ? it.instance.skip : it.instance

const createPty = Effect.fn("PtyOutputIsolationTest.createPty")(function* (input: Pty.CreateInput) {
  const pty = yield* Pty.Service
  return yield* Effect.acquireRelease(pty.create(input), (info) => pty.remove(info.id).pipe(Effect.ignore))
})

const decodeOutput = (data: string | Uint8Array | ArrayBuffer) =>
  typeof data === "string"
    ? data
    : Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data)).toString("utf8")

const makeSocket = Effect.fn("PtyOutputIsolationTest.makeSocket")(function* (data: unknown) {
  const output = yield* Queue.unbounded<string>()
  const chunks: string[] = []
  const socket: Socket = {
    readyState: 1,
    data,
    send: (data) => {
      const text = decodeOutput(data)
      chunks.push(text)
      Queue.offerUnsafe(output, text)
    },
    close: () => {
      // no-op (simulate abrupt drop)
    },
  }

  return { socket, output, chunks }
})

const waitForOutput = (output: Queue.Queue<string>, text: string, duration: Duration.Input = "5 seconds") =>
  Effect.gen(function* () {
    let received = ""
    while (!received.includes(text)) {
      received += yield* Queue.take(output)
    }
    return received
  }).pipe(
    Effect.timeoutOrElse({
      duration,
      orElse: () => Effect.fail(new Error(`timeout waiting for output containing ${JSON.stringify(text)}`)),
    }),
  )

const waitForLeakedOutput = (output: Queue.Queue<string>, text: string) =>
  Effect.gen(function* () {
    let received = ""
    while (!received.includes(text)) {
      received += yield* Queue.take(output)
    }
    return received
  }).pipe(
    Effect.timeoutOrElse({
      duration: "100 millis",
      orElse: () => Effect.succeed(undefined),
    }),
  )

describe("pty", () => {
  ptyTest(
    "does not leak output when websocket objects are reused",
    () =>
      Effect.gen(function* () {
        const pty = yield* Pty.Service
        const a = yield* createPty({ command: "cat", title: "a" })
        const b = yield* createPty({ command: "cat", title: "b" })
        const connectionA = yield* makeSocket({ events: { connection: "a" } })
        const connectionB = { events: { connection: "b" } }

        yield* pty.connect(a.id, connectionA.socket)

        const outBQueue = yield* Queue.unbounded<string>()
        const outB: string[] = []
        connectionA.socket.data = connectionB
        connectionA.socket.send = (data) => {
          const text = decodeOutput(data)
          outB.push(text)
          Queue.offerUnsafe(outBQueue, text)
        }
        yield* pty.connect(b.id, connectionA.socket)

        connectionA.chunks.length = 0
        outB.length = 0

        yield* pty.write(a.id, "AAA\n")
        const verifyA = yield* makeSocket({ events: { connection: "verify-a" } })
        yield* pty.connect(a.id, verifyA.socket)
        yield* waitForOutput(verifyA.output, "AAA")

        expect(outB.join("")).not.toContain("AAA")
        expect(yield* waitForLeakedOutput(outBQueue, "AAA")).toBeUndefined()
      }),
    { git: true },
  )

  ptyTest(
    "does not leak output when Bun recycles websocket objects before re-connect",
    () =>
      Effect.gen(function* () {
        const pty = yield* Pty.Service
        const a = yield* createPty({ command: "cat", title: "a" })
        const outA = yield* makeSocket({ events: { connection: "a" } })
        const outB = yield* Queue.unbounded<string>()

        yield* pty.connect(a.id, outA.socket)
        outA.chunks.length = 0

        const connectionB = { events: { connection: "b" } }
        outA.socket.data = connectionB
        outA.socket.send = (data) => {
          Queue.offerUnsafe(outB, decodeOutput(data))
        }

        yield* pty.write(a.id, "AAA\n")
        const verifyA = yield* makeSocket({ events: { connection: "verify-a" } })
        yield* pty.connect(a.id, verifyA.socket)
        yield* waitForOutput(verifyA.output, "AAA")

        expect(yield* waitForLeakedOutput(outB, "AAA")).toBeUndefined()
      }),
    { git: true },
  )

  ptyTest(
    "treats in-place socket data mutation as the same connection",
    () =>
      Effect.gen(function* () {
        const pty = yield* Pty.Service
        const a = yield* createPty({ command: "cat", title: "a" })
        const ctx = { connId: 1 }
        const out = yield* makeSocket(ctx)

        yield* pty.connect(a.id, out.socket)
        out.chunks.length = 0

        ctx.connId = 2

        yield* pty.write(a.id, "AAA\n")

        expect(yield* waitForOutput(out.output, "AAA")).toContain("AAA")
      }),
    { git: true },
  )
})
