import { describe, expect } from "bun:test"
import { randomBytes } from "node:crypto"
import { posix, win32 } from "node:path"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Queue, Result, Schema, Scope, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { Environment, EnvironmentDriver, makeMemoryDriver } from "@opencode/core/environment/index"
import { KV } from "@opencode/core/kv"
import { Frames } from "@opencode/core/machine/frames"
import { Identity } from "@opencode/core/machine/identity"
import { Link } from "@opencode/core/machine/link"
import { FromWorker, type Hello, Instance, ToWorker } from "@opencode/core/machine/wire"
import { WorkerClient } from "@opencode/core/machine/worker-client"
import { Workspace } from "@opencode/core/workspace"
import { makeWorker } from "./fixture/machine-worker"
import { it } from "./lib/effect"

const encodeFromWorker = Schema.encodeEffect(Schema.fromJsonString(FromWorker))
const decodeToWorker = Schema.decodeUnknownEffect(Schema.fromJsonString(ToWorker))
const text = (value: string) => new TextEncoder().encode(value)
const utf8 = new TextDecoder("utf-8", { fatal: true })
const newKey = () => Identity.fromSeed(new Uint8Array(randomBytes(32)))

const identityLayer = (key: Identity.Key) =>
  Layer.succeed(
    Identity.Service,
    Identity.Service.of({
      publicKey: () => Effect.succeed(key.publicKey),
      sign: (bytes) => Effect.succeed(key.sign(bytes)),
      seed: () => Effect.die("unused"),
    }),
  )

const kvStoreLayer = (store: Map<string, KV.Value>) =>
  Identity.kvLayer.pipe(
    Layer.provide(
      Layer.succeed(
        KV.Service,
        KV.Service.of({
          get: (key) => Effect.sync(() => store.get(key)),
          set: (key, value) => Effect.sync(() => void store.set(key, value)),
          remove: (key) => Effect.sync(() => void store.delete(key)),
          scan: () => Effect.succeed({ entries: [] }),
        }),
      ),
    ),
  )

const makeCarrierPair = Effect.gen(function* () {
  const toHome = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const toWorker = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const hangUp = Effect.all([Queue.end(toHome), Queue.end(toWorker)]).pipe(Effect.asVoid)
  return {
    home: {
      send: (frame: Uint8Array) => Queue.offer(toWorker, new Uint8Array(frame)).pipe(Effect.asVoid),
      receive: Queue.take(toHome).pipe(Effect.mapError(() => new Link.Closed())),
    } satisfies Link.Carrier,
    worker: {
      send: (frame: Uint8Array) => Queue.offer(toHome, new Uint8Array(frame)).pipe(Effect.asVoid),
      receive: Queue.take(toWorker).pipe(Effect.mapError(() => new Link.Closed())),
    } satisfies Link.Carrier,
    hangUp,
  }
})

describe("WorkerClient.fromConnection", () => {
  it.effect("gives a Windows worker Windows path rules and its shell, and any other worker a POSIX sh", () =>
    Effect.gen(function* () {
      const serve = (system: Pick<Hello, "os" | "home" | "shell">) =>
        WorkerClient.fromConnection(Environment.ID.make("box"), {
          hello: {
            type: "hello",
            protocol: 3,
            arch: "x64",
            instance: Instance.make(crypto.randomUUID()),
            processes: [],
            ...system,
          },
          send: () => {},
          messages: Stream.never,
        })

      const windows = yield* serve({ os: "win32", home: "C:\\Users\\worker", shell: "pwsh" })
      expect(windows.options.path).toBe(win32)
      expect(windows.options.shell).toBe("pwsh")
      expect(yield* windows.options.home!).toBe("C:\\Users\\worker")

      const linux = yield* serve({ os: "linux", home: "/home/worker" })
      expect(linux.options.path).toBe(posix)
      expect(linux.options.shell).toBe("sh")
    }),
  )
})

