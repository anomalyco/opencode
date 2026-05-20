import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import net from "node:net"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import { withTimeout } from "../../src/util/timeout"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { it } from "../lib/effect"

void Log.init({ print: false })

const original = {
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
  envPassword: process.env.OPENCODE_SERVER_PASSWORD,
  envUsername: process.env.OPENCODE_SERVER_USERNAME,
}
const auth = { username: "opencode", password: "listen-secret" }
const testPtyInstance = process.platform === "win32" ? it.instance.skip : it.instance
const testPtyEffect = process.platform === "win32" ? it.effect.skip : it.effect

afterEach(async () => {
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  if (original.envPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
  else process.env.OPENCODE_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME
  else process.env.OPENCODE_SERVER_USERNAME = original.envUsername
  await disposeAllInstances()
  await resetDatabase()
})

type Listener = Awaited<ReturnType<typeof Server.listen>>

const startListener = () =>
  Effect.acquireRelease(
    Effect.promise(() => {
      Flag.OPENCODE_SERVER_PASSWORD = auth.password
      Flag.OPENCODE_SERVER_USERNAME = auth.username
      process.env.OPENCODE_SERVER_PASSWORD = auth.password
      process.env.OPENCODE_SERVER_USERNAME = auth.username
      return Server.listen({ hostname: "127.0.0.1", port: 0 })
    }),
    (listener: Listener) =>
      Effect.promise(() =>
        withTimeout(listener.stop(true), 10_000, "timed out cleaning up listener").catch(() => undefined),
      ),
  )

const startNoAuthListener = () =>
  Effect.acquireRelease(
    Effect.promise(() => {
      Flag.OPENCODE_SERVER_PASSWORD = undefined
      Flag.OPENCODE_SERVER_USERNAME = auth.username
      delete process.env.OPENCODE_SERVER_PASSWORD
      process.env.OPENCODE_SERVER_USERNAME = auth.username
      return Server.listen({ hostname: "127.0.0.1", port: 0 })
    }),
    (listener: Listener) =>
      Effect.promise(() =>
        withTimeout(listener.stop(true), 10_000, "timed out cleaning up no-auth listener").catch(() => undefined),
      ),
  )

function authorization() {
  return `Basic ${btoa(`${auth.username}:${auth.password}`)}`
}

function socketURL(listener: Listener, id: string, dir: string, ticket?: string) {
  const url = new URL(PtyPaths.connect.replace(":ptyID", id), listener.url)
  url.protocol = "ws:"
  url.searchParams.set("directory", dir)
  url.searchParams.set("cursor", "-1")
  if (ticket) url.searchParams.set("ticket", ticket)
  return url
}

async function requestTicket(
  listener: Listener,
  id: string,
  dir: string,
  options?: { ticketHeader?: boolean; origin?: string },
) {
  const response = await fetch(new URL(PtyPaths.connectToken.replace(":ptyID", id), listener.url), {
    method: "POST",
    headers: {
      authorization: authorization(),
      "x-opencode-directory": dir,
      ...(options?.ticketHeader === false ? {} : { "x-opencode-ticket": "1" }),
      ...(options?.origin ? { origin: options.origin } : {}),
    },
  })

  return response
}

async function connectTicket(listener: Listener, id: string, dir: string) {
  const response = await requestTicket(listener, id, dir)
  expect(response.status).toBe(200)
  return (await response.json()) as { ticket: string; expires_in: number }
}

async function createCat(listener: Listener, dir: string) {
  const response = await fetch(new URL(PtyPaths.create, listener.url), {
    method: "POST",
    headers: {
      authorization: authorization(),
      "x-opencode-directory": dir,
      "content-type": "application/json",
    },
    body: JSON.stringify({ command: "/bin/cat", title: "listen-smoke" }),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { id: string }
}

async function openSocket(url: URL) {
  const ws = new WebSocket(url)
  ws.binaryType = "arraybuffer"
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true })
      ws.addEventListener("error", () => reject(new Error("websocket failed before open")), { once: true })
    }),
    5_000,
    "timed out waiting for websocket open",
  )
  return ws
}

async function expectSocketRejected(url: URL, init?: { headers?: Record<string, string> }) {
  // Bun's WebSocket accepts an init object with headers; standard DOM types don't reflect that.
  const Ctor = WebSocket as unknown as new (url: URL, init?: { headers?: Record<string, string> }) => WebSocket
  const ws = new Ctor(url, init)
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      ws.addEventListener(
        "open",
        () => {
          ws.close(1000)
          reject(new Error("websocket opened"))
        },
        { once: true },
      )
      ws.addEventListener("error", () => resolve(), { once: true })
      ws.addEventListener("close", () => resolve(), { once: true })
    }),
    5_000,
    "timed out waiting for websocket rejection",
  )
}

