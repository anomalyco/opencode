import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { expect } from "bun:test"
import { Group } from "@opencode-ai/schema/group"
import { PersistentPty } from "@opencode-ai/schema/persistent-pty"
import { Effect, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

const binary = process.env.OPENCODE_PTY_BIN ?? "/root/projects/opencode-pty/target/debug/opencode-pty"
const smoke = existsSync(binary) ? it.live : it.live.skip

smoke(
  "creates a group with two persistent terminals through the client API",
  () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => {
        const environment = {
          binary: process.env.OPENCODE_PTY_BIN,
          runtime: process.env.OPENCODE_PTY_RUNTIME_DIR,
          xdg: process.env.XDG_RUNTIME_DIR,
        }
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-pty-server-test-"))
        const database = path.join(root, "opencode.db")
        const runtime = path.join(root, "runtime")
        process.env.OPENCODE_PTY_BIN = binary
        delete process.env.OPENCODE_PTY_RUNTIME_DIR
        process.env.XDG_RUNTIME_DIR = runtime
        return {
          database,
          directory: path.join(
            runtime,
            "opencode-pty",
            createHash("sha256").update(database).digest("hex").slice(0, 16),
          ),
          environment,
          root,
        }
      }),
      (fixture) =>
        Effect.gen(function* () {
          const server = yield* ServerProcess.start<never, never>({
            hostname: "127.0.0.1",
            port: 0,
            password: "secret",
            app: { version: "test-version" },
            database: { path: fixture.database },
            fs: { filewatcher: false },
          })
          const base = HttpServer.formatAddress(server.address)
          expect(existsSync(path.join(fixture.directory, "service.json"))).toBeFalse()
          const group = Schema.decodeUnknownSync(Group.Info)(
            (yield* request(base, "POST", "/api/pty-group", { items: [] })).data,
          )
          expect((yield* request(base, "GET", `/api/pty-group/${group.id}/terminal`)).data).toEqual([])
          expect(existsSync(path.join(fixture.directory, "service.json"))).toBeFalse()
          const first = Schema.decodeUnknownSync(PersistentPty.Info)(
            (
              yield* request(base, "POST", `/api/pty-group/${group.id}/terminal`, {
                command: "/bin/sh",
                args: ["-c", "stty -echo; printf terminal-one; cat"],
                cwd: process.cwd(),
                title: "first",
                env: {},
              })
            ).data,
          )
          expect(first.size).toEqual({ cols: 80, rows: 24 })
          expect(existsSync(path.join(fixture.directory, "service.json"))).toBeTrue()
          const second = Schema.decodeUnknownSync(PersistentPty.Info)(
            (
              yield* request(base, "POST", `/api/pty-group/${group.id}/terminal`, {
                command: "/bin/sh",
                args: ["-c", "printf terminal-two; sleep 30"],
                cwd: process.cwd(),
                title: "second",
                env: {},
              })
            ).data,
          )

          const updated = Schema.decodeUnknownSync(Group.Info)(
            (yield* request(base, "GET", `/api/pty-group/${group.id}`)).data,
          )
          expect(updated.items).toEqual([
            { type: "terminal", id: first.id },
            { type: "terminal", id: second.id },
          ])

          const terminals = Schema.decodeUnknownSync(Schema.Array(PersistentPty.Info))(
            (yield* request(base, "GET", `/api/pty-group/${group.id}/terminal`)).data,
          )
          expect(terminals.map((terminal) => terminal.id).sort()).toEqual([first.id, second.id].sort())
          expect(yield* waitForText(base, first.id, "terminal-one")).toContain("terminal-one")
          expect(yield* waitForText(base, second.id, "terminal-two")).toContain("terminal-two")
          yield* Effect.promise(() => verifySharedControl(base, first.id))
          const snapshot = yield* request(base, "GET", `/api/persistent-pty/${first.id}/snapshot`)
          if (
            !isRecord(snapshot.data) ||
            typeof snapshot.data.checkpoint !== "string" ||
            !isRecord(snapshot.data.info) ||
            !isRecord(snapshot.data.info.output) ||
            typeof snapshot.data.info.output.tail !== "number"
          )
            throw new Error("Persistent PTY snapshot response was invalid")
          expect(Buffer.from(snapshot.data.checkpoint, "base64").byteLength).toBeGreaterThan(0)
          expect(snapshot.data.info.output.tail).toBeGreaterThan(0)

          yield* request(base, "DELETE", `/api/persistent-pty/${first.id}`)
          yield* request(base, "DELETE", `/api/persistent-pty/${second.id}`)
          expect((yield* request(base, "GET", `/api/pty-group/${group.id}`)).data).toMatchObject({ items: [] })

          yield* request(base, "POST", "/api/persistent-pty/shutdown")

          const unattended = Schema.decodeUnknownSync(PersistentPty.Info)(
            (
              yield* request(base, "POST", `/api/pty-group/${group.id}/terminal`, {
                command: "/bin/sh",
                args: ["-c", "exit 7"],
                cwd: process.cwd(),
                title: "unattended",
                env: {},
              })
            ).data,
          )
          yield* waitForStatus(base, unattended.id, "exited")
          expect((yield* request(base, "GET", `/api/pty-group/${group.id}`)).data).toMatchObject({
            items: [{ type: "terminal", id: unattended.id }],
          })
          yield* request(base, "DELETE", `/api/persistent-pty/${unattended.id}`)

          const visible = Schema.decodeUnknownSync(PersistentPty.Info)(
            (
              yield* request(base, "POST", `/api/pty-group/${group.id}/terminal`, {
                command: "/bin/sh",
                args: ["-c", "read value"],
                cwd: process.cwd(),
                title: "visible",
                env: {},
              })
            ).data,
          )
          yield* attachAndExit(base, visible.id)
          yield* waitForGroupItems(base, group.id, [])
          yield* request(base, "DELETE", `/api/pty-group/${group.id}`)
        }),
      (fixture) =>
        Effect.promise(async () => {
          await Bun.spawn([binary, "stop"], {
            env: { ...process.env, OPENCODE_PTY_RUNTIME_DIR: fixture.directory },
            stdout: "ignore",
            stderr: "ignore",
          }).exited
          await fs.rm(fixture.root, { recursive: true, force: true })
          restore("OPENCODE_PTY_BIN", fixture.environment.binary)
          restore("OPENCODE_PTY_RUNTIME_DIR", fixture.environment.runtime)
          restore("XDG_RUNTIME_DIR", fixture.environment.xdg)
        }),
    ),
  20_000,
)

