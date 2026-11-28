import { expect } from "bun:test"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { Database } from "@opencode/core/database/database"
import { ServerFetch } from "../src/fetch"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Identity } from "@opencode/core/machine/identity"
import { Join } from "@opencode/core/machine/join"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { type Cause, Deferred, Effect, Exit, Fiber, Option, Queue, Scope, Stream } from "effect"
import { makeWorker } from "../../core/test/fixture/machine-worker"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { WorkerdMachineLink } from "../src/workerd-machine-link"

// The home's side of a machine's link on workerd, over the server half of a `WebSocketPair` kept in memory: Bun has no
// `WebSocketPair` and refuses a 101 response, so the upgrade itself is covered under workerd by
// script/workerd-machine-link.ts. The worker is core's fake one, dialling with `Link.connect`, and the home has the real
// Machines, Identity and database layers.

const layers = (directory: string) =>
  AppNodeBuilder.build(LayerNode.group([Database.node, Machines.node, Identity.node]), [
    Global.node.replace(
      Global.layerWith({
        data: directory,
        cache: directory,
        config: directory,
        state: directory,
        tmp: directory,
        bin: directory,
        log: directory,
        repos: directory,
      }),
    ),
    Database.node.replace(Database.configured({ path: path.join(directory, "opencode.db") })),
  ])

const withHome = <A, E>(body: Effect.Effect<A, E, Machines.Service | Identity.Service | Scope.Scope>) =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    return yield* body.pipe(Effect.provide(layers(tmp.path), { local: true }))
  })

type Listener = (event: { readonly data: unknown }) => void

/**
 * workerd's server-side socket, accepted, and the worker's end of it: `deliver` is a message from the worker, handed
 * over as workerd would for the binary type the home set, `carrier` the worker's end as `Link.connect` dials over, and
 * `closed` the code the home closed the socket with.
 */
const socketPair = Effect.gen(function* () {
  const toWorker = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const closed = yield* Deferred.make<number>()
  const listeners = { message: [] as Listener[], close: [] as Listener[], error: [] as Listener[] }
  const socket = {
    readyState: 1,
    binaryType: "blob",
    send: (message: Uint8Array) => {
      Queue.offerUnsafe(toWorker, message.slice())
    },
    close: (code: number) => {
      socket.readyState = 3
      Queue.endUnsafe(toWorker)
      Deferred.doneUnsafe(closed, Effect.succeed(code))
    },
    addEventListener: (type: "message" | "close" | "error", listener: Listener) => {
      listeners[type].push(listener)
    },
  }
  const deliver = (data: Uint8Array | string) => {
    const message =
      typeof data === "string"
        ? data
        : socket.binaryType === "arraybuffer"
          ? data.slice().buffer
          : new Blob([data.slice()])
    listeners.message.forEach((listener) => listener({ data: message }))
  }
  return {
    socket,
    deliver,
    closed: Deferred.await(closed),
    /** The worker closes the socket, which workerd answers itself. */
    hangUp: Effect.sync(() => {
      socket.readyState = 3
      Queue.endUnsafe(toWorker)
      listeners.close.forEach((listener) => listener({ data: undefined }))
    }),
    carrier: {
      send: (message) => Effect.sync(() => deliver(message)),
      receive: Queue.take(toWorker).pipe(Effect.mapError(() => new Link.Closed())),
    } satisfies Link.Carrier,
  }
})

const online = Effect.flatMap(Machines.Service, (machines) =>
  Effect.map(machines.list(), (list) => list.filter((machine) => machine.online).map((machine) => machine.id)),
)

const until = Effect.fnUntraced(function* <R>(condition: Effect.Effect<boolean, never, R>) {
  const deadline = performance.now() + 30_000
  while (!(yield* condition)) {
    if (performance.now() > deadline) return yield* Effect.die(new Error("the home never got there"))
    yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)))
  }
})

it.live("joins a machine over workerd's socket, frees its place after the handshake, and ends with the socket", () =>
  withHome(
    Effect.gen(function* () {
      const machines = yield* Machines.Service
      const id = yield* machines.add("gpu")
      const join = Option.getOrThrow(Join.decode(yield* machines.invite(id, { reach: [] })))
      const pair = yield* socketPair
      const released = yield* Deferred.make<void>()
      const served = yield* Effect.forkChild(
        WorkerdMachineLink.serve(pair.socket, Deferred.succeed(released, undefined)),
        {
          startImmediately: true,
        },
      )
      expect(pair.socket.binaryType).toBe("arraybuffer")

      const worker = yield* makeWorker({
        connect: (connection) =>
          Effect.gen(function* () {
            const linked = yield* Link.connect(pair.carrier, {
              home: join.home,
              identity: Identity.fromSeed(randomBytes(32)),
              secret: join.secret,
            })
            linked.send(connection.hello)
            yield* Effect.raceFirst(
              Stream.runForEach(linked.messages, (message) => Effect.sync(() => connection.send(message))),
              Stream.runForEach(connection.messages, (message) => Effect.sync(() => linked.send(message))),
            )
          }).pipe(Effect.scoped),
      })
      yield* worker.restore
      yield* until(Effect.map(online, (ids) => ids.includes(id)))
      yield* Deferred.await(released)

      // A file both ways, larger than one frame.
      const large = new Uint8Array(randomBytes(200_000))
      const files = (yield* machines.get(id)).files
      yield* files.write("/big", large)
      expect((yield* Environment.makeFiles(worker.files).read("/big")).bytes).toEqual(large)
      expect((yield* files.read("/big")).bytes).toEqual(large)

      yield* pair.hangUp
      yield* Fiber.join(served)
      expect(yield* online).toEqual([])
    }),
  ),
)