describe("EnvironmentDriver.lazy", () => {
  it.effect("acquires and releases per operation and blocks remote drivers from claiming local", () =>
    Effect.gen(function* () {
      const events: string[] = []
      const memory = makeMemoryDriver()
      const driver = EnvironmentDriver.lazy(
        Effect.acquireRelease(
          Effect.sync(() => {
            events.push("acquire")
            return memory
          }),
          () => Effect.sync(() => void events.push("release")),
        ),
        {
          module: "TestDriver",
          spawnDescription: "failed to connect",
          options: {
            home: Effect.succeed("/home/sandbox"),
            shell: "sh",
            local: true,
          } as unknown as Environment.Driver["options"],
        },
      )
      const env = Environment.workspace(Workspace.ID.make("wrk_lazy"), driver)
      expect(env.local).toBe(false)
      expect(env.shell).toBe("sh")
      expect(yield* env.home!).toBe("/home/sandbox")
      expect(events).toEqual([])

      yield* env.files.write("/hello.txt", text("world"))
      expect(utf8.decode((yield* env.files.read("/hello.txt")).bytes)).toBe("world")
      expect(events).toEqual(["acquire", "release", "acquire", "release"])
    }),
  )

  it.effect("maps acquire failures to Environment.Failed and PlatformError", () =>
    Effect.gen(function* () {
      const failing = EnvironmentDriver.lazy(Effect.fail(new Error("offline")), {
        module: "TestDriver",
        spawnDescription: "failed to connect",
      })
      const fileErr = yield* Environment.makeFiles(failing).stat("/x").pipe(Effect.flip)
      expect(fileErr._tag).toBe("Environment.Failed")
      const spawnErr = yield* failing.spawner.spawn(ChildProcess.make("echo", ["hi"])).pipe(Effect.flip)
      expect(spawnErr._tag).toBe("PlatformError")
      expect(spawnErr.message).toContain("failed to connect")
    }),
  )
})

describe("Identity.kvLayer", () => {
  it.effect("generates one key under concurrent reads, persists across rebuilds, and signs", () =>
    Effect.gen(function* () {
      const store = new Map<string, KV.Value>()
      const first = yield* Effect.gen(function* () {
        const identity = yield* Identity.Service
        return yield* Effect.all([identity.publicKey(), identity.publicKey(), identity.seed()], {
          concurrency: "unbounded",
        })
      }).pipe(Effect.provide(kvStoreLayer(store)))
      expect(first[0]).toEqual(first[1])
      expect(first[2]).toHaveLength(32)
      expect(store.size).toBe(1)

      const restored = yield* Effect.gen(function* () {
        const identity = yield* Identity.Service
        return { pub: yield* identity.publicKey(), sig: yield* identity.sign(text("hello")) }
      }).pipe(Effect.provide(kvStoreLayer(store)))
      expect(restored.pub).toEqual(first[0])
      expect(Identity.verify(restored.pub, text("hello"), restored.sig)).toBe(true)
    }),
  )

  it.effect("rejects malformed KV values with Identity.InvalidKey", () =>
    Effect.gen(function* () {
      const store = new Map<string, KV.Value>()
      const valid = Buffer.from(randomBytes(32)).toString("base64url")
      for (const corrupted of [123, "not-32-bytes", `${valid}!!`, `${valid}=`]) {
        store.set("machine.home-key", corrupted)
        const err = yield* Effect.flatMap(Identity.Service, (id) => id.publicKey()).pipe(
          Effect.provide(kvStoreLayer(store)),
          Effect.flip,
        )
        expect(err._tag).toBe("Identity.InvalidKey")
      }
    }),
  )
})

