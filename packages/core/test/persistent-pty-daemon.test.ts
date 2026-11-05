import { expect } from "bun:test"
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { makeDaemonTransport } from "../src/persistent-pty/daemon"
import { frame, listen, pong, temporaryDirectory, terminal, writeRegistration } from "./fixture/persistent-pty-daemon"
import { it } from "./lib/effect"

it.live("rediscovers a same-protocol daemon after its registration rotates", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = path.join(directory, "daemon.sock")
    let token = "old-token"
    let instance = "old-instance"
    let creates = 0
    yield* listen(socketPath, (_socket, request, receivedToken) => {
      if (receivedToken !== token) return { type: "error", message: "authentication failed" }
      if (request.op === "ping") return { ...pong, instance_id: instance }
      if (request.op === "create") creates++
      return request.op === "list" ? { type: "processes", processes: [] } : { type: "ok" }
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath, instance, token))
    const daemon = yield* makeDaemonTransport(root, "daemon")
    yield* daemon.request({ op: "list" })

    token = "new-token"
    instance = "new-instance"
    yield* Effect.promise(() => writeRegistration(directory, socketPath, instance, token))

    const running = yield* daemon.requestIfRunning({ op: "list" })
    expect(running).toEqual({ type: "processes", processes: [] })

    token = "newest-token"
    instance = "newest-instance"
    yield* Effect.promise(() => writeRegistration(directory, socketPath, instance, token))
    yield* daemon.request({ op: "create" }, true)
    expect(creates).toBe(1)
  }),
)

it.live("rediscovers a rotated registration when acquiring a subscription", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = path.join(directory, "daemon.sock")
    let token = "old-token"
    let instance = "old-instance"
    let subscriptions = 0
    yield* listen(socketPath, (_socket, request, receivedToken) => {
      if (receivedToken !== token) return { type: "error", message: "authentication failed" }
      if (request.op === "ping") return { ...pong, instance_id: instance }
      if (request.op !== "subscribe") return { type: "processes", processes: [] }
      subscriptions++
      return {
        type: "attached",
        process: terminal(1),
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
    const daemon = yield* makeDaemonTransport(root, "daemon")
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

it.live("waits on its own connection until the process exits", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = path.join(directory, "daemon.sock")
    const waiting: net.Socket[] = []
    yield* listen(socketPath, (socket, request) => {
      if (request.op === "ping") return pong
      if (request.op === "wait" && request.id === 1) {
        waiting.push(socket)
        return undefined
      }
      return { type: "error", message: "terminal 2 not found" }
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    const daemon = yield* makeDaemonTransport(root, "daemon")

    const missing = yield* Effect.flip(daemon.wait(2))
    expect(missing).toMatchObject({ kind: "request", message: "terminal 2 not found" })

    const fiber = yield* daemon.wait(1).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* poll(() => waiting.length === 1)
    waiting[0].end(
      frame({ type: "exited", exit_code: null, signal: "SIGTERM", final_offset: 3, output_lines: 1, exited_at: 7 }),
    )
    expect(yield* Fiber.join(fiber)).toEqual({
      type: "exited",
      exit_code: null,
      signal: "SIGTERM",
      final_offset: 3,
      output_lines: 1,
      exited_at: 7,
    })
  }),
)

it.live("closes the wait connection when the wait is interrupted", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = path.join(directory, "daemon.sock")
    const waiting: net.Socket[] = []
    yield* listen(socketPath, (socket, request) => {
      if (request.op === "ping") return pong
      waiting.push(socket)
      return undefined
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    const daemon = yield* makeDaemonTransport(root, "daemon")

    const fiber = yield* daemon.wait(1).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* poll(() => waiting.length === 1)
    const closed = new Promise<void>((resolve) => waiting[0].once("close", () => resolve()))
    yield* Fiber.interrupt(fiber)
    yield* Effect.promise(() => closed)
  }),
)

it.live("reports a daemon that goes away during a wait as unreachable", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = path.join(directory, "daemon.sock")
    yield* listen(socketPath, (socket, request) => {
      if (request.op === "ping") return pong
      socket.destroy()
      return undefined
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    const daemon = yield* makeDaemonTransport(root, "daemon")

    expect((yield* Effect.flip(daemon.wait(1))).kind).toBe("connect")
  }),
)

it.live("retries a start-required request when connection fails before dispatch", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const firstSocket = path.join(directory, "first.sock")
    const secondSocket = path.join(directory, "second.sock")
    const first = yield* listen(firstSocket, (_socket, request) => {
      if (request.op === "ping") return pong
      return { type: "processes", processes: [] }
    })
    yield* Effect.promise(() => writeRegistration(directory, firstSocket))
    const daemon = yield* makeDaemonTransport(root, "daemon")
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
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = path.join(directory, "daemon.sock")
    let creates = 0
    yield* listen(socketPath, (socket, request) => {
      if (request.op === "ping") return pong
      creates++
      socket.destroy()
      return undefined
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    const daemon = yield* makeDaemonTransport(root, "daemon")
    const error = yield* Effect.flip(daemon.request({ op: "create" }, true))

    expect(error.kind).toBe("response")
    expect(creates).toBe(1)
  }),
)

it.live("rejects incompatible daemons without replacing or killing them", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
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
        JSON.stringify({
          instance_id: "old",
          pid: existing.pid,
          protocol: 7,
          socket: "/unused",
          token: "old",
          features: [],
        }),
      ),
    )
    const daemon = yield* makeDaemonTransport(root, "daemon", () => Promise.resolve("/missing/opencode-pty"))

    const optional = yield* Effect.flip(daemon.requestIfRunning({ op: "list" }))
    expect(optional).toMatchObject({
      kind: "protocol",
      message: "opencode-pty protocol mismatch: daemon=7, client=8",
      pid: existing.pid,
    })

    const starting = yield* Effect.flip(daemon.request({ op: "create" }, true))
    expect(starting).toEqual(optional)
    expect(existing.exitCode).toBeNull()
    expect(existing.signalCode).toBeNull()
    expect(process.kill(existing.pid, 0)).toBeTrue()
  }),
)