it.live("closes on what no link sends, and frees the place of a handshake it ends", () =>
  withHome(
    Effect.gen(function* () {
      const cases = [
        { name: "text", message: "hello", code: 1008 },
        { name: "shorter than a frame", message: new Uint8Array(15), code: 1008 },
        { name: "longer than a frame", message: new Uint8Array(65_536), code: 1009 },
      ]
      const results = yield* Effect.forEach(cases, (entry) =>
        Effect.gen(function* () {
          const pair = yield* socketPair
          const released = yield* Deferred.make<void>()
          const served = yield* Effect.forkChild(
            WorkerdMachineLink.serve(pair.socket, Deferred.succeed(released, undefined)),
            { startImmediately: true },
          )
          pair.deliver(entry.message)
          const code = yield* pair.closed
          yield* Fiber.join(served)
          yield* Deferred.await(released)
          return { name: entry.name, code }
        }),
      )
      expect(results).toEqual(cases.map((entry) => ({ name: entry.name, code: entry.code })))
      expect(yield* online).toEqual([])
    }),
  ),
)

it.live("closes the socket with 1008 when its scope closes mid-handshake", () =>
  withHome(
    Effect.gen(function* () {
      const pair = yield* socketPair
      const released = yield* Deferred.make<void>()
      const served = yield* Effect.forkChild(
        WorkerdMachineLink.serve(pair.socket, Deferred.succeed(released, undefined)),
        {
          startImmediately: true,
        },
      )
      pair.deliver(new Uint8Array(randomBytes(32)))
      // The home's second message, so the handshake is waiting on the peer's third.
      yield* pair.carrier.receive
      yield* Fiber.interrupt(served)
      expect(yield* pair.closed).toBe(1008)
      yield* Deferred.await(released)
    }),
  ),
)

it.live("ends once more than 8 MiB waits unread, and hands over what came before in order", () =>
  Effect.gen(function* () {
    const pair = yield* socketPair
    const carrier = yield* WorkerdMachineLink.carrier(pair.socket)
    const frame = (index: number) => new Uint8Array(65_535).fill(index)
    // 128 whole frames fit in 8 MiB; the 129th does not.
    for (const index of Array.from({ length: 129 }, (_, index) => index)) pair.deliver(frame(index))
    expect(yield* pair.closed).toBe(1008)
    const received = yield* Effect.forEach(Array.from({ length: 128 }), () => carrier.receive)
    expect(received.map((message) => message[0])).toEqual(Array.from({ length: 128 }, (_, index) => index))
    expect(yield* carrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())
  }).pipe(Effect.scoped),
)

it.live("closes cleanly when socket.send throws instead of defecting", () =>
  Effect.gen(function* () {
    const pair = yield* socketPair
    const throwing = {
      ...pair.socket,
      send: () => {
        throw new Error("socket already reset")
      },
    }
    const carrier = yield* WorkerdMachineLink.carrier(throwing)
    yield* carrier.send(new Uint8Array(32))
    expect(yield* pair.closed).toBe(1008)
    expect(yield* carrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())
  }).pipe(Effect.scoped),
)

it.live("isUpgrade matches only same-site GET upgrades to the machine link path", () =>
  Effect.sync(() => {
    const req = (url: string, init?: RequestInit) => new Request(url, init)
    expect(
      WorkerdMachineLink.isUpgrade(
        req("http://opencode.local/api/experimental/machine/link", { headers: { upgrade: "websocket" } }),
      ),
    ).toBe(true)
    expect(
      WorkerdMachineLink.isUpgrade(
        req("http://opencode.local/api/experimental/machine/link", {
          headers: { upgrade: "websocket", "sec-fetch-site": "cross-site", origin: "https://evil.example" },
        }),
      ),
    ).toBe(false)
    expect(WorkerdMachineLink.isUpgrade(req("http://opencode.local/api/experimental/machine/link"))).toBe(false)
    expect(
      WorkerdMachineLink.isUpgrade(req("http://opencode.local/api/other", { headers: { upgrade: "websocket" } })),
    ).toBe(false)
  }),
)

it.live("make returns 404 when machines are off and 503 after its scope closes", () =>
  Effect.gen(function* () {
    const pairClass = class {
      readonly 0 = {
        readyState: 1,
        binaryType: "blob",
        accept: () => {},
        send: () => {},
        close: () => {},
        addEventListener: () => {},
      }
      readonly 1 = this[0]
    }
    const upgrade = new Request("http://opencode.local/api/experimental/machine/link", {
      headers: { upgrade: "websocket" },
    })

    const off = yield* ServerFetch.makeWithContext({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
      config: { content: JSON.stringify({ experimental: { machines: false } }) },
    })
    const disabled = yield* WorkerdMachineLink.make().pipe(Effect.provide(off.context))
    const disabledEffect = disabled(upgrade, pairClass)
    expect(disabledEffect).toBeDefined()
    expect((yield* disabledEffect!).status).toBe(404)

    const on = yield* ServerFetch.makeWithContext({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
      config: { content: JSON.stringify({ experimental: { machines: true } }) },
    })
    const closedScope = yield* Scope.make()
    const link = yield* WorkerdMachineLink.make().pipe(Scope.provide(closedScope), Effect.provide(on.context))
    yield* Scope.close(closedScope, Exit.void)
    const closedEffect = link(upgrade, pairClass)
    expect(closedEffect).toBeDefined()
    expect((yield* closedEffect!).status).toBe(503)
  }).pipe(Effect.scoped),
)
