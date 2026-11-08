import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"

export const pong = { type: "pong", instance_id: "test", pid: process.pid, protocol: 7 }

export function temporaryDirectory() {
  return Effect.acquireRelease(
    Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "opencode-pty-test-"))),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  )
}

export function listen(
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

export function writeRegistration(
  directory: string,
  socket: string,
  instance = "test",
  token = "test",
  features?: string[],
) {
  return writeFile(
    path.join(directory, "service.json"),
    JSON.stringify({ instance_id: instance, pid: process.pid, protocol: 7, socket, token, features }),
  )
}

// An in-process opencode-pty that a server adopts through a handoff, so no daemon is spawned. Without
// features it answers like a daemon that predates the features list.
export const fakeDaemon = Effect.fn(function* (features?: string[]) {
  const base = yield* temporaryDirectory()
  const root = path.join(base, "root")
  const directory = path.join(root, "inherited")
  const socket = path.join(base, "daemon.sock")
  const terminals: Array<ReturnType<typeof terminal> & { user_title?: string | null }> = []
  const failTerminate = new Set<string>()
  const ops: string[] = []
  let nextID = 1
  yield* listen(socket, (connection, request) => {
    ops.push(String(request.op))
    if (request.op === "ping") return features ? { ...pong, features } : pong
    if (request.op === "list") return { type: "terminals", terminals }
    if (request.op === "create") {
      const base = terminal(nextID++, String(request.group_id))
      // A daemon that advertises features always serializes user_title.
      const created = features ? { ...base, user_title: null } : base
      terminals.push(created)
      return { type: "created", terminal: created }
    }
    if (request.op === "control") return { type: "ok" }
    if (request.op === "terminate") {
      if (failTerminate.has(`pty_persistent_${request.id}`)) return { type: "error", message: "terminate failed" }
      const index = terminals.findIndex((item) => item.id === request.id)
      if (index === -1) return { type: "error", message: `terminal not found: ${String(request.id)}` }
      terminals.splice(index, 1)
      return { type: "ok" }
    }
    if (request.op === "rename" && features?.includes("rename")) {
      const found = terminals.find((item) => item.id === request.id)
      if (!found) return { type: "error", message: "terminal not found" }
      found.user_title = typeof request.title === "string" && request.title !== "" ? request.title : null
      found.title = found.user_title ?? "test"
      return { type: "ok" }
    }
    // Old daemons cannot parse unknown requests and drop the connection.
    if (request.op === "rename") {
      connection.destroy()
      return undefined
    }
    return { type: "error", message: `unexpected request: ${String(request.op)}` }
  })
  yield* Effect.promise(async () => {
    await mkdir(directory, { recursive: true })
    await writeRegistration(directory, socket, "test", "test", features)
  })
  return {
    failTerminate,
    ops,
    options: {
      root,
      handoff: { directory, instanceID: "test", ticket: "ticket", expiresAt: Date.now() + 60_000 },
    },
  }
})

export function terminal(id: number, groupID = "ses_test") {
  return {
    id,
    pid: null,
    title: "test",
    foreground_process: null,
    group_id: groupID,
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
