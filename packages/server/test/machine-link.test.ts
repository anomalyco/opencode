import { expect } from "bun:test"
import { NodeHttpServer } from "@effect/platform-node"
import { NodeWS } from "@effect/platform-node-shared"
import { Environment } from "@opencode/core/environment/index"
import { Frames } from "@opencode/core/machine/frames"
import { Identity } from "@opencode/core/machine/identity"
import { Join } from "@opencode/core/machine/join"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { MACHINE_LINK_PATH } from "@opencode/protocol/groups/machine"
import { Global } from "@opencode/util/global"
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  Queue,
  References,
  Scope,
  Stream,
} from "effect"
import type { NonEmptyReadonlyArray } from "effect/Array"
import { HttpRouter, HttpServer, type HttpServerRequest, type HttpServerResponse } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Socket } from "effect/socket"
import { TestClock } from "effect/testing"
import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer, type IncomingMessage } from "node:http"
import { connect } from "node:net"
import { makeWorker } from "../../core/test/fixture/machine-worker"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { carrier, keepalive, type Transport, upgrade, Watch } from "../src/handlers/machine"
import { ServerProcess } from "../src/process"
import { createEmbeddedRoutes, createRoutes } from "../src/routes"

// The endpoint a machine's link lands on, over real sockets: the fake worker from core's tests dials it with
// `Link.connect` over a WebSocket, and the home is the server's own routes with the real Machines, Identity and
// database layers.
//
// A test that moves time (`it.effect`) runs the server on the test clock, where a wait of the endpoint ends only when
// the test moves the clock past it. A wait begins some turns after what set it off, and one the clock was moved before
// would be left behind, never to end. So a test moves the clock only once it has what the home sent or did on its way
// into the wait, in the same run of the same fiber: the ping before each interval, the close before the time to answer
// it. Where the home does nothing a test can see, `waits` counts the wait itself. Every other wait a test can reach is
// a limit on something real that the test waits for instead, and never has to end.
//
// A test that moves no time runs on the real clock (`it.live`).

const authorization = `Basic ${btoa("opencode:secret")}`
/** The close every connection the home ends carries. */
const CLOSED = { code: 1008, reason: "" }
/** The close the WebSocket layer gives a message over 65,535 bytes, which it takes none of. */
const TOO_BIG = { code: 1009, reason: "" }
const MAX_HANDSHAKES = 32
/** A path no route has, next to the link's. */
const OTHER = "/api/experimental/machine/other"
/** A path that is another route's, though a URL parser reads it as the link's: that route's to guard. */
const BORROWED = `/api/fs/read/../..${MACHINE_LINK_PATH.slice("/api".length)}`

const options = (directory: string, machines: boolean) => ({
  password: "secret",
  app: { version: "test-version" },
  database: { path: ":memory:" },
  models: { fetch: false },
  config: { directory, project: false, content: JSON.stringify({ experimental: { machines } }) },
  fs: { filewatcher: false },
})

/**
 * The server's routes on a port of their own, with the home's key and everything else it writes in a fresh directory.
 * As in ServerProcess, the routes are built once the server is serving, so they stop before it does. `sockets` is the
 * endpoint's own `ws` server once it has made one, whose clients are the connections it holds. Without `password` the
 * routes are the ones an embedding host serves, which ask for none, and without `upgrades` the server hands every
 * request over as HTTP.
 *
 * The routes run on the test's clock, through one that also counts the waits begun on it: `waits` is how many of a
 * length have begun in a span of a name, which is how a wait of the link is told from the server's own.
 */
const home = Effect.fnUntraced(function* (
  input: { readonly machines?: boolean; readonly password?: boolean; readonly upgrades?: boolean } = {},
) {
  const directory = (yield* tmpdirScoped("opencode-machine-link-")).path
  const server = createServer()
  const http = yield* NodeHttpServer.make(() => server, { port: 0, host: "127.0.0.1" })
  yield* Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()))
  const routes =
    yield* Deferred.make<
      Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, HttpServerRequest.HttpServerRequest | Scope.Scope>
    >()
  yield* http.serve(Effect.flatten(Deferred.await(routes))).pipe(Effect.provide(NodeHttpServer.layerHttpServices))
  if (input.upgrades === false) server.removeAllListeners("upgrade")
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
  const begun: Array<{ readonly span: string | undefined; readonly millis: number }> = []
  const real = yield* Clock.Clock
  const clock: Clock.Clock = Object.assign(Object.create(real), {
    sleep: (duration: Duration.Duration) =>
      Effect.flatMap(Effect.option(Effect.currentSpan), (span) => {
        begun.push({ span: Option.getOrUndefined(span)?.name, millis: Duration.toMillis(duration) })
        return real.sleep(duration)
      }),
  })
  const watched: Array<NodeWS.WebSocketServer> = []
  const most = { sockets: 0 }
  const context = yield* Layer.build(
    (input.password === false
      ? createEmbeddedRoutes(options(directory, input.machines ?? true), overrides)
      : createRoutes(options(directory, input.machines ?? true), () => [], overrides)
    ).pipe(Layer.provideMerge(NodeHttpServer.layerHttpServices)),
  ).pipe(
    Effect.provideService(Clock.Clock, clock),
    Effect.provideService(Watch, (sockets) => {
      watched.push(sockets)
      sockets.on("headers", () => {
        most.sockets = Math.max(most.sockets, sockets.clients.size + 1)
      })
    }),
  )
  yield* Deferred.succeed(routes, Context.get(context, HttpRouter.HttpRouter).asHttpEffect())
  const base = HttpServer.formatAddress(http.address)
  return {
    base,
    url: link(base),
    machines: Context.get(context, Machines.Service),
    /** How many `ws` servers the endpoint has made: none until its first link, and one from then on. */
    made: () => watched.length,
    get sockets() {
      return watched[0]
    },
    /** The most sockets the endpoint has held, counted each time one is about to be added. */
    most: () => most.sockets,
    waits: (span: string, length: Duration.Input) =>
      begun.filter((wait) => wait.span === span && wait.millis === Duration.toMillis(Duration.fromInputUnsafe(length)))
        .length,
  }
})

const link = (base: string) => {
  const url = new URL(MACHINE_LINK_PATH, base)
  url.protocol = "ws:"
  return url
}

/**
 * A WebSocket to the endpoint, as the carrier a worker dials with: Bun's own unless `open` makes another. `receive`
 * takes what arrived, in order, and `closed` is how the socket ended.
 */
