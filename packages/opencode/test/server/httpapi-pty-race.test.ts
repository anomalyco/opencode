import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import { withTimeout } from "../../src/util/timeout"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const testPty = process.platform === "win32" ? test.skip : test

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

// Regression guard for early-frame delivery on the PTY websocket upgrade path.
//
// The legacy Hono handler buffered inbound frames in a `pending[]` array
// between `onOpen` and `pty.connect()` resolving, then replayed them. The
// HTTP API handler has no such buffer (httpapi/handlers/pty.ts:90-172) and
// instead relies on Effect's `socket.runRaw` ordering: `request.upgrade`
// returns a socket value but defers the WS handshake until `runRaw` is
// invoked, so the client's `open` event cannot fire until after the frame
// listener is attached. That ordering closes the window the buffer existed
// to protect.
//
// Both backends should deliver every frame the client sends inside its
// `open` handler. If a future change moves `wss.handleUpgrade` ahead of
// `pty.connect()` resolving, the new path would start dropping frames and
// the HTTP API assertion below would fail.

const auth = { username: "opencode", password: "race-secret" }

const ITERATIONS = 20
const FRAMES_PER_ITERATION = 100

type Backend = "effect-httpapi" | "hono"

async function startListener(backend: Backend) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = backend === "effect-httpapi"
  Flag.OPENCODE_SERVER_PASSWORD = auth.password
  Flag.OPENCODE_SERVER_USERNAME = auth.username
  process.env.OPENCODE_SERVER_PASSWORD = auth.password
  process.env.OPENCODE_SERVER_USERNAME = auth.username
  return Server.listen({ hostname: "127.0.0.1", port: 0 })
}

function authorization() {
  return `Basic ${btoa(`${auth.username}:${auth.password}`)}`
}

async function createCat(listener: Awaited<ReturnType<typeof startListener>>, dir: string) {
  const response = await fetch(new URL(PtyPaths.create, listener.url), {
    method: "POST",
    headers: {
      authorization: authorization(),
      "x-opencode-directory": dir,
      "content-type": "application/json",
    },
    body: JSON.stringify({ command: "/bin/cat", title: "race-repro" }),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { id: string }
}

async function requestTicket(
  listener: Awaited<ReturnType<typeof startListener>>,
  id: string,
  dir: string,
) {
  const response = await fetch(
    new URL(`${PtyPaths.connectToken.replace(":ptyID", id)}?directory=${encodeURIComponent(dir)}`, listener.url),
    {
      method: "POST",
      headers: { authorization: authorization(), "x-opencode-ticket": "1" },
    },
  )
  expect(response.status).toBe(200)
  return (await response.json()) as { ticket: string }
}

function socketURL(listener: Awaited<ReturnType<typeof startListener>>, id: string, dir: string, ticket: string) {
  const url = new URL(PtyPaths.connect.replace(":ptyID", id), listener.url)
  url.protocol = "ws:"
  url.searchParams.set("directory", dir)
  url.searchParams.set("cursor", "-1")
  url.searchParams.set("ticket", ticket)
  return url
}

/**
 * Open a websocket, blast `count` distinct frames synchronously inside the
 * `open` event handler, then wait for echoes from `/bin/cat` to count which
 * frames actually reached the PTY.
 */
async function blastAndEcho(url: URL, count: number, settleMs: number): Promise<Set<number>> {
  const ws = new WebSocket(url)
  ws.binaryType = "arraybuffer"
  const decoder = new TextDecoder()
  const seen = new Set<number>()
  let buffer = ""

  ws.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : decoder.decode(event.data as ArrayBuffer)
    buffer += text
    for (const m of buffer.matchAll(/frame-(\d+)/g)) {
      const n = Number(m[1])
      if (Number.isSafeInteger(n)) seen.add(n)
    }
  })

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      ws.addEventListener(
        "open",
        () => {
          // Synchronously enqueue every frame in the same microtask the open
          // handler fires. This is the moment Hono's `pending[]` exists to
          // protect: any frames that race ahead of `pty.connect()` resolving
          // must still be delivered to the PTY.
          for (let i = 0; i < count; i++) {
            ws.send(`frame-${i}\n`)
          }
          resolve()
        },
        { once: true },
      )
      ws.addEventListener("error", () => reject(new Error("websocket failed before open")), { once: true })
    }),
    5_000,
    "timed out waiting for websocket open",
  )

  // Give the PTY enough time to round-trip every frame we sent. `/bin/cat`
  // echoes synchronously, so a small settle window is plenty.
  await new Promise((resolve) => setTimeout(resolve, settleMs))

  try {
    ws.close(1000)
  } catch {}

  return seen
}

async function runIterations(backend: Backend, iterations: number, framesPerIteration: number) {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const listener = await startListener(backend)
  try {
    const losses: Array<{ iteration: number; missing: number[] }> = []
    for (let iter = 0; iter < iterations; iter++) {
      const info = await createCat(listener, tmp.path)
      const ticket = await requestTicket(listener, info.id, tmp.path)
      const seen = await blastAndEcho(socketURL(listener, info.id, tmp.path, ticket.ticket), framesPerIteration, 400)
      const missing: number[] = []
      for (let i = 0; i < framesPerIteration; i++) if (!seen.has(i)) missing.push(i)
      if (missing.length > 0) losses.push({ iteration: iter, missing })

      await fetch(new URL(PtyPaths.remove.replace(":ptyID", info.id), listener.url), {
        method: "DELETE",
        headers: { authorization: authorization(), "x-opencode-directory": tmp.path },
      }).catch(() => undefined)
    }
    return losses
  } finally {
    await withTimeout(listener.stop(true), 10_000, "timed out cleaning up listener").catch(() => undefined)
  }
}

describe("PTY websocket early-frame buffering", () => {
  testPty(
    "Hono backend delivers every frame the client sends inside open",
    async () => {
      const losses = await runIterations("hono", ITERATIONS, FRAMES_PER_ITERATION)
      expect(losses).toEqual([])
    },
    60_000,
  )

  testPty(
    "HTTP API backend delivers every frame the client sends inside open",
    async () => {
      const losses = await runIterations("effect-httpapi", ITERATIONS, FRAMES_PER_ITERATION)
      expect(losses).toEqual([])
    },
    60_000,
  )
})
