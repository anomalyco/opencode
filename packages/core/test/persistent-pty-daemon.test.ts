import { expect } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { makeDaemonTransport } from "../src/persistent-pty/daemon"
import { it } from "./lib/effect"

const pong = { type: "pong", instance_id: "test", pid: process.pid, protocol: 7 }

it.live("rediscovers a same-protocol daemon after its registration rotates", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectory()
    const socketPath = path.join(directory, "daemon.sock")
    let token = "old-token"
    let instance = "old-instance"
    let creates = 0
    yield* listen(socketPath, (_socket, request, receivedToken) => {
      if (receivedToken !== token) return { type: "error", message: "authentication failed" }
      if (request.op === "ping") return { ...pong, instance_id: instance }
      if (request.op === "create") creates++
      return request.op === "list" ? { type: "terminals", terminals: [] } : { type: "ok" }
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath, instance, token))
    const daemon = yield* makeDaemonTransport(directory)
    yield* daemon.request({ op: "list" })

    token = "new-token"
    instance = "new-instance"
    yield* Effect.promise(() => writeRegistration(directory, socketPath, instance, token))

    const running = yield* daemon.requestIfRunning({ op: "list" })
    expect(running).toEqual({ type: "terminals", terminals: [] })

    token = "newest-token"
    instance = "newest-instance"
    yield* Effect.promise(() => writeRegistration(directory, socketPath, instance, token))
    yield* daemon.request({ op: "create" }, true)
    expect(creates).toBe(1)
  }),
)

it.live("rediscovers a rotated registration when acquiring a subscription", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectory()
    const socketPath = path.join(directory, "daemon.sock")
    let token = "old-token"
    let instance = "old-instance"
    let subscriptions = 0
    yield* listen(socketPath, (_socket, request, receivedToken) => {
      if (receivedToken !== token) return { type: "error", message: "authentication failed" }
      if (request.op === "ping") return { ...pong, instance_id: instance }
      if (request.op !== "subscribe") return { type: "terminals", terminals: [] }
      subscriptions++
      return {
        type: "attached",
        terminal: terminal(1),
        role: "observer",
        generation: 1,
        requested_offset: 0,
        available_offset: 0,
        end_offset: 0,
        truncated: false,
        replay_base64: "",
      }
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath, instance, token))
    const daemon = yield* makeDaemonTransport(directory)
    yield* daemon.request({ op: "list" })

    token = "new-token"
    instance = "new-instance"
    yield* Effect.promise(() => writeRegistration(directory, socketPath, instance, token))

    const attachment = yield* daemon.subscribe(1, {
      cursor: 0,
      attachmentID: "attachment",
      role: "observer",
      onEvent: () => {},
      onEnd: () => {},
    })
    expect(attachment.terminal.id).toBe(1)
    expect(subscriptions).toBe(1)
    attachment.detach()
  }),
)

it.live("retries a start-required request when connection fails before dispatch", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectory()
    const firstSocket = path.join(directory, "first.sock")
    const secondSocket = path.join(directory, "second.sock")
    const first = yield* listen(firstSocket, (_socket, request) => {
      if (request.op === "ping") return pong
      return { type: "terminals", terminals: [] }
    })
    yield* Effect.promise(() => writeRegistration(directory, firstSocket))
    const daemon = yield* makeDaemonTransport(directory)
    yield* daemon.request({ op: "list" })
    yield* Effect.promise(first.close)

    let creates = 0
    yield* listen(secondSocket, (_socket, request) => {
      if (request.op === "ping") return pong
      creates++
      return { type: "ok" }
    })
    yield* Effect.promise(() => writeRegistration(directory, secondSocket))
    yield* daemon.request({ op: "create" }, true)
    expect(creates).toBe(1)
  }),
)

it.live("does not replay a dispatched mutating request when its response is lost", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectory()
    const socketPath = path.join(directory, "daemon.sock")
    let creates = 0
    yield* listen(socketPath, (socket, request) => {
      if (request.op === "ping") return pong
      creates++
      socket.destroy()
      return undefined
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    const daemon = yield* makeDaemonTransport(directory)
    const error = yield* Effect.flip(daemon.request({ op: "create" }, true))

    expect(error.kind).toBe("response")
    expect(creates).toBe(1)
  }),
)

