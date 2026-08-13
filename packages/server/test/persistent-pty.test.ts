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

          yield* request(base, "DELETE", `/api/persistent-pty/${first.id}`)
          yield* request(base, "DELETE", `/api/persistent-pty/${second.id}`)
          expect((yield* request(base, "GET", `/api/pty-group/${group.id}`)).data).toMatchObject({ items: [] })
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

function request(base: string, method: string, pathname: string, body?: unknown) {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(new URL(pathname, base), {
        method,
        headers: {
          authorization: `Basic ${btoa("opencode:secret")}`,
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

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  if (value !== undefined) process.env[key] = value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
