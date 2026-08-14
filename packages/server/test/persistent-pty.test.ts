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
                args: ["-c", "printf terminal-one; sleep 30"],
                cwd: process.cwd(),
                title: "first",
                env: {},
              })
            ).data,
          )
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