const dial = Effect.fnUntraced(function* (url: URL, open: () => Socket.WebSocketLike = () => new WebSocket(url)) {
  const messages = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const closed = Promise.withResolvers<{ readonly code?: number; readonly reason?: string }>()
  const opened = Promise.withResolvers<boolean>()
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const socket = Object.assign(open(), { binaryType: "arraybuffer" })
      socket.addEventListener("open", () => opened.resolve(true))
      socket.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) Queue.offerUnsafe(messages, new Uint8Array(event.data))
      })
      socket.addEventListener("close", (event) => {
        Queue.endUnsafe(messages)
        opened.resolve(false)
        closed.resolve({ code: event.code, reason: event.reason })
      })
      return socket
    }),
    (socket) => Effect.sync(() => socket.close()),
  )
  return {
    opened: yield* Effect.promise(() => opened.promise),
    closed: Effect.promise(() => closed.promise),
    receive: Queue.take(messages).pipe(Effect.mapError(() => new Link.Closed())),
    send: (message: Uint8Array | string) =>
      Effect.sync(() => socket.send(typeof message === "string" ? message : new Uint8Array(message))),
  }
})

/** Lets the sockets move: one turn of the event loop, which no clock counts. */
const turn = Effect.promise(() => new Promise((resolve) => setImmediate(resolve)))

/**
 * Waits for the home to act on what a socket brought it, since nothing it does then is sent back. The bound is only
 * there to end a loop whose test has already failed, and is far more than a loaded machine needs.
 */
const until = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  const deadline = performance.now() + 30_000
  while (!(yield* condition)) {
    if (performance.now() > deadline) return yield* Effect.die(new Error("the home never got there"))
    yield* turn
  }
})

const online = (machines: Machines.Interface) =>
  Effect.map(machines.list(), (list) => list.filter((machine) => machine.online).map((machine) => machine.id))

const invite = (machines: Machines.Interface, id: Environment.ID) =>
  machines.invite(id, { reach: [] }).pipe(Effect.map((printed) => Option.getOrThrow(Join.decode(printed))))

/**
 * The fake worker from core's tests (test/fixture/machine-worker.ts), each of its connections a WebSocket to the
 * endpoint that `Link.connect` dials. `sockets` are those WebSockets, newest last.
 */
const worker = Effect.fnUntraced(function* (
  url: URL,
  machines: Machines.Interface,
  dialing: Link.DialOptions,
  open?: () => Socket.WebSocketLike,
) {
  const sockets: Array<Effect.Success<ReturnType<typeof dial>>> = []
  const fake = yield* makeWorker({
    connect: (connection) =>
      Effect.scoped(
        Effect.gen(function* () {
          const socket = yield* dial(url, open)
          sockets.push(socket)
          const linked = yield* Link.connect(socket, dialing)
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

/**
 * Starts handshakes, one socket after another, until the home turns one away, which it does before the socket is a
 * WebSocket. Each one admitted sends a first message, has the home's second, and is left waiting on its third.
 */
const handshakes = Effect.fnUntraced(function* (url: URL) {
  const admitted: Array<Effect.Success<ReturnType<typeof dial>>> = []
  while (admitted.length <= MAX_HANDSHAKES) {
    const peer = yield* dial(url)
    if (!peer.opened) return admitted
    yield* peer.send(randomBytes(32))
    yield* peer.receive
    admitted.push(peer)
  }
  return admitted
})

/**
 * How many handshakes the home has room for, found by filling it with peers that only connect. Each is then refused,
 * which frees its place before the peer can see that it was.
 */
const room = Effect.fnUntraced(function* (url: URL) {
  const admitted: Array<Effect.Success<ReturnType<typeof dial>>> = []
  while (admitted.length <= MAX_HANDSHAKES) {
    const peer = yield* dial(url)
    if (!peer.opened) break
    admitted.push(peer)
  }
  yield* Effect.forEach(admitted, (peer) => Effect.andThen(peer.send(randomBytes(100)), peer.closed), {
    concurrency: "unbounded",
  })
  return admitted.length
})

/**
 * Nothing is left of the connections that ended: the endpoint holds only the `left` sockets still in use, and every
 * place for a handshake is free.
 */
const idle = Effect.fnUntraced(function* (server: Effect.Success<ReturnType<typeof home>>, left = 0) {
  yield* until(Effect.sync(() => server.sockets.clients.size === left))
  expect(yield* room(server.url)).toBe(MAX_HANDSHAKES)
  yield* until(Effect.sync(() => server.sockets.clients.size === left))
})

/** One HTTP/1.1 request on a connection of its own, and the response as the server wrote it, less its date. */
const exchange = (base: string, path: string, headers: Record<string, string>, method = "GET") =>
  Effect.promise(async () => {
    const url = new URL(base)
    const socket = connect(Number(url.port), url.hostname)
    const chunks: Buffer[] = []
    socket.on("data", (chunk) => {
      chunks.push(chunk)
      // An upgraded connection stays open, so its response ends with its head.
      if (Buffer.concat(chunks).toString("latin1").startsWith("HTTP/1.1 101")) socket.destroy()
    })
    socket.write(
      [
        `${method} ${path} HTTP/1.1`,
        `Host: ${url.host}`,
        ...Object.entries({ Connection: "close", ...headers }).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ].join("\r\n"),
    )
    await once(socket, "close")
    return Buffer.concat(chunks)
      .toString("latin1")
      .replace(/^date: .*\r\n/im, "")
  })

const websocket = {
  Connection: "Upgrade",
  Upgrade: "websocket",
  "Sec-WebSocket-Version": "13",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
}

/** A peer that asks for the WebSocket and then says nothing more, not even in answer to a close. */
const mute = Effect.fnUntraced(function* (url: URL) {
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => connect(Number(url.port), url.hostname)),
    (socket) => Effect.sync(() => socket.destroy()),
  )
  const switched = once(socket, "data")
  socket.write(
    [
      `GET ${url.pathname} HTTP/1.1`,
      `Host: ${url.host}`,
      ...Object.entries(websocket).map(([name, value]) => `${name}: ${value}`),
      "",
      "",
    ].join("\r\n"),
  )
  yield* Effect.promise(() => switched)
  return socket
})

/** Resolves once the socket has been pinged `count` times. */
const pinged = (socket: NodeWS.WebSocket, count: number) => {
  const seen = { pings: 0 }
  const reached = Promise.withResolvers<void>()
  socket.on("ping", () => {
    if (++seen.pings === count) reached.resolve()
  })
  return reached.promise
}

/** A `ws` socket as the endpoint upgrades one, on a server that does nothing else, and the `ws` client at its other end. */
const pair = Effect.fnUntraced(function* () {
  const server = createServer()
  const request = Promise.withResolvers<IncomingMessage>()
  server.once("upgrade", request.resolve)
  yield* Effect.acquireRelease(
    Effect.promise(() => once(server.listen(0, "127.0.0.1"), "listening")),
    () => Effect.sync(() => server.close()),
  )
  const address = server.address()
  if (address === null || typeof address === "string") return yield* Effect.die(new Error("the server has no port"))
  const client = new NodeWS.WebSocket(`ws://127.0.0.1:${address.port}`)
  const opened = once(client, "open")
  const transport = yield* upgrade(
    new NodeWS.WebSocketServer({ noServer: true }),
    yield* Effect.promise(() => request.promise),
  )
  // Dropped before the endpoint's socket is closed, whose close would wait on a client the test left paused.
  yield* Effect.addFinalizer(() => Effect.sync(() => client.terminate()))
  yield* Effect.promise(() => opened)
  return { client, transport }
})

it.live("runs a command and reads a file on a machine that joined over a WebSocket", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const gpu = yield* worker(server.url, server.machines, {
      home: printed.home,
      identity: Identity.fromSeed(randomBytes(32)),
      secret: printed.secret,
    })
    const environment = yield* server.machines.get(id)
    const handle = yield* environment.spawner.spawn(ChildProcess.make("/bin/echo", ["over the link"], { cwd: "/work" }))
    const run = gpu.fake.runs[0]
    expect([run.argv, run.cwd]).toEqual([["/bin/echo", "over the link"], "/work"])
    yield* run.print("over the link\n")
    yield* run.exit(0)
    expect(yield* Stream.mkString(Stream.decodeText(handle.all))).toBe("over the link\n")
    expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))

    // 1 MiB is some twenty frames each way, more than the socket takes at once.
    const large = new Uint8Array(randomBytes(1024 * 1024))
    yield* environment.files.write("/big", large)
    expect((yield* gpu.files.read("/big")).bytes).toEqual(large)
    expect((yield* environment.files.read("/big")).bytes).toEqual(large)
    expect((yield* server.machines.list()).map((machine) => [machine.id, machine.online, machine.paired])).toEqual([
      [id, true, true],
    ])
  }),
)

it.live("serves a key that reconnects as the same machine, with no secret", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const identity = Identity.fromSeed(randomBytes(32))
    const first = yield* worker(server.url, server.machines, { home: printed.home, identity, secret: printed.secret })
    yield* first.fake.cut
    yield* until(Effect.map(online(server.machines), (ids) => ids.length === 0))

    const second = yield* worker(server.url, server.machines, { home: printed.home, identity })
    expect(yield* online(server.machines)).toEqual([id])
    const files = (yield* server.machines.get(id)).files
    yield* files.write("/note", new TextEncoder().encode("after the reconnect"))
    expect(new TextDecoder().decode((yield* second.files.read("/note")).bytes)).toBe("after the reconnect")

    // The spent secret pairs no second key.
    const other = yield* dial(server.url)
    const refused = yield* Link.connect(other, {
      home: printed.home,
      identity: Identity.fromSeed(randomBytes(32)),
      secret: printed.secret,
    }).pipe(Effect.flip)
    expect(refused).toEqual(new Link.Refused())
    expect(yield* other.closed).toEqual(CLOSED)
  }),
)

