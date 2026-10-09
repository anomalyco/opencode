import { expect } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { Effect, Exit, Predicate } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { createServer, connect, type AddressInfo, type Server } from "node:net"
import { testEffect } from "../../../core/test/lib/effect"
import { SshFailure } from "./command"
import { forward, openSession } from "./session"

const it = testEffect(NodeServices.layer)

const listen = (server: Server) =>
  Effect.promise(
    () =>
      new Promise<number>((resolve) =>
        // SAFETY: a TCP server listening on a host and port reports an AddressInfo.
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
      ),
  )

// Stands in for `ssh host sh -l -s`: the session's stdin reaches a local shell.
const open = Effect.fn("test.session.open")(function* (remote: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  return yield* openSession({ target: { host: "devbox", args: [] }, env: {}, socks: 1 }).pipe(
    Effect.provideService(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) =>
        spawner.spawn(
          Predicate.isTagged(command, "StandardCommand")
            ? ChildProcess.make("sh", ["-c", remote], command.options)
            : command,
        ),
      ),
    ),
  )
})

it.live(
  "runs every bootstrap step over one connection after login output",
  Effect.gen(function* () {
    const session = yield* open("echo login banner; printf 'partial'; exec sh -s")

    expect(yield* session.run("set -eu\necho out\necho err >&2\nprintf 'no newline'")).toBe("out\nno newline")

    const failed = yield* session.run("set -eu\necho before >&2\nexit 3\necho never").pipe(Effect.flip)
    expect(failed).toBeInstanceOf(SshFailure)
    expect(failed.message).toBe("before")

    // Larger than one read, so the driver must assemble it from several pipe reads.
    const archive = new TextEncoder().encode("0123456789abcdef\n".repeat(200_000))
    expect(yield* session.run("cat", archive)).toBe(new TextDecoder().decode(archive))
    expect(yield* session.run('printf "%s" "$(cat)"', new TextEncoder().encode("stdin is per step"))).toBe(
      "stdin is per step",
    )
    expect(yield* session.run("cat")).toBe("")
  }),
)

it.live(
  "fails every step with ssh diagnostics when the connection closes",
  Effect.gen(function* () {
    const session = yield* open("echo 'user@devbox: Permission denied (password).' >&2; exit 255")
    const failed = yield* session.run("echo never").pipe(Effect.flip)
    expect(failed.message).toBe("user@devbox: Permission denied (password).")
    expect((yield* session.closed.pipe(Effect.flip)).message).toBe(failed.message)
  }),
)

it.live(
  "forwards local connections to the remote service through SOCKS",
  Effect.gen(function* () {
    const requests: string[] = []

    const service = createServer((socket) =>
      socket.on("data", (data) => {
        requests.push(data.toString())
        socket.end("pong")
      }),
    )

    // A minimal SOCKS5 server, as `ssh -D` provides: no authentication, CONNECT only.
    const socks = createServer((client) => {
      client.once("data", () => {
        client.write(Buffer.from([5, 0]))
        client.once("data", (request) => {
          const host = request.subarray(5, 5 + (request[4] ?? 0)).toString()
          const port = request.readUInt16BE(5 + (request[4] ?? 0))

          const upstream = connect(port, host, () => {
            // Coalesce the reply with service bytes to cover data after the handshake.
            client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
            client.pipe(upstream).pipe(client)
          })
        })
      })
    })

    yield* Effect.addFinalizer(() => Effect.sync(() => (service.close(), socks.close())))
    const port = yield* forward(yield* listen(socks), { host: "127.0.0.1", port: yield* listen(service) })

    const reply = yield* Effect.promise(
      () =>
        new Promise<string>((resolve) => {
          const socket = connect(port, "127.0.0.1", () => socket.write("ping"))
          const chunks: Buffer[] = []
          socket.on("data", (data) => chunks.push(data)).on("close", () => resolve(Buffer.concat(chunks).toString()))
        }),
    )

    expect(reply).toBe("pong")
    expect(requests).toEqual(["ping"])
  }),
)

it.live(
  "closes the local forward with the attempt",
  Effect.gen(function* () {
    const port = yield* Effect.scoped(forward(1, { host: "127.0.0.1", port: 1 }))

    const exit = yield* Effect.exit(
      Effect.tryPromise(
        () =>
          new Promise<void>((resolve, reject) => {
            const socket = connect(port, "127.0.0.1", () => (socket.destroy(), resolve()))
            socket.on("error", reject)
          }),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  }),
)
