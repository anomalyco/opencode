import { expect } from "bun:test"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { Database } from "@opencode/core/database/database"
import { Noise } from "@opencode/core/machine/noise"
import { ServerFetch } from "../src/fetch"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Identity } from "@opencode/core/machine/identity"
import { Machine } from "@opencode/core/machine/index"
import { Join } from "@opencode/core/machine/join"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import {
  type Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Queue,
  Result,
  Schema,
  Scope,
  Stream,
} from "effect"
import { ChildProcess } from "effect/process"
import { makeDurableObjectStorage } from "../../core/test/fixture/durable-object-storage"
import { makeWorker } from "../../core/test/fixture/machine-worker"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerWorkerd } from "../src/workerd"
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
        serializeAttachment: () => {},
        deserializeAttachment: () => null,
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

/**
 * One wake of a Durable Object over `storage`: the workerd profile's routes built afresh, as a cold boot builds them,
 * their HTTP handler, and the machine link over `state`, which takes back every socket `state` lists.
 */
const boot = (
  storage: ReturnType<typeof makeDurableObjectStorage>,
  state: WorkerdMachineLink.State,
  scope: Scope.Scope,
) =>
  Effect.gen(function* () {
    const context = yield* ServerFetch.build(
      ServerWorkerd.routes({
        storage,
        app: { version: "test" },
        config: { content: JSON.stringify({ experimental: { machines: true } }) },
        models: { fetch: false },
      }),
    )
    const http = yield* ServerFetch.serve(context, ServerFetch.middleware({}))
    const link = yield* WorkerdMachineLink.make({ state }, { rekeyInterval: 3 }).pipe(Effect.provide(context))
    return { http, link, machines: Context.get(context, Machines.Service) }
  }).pipe(Scope.provide(scope))

/**
 * A Durable Object as hibernation sees it: the sockets it accepted, which outlive every wake, and `ctx`, a new one for
 * each wake as workerd gives, listing them.
 */
const durableObject = () => {
  const accepted: Array<{ readonly socket: WorkerdMachineLink.HibernatableSocket; readonly tags: string[] }> = []
  return {
    accepted,
    ctx: (): WorkerdMachineLink.State => ({
      acceptWebSocket: (socket, tags = []) => {
        accepted.push({ socket, tags })
      },
      getWebSockets: (tag) =>
        accepted
          .filter((entry) => entry.socket.readyState < 2 && (tag === undefined || entry.tags.includes(tag)))
          .map((entry) => entry.socket),
    }),
  }
}

/**
 * A socket `ctx.acceptWebSocket` took, and the worker's end of it. workerd hands the worker's messages to the Durable
 * Object's `webSocketMessage`, here whichever wake `route.current` is, and keeps the attachment, a structured clone of
 * at most 2,048 bytes, across wakes.
 */
const hibernatable = (route: { current?: WorkerdMachineLink.Hibernation }) =>
  Effect.gen(function* () {
    const toWorker = yield* Queue.unbounded<Uint8Array, Cause.Done>()
    const closed = yield* Deferred.make<number>()
    const held = { attachment: null as unknown }
    const socket = {
      readyState: 1,
      binaryType: "blob",
      /** Messages the home sent. */
      sent: 0,
      accept: () => {
        throw new Error("a hibernatable socket is never accepted")
      },
      addEventListener: () => {
        throw new Error("a hibernatable socket has no listeners")
      },
      send: (message: Uint8Array) => {
        socket.sent++
        Queue.offerUnsafe(toWorker, message.slice())
      },
      close: (code: number) => {
        socket.readyState = 3
        Queue.endUnsafe(toWorker)
        Deferred.doneUnsafe(closed, Effect.succeed(code))
      },
      serializeAttachment: (value: unknown) => {
        if (JSON.stringify(value).length > 2048) throw new Error("attachment over 2,048 bytes")
        held.attachment = structuredClone(value)
      },
      deserializeAttachment: () => structuredClone(held.attachment),
    }
    return {
      socket,
      Pair: class {
        readonly 0 = socket
        readonly 1 = socket
      },
      closed: Deferred.await(closed),
      carrier: {
        send: (message) => Effect.sync(() => route.current?.webSocketMessage(socket, message.slice().buffer)),
        receive: Queue.take(toWorker).pipe(Effect.mapError(() => new Link.Closed())),
      } satisfies Link.Carrier,
    }
  })