function request(base: string, method: string, pathname: string, body?: unknown, headers?: Record<string, string>) {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(new URL(pathname, base), {
        method,
        headers: {
          authorization: `Basic ${btoa("opencode:secret")}`,
          ...headers,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`${method} ${pathname} failed (${response.status}): ${await response.text()}`)
      if (response.status === 204) return {}
      const value: unknown = await response.json()
      if (!isRecord(value)) throw new Error(`${method} ${pathname} returned a non-object response`)
      return value
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function waitForText(base: string, ptyID: string, expected: string) {
  return Effect.tryPromise({
    try: async () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const response = await Effect.runPromise(request(base, "GET", `/api/persistent-pty/${ptyID}/snapshot`))
        if (isRecord(response.data) && typeof response.data.text === "string" && response.data.text.includes(expected))
          return response.data.text
        await Bun.sleep(50)
      }
      throw new Error(`Persistent PTY snapshot did not contain ${expected}`)
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function waitForStatus(base: string, ptyID: string, status: string) {
  return Effect.tryPromise({
    try: async () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const response = await Effect.runPromise(request(base, "GET", `/api/persistent-pty/${ptyID}`))
        if (isRecord(response.data) && response.data.status === status) return
        await Bun.sleep(50)
      }
      throw new Error(`Persistent PTY ${ptyID} did not reach status ${status}`)
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function attachAndExit(base: string, ptyID: string) {
  return Effect.tryPromise({
    try: async () => {
      const response = await Effect.runPromise(
        request(base, "POST", `/api/persistent-pty/${ptyID}/connect-token`, undefined, {
          "x-opencode-ticket": "1",
        }),
      )
      if (!isRecord(response.data) || typeof response.data.ticket !== "string")
        throw new Error("Persistent PTY connect token response was invalid")
      const url = new URL(`/api/persistent-pty/${ptyID}/connect`, base)
      url.protocol = "ws:"
      url.searchParams.set("ticket", response.data.ticket)
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(url)
        const timeout = setTimeout(() => {
          socket.close()
          reject(new Error("Persistent PTY did not exit while attached"))
        }, 5_000)
        socket.addEventListener("message", (event) => {
          if (typeof event.data !== "string") return
          const message: unknown = JSON.parse(event.data)
          if (!isRecord(message)) return
          if (message.type === "attached") socket.send(new Uint8Array([4]))
          if (message.type !== "exited") return
          clearTimeout(timeout)
          socket.close()
          resolve()
        })
        socket.addEventListener("error", () => {
          clearTimeout(timeout)
          reject(new Error("Persistent PTY WebSocket failed"))
        })
      })
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

async function verifySharedControl(base: string, ptyID: string) {
  const first = await openTerminalSocket(base, ptyID, "first")
  const second = await openTerminalSocket(base, ptyID, "second")
  try {
    first.socket.send(controlFrame(90, 25))
    first.socket.send(inputFrame(90, 25, "from-first\n"))
    await waitForSocketOutput([first, second], "from-first")

    second.socket.send(inputFrame(70, 20, "from-second\n"))
    await waitForSocketOutput([first, second], "from-second")

    second.socket.send(inputFrame(70, 20, "x".repeat(1024 * 1024)))
    second.socket.send(inputFrame(70, 20, "after-burst\n"))
    await waitForSocketOutput([first, second], "after-burst")
    expect(first.closed).toBeFalse()
    expect(second.closed).toBeFalse()
    expect(first.resizes).toBeGreaterThan(0)
    expect(second.resizes).toBeGreaterThan(0)
    expect(first.output).not.toContain("\0")
    expect(second.output).not.toContain("\0")
  } finally {
    first.socket.close()
    second.socket.close()
  }
}

async function openTerminalSocket(base: string, ptyID: string, attachmentID: string) {
  const response = await Effect.runPromise(
    request(base, "POST", `/api/persistent-pty/${ptyID}/connect-token`, undefined, {
      "x-opencode-ticket": "1",
    }),
  )
  if (!isRecord(response.data) || typeof response.data.ticket !== "string")
    throw new Error("Persistent PTY connect token response was invalid")
  const url = new URL(`/api/persistent-pty/${ptyID}/connect`, base)
  url.protocol = "ws:"
  url.searchParams.set("ticket", response.data.ticket)
  url.searchParams.set("attachment_id", attachmentID)
  url.searchParams.set("takeover", "true")
  url.searchParams.set("input_protocol", "1")
  const state = { socket: new WebSocket(url), output: "", closed: false, resizes: 0 }
  state.socket.binaryType = "arraybuffer"
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Persistent PTY WebSocket did not attach")), 5_000)
    let attached = false
    state.socket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        state.output += new TextDecoder().decode(event.data)
        return
      }
      if (typeof event.data !== "string") return
      const message: unknown = JSON.parse(event.data)
      if (!isRecord(message)) return
      if (message.type === "resized") {
        if (typeof message.checkpoint !== "string") {
          clearTimeout(timeout)
          reject(new Error("Persistent PTY resize omitted its checkpoint"))
          return
        }
        state.resizes++
        return
      }
      if (message.type === "attached") {
        if (message.inputProtocol === 1) {
          attached = true
          return
        }
        clearTimeout(timeout)
        reject(new Error("Persistent PTY WebSocket did not negotiate framed input"))
        return
      }
      if (message.type !== "replay_complete" || !attached) return
      clearTimeout(timeout)
      resolve()
    })
    state.socket.addEventListener("close", () => {
      state.closed = true
    })
    state.socket.addEventListener("error", () => {
      clearTimeout(timeout)
      reject(new Error("Persistent PTY WebSocket failed"))
    })
  })
  return state
}

function inputFrame(cols: number, rows: number, input: string) {
  const data = new TextEncoder().encode(input)
  const frame = new Uint8Array(5 + data.byteLength)
  const view = new DataView(frame.buffer)
  frame[0] = 1
  view.setUint16(1, cols)
  view.setUint16(3, rows)
  frame.set(data, 5)
  return frame
}

function controlFrame(cols: number, rows: number) {
  const frame = new Uint8Array(5)
  const view = new DataView(frame.buffer)
  view.setUint16(1, cols)
  view.setUint16(3, rows)
  return frame
}

async function waitForSocketOutput(
  sockets: Array<{ output: string; closed: boolean }>,
  expected: string,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (sockets.every((socket) => socket.output.includes(expected))) return
    if (sockets.some((socket) => socket.closed)) throw new Error("Persistent PTY observer disconnected")
    await Bun.sleep(20)
  }
  throw new Error(
    `Persistent PTY sockets did not both receive ${expected}: ${JSON.stringify(sockets.map((socket) => socket.output))}`,
  )
}

function waitForGroupItems(base: string, groupID: string, expected: unknown[]) {
  return Effect.tryPromise({
    try: async () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const response = await Effect.runPromise(request(base, "GET", `/api/pty-group/${groupID}`))
        if (isRecord(response.data) && JSON.stringify(response.data.items) === JSON.stringify(expected)) return
        await Bun.sleep(50)
      }
      throw new Error(`Persistent PTY group ${groupID} did not reconcile`)
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  if (value !== undefined) process.env[key] = value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