describe("WorkerClient.dial", () => {
  const id = Environment.ID.make("exedev-box")

  const dialHandshake = (peerKey: Uint8Array, dialOptions: Link.DialOptions, homeKey: Identity.Key) =>
    Effect.gen(function* () {
      const pair = yield* makeCarrierPair
      const [homeResult] = yield* Effect.all(
        [
          WorkerClient.dial(id, pair.home, { peerKey }).pipe(
            Effect.provide(identityLayer(homeKey)),
            Effect.onError(() => pair.hangUp),
            Effect.result,
          ),
          Link.dial(pair.worker, dialOptions).pipe(
            Effect.onError(() => pair.hangUp),
            Effect.result,
          ),
        ],
        { concurrency: 2 },
      )
      return homeResult
    })

  it.effect("authenticates a pinned worker key, runs files and commands, and closes with its scope", () =>
    Effect.gen(function* () {
      const homeKey = newKey()
      const workerKey = newKey()
      const pair = yield* makeCarrierPair
      yield* Effect.addFinalizer(() => pair.hangUp)

      const worker = yield* makeWorker({
        connect: (connection) =>
          Effect.scoped(
            Effect.gen(function* () {
              const linked = yield* Link.connect(pair.worker, { home: homeKey.publicKey, identity: workerKey })
              linked.send(connection.hello)
              yield* Effect.raceFirst(
                Stream.runForEach(linked.messages, (message) => Effect.sync(() => connection.send(message))),
                Stream.runForEach(connection.messages, (message) => Effect.sync(() => linked.send(message))),
              )
            }),
          ),
      })
      yield* worker.restore

      const driverScope = yield* Scope.fork(yield* Effect.scope)
      const driver = yield* WorkerClient.dial(id, pair.home, { peerKey: workerKey.publicKey }).pipe(
        Effect.provide(identityLayer(homeKey)),
        Scope.provide(driverScope),
      )
      const env = Environment.make(id, driver)
      expect(yield* env.home!).toBe("/home/worker")
      expect(env.shell).toBe("sh")
      expect(env.local).toBe(false)

      yield* env.files.write("/project/app.ts", text("export const x = 1"))
      expect(utf8.decode((yield* env.files.read("/project/app.ts")).bytes)).toBe("export const x = 1")

      const proc = yield* env.spawner.spawn(ChildProcess.make("/bin/echo", ["from pull"], { cwd: "/project" }))
      const run = worker.runs[0]
      expect([run.argv, run.cwd]).toEqual([["/bin/echo", "from pull"], "/project"])
      yield* run.print("from pull\n")
      yield* run.exit(0)
      expect(yield* Stream.mkString(Stream.decodeText(proc.all))).toBe("from pull\n")
      expect(yield* proc.exitCode).toBe(ChildProcessSpawner.ExitCode(0))

      yield* Scope.close(driverScope, Exit.void)
      expect((yield* env.files.stat("/project/app.ts").pipe(Effect.flip))._tag).toBe("Environment.Failed")
    }),
  )

  it.effect("refuses a malformed peerKey, wrong peerKey, or secret-bearing handshake", () =>
    Effect.gen(function* () {
      const homeKey = newKey()
      const workerKey = newKey()
      const pair = yield* makeCarrierPair

      const shortKey = yield* WorkerClient.dial(id, pair.home, { peerKey: new Uint8Array(16) }).pipe(
        Effect.provide(identityLayer(homeKey)),
        Effect.flip,
      )
      expect(shortKey).toEqual(new Link.Refused())

      const wrongKey = yield* dialHandshake(
        newKey().publicKey,
        { home: homeKey.publicKey, identity: workerKey },
        homeKey,
      )
      expect(Result.isFailure(wrongKey) && wrongKey.failure).toEqual(new Link.Refused())

      const withSecret = yield* dialHandshake(
        workerKey.publicKey,
        { home: homeKey.publicKey, identity: workerKey, secret: new Uint8Array(randomBytes(32)) },
        homeKey,
      )
      expect(Result.isFailure(withSecret) && withSecret.failure).toEqual(new Link.Refused())
    }),
  )

  it.effect("propagates caller interruption without turning it into Refused", () =>
    Effect.gen(function* () {
      const homeKey = newKey()
      const silent: Link.Carrier = { send: () => Effect.void, receive: Effect.never }
      const waiting = yield* Effect.forkChild(
        Link.serveDirect(silent, { machine: id, peerKey: newKey().publicKey }).pipe(
          Effect.provide(identityLayer(homeKey)),
        ),
        { startImmediately: true },
      )
      const exit = yield* Fiber.interrupt(waiting).pipe(Effect.andThen(Fiber.await(waiting)))
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    }),
  )
})