/** A first wake with `gpu` invited and its worker joined over a hibernatable socket, a rekey every third message. */
const joined = Effect.gen(function* () {
  const storage = makeDurableObjectStorage()
  const object = durableObject()
  const route: { current?: WorkerdMachineLink.Hibernation } = {}
  const ctx = object.ctx()
  const first = yield* boot(storage, ctx, yield* Scope.make())
  route.current = first.link
  const id = yield* first.machines.add("gpu")
  const join = Option.getOrThrow(Join.decode(yield* first.machines.invite(id, { reach: [] })))
  const pair = yield* hibernatable(route)
  const upgrade = first.link(
    new Request("http://opencode.local/api/experimental/machine/link", { headers: { upgrade: "websocket" } }),
    pair.Pair,
  )
  expect((yield* upgrade!).status).toBe(101)
  expect(object.accepted.map((entry) => entry.tags)).toEqual([[WorkerdMachineLink.TAG]])
  // Nothing is saved until the hello: a link cut during its handshake is never resumed.
  expect(pair.socket.deserializeAttachment()).toBeNull()
  const dials = { count: 0 }
  const worker = yield* makeWorker({
    connect: (connection) =>
      Effect.gen(function* () {
        dials.count++
        const linked = yield* Link.connect(pair.carrier, {
          home: join.home,
          identity: Identity.fromSeed(randomBytes(32)),
          secret: join.secret,
          rekeyInterval: 3,
        })
        linked.send(connection.hello)
        yield* Effect.raceFirst(
          Stream.runForEach(linked.messages, (message) => Effect.sync(() => connection.send(message))),
          Stream.runForEach(connection.messages, (message) => Effect.sync(() => linked.send(message))),
        )
      }).pipe(Effect.scoped),
  })
  yield* worker.restore
  yield* until(Effect.map(first.machines.list(), (list) => list.some((machine) => machine.online)))
  /** The next wake: a fresh home over the same storage and sockets. The last is dropped, never closed, as hibernation does. */
  const wake = Effect.gen(function* () {
    route.current = undefined
    const next = yield* boot(storage, object.ctx(), yield* Scope.make())
    route.current = next.link
    return next
  })
  return { storage, object, ctx, route, first, id, pair, worker, dials, wake }
})

const listed = (http: (request: Request) => Promise<Response>) =>
  Effect.promise(async () => {
    const response = await http(new Request("http://opencode.local/api/experimental/machine"))
    return Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Schema.Unknown) }))(await response.json()).data
  })

const sleep = (machines: Machines.Interface, id: Environment.ID) =>
  Effect.flatMap(machines.get(id), (environment) =>
    environment.spawner.spawn(ChildProcess.make("sleep", ["100"], { cwd: "/home/worker" })),
  )

it.live(
  "carries a link on across hibernation: no reconnect, no frame on the wire, and nonces in step across rekeys",
  () =>
    Effect.gen(function* () {
      const home = yield* joined
      yield* (yield* home.first.machines.get(home.id)).files.write("/before", new Uint8Array([1, 2, 3]))
      const saved = home.pair.socket.deserializeAttachment()
      expect(saved).toMatchObject({ v: 1, machine: "gpu", hello: { type: "hello", processes: [] } })
      expect(JSON.stringify(saved).length).toBeLessThan(2048)

      // Two hibernations, each a cold boot that keeps nothing of the last but storage, the socket and its attachment.
      for (const wake of [1, 2]) {
        const sent = home.pair.socket.sent
        const next = yield* home.wake
        expect(yield* listed(next.http)).toEqual([
          expect.objectContaining({ id: "gpu", online: true, paired: true, os: "linux" }),
        ])
        expect(home.pair.socket.sent).toBe(sent)

        // Many frames both ways with a rekey every third message: one nonce or key out of step fails the link.
        const large = new Uint8Array(randomBytes(200_000))
        const files = (yield* next.machines.get(home.id)).files
        yield* files.write(`/big-${wake}`, large)
        expect((yield* Environment.makeFiles(home.worker.files).read(`/big-${wake}`)).bytes).toEqual(large)
        expect((yield* files.read(`/big-${wake}`)).bytes).toEqual(large)
        expect((yield* files.read("/before")).bytes).toEqual(new Uint8Array([1, 2, 3]))
        expect(home.pair.socket.sent).toBeGreaterThan(sent + 4)
      }
      expect(home.dials.count).toBe(1)
      expect(home.pair.socket.readyState).toBe(1)
    }),
)