it.live("rejects incompatible daemons without replacing or killing them", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectory()
    const existing = yield* Effect.acquireRelease(
      Effect.sync(() => spawn("sleep", ["30"])),
      (child) =>
        Effect.promise(async () => {
          if (child.exitCode !== null || child.signalCode !== null) return
          const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
          child.kill("SIGKILL")
          await exited
        }),
    )
    if (existing.pid === undefined) throw new Error("Expected fixture process PID")
    yield* Effect.promise(() =>
      writeFile(
        path.join(directory, "service.json"),
        JSON.stringify({ instance_id: "old", pid: existing.pid, protocol: 6, socket: "/unused", token: "old" }),
      ),
    )
    const daemon = yield* makeDaemonTransport(directory, () => Promise.resolve("/missing/opencode-pty"))

    const optional = yield* Effect.flip(daemon.requestIfRunning({ op: "list" }))
    expect(optional).toMatchObject({
      kind: "protocol",
      message: "opencode-pty protocol mismatch: daemon=6, client=7",
      pid: existing.pid,
    })

    const starting = yield* Effect.flip(daemon.request({ op: "create" }, true))
    expect(starting).toEqual(optional)
    expect(existing.exitCode).toBeNull()
    expect(existing.signalCode).toBeNull()
    expect(process.kill(existing.pid, 0)).toBeTrue()
  }),
)

function temporaryDirectory() {
  return Effect.acquireRelease(
    Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "opencode-pty-test-"))),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  )
}

function listen(
  socketPath: string,
  handle: (socket: net.Socket, request: Record<string, unknown>, token: string) => object | undefined,
) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const sockets = new Set<net.Socket>()
      const server = net.createServer((socket) => {
        sockets.add(socket)
        socket.once("close", () => sockets.delete(socket))
        void readRequest(socket)
          .then((envelope) => {
            const response =
              envelope.request.op === "own" ? { type: "owned" } : handle(socket, envelope.request, envelope.token)
            if (response) socket.write(frame(response))
          })
          .catch(() => socket.destroy())
      })
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(socketPath, resolve)
      })
      return {
        close: () => {
          sockets.forEach((socket) => socket.destroy())
          return close(server)
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

function readRequest(socket: net.Socket) {
  return new Promise<Buffer>((resolve, reject) => {
    let pending = Buffer.alloc(0)
    const cleanup = () => {
      socket.off("data", onData)
      socket.off("end", onEnd)
      socket.off("error", onError)
    }
    const onData = (value: Buffer) => {
      pending = Buffer.concat([pending, value])
      if (pending.length < 4) return
      const length = pending.readUInt32BE(0)
      if (pending.length < length + 4) return
      cleanup()
      resolve(pending.subarray(4, length + 4))
    }
    const onEnd = () => {
      cleanup()
      reject(new Error("connection closed before request"))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    socket.on("data", onData)
    socket.on("end", onEnd)
    socket.on("error", onError)
  }).then((payload) => {
    const envelope: unknown = JSON.parse(payload.toString("utf8"))
    if (!isRecord(envelope) || typeof envelope.token !== "string" || !isRecord(envelope.request))
      throw new Error("Invalid test daemon envelope")
    return { token: envelope.token, request: envelope.request }
  })
}

function frame(value: object) {
  const payload = Buffer.from(JSON.stringify(value))
  const output = Buffer.allocUnsafe(payload.length + 4)
  output.writeUInt32BE(payload.length)
  payload.copy(output, 4)
  return output
}

function writeRegistration(directory: string, socket: string, instance = "test", token = "test") {
  return writeFile(
    path.join(directory, "service.json"),
    JSON.stringify({ instance_id: instance, pid: process.pid, protocol: 7, socket, token }),
  )
}

function terminal(id: number) {
  return {
    id,
    pid: null,
    title: "test",
    foreground_process: null,
    group_id: "test",
    command: ["test"],
    cwd: "/tmp",
    cols: 80,
    rows: 24,
    lifecycle: { status: "running" },
    output_head: 0,
    output_tail: 0,
  }
}

function close(server: net.Server) {
  if (!server.listening) return Promise.resolve()
  return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