it.live("closes a stranger's handshake the same way whatever it lacks, and connects no machine", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const strangers: ReadonlyArray<Link.DialOptions> = [
      { home: printed.home, identity: Identity.fromSeed(randomBytes(32)) },
      { home: printed.home, identity: Identity.fromSeed(randomBytes(32)), secret: randomBytes(32) },
    ]
    for (const stranger of strangers) {
      const peer = yield* dial(server.url)
      expect(peer.opened).toBe(true)
      expect(yield* Link.connect(peer, stranger).pipe(Effect.flip)).toEqual(new Link.Refused())
      expect(yield* peer.closed).toEqual(CLOSED)
    }
    expect((yield* server.machines.list()).map((machine) => [machine.online, machine.paired])).toEqual([[false, false]])
    yield* idle(server)
  }),
)

/**
 * Requests that are not the link's upgrade though something about each says so. `path` puts the route in the request's
 * path, so the same request can be made of a path no route has.
 */
const impostors: ReadonlyArray<{
  readonly method?: string
  readonly path: (route: string) => string
  readonly headers: Record<string, string>
}> = [
  // The protocol is named, on a connection that does not ask to change to it.
  { path: (route) => route, headers: { ...websocket, Connection: "close" } },
  { method: "POST", path: (route) => route, headers: websocket },
  { method: "HEAD", path: (route) => route, headers: websocket },
  // Paths a URL parser reads as the route's, and the router does not.
  { path: (route) => `//evil.example${route}`, headers: websocket },
  { path: (route) => route.replace(/\/([^/]+)$/, "/x/../$1"), headers: websocket },
]

it.live("takes no server password for a GET WebSocket upgrade to exactly its path, and for nothing else", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("opencode-machine-link-")).path
    const started = yield* ServerProcess.start<never, never>({
      ...options(directory, true),
      hostname: "127.0.0.1",
      port: 0,
    })
    const base = HttpServer.formatAddress(started.address)

    // Not a first message of the handshake, so the home refuses it before it reads its key.
    const peer = yield* dial(link(base))
    expect(peer.opened).toBe(true)
    yield* peer.send(randomBytes(64))
    expect(yield* peer.closed).toEqual(CLOSED)

    const status = (path: string, headers: Record<string, string>) =>
      Effect.map(exchange(base, path, headers), (response) => response.split("\r\n")[0])
    expect(yield* status(MACHINE_LINK_PATH, websocket)).toBe("HTTP/1.1 101 Switching Protocols")
    // `upgrade` is one of the connection's tokens, in any case, and a query is no part of the path.
    expect(yield* status(MACHINE_LINK_PATH, { ...websocket, Connection: "keep-alive, UPGRADE" })).toBe(
      "HTTP/1.1 101 Switching Protocols",
    )
    expect(yield* status(`${MACHINE_LINK_PATH}?from=worker`, websocket)).toBe("HTTP/1.1 101 Switching Protocols")
    // The same request to its neighbours, and the path without the upgrade.
    expect(yield* status("/api/experimental/job", websocket)).toBe("HTTP/1.1 401 Unauthorized")
    expect(yield* status("/api/experimental/persistent-pty/pty_1/connect", websocket)).toBe("HTTP/1.1 401 Unauthorized")
    expect(yield* status(MACHINE_LINK_PATH, {})).toBe("HTTP/1.1 401 Unauthorized")
    expect(yield* status(`${MACHINE_LINK_PATH}/`, websocket)).toBe("HTTP/1.1 401 Unauthorized")
    expect(yield* status(MACHINE_LINK_PATH, { authorization })).toBe("HTTP/1.1 404 Not Found")
    expect(yield* status(BORROWED, websocket)).toBe("HTTP/1.1 401 Unauthorized")
    // Turned away where an unknown route is, before the routes see it: the status, the challenge and the body.
    expect(yield* exchange(base, MACHINE_LINK_PATH, {})).toBe(yield* exchange(base, OTHER, {}))
    for (const request of impostors) {
      const unknown = yield* exchange(base, request.path(OTHER), request.headers, request.method)
      expect(unknown.split("\r\n").slice(0, 2)).toEqual([
        "HTTP/1.1 401 Unauthorized",
        'www-authenticate: Basic realm="Secure Area"',
      ])
      expect(yield* exchange(base, request.path(MACHINE_LINK_PATH), request.headers, request.method)).toBe(unknown)
    }
  }),
)

