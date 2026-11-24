import { describe, expect } from "bun:test"
import { Environment } from "@opencode/core/environment/index"
import { Identity } from "@opencode/core/machine/identity"
import { Join } from "@opencode/core/machine/join"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { MACHINE_LINK_PATH } from "@opencode/protocol/groups/machine"
import { Cause, Context, Effect, Exit, Fiber, Option, Queue, Scope, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { randomBytes } from "node:crypto"
import { Global } from "@opencode/util/global"
import { makeDurableObjectStorage } from "../../core/test/fixture/durable-object-storage"
import { makeWorker } from "../../core/test/fixture/machine-worker"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { CLOSE, MAX_FRAME, MAX_HANDSHAKES } from "../src/handlers/machine"
import {
  createWorkerdCarrier,
  makeWorkerdMachineLink,
  WORKERD_MAX_BUFFERED,
  WORKERD_MAX_HANDSHAKE_WAITING,
  WORKERD_MAX_WAITING,
  type WorkerdWebSocket,
  WorkerdWebSocketPair,
  type WorkerdWebSocketPairFactory,
} from "../src/handlers/machine-workerd"
import { ServerWorkerd } from "../src/workerd"

const CLOSED = { code: CLOSE, reason: "" }
const TOO_BIG = { code: 1009, reason: "" }
const authorization = "Basic " + btoa("opencode:secret")
const upgradeHeaders = { Connection: "Upgrade", Upgrade: "websocket" }
const linkURL = "https://do.example" + MACHINE_LINK_PATH

interface MemorySocket extends WorkerdWebSocket {
  bufferedAmount: number
  readonly closed: Promise<{ readonly code?: number; readonly reason?: string }>
  readonly sent: Array<Uint8Array | string>
  deliver(data: unknown): void
  triggerError(): void
}

function makeMemorySocketPair(): readonly [client: MemorySocket, server: MemorySocket] {
  const pair: [MemorySocket | undefined, MemorySocket | undefined] = [undefined, undefined]

  const createEnd = (peerIndex: 0 | 1): MemorySocket => {
    const messageListeners = new Set<(event: { readonly data: unknown }) => void>()
    const closeListeners = new Set<() => void>()
    const errorListeners = new Set<() => void>()
    const closed = Promise.withResolvers<{ readonly code?: number; readonly reason?: string }>()
    const pending: Array<unknown> = []
    let accepted = false
    let readyState = 1

    const dispatchMessage = (data: unknown) => {
      if (readyState !== 1) return
      if (!accepted) {
        pending.push(data)
        return
      }
      for (const listener of [...messageListeners]) listener({ data })
    }

    const markClosed = (code?: number, reason?: string) => {
      if (readyState === 3) return
      readyState = 3
      closed.resolve({ code, reason: reason ?? "" })
      for (const listener of [...closeListeners]) listener()
    }

    const socket: MemorySocket = {
      get readyState() {
        return readyState
      },
      bufferedAmount: 0,
      closed: closed.promise,
      sent: [],
      accept() {
        accepted = true
        while (pending.length > 0 && readyState === 1) {
          const next = pending.shift()
          for (const listener of [...messageListeners]) listener({ data: next })
        }
      },
      send(message) {
        if (readyState !== 1) throw new Error("socket is not open")
        if (typeof message === "string") {
          socket.sent.push(message)
          queueMicrotask(() => pair[peerIndex]?.deliver(message))
          return
        }
        const copy = message instanceof ArrayBuffer ? new Uint8Array(message.slice(0)) : new Uint8Array(message)
        socket.sent.push(copy)
        queueMicrotask(() => pair[peerIndex]?.deliver(copy.buffer))
      },
      close(code, reason) {
        if (readyState >= 2) return
        markClosed(code, reason)
        queueMicrotask(() => {
          const peer = pair[peerIndex]
          if (peer && peer.readyState < 2) peer.close(code, reason)
        })
      },
      deliver: dispatchMessage,
      triggerError() {
        for (const listener of [...errorListeners]) listener()
      },
      addEventListener(type: "message" | "close" | "error", listener: unknown) {
        if (type === "message") messageListeners.add(listener as (event: { readonly data: unknown }) => void)
        if (type === "close") closeListeners.add(listener as () => void)
        if (type === "error") errorListeners.add(listener as () => void)
      },
      removeEventListener(type: "message" | "close" | "error", listener: unknown) {
        if (type === "message") messageListeners.delete(listener as (event: { readonly data: unknown }) => void)
        if (type === "close") closeListeners.delete(listener as () => void)
        if (type === "error") errorListeners.delete(listener as () => void)
      },
    }
    return socket
  }

  pair[0] = createEnd(1)
  pair[1] = createEnd(0)
  return [pair[0], pair[1]]
}

interface UpgradeResponse extends Response {
  readonly webSocket?: MemorySocket
}

const makePairTracker = () => {
  const created: Array<readonly [client: MemorySocket, server: MemorySocket]> = []
  const factory: WorkerdWebSocketPairFactory = {
    create: () => {
      const pair = makeMemorySocketPair()
      created.push(pair)
      return pair
    },
    respond: (webSocket) => Object.assign(new Response(null, { status: 101 }), { webSocket }),
  }
  return { created, factory }
}

const dialWorkerd = Effect.fnUntraced(function* (
  handler: (request: Request) => Promise<Response>,
  url = linkURL,
  headers: Record<string, string> = upgradeHeaders,
) {
  const response = (yield* Effect.promise(() => handler(new Request(url, { headers })))) as UpgradeResponse
  if (response.status !== 101 || !response.webSocket) {
    return {
      status: response.status,
      opened: false as const,
      socket: undefined,
      closed: Effect.succeed({ code: undefined, reason: undefined }),
      receive: Effect.fail(new Link.Closed()),
      send: () => Effect.void,
    }
  }
  const client = response.webSocket
  const inbox = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  client.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer) Queue.offerUnsafe(inbox, new Uint8Array(event.data))
  })
  client.addEventListener("close", () => Queue.endUnsafe(inbox))
  client.accept()
  yield* Effect.addFinalizer(() => Effect.sync(() => client.close()))
  return {
    status: response.status,
    opened: true as const,
    socket: client,
    closed: Effect.promise(() => client.closed),
    receive: Queue.take(inbox).pipe(Effect.mapError(() => new Link.Closed())),
    send: (message: Uint8Array | string) => Effect.sync(() => client.send(message)),
  }
})

