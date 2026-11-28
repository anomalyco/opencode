import { expect } from "bun:test"
import { NodeHttpServer } from "@effect/platform-node"
import { OpenCode } from "@opencode/client"
import { Environment } from "@opencode/core/environment/index"
import { Identity } from "@opencode/core/machine/identity"
import { Iroh } from "@opencode/core/machine/iroh"
import loadBinding from "@opencode/core/machine/iroh-binding"
import { Join } from "@opencode/core/machine/join"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { Global } from "@opencode/util/global"
import { Context, Deferred, Effect, Exit, Layer, Option, Scope, Stream } from "effect"
import { HttpRouter, HttpServer, type HttpServerRequest, type HttpServerResponse } from "effect/http"
import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { makeWorker } from "../../core/test/fixture/machine-worker"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

// The link over Iroh, offline: the home binds on loopback with no relays or address lookup, and a second endpoint of
// the same binding, standing in for the worker, dials the home key at the home's bound address.

const ALPN = Array.from(new TextEncoder().encode("opencode-link/1"))

/** Deterministic read boundaries, without a native stream coalescing or splitting the fixture. */
const reading = (chunks: number[][]) => {
  const unused = () => {
    throw new Error("unexpected stream operation")
  }
  return Iroh.carrier(
    {
      recv: {
        read: async () => chunks.shift() ?? [],
        readExact: unused,
        readToEnd: unused,
        id: unused,
        bytesRead: unused,
        stop: unused,
        receivedReset: unused,
      },
      send: {
        write: unused,
        writeAll: unused,
        finish: unused,
        reset: unused,
        setPriority: unused,
        priority: unused,
        stopped: unused,
        id: unused,
      },
    },
    unused,
  )
}

it.effect("reads many Iroh messages intact and in order from one read", () =>
  Effect.gen(function* () {
    const messages = Array.from({ length: 900 }, (_, index) => {
      const message = new Uint8Array(70).fill(index % 256)
      new DataView(message.buffer).setUint16(0, index)
      return message
    })
    const carrier = reading([messages.flatMap((message) => [0, message.length, ...message])])
    const received = yield* Effect.forEach(messages, () => carrier.receive)
    expect(received).toEqual(messages)
    received[0][0] ^= 1
    expect(received[1]).toEqual(messages[1])
    expect(yield* carrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())
  }),
)

it.effect("reassembles an Iroh message split across two reads after an earlier message", () =>
  Effect.gen(function* () {
    const carrier = reading([
      [0, 3, 1, 2, 3, 0, 4, 4],
      [5, 6, 7],
    ])
    const first = yield* carrier.receive
    expect(yield* carrier.receive).toEqual(Uint8Array.of(4, 5, 6, 7))
    expect(first).toEqual(Uint8Array.of(1, 2, 3))
    expect(yield* carrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())
  }),
)

type Endpoint = Effect.Success<ReturnType<typeof Iroh.listen>>

/** The server's routes on a port of their own, counting every import of the Iroh binding. */
const home = Effect.fnUntraced(function* (machines: boolean) {
  const directory = (yield* tmpdirScoped("opencode-machine-iroh-")).path
  const server = createServer()
  const http = yield* NodeHttpServer.make(() => server, { port: 0, host: "127.0.0.1" })
  yield* Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()))
  const routes =
    yield* Deferred.make<
      Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, HttpServerRequest.HttpServerRequest | Scope.Scope>
    >()
  yield* http.serve(Effect.flatten(Deferred.await(routes))).pipe(Effect.provide(NodeHttpServer.layerHttpServices))
  const overrides = [
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
  ]
  const state = { loads: 0, endpoint: undefined as Endpoint | undefined }
  const options = {
    password: "secret",
    app: { version: "test-version" },
    database: { path: ":memory:" },
    models: { fetch: false },
    config: { directory, project: false, content: JSON.stringify({ experimental: { machines } }) },
    fs: { filewatcher: false },
  }
  const context = yield* Layer.build(
    createRoutes(options, () => [], overrides).pipe(Layer.provideMerge(NodeHttpServer.layerHttpServices)),
  ).pipe(
    Effect.provideService(Iroh.Testing, {
      offline: true,
      load: () => {
        state.loads++
        return loadBinding()
      },
      watch: (endpoint) => {
        state.endpoint = endpoint
      },
    }),
  )
  yield* Deferred.succeed(routes, Context.get(context, HttpRouter.HttpRouter).asHttpEffect())
  return {
    state,
    context,
    machines: Context.get(context, Machines.Service),
    api: OpenCode.make({
      baseUrl: HttpServer.formatAddress(http.address),
      headers: { authorization: `Basic ${btoa("opencode:secret")}` },
    }),
  }
})