it.live("makes the same exception, and no wider one, where the routes are served alone", () =>
  Effect.gen(function* () {
    // As an embedding host serves them, with the server's password.
    const routes = yield* home()
    const routed = (headers: Record<string, string>) =>
      Effect.map(exchange(routes.base, MACHINE_LINK_PATH, headers), (response) => response.split("\r\n")[0])
    expect(yield* routed(websocket)).toBe("HTTP/1.1 101 Switching Protocols")
    expect(yield* routed({})).toBe("HTTP/1.1 401 Unauthorized")
    // The header alone asks for nothing, and is let past nothing.
    expect(yield* routed({ Upgrade: "websocket" })).toBe("HTTP/1.1 401 Unauthorized")
    // An upgrade that is no WebSocket handshake is answered by the WebSocket layer.
    expect(yield* routed({ Connection: "Upgrade", Upgrade: "websocket" })).toBe("HTTP/1.1 400 Bad Request")
    expect(yield* routed({ authorization })).toBe("HTTP/1.1 404 Not Found")
    // With the password, a request that is not the upgrade finds no route here.
    expect(yield* routed({ Upgrade: "websocket", authorization })).toBe("HTTP/1.1 404 Not Found")
    expect(new URL(BORROWED, routes.base).pathname).toBe(MACHINE_LINK_PATH)
    expect((yield* exchange(routes.base, BORROWED, websocket)).split("\r\n")[0]).toBe("HTTP/1.1 401 Unauthorized")

    // A server that upgrades nothing hands the upgrade over as any other request, and the endpoint leaves it one.
    const plain = yield* home({ upgrades: false })
    const kept = yield* exchange(plain.base, MACHINE_LINK_PATH, { ...websocket, Connection: "Upgrade, close" })
    expect([kept.split("\r\n")[0], plain.made()]).toEqual(["HTTP/1.1 404 Not Found", 0])

    // Routes that ask for no password answer everything but the upgrade as they answer a path with no route.
    const open = yield* home({ password: false })
    expect((yield* exchange(open.base, MACHINE_LINK_PATH, websocket)).split("\r\n")[0]).toBe(
      "HTTP/1.1 101 Switching Protocols",
    )
    for (const request of [{ path: (route: string) => route, headers: {} }, ...impostors]) {
      const unknown = yield* exchange(open.base, request.path(OTHER), request.headers, request.method)
      expect(unknown.split("\r\n")[0]).toBe("HTTP/1.1 404 Not Found")
      expect(yield* exchange(open.base, request.path(MACHINE_LINK_PATH), request.headers, request.method)).toBe(unknown)
    }
  }),
)

it.live("logs no response for a request that became a WebSocket, and still logs one it turned away", () =>
  Effect.gen(function* () {
    // The status of each line the server's own response log writes for the link's path.
    const logged: Array<unknown> = []
    const directory = (yield* tmpdirScoped("opencode-machine-link-")).path
    const started = yield* ServerProcess.start<never, never>({
      ...options(directory, true),
      hostname: "127.0.0.1",
      port: 0,
    }).pipe(
      Effect.provide(
        Logger.layer([
          Logger.make((line) => {
            const annotations = line.fiber.getRef(References.CurrentLogAnnotations)
            if (annotations["http.url"] === MACHINE_LINK_PATH) logged.push(annotations["http.status"])
          }),
        ]),
      ),
    )
    const base = HttpServer.formatAddress(started.address)

    // A link the home ends: the server sees its connection close with no response written.
    const refused = yield* dial(link(base))
    yield* refused.send(randomBytes(64))
    expect(yield* refused.closed).toEqual(CLOSED)

    // Every place held by a peer that has only connected, and the request turned away for want of one.
    const holding = yield* Effect.forEach(Array.from({ length: MAX_HANDSHAKES }), () => dial(link(base)))
    expect(holding.every((peer) => peer.opened)).toBe(true)
    expect((yield* exchange(base, MACHINE_LINK_PATH, websocket)).split("\r\n")[0]).toBe(
      "HTTP/1.1 503 Service Unavailable",
    )
    yield* until(Effect.sync(() => logged.length > 0))
    expect(logged).toEqual([503])
  }),
)

it.live("makes its WebSocket server for the first link, not with the routes", () =>
  Effect.gen(function* () {
    // The routes are also built where there is no Node and no such server to make, and where nothing is a link.
    const server = yield* home()
    expect(server.made()).toBe(0)
    yield* exchange(server.base, MACHINE_LINK_PATH, { authorization })
    yield* exchange(server.base, MACHINE_LINK_PATH, { Upgrade: "websocket", authorization })
    expect(server.made()).toBe(0)
    const peers = yield* Effect.forEach([1, 2, 3], () => dial(server.url), { concurrency: "unbounded" })
    expect([peers.every((peer) => peer.opened), server.made(), server.sockets.clients.size]).toEqual([true, 1, 3])
  }),
)

it.live("answers as an unknown route does while machines are off", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("opencode-machine-link-")).path
    const started = yield* ServerProcess.start<never, never>({
      ...options(directory, false),
      hostname: "127.0.0.1",
      port: 0,
    })
    const base = HttpServer.formatAddress(started.address)
    const requests: ReadonlyArray<Record<string, string>> = [
      websocket,
      { ...websocket, authorization },
      {},
      { authorization },
    ]
    for (const headers of requests) {
      const unknown = yield* exchange(base, OTHER, headers)
      expect(unknown.split("\r\n")[0]).toBe(
        "authorization" in headers ? "HTTP/1.1 404 Not Found" : "HTTP/1.1 401 Unauthorized",
      )
      expect(yield* exchange(base, MACHINE_LINK_PATH, headers)).toBe(unknown)
    }
  }),
)