const bootWorkerd = Effect.fnUntraced(function* (
  input: { readonly machines?: boolean; readonly password?: string } = {},
) {
  const dir = (yield* tmpdirScoped("opencode-workerd-link-")).path
  const tracker = makePairTracker()
  const options: ServerWorkerd.Options = {
    storage: makeDurableObjectStorage(),
    password: input.password,
    app: { version: "workerd-link-test" },
    models: { fetch: false },
    config: { content: JSON.stringify({ experimental: { machines: input.machines ?? true } }) },
  }
  const { context, handler: baseHandler } = yield* ServerFetch.makeWithContext(ServerWorkerd.serverOptions(options), {
    overrides: [
      ...ServerWorkerd.replacements(options),
      Global.node.replace(
        Global.layerWith({
          data: dir,
          cache: dir,
          config: dir,
          state: dir,
          tmp: dir,
          bin: dir,
          log: dir,
          repos: dir,
        }),
      ),
    ],
  })
  const upgrade = yield* makeWorkerdMachineLink(context).pipe(
    Effect.provideService(WorkerdWebSocketPair, tracker.factory),
  )
  const handler = async (request: Request): Promise<Response> => {
    const pending = upgrade(request)
    if (pending) {
      const upgraded = await pending
      if (upgraded) return upgraded
    }
    return baseHandler(request)
  }
  return {
    handler,
    tracker,
    machines: Context.get(context, Machines.Service),
  }
})

const turn = Effect.promise(() => new Promise((resolve) => setImmediate(resolve)))

const until = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  const deadline = performance.now() + 10_000
  while (!(yield* condition)) {
    if (performance.now() > deadline) return yield* Effect.die(new Error("timed out waiting for condition"))
    yield* turn
  }
})

const online = (machines: Machines.Interface) =>
  Effect.map(machines.list(), (list) => list.filter((machine) => machine.online).map((machine) => machine.id))

const invite = (machines: Machines.Interface, id: Environment.ID) =>
  machines.invite(id, { reach: [] }).pipe(Effect.map((printed) => Option.getOrThrow(Join.decode(printed))))

const connectWorker = Effect.fnUntraced(function* (
  handler: (request: Request) => Promise<Response>,
  machines: Machines.Interface,
  dialing: Link.DialOptions,
) {
  const sockets: Array<MemorySocket> = []
  const fake = yield* makeWorker({
    connect: (connection) =>
      Effect.scoped(
        Effect.gen(function* () {
          const peer = yield* dialWorkerd(handler)
          if (!peer.opened) return
          sockets.push(peer.socket)
          const linked = yield* Link.connect(peer, dialing)
          linked.send(connection.hello)
          yield* Effect.raceFirst(
            Stream.runForEach(linked.messages, (message) => Effect.sync(() => connection.send(message))),
            Stream.runForEach(connection.messages, (message) => Effect.sync(() => linked.send(message))),
          )
        }),
      ),
  })
  const connected = Effect.andThen(fake.restore, until(Effect.map(online(machines), (ids) => ids.length > 0)))
  yield* connected
  return { fake, files: Environment.makeFiles(fake.files), sockets, reconnect: connected }
})