/**
 * A worker's endpoint on loopback, its Iroh key from `seed` when given, and a dial of the home key over it whose stream
 * is the link's carrier.
 */
const workerEndpoint = Effect.fnUntraced(function* (home: Endpoint, seed?: Uint8Array) {
  const binding = yield* Effect.promise(() => loadBinding())
  if (!binding) return yield* Effect.die(new Error("no Iroh build for this platform"))
  const builder = binding.Endpoint.builder()
  builder.applyMinimal()
  builder.bindAddr("127.0.0.1:0")
  if (seed) builder.secretKey(Array.from(seed))
  const endpoint = yield* Effect.acquireRelease(
    Effect.promise(() => builder.bind()),
    (endpoint) => Effect.promise(() => endpoint.close()),
  )
  return (key: Uint8Array) =>
    Effect.gen(function* () {
      const address = new binding.EndpointAddr(binding.EndpointId.fromBytes(Array.from(key)), null, home.boundSockets())
      const connection = yield* Effect.acquireRelease(
        Effect.promise(() => endpoint.connect(address, ALPN)),
        (connection) => Effect.sync(() => connection.close(0n, [])),
      )
      const stream = yield* Effect.promise(() => connection.openBi())
      return { connection, carrier: Iroh.carrier(stream, () => connection.close(0n, [])) }
    })
})

const until = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  const deadline = Date.now() + 10_000
  while (!(yield* condition)) {
    if (Date.now() > deadline) return yield* Effect.die(new Error("timed out"))
    yield* Effect.sleep("10 millis")
  }
})

it.live("pairs a worker over Iroh, carries its frames, and refuses a bad join with 1008", () =>
  Effect.gen(function* () {
    const server = yield* home(true)
    yield* Effect.promise(() => server.api.experimental.machine.list())
    expect(server.state.loads).toBe(0)

    const added = yield* Effect.promise(() => server.api.experimental.machine.add({ name: "gpu", reach: [] }))
    expect(server.state.loads).toBe(1)
    const join = Option.getOrThrow(Join.decode(added.join))
    expect(join.reach).toEqual([{ type: "iroh" }])
    expect(added.reach).toEqual(join.reach)
    const dial = yield* workerEndpoint(server.state.endpoint!)

    // A stranger with a wrong secret: refused, and the home closes the connection with 1008.
    const stranger = yield* dial(join.home)
    const refused = yield* Link.connect(stranger.carrier, {
      home: join.home,
      identity: Identity.fromSeed(randomBytes(32)),
      secret: randomBytes(32),
    }).pipe(Effect.flip)
    expect(refused._tag).toBe("Link.Refused")
    expect(yield* Effect.promise(() => stranger.connection.closed())).toContain("1008")

    // The worker pairs with the join secret, dialing the home key, and files go both ways over the link.
    const identity = Identity.fromSeed(randomBytes(32))
    const fake = yield* makeWorker({
      connect: (connection) =>
        Effect.scoped(
          Effect.gen(function* () {
            const dialed = yield* dial(join.home)
            const linked = yield* Link.connect(dialed.carrier, { home: join.home, identity, secret: join.secret })
            linked.send(connection.hello)
            yield* Effect.raceFirst(
              Stream.runForEach(linked.messages, (message) => Effect.sync(() => connection.send(message))),
              Stream.runForEach(connection.messages, (message) => Effect.sync(() => linked.send(message))),
            )
          }),
        ),
    })
    yield* fake.restore
    yield* until(Effect.map(server.machines.list(), (list) => list.some((machine) => machine.online)))
    const listed = yield* Effect.promise(() => server.api.experimental.machine.list())
    expect(listed[0].connection).toMatchObject({ kind: "iroh", path: "direct" })
    expect(listed[0].connection?.rtt).toBeGreaterThanOrEqual(0)
    const files = (yield* server.machines.get(Environment.ID.make("gpu"))).files
    const bytes = randomBytes(200_000)
    yield* files.write("/note.bin", bytes)
    expect(Buffer.compare((yield* files.read("/note.bin")).bytes, bytes)).toBe(0)
    expect(server.state.loads).toBe(1)
  }),
)

