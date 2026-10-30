import { expect } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { makeDaemonTransport } from "../src/persistent-pty/daemon"
import { listen, pong, temporaryDirectory, terminal, writeRegistration } from "./fixture/persistent-pty-daemon"
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
      return request.op === "list" ? { type: "terminals", terminals: [] } : { type: "ok" }
    })
    yield* Effect.promise(() => writeRegistration(directory, socketPath, instance, token))
    const daemon = yield* makeDaemonTransport(root, "daemon")
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
    const { root, directory } = yield* temporaryRuntime()
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

it.live("retries a start-required request when connection fails before dispatch", () =>
  Effect.gen(function* () {
    const { root, directory } = yield* temporaryRuntime()
    const firstSocket = path.join(directory, "first.sock")
    const secondSocket = path.join(directory, "second.sock")
    const first = yield* listen(firstSocket, (_socket, request) => {
      if (request.op === "ping") return pong
      return { type: "terminals", terminals: [] }
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
        JSON.stringify({ instance_id: "old", pid: existing.pid, protocol: 6, socket: "/unused", token: "old" }),
      ),
    )
    const daemon = yield* makeDaemonTransport(root, "daemon", () => Promise.resolve("/missing/opencode-pty"))

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

it.live("moves an inherited legacy registration into the runtime root and keeps its lock file", () =>
  Effect.gen(function* () {
    const base = yield* temporaryDirectory()
    const legacy = path.join(base, "legacy", "inherited")
    const socketPath = path.join(base, "daemon.sock")
    yield* listen(socketPath, (_socket, request) => {
      if (request.op === "ping") return pong
      return { type: "terminals", terminals: [] }
    })
    yield* Effect.promise(async () => {
      await mkdir(legacy, { recursive: true })
      await writeFile(path.join(legacy, "service.lock"), "")
      await writeRegistration(legacy, socketPath)
    })
    const lock = yield* Effect.promise(() => stat(path.join(legacy, "service.lock")))
    const daemon = yield* makeDaemonTransport(path.join(base, "root"), "fresh", undefined, {
      directory: legacy,
      instanceID: "test",
      ticket: "ticket",
      expiresAt: Date.now() + 60_000,
    })

    const migrated = path.join(base, "root", "inherited")
    expect(existsSync(path.join(legacy, "service.json"))).toBeFalse()
    expect((yield* Effect.promise(() => stat(path.join(migrated, "service.lock")))).ino).toBe(lock.ino)
    expect(existsSync(path.join(migrated, "service.json"))).toBeTrue()
    expect(yield* daemon.request({ op: "list" })).toEqual({ type: "terminals", terminals: [] })
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

function temporaryRuntime() {
  return Effect.gen(function* () {
    const root = yield* temporaryDirectory()
    const directory = path.join(root, "daemon")
    yield* Effect.promise(() => mkdir(directory))
    return { root, directory }
  })
}