it.live("starts fresh instead of failing when an inherited registration is gone or expired", () =>
  Effect.gen(function* () {
    const base = yield* temporaryDirectory()
    const legacy = path.join(base, "legacy")
    yield* Effect.promise(() => mkdir(legacy))
    for (const expiresAt of [Date.now() + 60_000, Date.now() - 1]) {
      const daemon = yield* makeDaemonTransport(path.join(base, "root"), "fresh", undefined, {
        directory: legacy,
        instanceID: "test",
        ticket: "ticket",
        expiresAt,
      })
      expect(yield* daemon.handoff).toBeNull()
      expect(yield* daemon.requestIfRunning({ op: "list" })).toBeUndefined()
    }
  }),
)

it.live("stops a discovered inherited daemon when adoption fails", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const socketPath = path.join(directory, "daemon.sock")
    let shutdowns = 0
    yield* listen(socketPath, (_socket, request) => {
      if (request.op === "ping") return pong
      if (request.op === "shutdown") shutdowns++
      return { type: "ok" }
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath))
    yield* makeDaemonTransport(root, "fresh", undefined, {
      directory,
      instanceID: "replaced",
      ticket: "ticket",
      expiresAt: Date.now() + 60_000,
    })
    expect(shutdowns).toBe(1)
  }),
)

function poll(ready: () => boolean) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200 && !ready(); attempt++) yield* Effect.sleep(10)
    expect(ready()).toBeTrue()
  })
}

function temporaryRuntime() {
  return Effect.gen(function* () {
    const root = yield* temporaryDirectory()
    const directory = path.join(root, "daemon")
    yield* Effect.promise(() => mkdir(directory))
    return { root, directory }
  })
}
