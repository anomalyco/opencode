import { expect } from "bun:test"
import { isConflictError, isForbiddenError, isInvalidRequestError, OpenCode } from "@opencode/client"
import { Identity } from "@opencode/core/machine/identity"
import { Machine } from "@opencode/core/machine/index"
import { Iroh } from "@opencode/core/machine/iroh"
import loadBinding from "@opencode/core/machine/iroh-binding"
import { Join } from "@opencode/core/machine/join"
import { Link } from "@opencode/core/machine/link"
import { MACHINE_LINK_PATH } from "@opencode/protocol/groups/machine"
import { Cause, Effect, Option, Queue } from "effect"
import { HttpServer } from "effect/http"
import { randomBytes } from "node:crypto"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

const authorization = `Basic ${btoa("opencode:secret")}`

const start = Effect.fnUntraced(function* (machines: boolean) {
  const directory = (yield* tmpdirScoped("opencode-machine-routes-")).path
  const started = yield* ServerProcess.start<never, never>({
    password: "secret",
    app: { version: "test-version" },
    database: { path: ":memory:" },
    models: { fetch: false },
    config: { directory, project: false, content: JSON.stringify({ experimental: { machines } }) },
    fs: { filewatcher: false },
    hostname: "127.0.0.1",
    port: 0,
  }).pipe(Effect.provideService(Iroh.Testing, { offline: true, load: loadBinding, watch: () => {} }))
  const base = HttpServer.formatAddress(started.address)
  const link = new URL(MACHINE_LINK_PATH, base)
  link.protocol = "ws:"
  return {
    base,
    link,
    api: OpenCode.make({ baseUrl: base, headers: { authorization } }),
  }
})

const dial = Effect.fnUntraced(function* (url: URL) {
  const messages = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const opened = Promise.withResolvers<boolean>()
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const socket = Object.assign(new WebSocket(url), { binaryType: "arraybuffer" })
      socket.addEventListener("open", () => opened.resolve(true))
      socket.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) Queue.offerUnsafe(messages, new Uint8Array(event.data))
      })
      socket.addEventListener("close", () => {
        Queue.endUnsafe(messages)
        opened.resolve(false)
      })
      return socket
    }),
    (socket) => Effect.sync(() => socket.close()),
  )
  expect(yield* Effect.promise(() => opened.promise)).toBe(true)
  return {
    receive: Queue.take(messages).pipe(Effect.mapError(() => new Link.Closed())),
    send: (message: Uint8Array) => Effect.sync(() => socket.send(new Uint8Array(message))),
  }
})

it.live("adds, invites, lists, protects paired machines, and removes machines", () =>
  Effect.gen(function* () {
    const server = yield* start(true)
    const reach = [
      { type: "url" as const, url: "wss://example.com/api/experimental/machine/link" },
      { type: "url" as const, url: server.link.href },
    ]

    // Every management route requires the server password.
    const responses = yield* Effect.promise(() =>
      Promise.all([
        fetch(`${server.base}/api/experimental/machine`),
        fetch(`${server.base}/api/experimental/machine`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "gpu", reach }),
        }),
        fetch(`${server.base}/api/experimental/machine/gpu`, { method: "DELETE" }),
      ]),
    )
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401])

    expect(yield* Effect.promise(() => server.api.experimental.machine.list())).toEqual([])

    // Invalid names return a 400 InvalidRequestError.
    const invalid = yield* Effect.promise(() =>
      server.api.experimental.machine.add({ name: "local", reach }).then(
        () => undefined,
        (error) => error,
      ),
    )
    expect(isInvalidRequestError(invalid)).toBe(true)
    expect(invalid).toMatchObject({ _tag: "InvalidRequestError", kind: "invalid_name", field: "name" })

    // Adding creates the machine and returns a join string whose expiry and reach match Join.decode.
    const first = yield* Effect.promise(() => server.api.experimental.machine.add({ name: "gpu", reach }))
    const decoded = Option.getOrThrow(Join.decode(first.join))
    expect(first.name).toBe("gpu")
    expect(first.expires).toBe(decoded.expires)
    // The home's Iroh endpoint is bound by the first join string, which puts it ahead of the URLs.
    expect(decoded.reach).toEqual([{ type: "iroh" }, ...reach])
    expect(first.reach).toEqual(decoded.reach)
    expect(yield* Effect.promise(() => server.api.experimental.machine.list())).toEqual([
      { id: "gpu", online: false, paired: false },
    ])

    // Adding an unpaired machine again issues a fresh join string.
    const second = yield* Effect.promise(() => server.api.experimental.machine.add({ name: "gpu", reach }))
    expect(second.join).not.toBe(first.join)
    const latest = Option.getOrThrow(Join.decode(second.join))

    // Pair the machine over the real WebSocket link.
    yield* Effect.scoped(
      Effect.gen(function* () {
        const socket = yield* dial(server.link)
        const linked = yield* Link.connect(socket, {
          home: latest.home,
          identity: Identity.fromSeed(randomBytes(32)),
          secret: latest.secret,
        })
        linked.send({
          type: "hello",
          protocol: 3,
          os: "linux",
          arch: "x64",
          home: "/home/worker",
          instance: Machine.Instance.make(crypto.randomUUID()),
          processes: [],
        })
        yield* Effect.gen(function* () {
          while (true) {
            const listed = yield* Effect.promise(() => server.api.experimental.machine.list())
            if (listed[0].online) {
              expect(listed[0].connection).toEqual({ kind: "websocket" })
              return
            }
            yield* Effect.sleep("10 millis")
          }
        }).pipe(Effect.timeout("3 seconds"))
      }),
    )

    // Once paired, add without replace returns 409 ConflictError; replace: true issues a new invite.
    const conflict = yield* Effect.promise(() =>
      server.api.experimental.machine.add({ name: "gpu", reach }).then(
        () => undefined,
        (error) => error,
      ),
    )
    expect(isConflictError(conflict)).toBe(true)
    expect(conflict).toMatchObject({ _tag: "ConflictError", resource: "gpu" })

    const replaced = yield* Effect.promise(() =>
      server.api.experimental.machine.add({ name: "gpu", reach, replace: true }),
    )
    expect(replaced.join).not.toBe(second.join)
    expect(Option.isSome(Join.decode(replaced.join))).toBe(true)

    // Removing deletes the machine; removing it again, or any unknown name, is 404 MachineNotFoundError.
    yield* Effect.promise(() => server.api.experimental.machine.remove({ name: "gpu" }))
    expect(yield* Effect.promise(() => server.api.experimental.machine.list())).toEqual([])
    for (const name of ["gpu", "unknown"]) {
      const missing = yield* Effect.promise(() =>
        server.api.experimental.machine.remove({ name }).then(
          () => undefined,
          (error) => error,
        ),
      )
      expect(missing).toMatchObject({ _tag: "MachineNotFoundError", machine: name })
    }
  }),
)

it.live("rejects every machine management route with 403 ForbiddenError while machines are off", () =>
  Effect.gen(function* () {
    const server = yield* start(false)
    const results = yield* Effect.promise(() =>
      Promise.all(
        [
          server.api.experimental.machine.list(),
          server.api.experimental.machine.add({ name: "gpu", reach: [] }),
          server.api.experimental.machine.remove({ name: "gpu" }),
        ].map((call) =>
          call.then(
            () => undefined,
            (error) => error,
          ),
        ),
      ),
    )
    expect(results.map(isForbiddenError)).toEqual([true, true, true])
  }),
)