describe("workerd machine WebSocket carrier", () => {
  it.live(
    "pairs, runs commands, transfers multi-frame files, reconnects, and replaces/removes cleanly",
    () =>
      Effect.gen(function* () {
        const server = yield* bootWorkerd({ password: "secret" })
        const id = yield* server.machines.add("gpu")
        const printed = yield* invite(server.machines, id)
        const identity = Identity.fromSeed(randomBytes(32))

        // 1. Pair and run command + multi-frame file transfer (256 KiB spans ~5 encrypted frames each way)
        const gpu = yield* connectWorker(server.handler, server.machines, {
          home: printed.home,
          identity,
          secret: printed.secret,
        })
        const environment = yield* server.machines.get(id)
        const handle = yield* environment.spawner.spawn(
          ChildProcess.make("/bin/echo", ["over workerd"], { cwd: "/work" }),
        )
        const run = gpu.fake.runs[0]
        expect([run.argv, run.cwd]).toEqual([["/bin/echo", "over workerd"], "/work"])
        yield* run.print("over workerd\n")
        yield* run.exit(0)
        expect(yield* Stream.mkString(Stream.decodeText(handle.all))).toBe("over workerd\n")
        expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))

        const large = new Uint8Array(randomBytes(256 * 1024))
        yield* environment.files.write("/big", large)
        expect((yield* gpu.files.read("/big")).bytes).toEqual(large)
        expect((yield* environment.files.read("/big")).bytes).toEqual(large)
        expect((yield* server.machines.list()).map((machine) => [machine.id, machine.online, machine.paired])).toEqual([
          [id, true, true],
        ])

        // 2. Replace live connection with a second connection from the same key (no secret)
        const firstSocket = gpu.sockets[0]
        const second = yield* connectWorker(server.handler, server.machines, { home: printed.home, identity })
        expect(yield* Effect.promise(() => firstSocket.closed)).toEqual(CLOSED)
        expect(yield* online(server.machines)).toEqual([id])

        // 3. Removing the machine closes the live socket quietly with 1008
        yield* server.machines.remove(id)
        expect(yield* Effect.promise(() => second.sockets[0].closed)).toEqual(CLOSED)
        expect(yield* server.machines.list()).toEqual([])
      }),
    15_000,
  )

  it.live(
    "enforces machines flag, exact upgrade path matching, password bypass only on upgrades, and missing WebSocketPair fallback",
    () =>
      Effect.gen(function* () {
        const on = yield* bootWorkerd({ machines: true, password: "secret" })
        const ok1 = yield* dialWorkerd(on.handler, linkURL + "?from=worker", {
          Connection: "keep-alive, UPGRADE",
          Upgrade: "WebSocket",
        })
        expect(ok1.opened).toBe(true)

        const checks: ReadonlyArray<readonly [Request, number]> = [
          [new Request(linkURL), 401],
          [new Request(linkURL, { headers: { Upgrade: "websocket" } }), 401],
          [new Request(linkURL, { headers: { Upgrade: "websocket", Connection: "close" } }), 401],
          [new Request(linkURL, { method: "POST", headers: upgradeHeaders }), 404],
          [new Request(linkURL + "/", { headers: upgradeHeaders }), 404],
          [new Request("https://do.example/api/experimental/machine/other", { headers: upgradeHeaders }), 404],
          [new Request(linkURL, { headers: { authorization } }), 404],
        ]
        for (const [request, expected] of checks) {
          const res = yield* Effect.promise(() => on.handler(request))
          expect(res.status).toBe(expected)
        }

        // Standalone routes answer unknown paths (and disabled machine upgrades) with 404 without allocating a pair.
        const off = yield* bootWorkerd({ machines: false, password: "secret" })
        const offRes = yield* Effect.promise(() => off.handler(new Request(linkURL, { headers: upgradeHeaders })))
        expect([offRes.status, off.tracker.created.length]).toEqual([404, 0])

        const noPair = yield* ServerWorkerd.create({
          storage: makeDurableObjectStorage(),
          models: { fetch: false },
          config: { content: JSON.stringify({ experimental: { machines: true } }) },
        }).pipe(
          Effect.provideService(WorkerdWebSocketPair, {
            create: () => undefined,
            respond: () => new Response(null, { status: 101 }),
          }),
        )
        const fallback = yield* Effect.promise(() => noPair(new Request(linkURL, { headers: upgradeHeaders })))
        expect(fallback.status).toBe(404)
      }),
  )

  it.live("closes peers on text frames, undersized frames, oversized frames, and inbound floods", () =>
    Effect.gen(function* () {
      const server = yield* bootWorkerd()
      const bad: ReadonlyArray<readonly [Uint8Array | string, { readonly code: number; readonly reason: string }]> = [
        ["a text message", CLOSED],
        [new Uint8Array(0), CLOSED],
        [randomBytes(15), CLOSED],
        [new Uint8Array(MAX_FRAME + 1), TOO_BIG],
      ]
      for (const [payload, expected] of bad) {
        const peer = yield* dialWorkerd(server.handler)
        expect(peer.opened).toBe(true)
        yield* peer.send(payload)
        expect(yield* peer.closed).toEqual(expected)
      }

      // During handshake, unread bytes are capped at WORKERD_MAX_HANDSHAKE_WAITING (4 KiB).
      const [handshakeClient, handshakeServer] = makeMemorySocketPair()
      const handshakeHandle = yield* createWorkerdCarrier(handshakeServer)
      handshakeServer.accept()
      handshakeClient.accept()
      handshakeServer.deliver(new Uint8Array(WORKERD_MAX_HANDSHAKE_WAITING + 1).fill(7).buffer)
      expect(yield* Effect.promise(() => handshakeClient.closed)).toEqual(CLOSED)
      expect(yield* handshakeHandle.carrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())

      // After promote(), authenticated links accept up to WORKERD_MAX_WAITING (4 MiB) before closing.
      const [client, serverEnd] = makeMemorySocketPair()
      const handle = yield* createWorkerdCarrier(serverEnd)
      handle.promote()
      serverEnd.accept()
      client.accept()
      const chunk = new Uint8Array(MAX_FRAME).fill(7)
      const count = Math.floor(WORKERD_MAX_WAITING / MAX_FRAME) + 1
      for (let i = 0; i < count; i++) serverEnd.deliver(chunk.buffer)
      expect(yield* Effect.promise(() => client.closed)).toEqual(CLOSED)
      expect(yield* handle.carrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())
    }),
  )

  it.effect(
    "caps concurrent handshakes at MAX_HANDSHAKES (503 beyond) and frees slots on 10s timeout or scope close",
    () =>
      Effect.gen(function* () {
        const serverScope = yield* Scope.fork(yield* Effect.scope)
        const server = yield* bootWorkerd().pipe(Scope.provide(serverScope))

        const peers = yield* Effect.forEach(Array.from({ length: MAX_HANDSHAKES }), () => dialWorkerd(server.handler), {
          concurrency: "unbounded",
        })
        expect(peers.every((peer) => peer.opened)).toBe(true)
        expect(server.tracker.created.length).toBe(MAX_HANDSHAKES)

        const overflow = yield* dialWorkerd(server.handler)
        expect([overflow.opened, overflow.status, server.tracker.created.length]).toEqual([false, 503, MAX_HANDSHAKES])

        yield* TestClock.adjust("10 seconds")
        expect(yield* Effect.forEach(peers, (peer) => peer.closed)).toEqual(peers.map(() => CLOSED))

        const next = yield* dialWorkerd(server.handler)
        expect(next.opened).toBe(true)
        yield* Scope.close(serverScope, Exit.void)
        expect(yield* next.closed).toEqual(CLOSED)

        const afterClose = yield* dialWorkerd(server.handler)
        expect([afterClose.opened, afterClose.status]).toEqual([false, 503])
      }),
  )

  it.effect("waits on bufferedAmount backpressure, resets stall timer on drain, and drops after 60s stall", () =>
    Effect.gen(function* () {
      const [client, serverEnd] = makeMemorySocketPair()
      const handle = yield* createWorkerdCarrier(serverEnd)
      serverEnd.accept()
      client.accept()

      const frame = new Uint8Array(64).fill(1)
      serverEnd.bufferedAmount = WORKERD_MAX_BUFFERED + 2048
      const sending = yield* Effect.forkChild(handle.carrier.send(frame), { startImmediately: true })

      yield* TestClock.adjust("45 seconds")
      expect(sending.pollUnsafe()).toBeUndefined()
      serverEnd.bufferedAmount = WORKERD_MAX_BUFFERED + 1024
      yield* TestClock.adjust("45 seconds")
      expect(sending.pollUnsafe()).toBeUndefined()

      serverEnd.bufferedAmount = 0
      yield* TestClock.adjust("50 millis")
      yield* Fiber.join(sending)
      expect(serverEnd.sent.length).toBe(1)
      expect(serverEnd.readyState).toBe(1)

      serverEnd.bufferedAmount = WORKERD_MAX_BUFFERED + 1024
      const stalled = yield* Effect.forkChild(handle.carrier.send(frame), { startImmediately: true })
      yield* TestClock.adjust("59 seconds")
      expect(stalled.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("2 seconds")
      yield* Fiber.join(stalled)
      expect(yield* Effect.promise(() => client.closed)).toEqual(CLOSED)
      expect(yield* handle.carrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())
    }),
  )
})
