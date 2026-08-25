import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { makeDaemonTransport } from "../src/persistent-pty/daemon"

const pong = { type: "pong", instance_id: "test", pid: process.pid, protocol: 6 }

test("rediscovers a same-protocol daemon after its registration rotates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-pty-registration-"))
  const socketPath = path.join(directory, "daemon.sock")
  let token = "old-token"
  let instance = "old-instance"
  let creates = 0
  const server = await listen(socketPath, (_socket, request, receivedToken) => {
    if (receivedToken !== token) return { type: "error", message: "authentication failed" }
    if (request.op === "ping") return { ...pong, instance_id: instance }
    if (request.op === "create") creates++
    return request.op === "list" ? { type: "terminals", terminals: [] } : { type: "ok" }
  })
  try {
    await writeRegistration(directory, socketPath, instance, token)
    const daemon = await Effect.runPromise(makeDaemonTransport(directory))
    await Effect.runPromise(daemon.request({ op: "list" }))

    token = "new-token"
    instance = "new-instance"
    await writeRegistration(directory, socketPath, instance, token)

    const running = await Effect.runPromise(daemon.requestIfRunning({ op: "list" }))
    expect(running).toEqual({ type: "terminals", terminals: [] })

    token = "newest-token"
    instance = "newest-instance"
    await writeRegistration(directory, socketPath, instance, token)
    await Effect.runPromise(daemon.request({ op: "create" }, true))
    expect(creates).toBe(1)
  } finally {
    await close(server)
    await rm(directory, { recursive: true, force: true })
  }
})

test("rediscovers a rotated registration when acquiring a subscription", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-pty-subscription-"))
  const socketPath = path.join(directory, "daemon.sock")
  let token = "old-token"
  let instance = "old-instance"
  let subscriptions = 0
  const server = await listen(socketPath, (_socket, request, receivedToken) => {
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
  try {
    await writeRegistration(directory, socketPath, instance, token)
    const daemon = await Effect.runPromise(makeDaemonTransport(directory))
    await Effect.runPromise(daemon.request({ op: "list" }))

    token = "new-token"
    instance = "new-instance"
    await writeRegistration(directory, socketPath, instance, token)

    const attachment = await Effect.runPromise(
      daemon.subscribe(1, {
        cursor: 0,
        attachmentID: "attachment",
        role: "observer",
        onEvent: () => {},
        onEnd: () => {},
      }),
    )
    expect(attachment.terminal.id).toBe(1)
    expect(subscriptions).toBe(1)
    attachment.detach()
  } finally {
    await close(server)
    await rm(directory, { recursive: true, force: true })
  }
})

test("retries a start-required request when connection fails before dispatch", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-pty-retry-"))
  const firstSocket = path.join(directory, "first.sock")
  const secondSocket = path.join(directory, "second.sock")
  const first = await listen(firstSocket, (_socket, request) => {
    if (request.op === "ping") return pong
    return { type: "terminals", terminals: [] }
  })
  try {
    await writeRegistration(directory, firstSocket)
    const daemon = await Effect.runPromise(makeDaemonTransport(directory))
    await Effect.runPromise(daemon.request({ op: "list" }))
    await close(first)

    let creates = 0
    const second = await listen(secondSocket, (_socket, request) => {
      if (request.op === "ping") return pong
      creates++
      return { type: "ok" }
    })
    try {
      await writeRegistration(directory, secondSocket)
      await Effect.runPromise(daemon.request({ op: "create" }, true))
      expect(creates).toBe(1)
    } finally {
      await close(second)
    }
  } finally {
    await close(first)
    await rm(directory, { recursive: true, force: true })
  }
})

test("does not replay a dispatched mutating request when its response is lost", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-pty-response-"))
  const socketPath = path.join(directory, "daemon.sock")
  let creates = 0
  const server = await listen(socketPath, (socket, request) => {
    if (request.op === "ping") return pong
    creates++
    socket.destroy()
    return undefined
  })
  try {
    await writeRegistration(directory, socketPath)
    const daemon = await Effect.runPromise(makeDaemonTransport(directory))
    const error = await Effect.runPromise(Effect.flip(daemon.request({ op: "create" }, true)))

    expect(error.kind).toBe("response")
    expect(creates).toBe(1)
  } finally {
    await close(server)
    await rm(directory, { recursive: true, force: true })
  }
})

test("reports protocol mismatches until a start-required request replaces the daemon", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-pty-mismatch-"))
  const existing = spawn("sleep", ["30"])
  const exited = new Promise<void>((resolve) => existing.once("exit", () => resolve()))
  try {
    if (existing.pid === undefined) throw new Error("Expected fixture process PID")
    await writeFile(
      path.join(directory, "service.json"),
      JSON.stringify({ instance_id: "old", pid: existing.pid, protocol: 5, socket: "/unused", token: "old" }),
    )
    const daemon = await Effect.runPromise(
      makeDaemonTransport(directory, () => Promise.resolve("/missing/opencode-pty")),
    )

    const optional = await Effect.runPromise(Effect.flip(daemon.requestIfRunning({ op: "list" })))
    expect(optional).toMatchObject({
      kind: "protocol",
      message: "opencode-pty protocol mismatch: daemon=5, client=6",
      pid: existing.pid,
    })
    expect(existing.exitCode).toBeNull()

    const starting = await Effect.runPromise(Effect.flip(daemon.request({ op: "create" }, true)))
    await exited
    expect(starting).toMatchObject({ kind: "spawn" })
    expect(existing.signalCode).toBe(process.platform === "win32" ? null : "SIGTERM")
  } finally {
    existing.kill("SIGKILL")
    await rm(directory, { recursive: true, force: true })
  }
})

function listen(
  socketPath: string,
  handle: (socket: net.Socket, request: Record<string, unknown>, token: string) => object | undefined,
) {
  const server = net.createServer((socket) => {
    void readRequest(socket)
      .then((envelope) => {
        const response = handle(socket, envelope.request, envelope.token)
        if (response) socket.write(frame(response))
      })
      .catch(() => socket.destroy())
  })
  return new Promise<net.Server>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, () => resolve(server))
  })
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
    JSON.stringify({ instance_id: instance, pid: process.pid, protocol: 6, socket, token }),
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