it.live("answers as an unknown route does while machines are off, where the routes are served alone", () =>
  Effect.gen(function* () {
    // As an embedding host serves them, with a password and without one.
    const server = yield* home({ machines: false })
    expect(yield* exchange(server.base, MACHINE_LINK_PATH, { ...websocket, authorization })).toBe(
      yield* exchange(server.base, OTHER, { ...websocket, authorization }),
    )
    const open = yield* home({ machines: false, password: false })
    expect(yield* exchange(open.base, MACHINE_LINK_PATH, websocket)).toBe(yield* exchange(open.base, OTHER, websocket))
    expect([server.made(), open.made()]).toEqual([0, 0])
  }),
)

it.live("closes a peer that sends what no link sends, leaving no handshake behind", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const bad: ReadonlyArray<ReadonlyArray<Uint8Array | string>> = [
      ["a text message, not a binary one"],
      // The largest message the WebSocket layer lets in, which is no first message.
      [new Uint8Array(65_535)],
      [randomBytes(100)],
      // Shorter than any frame of a link is, and the shortest that is not.
      [new Uint8Array(0)],
      [randomBytes(15)],
      [randomBytes(16)],
      // A first message the home answers, then bytes that are no third message.
      [randomBytes(32), randomBytes(193)],
    ]
    for (const messages of bad) {
      const socket = yield* dial(server.url)
      yield* Effect.forEach(messages, socket.send, { discard: true })
      expect(yield* socket.closed).toEqual(CLOSED)
    }
    // One byte more than the WebSocket layer lets in: it closes the socket itself, and the home drops a stranger
    // without waiting for what it was still sending, so the close may not be what the stranger sees last.
    const oversized = yield* dial(server.url)
    yield* oversized.send(new Uint8Array(65_536))
    const seen = (yield* oversized.closed).code
    expect(seen === TOO_BIG.code || seen === 1006).toBe(true)
    // A place any of them had kept would be missing here.
    yield* idle(server)

    // The same after the handshake: a paired worker whose link carries garbage is cut off and its machine goes offline.
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const gpu = yield* worker(server.url, server.machines, {
      home: printed.home,
      identity: Identity.fromSeed(randomBytes(32)),
      secret: printed.secret,
    })
    const garbage = [
      { message: "a text message, not a binary one", closed: CLOSED },
      { message: new Uint8Array(65_536), closed: TOO_BIG },
      { message: randomBytes(100), closed: CLOSED },
      { message: randomBytes(15), closed: CLOSED },
    ]
    for (const sent of garbage) {
      const socket = gpu.sockets[gpu.sockets.length - 1]
      yield* socket.send(sent.message)
      expect(yield* socket.closed).toEqual(sent.closed)
      yield* until(Effect.map(online(server.machines), (ids) => ids.length === 0))
      yield* until(Effect.sync(() => server.sockets.clients.size === 0))
      yield* gpu.reconnect
    }
    yield* idle(server, 1)
  }),
)

it.effect("closes a peer that says nothing ten seconds after it connected", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const silent = yield* dial(server.url)
    expect(silent.opened).toBe(true)
    // Nothing tells a peer that its ten seconds have begun.
    yield* until(Effect.sync(() => server.waits("Link.serve", "10 seconds") === 1))
    const [held] = [...server.sockets.clients]
    yield* TestClock.adjust("9999 millis")
    // It still holds one of the places.
    expect(held.readyState).toBe(held.OPEN)
    expect(yield* room(server.url)).toBe(MAX_HANDSHAKES - 1)
    yield* TestClock.adjust("1 millis")
    expect(yield* silent.closed).toEqual(CLOSED)
    yield* idle(server)
  }),
)

it.effect("makes no more strangers WebSockets than it has places for, and answers the rest as HTTP", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const strangers = yield* Effect.forEach(Array.from({ length: 50 }), () => dial(server.url), {
      concurrency: "unbounded",
    })
    const admitted = strangers.filter((stranger) => stranger.opened)
    expect([admitted.length, server.sockets.clients.size]).toEqual([MAX_HANDSHAKES, MAX_HANDSHAKES])
    // One more is answered, with nothing in the body, and is never a WebSocket.
    expect(yield* exchange(server.base, MACHINE_LINK_PATH, websocket)).toBe(
      "HTTP/1.1 503 Service Unavailable\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
    )
    expect(server.sockets.clients.size).toBe(MAX_HANDSHAKES)

    // Places change hands: the ones holding them are refused while twice as many ask for one.
    const asking = yield* Effect.forkChild(
      Effect.forEach(
        Array.from({ length: 2 * MAX_HANDSHAKES }),
        () =>
          Effect.scoped(
            Effect.gen(function* () {
              const stranger = yield* dial(server.url)
              if (!stranger.opened) return false
              yield* stranger.send(randomBytes(100))
              yield* stranger.closed
              return true
            }),
          ),
        { concurrency: 2 * MAX_HANDSHAKES },
      ),
      { startImmediately: true },
    )
    yield* Effect.forEach(admitted, (stranger) => Effect.andThen(stranger.send(randomBytes(100)), stranger.closed), {
      concurrency: "unbounded",
    })
    expect((yield* Fiber.join(asking)).filter((opened) => opened).length).toBeGreaterThan(0)
    // Counted as each was about to be added, when the endpoint's sockets were the most they had been.
    expect(server.most()).toBe(MAX_HANDSHAKES)

    // The same for handshakes begun, which find every place free again: the one past the last is turned away with the
    // clock where it was, and the ones that never finish give their places back when their time is up. Each has the
    // home's answer to its first message, which the home sends with that time already running.
    const begun = yield* handshakes(server.url)
    expect(begun.length).toBe(MAX_HANDSHAKES)
    yield* TestClock.adjust("10 seconds")
    expect(yield* Effect.forEach(begun, (peer) => peer.closed)).toEqual(begun.map(() => CLOSED))
    yield* idle(server)
  }),
)

it.live("closes the socket of a machine removed while it is connected", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const identity = Identity.fromSeed(randomBytes(32))
    const gpu = yield* worker(server.url, server.machines, { home: printed.home, identity, secret: printed.secret })
    yield* server.machines.remove(id)
    expect(yield* gpu.sockets[0].closed).toEqual(CLOSED)
    expect(yield* server.machines.list()).toEqual([])

    // Its key is gone with it.
    const again = yield* dial(server.url)
    expect(yield* Link.connect(again, { home: printed.home, identity }).pipe(Effect.flip)).toEqual(new Link.Refused())
    expect(yield* again.closed).toEqual(CLOSED)
    yield* idle(server)
  }),
)