describe("WorkerClient.stdio", () => {
  const id = Environment.ID.make("ssh-box")

  it.effect("frames and incrementally decodes split headers and multi-frame chunks within bounds", () =>
    Effect.sync(() => {
      // Type-level guard: ChildProcessHandle must satisfy StdioPipe directly.
      const _check = (handle: ChildProcessSpawner.ChildProcessHandle): WorkerClient.StdioPipe => handle
      void _check

      const f1 = Result.getOrThrow(WorkerClient.encodeStdioFrame(text("alpha")))
      const f2 = Result.getOrThrow(WorkerClient.encodeStdioFrame(text("beta")))
      const combined = new Uint8Array(f1.byteLength + f2.byteLength)
      combined.set(f1, 0)
      combined.set(f2, f1.byteLength)

      const batch = WorkerClient.createStdioFrameDecoder()
      expect(Result.getOrThrow(batch.push(combined)).map((bytes) => utf8.decode(bytes))).toEqual(["alpha", "beta"])
      expect(batch.hasPartial()).toBe(false)

      const bytewise = WorkerClient.createStdioFrameDecoder()
      const collected = Array.from({ length: combined.byteLength }, (_, i) =>
        Result.getOrThrow(bytewise.push(combined.subarray(i, i + 1))).map((bytes) => utf8.decode(bytes)),
      ).flat()
      expect(collected).toEqual(["alpha", "beta"])
      expect(bytewise.hasPartial()).toBe(false)

      expect(Result.isFailure(WorkerClient.encodeStdioFrame(new Uint8Array(0)))).toBe(true)
      const tooBig = new Uint8Array(4)
      new DataView(tooBig.buffer).setUint32(0, Frames.MAX_MESSAGE + 1, false)
      expect(Result.isFailure(WorkerClient.createStdioFrameDecoder().push(tooBig))).toBe(true)
    }),
  )

  it.effect("runs files and commands over split length-prefixed stdio chunks", () =>
    Effect.gen(function* () {
      const toClient = yield* Queue.unbounded<Uint8Array, Cause.Done>()
      const fromClient = yield* Queue.unbounded<Uint8Array, Cause.Done>()
      const ready = yield* Deferred.make<void>()

      const worker = yield* makeWorker({
        connect: (connection) =>
          Effect.gen(function* () {
            const sendFramed = (message: FromWorker) =>
              Effect.flatMap(encodeFromWorker(message), (json) =>
                Effect.sync(() => {
                  const frame = Result.getOrThrow(WorkerClient.encodeStdioFrame(text(json)))
                  Queue.offerUnsafe(toClient, frame.subarray(0, 2))
                  Queue.offerUnsafe(toClient, frame.subarray(2))
                }),
              )

            yield* sendFramed(connection.hello)
            yield* Deferred.succeed(ready, undefined)

            const peerDecoder = WorkerClient.createStdioFrameDecoder()
            yield* Effect.raceFirst(
              Stream.runForEach(connection.messages, sendFramed),
              Stream.runForEach(Stream.fromQueue(fromClient), (chunk) =>
                Effect.gen(function* () {
                  for (const payload of yield* Effect.fromResult(peerDecoder.push(chunk))) {
                    connection.send(yield* decodeToWorker(utf8.decode(payload)))
                  }
                }),
              ),
            )
          }),
      })
      yield* worker.restore
      yield* Deferred.await(ready)

      const driver = yield* WorkerClient.stdio(id, {
        stdin: Sink.forEach((chunk) => Effect.sync(() => void Queue.offerUnsafe(fromClient, chunk))),
        stdout: Stream.fromQueue(toClient),
      })
      const env = Environment.make(id, driver)
      expect(yield* env.home!).toBe("/home/worker")

      yield* env.files.write("/pipe.txt", text("over stdio"))
      expect(utf8.decode((yield* env.files.read("/pipe.txt")).bytes)).toBe("over stdio")

      const proc = yield* env.spawner.spawn(ChildProcess.make("/bin/echo", ["pipe"], { cwd: "/" }))
      const run = worker.runs[0]
      yield* run.print("pipe\n")
      yield* run.exit(0)
      expect(yield* Stream.mkString(Stream.decodeText(proc.all))).toBe("pipe\n")
      expect(yield* proc.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  it.effect("refuses zero-length, truncated-at-EOF, or timed-out hello frames", () =>
    Effect.gen(function* () {
      for (const bad of [new Uint8Array([0, 0, 0, 0]), new Uint8Array([0, 0])]) {
        const err = yield* WorkerClient.stdio(id, { stdin: Sink.drain, stdout: Stream.succeed(bad) }).pipe(Effect.flip)
        expect(err).toEqual(new Link.Refused())
      }

      const stalling = yield* Effect.forkChild(
        WorkerClient.stdio(id, { stdin: Sink.drain, stdout: Stream.never }).pipe(Effect.flip),
        { startImmediately: true },
      )
      yield* TestClock.adjust("10 seconds")
      expect(yield* Fiber.join(stalling)).toEqual(new Link.Refused())
    }),
  )
})

const makeMockWebSocketPair = (initialReadyState = 1) => {
  type Listener = (event: { readonly data: unknown }) => void
  const makeSide = () => {
    let lastCloseCode: number | undefined
    let onSend: (buffer: ArrayBuffer) => void = () => {}
    let onClose: (code?: number) => void = () => {}
    const listeners: Record<"open" | "message" | "error" | "close", Set<Listener>> = {
      open: new Set(),
      message: new Set(),
      error: new Set(),
      close: new Set(),
    }
    const side = {
      readyState: initialReadyState,
      binaryType: "blob",
      get lastCloseCode() {
        return lastCloseCode
      },
      link(peer: { readyState: number; deliverRaw(data: unknown): void; close(code?: number): void }) {
        onSend = (buffer) => {
          if (peer.readyState === 1) peer.deliverRaw(buffer)
        }
        onClose = (code) => {
          if (peer.readyState < 2) peer.close(code)
        }
      },
      open() {
        if (side.readyState !== 0) return
        side.readyState = 1
        Array.from(listeners.open, (fn) => fn({ data: undefined }))
      },
      deliverRaw(data: unknown) {
        Array.from(listeners.message, (fn) => fn({ data }))
      },
      send(data: Uint8Array<ArrayBuffer>) {
        if (side.readyState === 1) onSend(data.slice().buffer)
      },
      close(code?: number) {
        // Mirror the WHATWG WebSocket API (Node 22+ throws InvalidAccessError for codes outside 1000 and 3000–4999).
        if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
          throw new RangeError(`Invalid WebSocket close code: ${code}`)
        }
        lastCloseCode = code
        if (side.readyState >= 2) return
        side.readyState = 3
        Array.from(listeners.close, (fn) => fn({ data: undefined }))
        onClose(code)
      },
      addEventListener(type: "open" | "close" | "error" | "message", fn: Listener) {
        listeners[type].add(fn)
      },
      removeEventListener(type: "open" | "close" | "error" | "message", fn: Listener) {
        listeners[type].delete(fn)
      },
      listenerCount() {
        return Object.values(listeners).reduce((sum, set) => sum + set.size, 0)
      },
    }
    return side
  }
  const a = makeSide()
  const b = makeSide()
  a.link(b)
  b.link(a)
  return { a, b }
}

describe("WorkerClient.fromWebSocket", () => {
  const id = Workspace.ID.make("wrk_01TestUpperCase_Ws")

  it.effect("completes a full Noise XX WorkerClient.dial over an already-open WebSocket and closes on scope exit", () =>
    Effect.gen(function* () {
      // Standard global WebSocket structurally satisfies WebSocketLike without casts.
      const _check = (ws: WebSocket): WorkerClient.WebSocketLike => ws
      void _check

      const homeKey = newKey()
      const workerKey = newKey()
      const pair = makeMockWebSocketPair(1)
      const driverScope = yield* Scope.fork(yield* Effect.scope)

      const homeCarrier = yield* WorkerClient.fromWebSocket(pair.a).pipe(Scope.provide(driverScope))
      const workerCarrier = yield* WorkerClient.fromWebSocket(pair.b)
      expect(pair.a.binaryType).toBe("arraybuffer")

      const worker = yield* makeWorker({
        connect: (connection) =>
          Effect.scoped(
            Effect.gen(function* () {
              const linked = yield* Link.connect(workerCarrier, { home: homeKey.publicKey, identity: workerKey })
              expect(linked.machine).toBe("wrk-01testuppercase-ws")
              linked.send(connection.hello)
              yield* Effect.raceFirst(
                Stream.runForEach(linked.messages, (message) => Effect.sync(() => connection.send(message))),
                Stream.runForEach(connection.messages, (message) => Effect.sync(() => linked.send(message))),
              )
            }),
          ),
      })
      yield* worker.restore

      const driver = yield* WorkerClient.dial(id, homeCarrier, { peerKey: workerKey.publicKey }).pipe(
        Effect.provide(identityLayer(homeKey)),
        Scope.provide(driverScope),
      )
      const env = Environment.workspace(id, driver)
      yield* env.files.write("/ws.txt", text("over websocket"))
      expect(utf8.decode((yield* env.files.read("/ws.txt")).bytes)).toBe("over websocket")

      yield* Scope.close(driverScope, Exit.void)
      expect(pair.a.readyState).toBe(3)
      expect(pair.a.listenerCount()).toBe(0)
    }),
  )

  it.effect("waits for CONNECTING sockets, fails on pre-closed sockets, and rejects text or oversized frames", () =>
    Effect.gen(function* () {
      const closed = makeMockWebSocketPair(3)
      expect(yield* WorkerClient.fromWebSocket(closed.a).pipe(Effect.flip)).toEqual(new Link.Closed())
      expect(closed.a.listenerCount()).toBe(0)

      const connecting = makeMockWebSocketPair(0)
      const fiber = yield* Effect.forkChild(WorkerClient.fromWebSocket(connecting.a), { startImmediately: true })
      connecting.a.open()
      const carrier = yield* Fiber.join(fiber)

      connecting.a.deliverRaw("not-binary")
      expect(yield* carrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())
      expect(connecting.a.lastCloseCode).toBe(4008)
      expect(connecting.a.listenerCount()).toBe(0)

      // Oversized frames (>65535B) close with WHATWG-valid policy code 4008 and immediately detach listeners.
      const over = makeMockWebSocketPair(1)
      const overCarrier = yield* WorkerClient.fromWebSocket(over.a)
      over.a.deliverRaw(new Uint8Array(65_536))
      expect(yield* overCarrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())
      expect(over.a.lastCloseCode).toBe(4008)
      expect(over.a.listenerCount()).toBe(0)

      // Closing while still CONNECTING fails with Link.Closed and immediately detaches listeners.
      const dying = makeMockWebSocketPair(0)
      const dyingFiber = yield* Effect.forkChild(WorkerClient.fromWebSocket(dying.a), { startImmediately: true })
      dying.a.close(1000)
      expect(yield* Fiber.join(dyingFiber).pipe(Effect.flip)).toEqual(new Link.Closed())
      expect(dying.a.listenerCount()).toBe(0)

      // Interrupting while CONNECTING immediately closes the socket and detaches listeners even if the outer scope stays open.
      const stalled = makeMockWebSocketPair(0)
      const stalledFiber = yield* Effect.forkChild(WorkerClient.fromWebSocket(stalled.a), { startImmediately: true })
      yield* Fiber.interrupt(stalledFiber)
      expect(stalled.a.readyState).toBe(3)
      expect(stalled.a.lastCloseCode).toBe(1000)
      expect(stalled.a.listenerCount()).toBe(0)
    }),
  )
})