function waitForMessage(ws: WebSocket, predicate: (message: string) => boolean) {
  const decoder = new TextDecoder()
  let onMessage: ((event: MessageEvent) => void) | undefined
  return withTimeout(
    new Promise<string>((resolve) => {
      onMessage = (event: MessageEvent) => {
        const message = typeof event.data === "string" ? event.data : decoder.decode(event.data as ArrayBuffer)
        if (!predicate(message)) return
        resolve(message)
      }
      ws.addEventListener("message", onMessage)
    }),
    5_000,
    "timed out waiting for websocket message",
  ).finally(() => {
    if (onMessage) ws.removeEventListener("message", onMessage)
  })
}

async function openPtySocket(listener: Listener, dir: string) {
  const info = await createCat(listener, dir)
  const ticket = await connectTicket(listener, info.id, dir)
  const ws = await openSocket(socketURL(listener, info.id, dir, ticket.ticket))
  return {
    ws,
    closed: new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true })),
  }
}

describe("HttpApi Server.listen", () => {
  testPtyInstance(
    "serves HTTP routes and upgrades PTY websocket through Server.listen",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const listener = yield* startListener()

        yield* Effect.promise(async () => {
          const response = await fetch(new URL(PtyPaths.shells, listener.url), {
            headers: { authorization: authorization(), "x-opencode-directory": tmp.directory },
          })
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                path: expect.any(String),
                name: expect.any(String),
                acceptable: expect.any(Boolean),
              }),
            ]),
          )

          const info = await createCat(listener, tmp.directory)
          const ticket = await connectTicket(listener, info.id, tmp.directory)
          expect(ticket.expires_in).toBeGreaterThan(0)
          const ws = await openSocket(socketURL(listener, info.id, tmp.directory, ticket.ticket))
          const closed = new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true }))

          const message = waitForMessage(ws, (m) => m.includes("ping-listen"))
          ws.send("ping-listen\n")
          expect(await message).toContain("ping-listen")

          await withTimeout(listener.stop(true), 10_000, "timed out waiting for listener.stop(true)")
          await withTimeout(closed, 5_000, "timed out waiting for websocket close")
          expect(ws.readyState).toBe(WebSocket.CLOSED)
        })

        const restarted = yield* startListener()
        yield* Effect.promise(async () => {
          const nextInfo = await createCat(restarted, tmp.directory)
          const nextTicket = await connectTicket(restarted, nextInfo.id, tmp.directory)
          const nextWs = await openSocket(socketURL(restarted, nextInfo.id, tmp.directory, nextTicket.ticket))
          const nextMessage = waitForMessage(nextWs, (m) => m.includes("ping-restarted"))
          nextWs.send("ping-restarted\n")
          expect(await nextMessage).toContain("ping-restarted")
          nextWs.close(1000)
        })
      }),
    { config: { formatter: false, lsp: false } },
  )

  testPtyInstance(
    "stop(true) is safe when called concurrently and repeatedly",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const listener = yield* startListener()

        yield* Effect.promise(async () => {
          const socket = await openPtySocket(listener, tmp.directory)
          await withTimeout(
            Promise.all([listener.stop(true), listener.stop(true)]).then(() => undefined),
            10_000,
            "timed out waiting for concurrent listener.stop(true)",
          )
          await withTimeout(socket.closed, 5_000, "timed out waiting for websocket close after concurrent stop")
          await withTimeout(listener.stop(true), 5_000, "timed out waiting for repeated listener.stop(true)")
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  testPtyInstance(
    "stop(true) can force a graceful stop already in progress",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const listener = yield* startListener()

        yield* Effect.promise(async () => {
          const socket = await openPtySocket(listener, tmp.directory)
          const graceful = listener.stop()
          const forced = listener.stop(true)
          await withTimeout(
            Promise.all([graceful, forced]).then(() => undefined),
            10_000,
            "timed out waiting for forced listener stop",
          )
          await withTimeout(socket.closed, 5_000, "timed out waiting for websocket close after forced stop")
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  testPtyInstance(
    "graceful stop waits for an overlapping forced stop",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const listener = yield* startListener()

        yield* Effect.promise(async () => {
          const socket = await openPtySocket(listener, tmp.directory)
          const forced = listener.stop(true)
          await withTimeout(listener.stop(), 10_000, "timed out waiting for graceful stop after forced stop")
          await withTimeout(forced, 5_000, "timed out waiting for overlapping forced stop")
          await withTimeout(socket.closed, 5_000, "timed out waiting for websocket close before graceful stop resolved")
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.effect("stop() gracefully closes an idle listener and is repeat-safe", () =>
    Effect.gen(function* () {
      const listener = yield* startListener()
      yield* Effect.promise(async () => {
        await withTimeout(listener.stop(), 10_000, "timed out waiting for graceful listener.stop()")
        await withTimeout(listener.stop(), 5_000, "timed out waiting for repeated graceful listener.stop()")
        await expect(
          fetch(new URL(PtyPaths.shells, listener.url), { headers: { authorization: authorization() } }),
        ).rejects.toThrow()
      })
    }),
  )

  it.effect("default in-process handler does not emit Effect HTTP response logs", () =>
    Effect.promise(async () => {
      let output = ""
      // oxlint-disable-next-line typescript-eslint/unbound-method -- restored in finally after temporarily capturing stderr.
      const original = process.stderr.write
      process.stderr.write = ((chunk) => {
        output += String(chunk)
        return true
      }) as typeof process.stderr.write
      try {
        const response = await Server.Default().app.request("/status")
        expect(response.status).toBe(200)
      } finally {
        process.stderr.write = original
      }

      expect(output).not.toContain("Sent HTTP response")
    }),
  )

  it.effect("port 0 prefers 4096 when free", () =>
    Effect.gen(function* () {
      const free = yield* Effect.promise(() => isPortFree(4096))
      if (!free) return
      const listener = yield* startListener()
      expect(listener.port).toBe(4096)
    }),
  )

  it.effect("port 0 falls back when 4096 is taken", () =>
    Effect.gen(function* () {
      const blocker = yield* Effect.acquireRelease(
        Effect.promise(() => occupyPort(4096)),
        (server: net.Server | undefined) =>
          server
            ? Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))
            : Effect.void,
      )
      if (!blocker) return
      const listener = yield* startListener()
      expect(listener.port).not.toBe(4096)
      expect(listener.port).toBeGreaterThan(0)
    }),
  )

  testPtyInstance(
    "rejects unsafe PTY ticket mint and connect requests",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const listener = yield* startListener()

        yield* Effect.promise(async () => {
          const info = await createCat(listener, tmp.directory)

          expect((await requestTicket(listener, info.id, tmp.directory, { ticketHeader: false })).status).toBe(403)
          expect((await requestTicket(listener, info.id, tmp.directory, { origin: "https://evil.example" })).status).toBe(
            403,
          )

          // Regression for #25698: minting without a directory uses the server cwd
          // and cannot find a PTY registered in a project directory.
          const ambiguous = await fetch(new URL(PtyPaths.connectToken.replace(":ptyID", info.id), listener.url), {
            method: "POST",
            headers: { authorization: authorization(), "x-opencode-ticket": "1" },
          })
          expect(ambiguous.status).toBe(404)

          const directoryScoped = await fetch(
            new URL(
              `${PtyPaths.connectToken.replace(":ptyID", info.id)}?directory=${encodeURIComponent(tmp.directory)}`,
              listener.url,
            ),
            {
              method: "POST",
              headers: { authorization: authorization(), "x-opencode-ticket": "1" },
            },
          )
          expect(directoryScoped.status).toBe(200)
          const mint = (await directoryScoped.json()) as { ticket: string }
          const scopedWs = await openSocket(socketURL(listener, info.id, tmp.directory, mint.ticket))
          scopedWs.close(1000)

          await expectSocketRejected(socketURL(listener, info.id, tmp.directory, "not-a-ticket"))

          const reusable = await connectTicket(listener, info.id, tmp.directory)
          const ws = await openSocket(socketURL(listener, info.id, tmp.directory, reusable.ticket))
          await expectSocketRejected(socketURL(listener, info.id, tmp.directory, reusable.ticket))
          ws.close(1000)

          const other = await createCat(listener, tmp.directory)
          const scoped = await connectTicket(listener, info.id, tmp.directory)
          await expectSocketRejected(socketURL(listener, other.id, tmp.directory, scoped.ticket))

          const crossOrigin = await connectTicket(listener, info.id, tmp.directory)
          await expectSocketRejected(socketURL(listener, info.id, tmp.directory, crossOrigin.ticket), {
            headers: { origin: "https://evil.example" },
          })
        })
      }),
    { config: { formatter: false, lsp: false } },
  )

  testPtyInstance(
    "keeps PTY websocket tickets optional when server auth is disabled",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const listener = yield* startNoAuthListener()

        yield* Effect.promise(async () => {
          const info = await createCat(listener, tmp.directory)
          const ws = await openSocket(socketURL(listener, info.id, tmp.directory))
          const message = waitForMessage(ws, (m) => m.includes("ping-no-auth"))
          ws.send("ping-no-auth\n")
          expect(await message).toContain("ping-no-auth")
          ws.close(1000)
        })
      }),
    { config: { formatter: false, lsp: false } },
  )
})

function isPortFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer()
    probe.once("error", () => resolve(false))
    probe.once("listening", () => probe.close(() => resolve(true)))
    probe.listen(port, "127.0.0.1")
  })
}

function occupyPort(port: number) {
  return new Promise<net.Server | undefined>((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(undefined))
    server.listen(port, "127.0.0.1", () => resolve(server))
  })
}