it.live("reports the path of a worker that dials again while its old Iroh connection is still open", () =>
  Effect.gen(function* () {
    const server = yield* home(true)
    const added = yield* Effect.promise(() => server.api.experimental.machine.add({ name: "gpu", reach: [] }))
    const join = Option.getOrThrow(Join.decode(added.join))
    // As when a worker restarts or redials before the home's idle timeout: Iroh keeps the first connection's path
    // selected for the key, so no path of the second connection is marked selected on the home.
    const seed = randomBytes(32)
    const first = yield* workerEndpoint(server.state.endpoint!, seed)
    yield* first(join.home)
    const dial = yield* workerEndpoint(server.state.endpoint!, seed)
    const identity = Identity.fromSeed(randomBytes(32))
    const fake = yield* makeWorker({
      connect: (connection) =>
        Effect.scoped(
          Effect.gen(function* () {
            const dialed = yield* dial(join.home)
            const linked = yield* Link.connect(dialed.carrier, { home: join.home, identity, secret: join.secret })
            linked.send(connection.hello)
            yield* Effect.raceFirst(
              Stream.runForEach(linked.messages, (message) => Effect.sync(() => connection.send(message))),
              Stream.runForEach(connection.messages, (message) => Effect.sync(() => linked.send(message))),
            )
          }),
        ),
    })
    yield* fake.restore
    yield* until(Effect.map(server.machines.list(), (list) => list.some((machine) => machine.online)))
    const listed = yield* Effect.promise(() => server.api.experimental.machine.list())
    expect(listed[0].connection).toMatchObject({ kind: "iroh", path: "direct" })
    expect(listed[0].connection?.rtt).toBeGreaterThanOrEqual(0)
  }),
)

it.live("refuses an Iroh connection while machines are off", () =>
  Effect.gen(function* () {
    const server = yield* home(true)
    const endpoint = yield* Iroh.listen(Effect.succeed(false)).pipe(
      Effect.provide(server.context),
      Effect.provideService(Iroh.Testing, { offline: true, load: loadBinding, watch: () => {} }),
    )
    const identity = Context.get(server.context, Identity.Service)
    const dial = yield* workerEndpoint(endpoint)
    const dialed = yield* Effect.exit(Effect.scoped(dial(yield* identity.publicKey())))
    expect(Exit.isFailure(dialed)).toBe(true)
  }),
)

it.live("never imports Iroh while machines are off, or on with no machines", () =>
  Effect.gen(function* () {
    const off = yield* home(false)
    const results = yield* Effect.promise(() =>
      Promise.allSettled([
        off.api.experimental.machine.list(),
        off.api.experimental.machine.add({ name: "gpu", reach: [] }),
      ]),
    )
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"])
    const on = yield* home(true)
    yield* Effect.promise(() => on.api.experimental.machine.list())
    expect([off.state.loads, on.state.loads]).toEqual([0, 0])
  }),
)
