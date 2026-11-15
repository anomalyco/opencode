import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { Effect, Option } from "effect"
import fs from "node:fs/promises"
import { EOL } from "node:os"
import os from "node:os"
import path from "node:path"
import { Server } from "../src/commands/commands"
import move from "../src/commands/handlers/session/move"
import { OPENCODE_VERSION } from "../src/version"

const originalStdout = process.stdout.write
const originalStderr = process.stderr.write

let root = ""
let stdout = ""
let stderr = ""

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-session-move-"))
  stdout = ""
  stderr = ""
  process.exitCode = 0
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString()
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString()
    return true
  }) as typeof process.stderr.write
})

afterEach(async () => {
  process.stdout.write = originalStdout
  process.stderr.write = originalStderr
  process.exitCode = 0
  await fs.rm(root, { recursive: true, force: true })
})

function status() {
  return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: os.tmpdir() } })
}

async function run(input: { sessionID: string; directory: string }, url: string) {
  await Effect.runPromise(
    Effect.scoped(
      move(input).pipe(
        Effect.provideService(Server, Option.some(url)),
        Effect.provide(Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })),
        Effect.provide(NodeServices.layer),
      ),
    ),
  )
}

test("moves a session to an absolute destination", async () => {
  const requests: Array<{ path: string; body: unknown }> = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info") return status()
      requests.push({ path: url.pathname, body: await request.json() })
      return new Response(null, { status: 204 })
    },
  })

  try {
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-move-destination-"))
    await run({ sessionID: "ses_move", directory: destination }, server.url.toString())
    await fs.rm(destination, { recursive: true, force: true })

    expect(requests).toEqual([{ path: "/api/session/ses_move/move", body: { directory: destination } }])
    expect(stdout).toBe(`Session ses_move moved to ${destination}${EOL}`)
    expect(stderr).toBe("")
    expect(process.exitCode).toBe(0)
  } finally {
    await server.stop(true)
  }
})

test("resolves a relative destination before calling the server", async () => {
  const requests: Array<{ body: unknown }> = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === "/api/info") return status()
      requests.push({ body: await request.json() })
      return new Response(null, { status: 204 })
    },
  })

  try {
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-move-destination-"))
    await run({ sessionID: "ses_move", directory: path.relative(process.cwd(), destination) }, server.url.toString())
    await fs.rm(destination, { recursive: true, force: true })

    expect(requests).toEqual([{ body: { directory: destination } }])
    expect(stdout).toBe(`Session ses_move moved to ${destination}${EOL}`)
    expect(process.exitCode).toBe(0)
  } finally {
    await server.stop(true)
  }
})

test("reports a missing session on stderr", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/api/info") return status()
      return Response.json({ _tag: "SessionNotFoundError", message: "Session not found: ses_missing" }, { status: 404 })
    },
  })

  try {
    await run({ sessionID: "ses_missing", directory: os.tmpdir() }, server.url.toString())

    expect(stdout).toBe("")
    expect(stderr).toBe(`Session not found: ses_missing${EOL}`)
    expect(process.exitCode).toBe(1)
  } finally {
    await server.stop(true)
  }
})

test("reports an invalid destination on stderr", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/api/info") return status()
      return Response.json({ message: "Directory does not exist: /missing" }, { status: 400 })
    },
  })

  try {
    await run({ sessionID: "ses_move", directory: "/missing" }, server.url.toString())

    expect(stdout).toBe("")
    expect(stderr).toBe(`Directory does not exist: /missing${EOL}`)
    expect(process.exitCode).toBe(1)
  } finally {
    await server.stop(true)
  }
})