it.live("serves a machine's second connection in place of its first", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const identity = Identity.fromSeed(randomBytes(32))
    const first = yield* worker(server.url, server.machines, { home: printed.home, identity, secret: printed.secret })
    const offline = { seen: false }
    const watching = yield* Effect.forkChild(
      Effect.forever(
        Effect.andThen(
          Effect.map(online(server.machines), (ids) => {
            if (ids.length === 0) offline.seen = true
          }),
          turn,
        ),
      ),
      { startImmediately: true },
    )
    // The same worker dialing again while the home still holds its first connection, which nothing has ended.
    const second = yield* worker(server.url, server.machines, { home: printed.home, identity })
    expect(yield* first.sockets[0].closed).toEqual(CLOSED)
    yield* idle(server, 1)
    yield* Fiber.interrupt(watching)
    expect([offline.seen, yield* online(server.machines)]).toEqual([false, [id]])

    const environment = yield* server.machines.get(id)
    const handle = yield* environment.spawner.spawn(ChildProcess.make("/bin/echo", ["on the second"], { cwd: "/work" }))
    expect(first.fake.runs).toEqual([])
    const run = second.fake.runs[0]
    yield* run.print("on the second\n")
    yield* run.exit(0)
    expect(yield* Stream.mkString(Stream.decodeText(handle.all))).toBe("on the second\n")
    expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
  }),
)

it.live("leaves no socket and no handshake behind, whichever side ends a connection and when", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const gone = until(Effect.sync(() => server.sockets.clients.size === 0))
    // Before the handshake: a stranger that closes, one that vanishes, and one whose WebSocket handshake is refused.
    yield* Effect.scoped(Effect.asVoid(dial(server.url)))
    yield* gone
    yield* Effect.scoped(Effect.map(mute(server.url), (stranger) => stranger.destroy()))
    yield* gone
    const refused = yield* exchange(server.base, MACHINE_LINK_PATH, { Connection: "Upgrade", Upgrade: "websocket" })
    expect(refused.split("\r\n")[0]).toBe("HTTP/1.1 400 Bad Request")
    // A place any of the three had kept would be missing here.
    yield* idle(server)

    // After it: a machine that closes, and one that vanishes.
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const identity = Identity.fromSeed(randomBytes(32))
    const offline = until(Effect.map(online(server.machines), (ids) => ids.length === 0))
    const closing = yield* worker(server.url, server.machines, { home: printed.home, identity, secret: printed.secret })
    yield* closing.fake.cut
    yield* offline
    yield* gone
    const vanishing = new NodeWS.WebSocket(server.url)
    yield* worker(server.url, server.machines, { home: printed.home, identity }, () => vanishing)
    vanishing.terminate()
    yield* offline
    yield* idle(server)
  }),
)

it.effect("gives a machine five seconds to answer the close, and a stranger none", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const stranger = yield* mute(server.url)
    yield* until(Effect.sync(() => server.waits("Link.serve", "10 seconds") === 1))
    const received: Array<Buffer> = []
    stranger.on("data", (chunk) => received.push(chunk))
    const dropped = once(stranger, "close")
    yield* TestClock.adjust("10 seconds")
    // The clock stays where the deadline was: the connection ends with the close, not after a wait for its answer.
    yield* Effect.promise(() => dropped)
    // The close frame, 1008 with no reason, and nothing after it: the route's HTTP response found no connection to
    // be written to.
    expect([...Buffer.concat(received)]).toEqual([0x88, 0x02, 0x03, 0xf0])
    yield* idle(server)

    // A machine that stops reading, so the close the home sends it when it is removed goes unanswered.
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const client = new NodeWS.WebSocket(server.url)
    const gpu = yield* worker(
      server.url,
      server.machines,
      { home: printed.home, identity: Identity.fromSeed(randomBytes(32)), secret: printed.secret },
      () => client,
    )
    const [linked] = [...server.sockets.clients]
    client.pause()
    yield* server.machines.remove(id)
    // Closing, which the home's socket is from the moment the home sends the close and begins to wait for the answer.
    yield* until(Effect.sync(() => linked.readyState === linked.CLOSING))
    yield* TestClock.adjust("4999 millis")
    expect([linked.readyState, server.sockets.clients.size]).toEqual([linked.CLOSING, 1])
    yield* TestClock.adjust("1 millis")
    yield* idle(server)
    // What the machine finds when it reads again is the close, and the end of the connection.
    client.resume()
    expect(yield* gpu.sockets[0].closed).toEqual(CLOSED)
  }),
)

it.effect("closes every link as the server begins to stop, without waiting out what it gives open connections", () =>
  Effect.gen(function* () {
    // The whole server, with a peer that has only connected. Nothing here moves the clock, so neither its ten seconds
    // nor the server's twenty can pass.
    const process = yield* Scope.fork(yield* Effect.scope)
    const directory = (yield* tmpdirScoped("opencode-machine-link-")).path
    const started = yield* ServerProcess.start<never, never>({
      ...options(directory, true),
      hostname: "127.0.0.1",
      port: 0,
    }).pipe(Scope.provide(process))
    const peer = yield* dial(link(HttpServer.formatAddress(started.address)))
    expect(peer.opened).toBe(true)
    yield* Scope.close(process, Exit.void)
    expect(yield* peer.closed).toEqual(CLOSED)

    // The routes, with a machine connected.
    const routes = yield* Scope.fork(yield* Effect.scope)
    const server = yield* home().pipe(Scope.provide(routes))
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const gpu = yield* worker(server.url, server.machines, {
      home: printed.home,
      identity: Identity.fromSeed(randomBytes(32)),
      secret: printed.secret,
    })
    yield* Scope.close(routes, Exit.void)
    expect(yield* gpu.sockets[0].closed).toEqual(CLOSED)
    expect(server.sockets.clients.size).toBe(0)
  }),
)