it.live("keeps the object awake while a machine has work in flight, and never resumes a link mid-work", () =>
  Effect.gen(function* () {
    const home = yield* joined
    expect(home.first.link.keepingAwake()).toBe(false)
    expect(home.pair.socket.deserializeAttachment()).not.toBeNull()

    // A process running: a timer holds the object awake and nothing is resumable.
    const work = yield* Scope.make()
    const handle = yield* sleep(home.first.machines, home.id).pipe(Scope.provide(work))
    expect(home.first.link.keepingAwake()).toBe(true)
    expect(home.pair.socket.deserializeAttachment()).toBeNull()

    // It exits: idle again, the timer cleared and the link resumable, and a wake carries it on.
    yield* home.worker.runs[0].exit(0)
    expect(Number(yield* handle.exitCode)).toBe(0)
    yield* until(Effect.sync(() => !home.first.link.keepingAwake()))
    expect(home.pair.socket.deserializeAttachment()).toMatchObject({ v: 1, machine: "gpu" })
    const second = yield* home.wake
    expect(yield* listed(second.http)).toEqual([expect.objectContaining({ id: "gpu", online: true })])
    const files = (yield* second.machines.get(home.id)).files
    yield* files.write("/after", new Uint8Array([4]))
    expect((yield* files.read("/after")).bytes).toEqual(new Uint8Array([4]))
    expect(second.link.keepingAwake()).toBe(false)

    // Should the object wake with a process still running, the socket is closed for the worker to reconnect with a
    // hello that lists it, never resumed without it.
    yield* sleep(second.machines, home.id).pipe(Scope.provide(yield* Scope.make()))
    expect(second.link.keepingAwake()).toBe(true)
    const third = yield* home.wake
    expect(yield* home.pair.closed).toBe(1008)
    expect(yield* listed(third.http)).toEqual([expect.objectContaining({ id: "gpu", online: false })])
    expect(third.link.keepingAwake()).toBe(false)
  }),
)

it.live("a second make over the same ctx leaves the links the first holds alone", () =>
  Effect.gen(function* () {
    const home = yield* joined
    const sent = home.pair.socket.sent
    const twin = yield* boot(home.storage, home.ctx, yield* Scope.make())
    expect(yield* listed(twin.http)).toEqual([expect.objectContaining({ id: "gpu", online: false })])
    expect(home.pair.socket.sent).toBe(sent)
    expect(home.pair.socket.readyState).toBe(1)
    // The first still carries it, its ciphers the only copy.
    const files = (yield* home.first.machines.get(home.id)).files
    yield* files.write("/still", new Uint8Array([7]))
    expect((yield* files.read("/still")).bytes).toEqual(new Uint8Array([7]))
  }),
)

it.live("closes with 1008 on wake every socket it cannot resume, and any socket no link holds", () =>
  Effect.gen(function* () {
    const ctx = durableObject().ctx()
    const route = {}
    const sockets = yield* Effect.all(Array.from({ length: 5 }, () => hibernatable(route)))
    const [handshaking, foreign, removed, closing, stranger] = sockets
    const transport = Result.getOrThrow(
      Result.flatMap(
        Noise.restoreTransport({
          send: { key: new Uint8Array(32), nonce: 4n },
          receive: { key: new Uint8Array(32), nonce: 4n },
        }),
        (restored) => restored.snapshot(),
      ),
    )
    const resumable = (machine: string) => ({
      v: 1,
      ...Schema.encodeSync(Link.Resumable)({
        machine: Environment.ID.make(machine),
        hello: {
          type: "hello",
          protocol: 3,
          os: "linux",
          arch: "x64",
          home: "/home/worker",
          instance: Machine.Instance.make("one"),
          processes: [],
        },
        transport,
      }),
    })
    // Cut during its handshake, so nothing was saved; from another version; a machine since removed; and a socket
    // already closing, which is never taken back.
    foreign.socket.serializeAttachment({ v: 2 })
    removed.socket.serializeAttachment(resumable("gone"))
    closing.socket.serializeAttachment(resumable("gone"))
    for (const entry of [handshaking, foreign, removed]) ctx.acceptWebSocket(entry.socket, [WorkerdMachineLink.TAG])
    closing.socket.readyState = 2
    // workerd may still list a socket while it closes.
    const listing: WorkerdMachineLink.State = {
      acceptWebSocket: ctx.acceptWebSocket,
      getWebSockets: (tag) => [...ctx.getWebSockets(tag), closing.socket],
    }
    const awake = yield* boot(makeDurableObjectStorage(), listing, yield* Scope.make())
    expect(yield* Effect.all([handshaking.closed, foreign.closed, removed.closed])).toEqual([1008, 1008, 1008])
    expect(removed.socket.sent).toBe(0)
    expect(closing.socket.deserializeAttachment()).toBeNull()
    expect(closing.socket.sent).toBe(0)
    awake.link.webSocketMessage(stranger.socket, new ArrayBuffer(32))
    expect(yield* stranger.closed).toBe(1008)
  }),
)