it.effect("stops a second after it begins to, however many peers leave the close unanswered", () =>
  Effect.gen(function* () {
    const routes = yield* Scope.fork(yield* Effect.scope)
    const server = yield* home().pipe(Scope.provide(routes))
    // A machine that has stopped reading, and strangers that never read: none of them answers a close.
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const client = new NodeWS.WebSocket(server.url)
    yield* worker(
      server.url,
      server.machines,
      { home: printed.home, identity: Identity.fromSeed(randomBytes(32)), secret: printed.secret },
      () => client,
    )
    client.pause()
    const strangers = yield* Effect.forEach(Array.from({ length: 5 }), () => mute(server.url))
    const closes = strangers.map((stranger) => once(stranger, "data"))
    const dropped = strangers.map((stranger) => once(stranger, "close"))
    expect(server.sockets.clients.size).toBe(6)

    const stopping = yield* Effect.forkChild(Scope.close(routes, Exit.void), { startImmediately: true })
    // Each is sent the close as the routes begin to stop, and has the one second from then.
    expect((yield* Effect.promise(() => Promise.all(closes))).map(([frame]) => [...frame])).toEqual(
      strangers.map(() => [0x88, 0x02, 0x03, 0xf0]),
    )
    yield* TestClock.adjust("999 millis")
    expect([stopping.pollUnsafe(), server.sockets.clients.size]).toEqual([undefined, 6])
    yield* TestClock.adjust("1 millis")
    yield* Fiber.join(stopping)
    yield* Effect.promise(() => Promise.all(dropped))
    expect(server.sockets.clients.size).toBe(0)
  }),
)

it.effect("keeps a quiet link while its pings are answered, and drops it when they are not", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    // This peer answers a ping when the test says so, and the test waits for the home to have the answer.
    const client = new NodeWS.WebSocket(server.url, { autoPong: false })
    const first = pinged(client, 1)
    const gpu = yield* worker(
      server.url,
      server.machines,
      { home: printed.home, identity: Identity.fromSeed(randomBytes(32)), secret: printed.secret },
      () => client,
    )
    yield* Effect.promise(() => first)
    const [linked] = [...server.sockets.clients]
    // Nothing else is sent on this link once it is up, so the home pings again only because the last ping was answered.
    for (const _ of ["second", "third", "fourth"]) {
      const answered = once(linked, "pong")
      client.pong()
      yield* Effect.promise(() => answered)
      const next = pinged(client, 1)
      yield* TestClock.adjust("30 seconds")
      yield* Effect.promise(() => next)
    }
    // The fourth goes unanswered, as every ping to a peer that is gone does.
    yield* TestClock.adjust("29999 millis")
    expect([yield* online(server.machines), server.sockets.clients.size]).toEqual([[id], 1])
    yield* TestClock.adjust("1 millis")
    // Dropped, not closed: no close frame reaches a peer that is gone.
    expect((yield* gpu.sockets[0].closed).code).toBe(1006)
    yield* until(Effect.map(online(server.machines), (ids) => ids.length === 0))
    yield* idle(server)
  }),
)

it.effect("keeps a link whose peer keeps sending though it answers no ping, and drops it once it is silent", () =>
  Effect.gen(function* () {
    const server = yield* home()
    const id = yield* server.machines.add("gpu")
    const printed = yield* invite(server.machines, id)
    const unanswering = new NodeWS.WebSocket(server.url, { autoPong: false })
    const first = pinged(unanswering, 1)
    const gpu = yield* worker(
      server.url,
      server.machines,
      { home: printed.home, identity: Identity.fromSeed(randomBytes(32)), secret: printed.secret },
      () => unanswering,
    )
    yield* Effect.promise(() => first)
    const files = (yield* server.machines.get(id)).files
    for (const minute of ["first", "second", "third"]) {
      // The worker's reply is something from the peer since the last ping.
      yield* files.write("/note", new TextEncoder().encode(minute))
      const next = pinged(unanswering, 1)
      yield* TestClock.adjust("30 seconds")
      yield* Effect.promise(() => next)
    }
    yield* TestClock.adjust("29999 millis")
    expect(yield* online(server.machines)).toEqual([id])
    yield* TestClock.adjust("1 millis")
    expect((yield* gpu.sockets[0].closed).code).toBe(1006)
    yield* until(Effect.map(online(server.machines), (ids) => ids.length === 0))
    yield* idle(server)
  }),
)

it.effect("on a real socket, returns from a send when the peer has taken it and drops a peer that takes nothing", () =>
  Effect.gen(function* () {
    const { client, transport } = yield* pair()
    const socket = yield* Socket.fromWebSocket(Effect.succeed(transport))
    const link = carrier(yield* socket.reader, transport)
    const received = { bytes: 0 }
    client.on("message", (data: Buffer) => {
      received.bytes += data.length
    })
    // 64 MiB, more than the connection holds between the two: while the client reads nothing, not all of it is taken.
    const frame = new Uint8Array(65_535)
    const frames = Array.from({ length: 1024 }, () => frame)
    const send = Effect.forkChild(Effect.forEach(frames, link.send, { discard: true }), { startImmediately: true })

    client.pause()
    const held = yield* send
    yield* until(Effect.sync(() => transport.bufferedAmount > 0))
    expect(held.pollUnsafe()).toBeUndefined()
    client.resume()
    yield* Fiber.join(held)
    expect(transport.bufferedAmount).toBe(0)
    yield* until(Effect.sync(() => received.bytes === frames.length * frame.length))

    // A minute passes only once bytes wait in the socket behind a client that reads nothing: a send still on its way
    // there is not one the peer is failing to take. A minute in which the connection took some more is not the last.
    client.pause()
    const stalled = yield* send
    const minutes: Array<number> = []
    while (transport.readyState === transport.OPEN) {
      yield* until(Effect.sync(() => transport.bufferedAmount > 0))
      expect(stalled.pollUnsafe()).toBeUndefined()
      minutes.push(transport.bufferedAmount)
      yield* TestClock.adjust("60 seconds")
    }
    expect(minutes.every((waiting) => waiting > 0)).toBe(true)
    yield* Fiber.join(stalled)
    expect(yield* link.receive.pipe(Effect.flip)).toEqual(new Link.Closed())
  }),
)

it.live("on a real socket, drops a peer on the first frame shorter than a frame can be", () =>
  Effect.gen(function* () {
    // What the reader would be handed, heard after the endpoint's own listener as the reader hears it.
    const flooded = yield* pair()
    const handed = { frames: 0 }
    flooded.transport.on("message", () => {
      handed.frames++
    })
    const closed = once(flooded.client, "close")
    // Frames of no bytes never stop the reader, which counts the bytes that wait.
    Array.from({ length: 2_000 }).forEach(() => flooded.client.send(new Uint8Array(0)))
    yield* Effect.promise(() => closed)
    yield* until(Effect.sync(() => flooded.transport.readyState === flooded.transport.CLOSED))
    expect(handed.frames).toBe(1)

    // A frame of sixteen bytes is let through, and one of fifteen is the last.
    const exact = yield* pair()
    const lengths: Array<number> = []
    exact.transport.on("message", (data: Buffer) => lengths.push(data.length))
    const ended = once(exact.client, "close")
    for (const length of [16, 16, 15, 16]) exact.client.send(new Uint8Array(length))
    yield* Effect.promise(() => ended)
    yield* until(Effect.sync(() => exact.transport.readyState === exact.transport.CLOSED))
    expect(lengths).toEqual([16, 16, 15])
  }),
)

// The carrier and the keepalive on their own, over a socket the test controls: a real socket cannot be told how much to
// take or when its reading is paused. `transport` stands for the `ws` socket and takes what was sent only when the test
// says so.
const controlled = Effect.fnUntraced(function* () {
  const inbox = yield* Queue.unbounded<NonEmptyReadonlyArray<Uint8Array | string>>()
  const unsent: Array<{ bytes: number; readonly taken: () => void }> = []
  const listeners = new Map<string, Set<() => void>>()
  const state = { pings: 0, terminated: false, paused: false }
  const transport: Transport = {
    get bufferedAmount() {
      return unsent.reduce((bytes, message) => bytes + message.bytes, 0)
    },
    get isPaused() {
      return state.paused
    },
    send: (message, taken) => {
      unsent.push({ bytes: message.length, taken })
    },
    ping: () => {
      state.pings++
    },
    on: (event, listener) => listeners.set(event, new Set([...(listeners.get(event) ?? []), listener])),
    off: (event, listener) => listeners.get(event)?.delete(listener),
    terminate: () => {
      state.terminated = true
    },
  }
  return {
    inbox,
    transport,
    state,
    /** Something of this kind arrives from the peer. */
    hear: (event: string) => listeners.get(event)?.forEach((listener) => listener()),
    listening: () => [...listeners.values()].reduce((count, heard) => count + heard.size, 0),
    /** The peer takes `bytes` of the oldest message still unsent. */
    take: (bytes: number) => {
      unsent[0].bytes -= bytes
      if (unsent[0].bytes === 0) unsent.shift()?.taken()
    },
    carrier: carrier({ pull: Queue.take(inbox), upgrade: Socket.SocketUpgradeError.unsupported }, transport),
  }
})

it.live("hands over binary messages in order and ends on a text message or a flood", () =>
  Effect.gen(function* () {
    const socket = yield* controlled()
    const largest = new Uint8Array(65_535).fill(7)
    Queue.offerUnsafe(socket.inbox, [Uint8Array.of(1), largest])
    Queue.offerUnsafe(socket.inbox, [Uint8Array.of(3)])
    expect(yield* socket.carrier.receive).toEqual(Uint8Array.of(1))
    expect(yield* socket.carrier.receive).toBe(largest)
    expect(yield* socket.carrier.receive).toEqual(Uint8Array.of(3))

    const ended = yield* controlled()
    Queue.offerUnsafe(ended.inbox, ["text"])
    expect(yield* ended.carrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())

    // More waiting than a whole message is more than the socket should ever have let in.
    const flooded = yield* controlled()
    const frames = Array.from({ length: Math.ceil(Frames.MAX_MESSAGE / largest.length) }, () => largest)
    Queue.offerUnsafe(flooded.inbox, [largest, ...frames])
    expect(yield* flooded.carrier.receive.pipe(Effect.flip)).toEqual(new Link.Closed())
    const full = yield* controlled()
    Queue.offerUnsafe(full.inbox, [largest, ...frames.slice(2)])
    expect(yield* full.carrier.receive).toBe(largest)

    // A read with nothing to take can be interrupted.
    const reading = yield* Effect.forkChild(socket.carrier.receive, { startImmediately: true })
    yield* Fiber.interrupt(reading)
  }),
)

it.effect("holds a send until the socket has taken it, and drops a socket that takes nothing for a minute", () =>
  Effect.gen(function* () {
    const socket = yield* controlled()
    const frame = new Uint8Array(2_000)
    const send = () => Effect.forkChild(socket.carrier.send(frame), { startImmediately: true })

    // Nothing more is sent while the socket still holds this one, however long a peer that is reading takes.
    const first = yield* send()
    yield* TestClock.adjust("59 seconds")
    socket.take(1_000)
    yield* TestClock.adjust("59 seconds")
    expect([first.pollUnsafe(), socket.transport.bufferedAmount]).toEqual([undefined, 1_000])
    socket.take(1_000)
    yield* Fiber.join(first)

    // A minute in which the peer took something starts another; one in which it took nothing is the last.
    const stalled = yield* send()
    yield* TestClock.adjust("59 seconds")
    socket.take(1)
    yield* TestClock.adjust("1 seconds")
    yield* TestClock.adjust("59999 millis")
    expect([stalled.pollUnsafe(), socket.state.terminated]).toEqual([undefined, false])
    yield* TestClock.adjust("1 millis")
    yield* Fiber.join(stalled)
    expect(socket.state.terminated).toBe(true)

    // A send that is waiting can be interrupted.
    const waiting = yield* send()
    yield* Fiber.interrupt(waiting)
  }),
)

it.effect("pings every interval and drops the socket once one passes with nothing from the peer", () =>
  Effect.gen(function* () {
    const socket = yield* controlled()
    const fiber = yield* Effect.forkChild(keepalive(socket.transport), { startImmediately: true })
    expect(socket.state.pings).toBe(1)
    socket.hear("pong")
    yield* TestClock.adjust("29999 millis")
    expect(socket.state.pings).toBe(1)
    yield* TestClock.adjust("1 millis")
    expect(socket.state.pings).toBe(2)

    // Anything else from the peer counts as its answer does.
    for (const event of ["message", "ping"]) {
      socket.hear(event)
      yield* TestClock.adjust("30 seconds")
    }
    expect([socket.state.pings, socket.state.terminated]).toEqual([4, false])

    // Nothing the peer sends can be seen while reading is paused, so an interval that ends paused is not held against
    // it, nor is one that began paused: here reading resumes a millisecond before the interval is up, too late for
    // the answer to its ping to have been read.
    socket.state.paused = true
    yield* TestClock.adjust("30 seconds")
    expect([socket.state.pings, socket.state.terminated]).toEqual([5, false])
    yield* TestClock.adjust("29999 millis")
    socket.state.paused = false
    yield* TestClock.adjust("1 millis")
    expect([socket.state.pings, socket.state.terminated]).toEqual([6, false])

    // The interval after it was read from start to end, and is the peer's to answer.
    yield* TestClock.adjust("29999 millis")
    expect([socket.state.pings, socket.state.terminated]).toEqual([6, false])
    yield* TestClock.adjust("1 millis")
    yield* Fiber.join(fiber)
    expect([socket.state.pings, socket.state.terminated, socket.listening()]).toEqual([6, true, 0])
  }),
)
