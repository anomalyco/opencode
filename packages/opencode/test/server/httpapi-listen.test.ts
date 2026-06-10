import { afterEach, describe, expect, test } from "bun:test"
import net from "node:net"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "../../src/server/server"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import { withTimeout } from "../../src/util/timeout"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const original = {
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
  envPassword: process.env.OPENCODE_SERVER_PASSWORD,
  envUsername: process.env.OPENCODE_SERVER_USERNAME,
}
const auth = { username: "opencode", password: "listen-secret" }
const testPty = process.platform === "win32" ? test.skip : test

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

async function startListener() {
  Flag.OPENCODE_SERVER_PASSWORD = auth.password
  Flag.OPENCODE_SERVER_USERNAME = auth.username
  process.env.OPENCODE_SERVER_PASSWORD = auth.password
  process.env.OPENCODE_SERVER_USERNAME = auth.username
  return Server.listen({ hostname: "127.0.0.1", port: 0 })
}

async function startNoAuthListener() {
  Flag.OPENCODE_SERVER_PASSWORD = undefined
  Flag.OPENCODE_SERVER_USERNAME = auth.username
  delete process.env.OPENCODE_SERVER_PASSWORD
  process.env.OPENCODE_SERVER_USERNAME = auth.username
  return Server.listen({ hostname: "127.0.0.1", port: 0 })
}

function authorization() {
  return `Basic ${btoa(`${auth.username}:${auth.password}`)}`
}

function socketURL(listener: Awaited<ReturnType<typeof startListener>>, id: string, dir: string, ticket?: string) {
  const url = new URL(PtyPaths.connect.replace(":ptyID", id), listener.url)
  url.protocol = "ws:"
  url.searchParams.set("directory", dir)
  url.searchParams.set("cursor", "-1")
  if (ticket) url.searchParams.set("ticket", ticket)
  return url
}

async function requestTicket(
  listener: Awaited<ReturnType<typeof startListener>>,
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

async function connectTicket(listener: Awaited<ReturnType<typeof startListener>>, id: string, dir: string) {
  const response = await requestTicket(listener, id, dir)
  expect(response.status).toBe(200)
  return (await response.json()) as { ticket: string; expires_in: number }
}

async function createCat(listener: Awaited<ReturnType<typeof startListener>>, dir: string) {
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

function stop(listener: Awaited<ReturnType<typeof startListener>>, label: string) {
  return withTimeout(listener.stop(true), 10_000, label)
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

async function openPtySocket(listener: Awaited<ReturnType<typeof startListener>>, dir: string) {
  const info = await createCat(listener, dir)
  const ticket = await connectTicket(listener, info.id, dir)
  const ws = await openSocket(socketURL(listener, info.id, dir, ticket.ticket))
  return {
    ws,
    closed: new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true })),
  }
}

describe("HttpApi Server.listen", () => {
  testPty("serves HTTP routes and upgrades PTY websocket through Server.listen", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const listener = await startListener()
    let stopped = false
    try {
      const response = await fetch(new URL(PtyPaths.shells, listener.url), {
        headers: { authorization: authorization(), "x-opencode-directory": tmp.path },
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

      const info = await createCat(listener, tmp.path)
      const ticket = await connectTicket(listener, info.id, tmp.path)
      expect(ticket.expires_in).toBeGreaterThan(0)
      const ws = await openSocket(socketURL(listener, info.id, tmp.path, ticket.ticket))
      const closed = new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true }))

      const message = waitForMessage(ws, (message) => message.includes("ping-listen"))
      ws.send("ping-listen\n")
      expect(await message).toContain("ping-listen")

      await stop(listener, "timed out waiting for listener.stop(true)")
      stopped = true
      await withTimeout(closed, 5_000, "timed out waiting for websocket close")
      expect(ws.readyState).toBe(WebSocket.CLOSED)

      const restarted = await startListener()
      try {
        const nextInfo = await createCat(restarted, tmp.path)
        const nextTicket = await connectTicket(restarted, nextInfo.id, tmp.path)
        const nextWs = await openSocket(socketURL(restarted, nextInfo.id, tmp.path, nextTicket.ticket))
        const nextMessage = waitForMessage(nextWs, (message) => message.includes("ping-restarted"))
        nextWs.send("ping-restarted\n")
        expect(await nextMessage).toContain("ping-restarted")
        nextWs.close(1000)
      } finally {
        await stop(restarted, "timed out waiting for restarted listener.stop(true)")
      }
    } finally {
      if (!stopped) await stop(listener, "timed out cleaning up listener").catch(() => undefined)
    }
  })

  testPty("stop(true) is safe when called concurrently and repeatedly", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const listener = await startListener()
    let stopped = false
    try {
      const socket = await openPtySocket(listener, tmp.path)

      await withTimeout(
        Promise.all([listener.stop(true), listener.stop(true)]).then(() => undefined),
        10_000,
        "timed out waiting for concurrent listener.stop(true)",
      )
      await withTimeout(socket.closed, 5_000, "timed out waiting for websocket close after concurrent stop")
      await withTimeout(listener.stop(true), 5_000, "timed out waiting for repeated listener.stop(true)")
      stopped = true
    } finally {
      if (!stopped) await stop(listener, "timed out cleaning up concurrent stop listener").catch(() => undefined)
    }
  })

  testPty("stop(true) can force a graceful stop already in progress", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const listener = await startListener()
    let stopped = false
    try {
      const socket = await openPtySocket(listener, tmp.path)

      const graceful = listener.stop()
      const forced = listener.stop(true)
      await withTimeout(
        Promise.all([graceful, forced]).then(() => undefined),
        10_000,
        "timed out waiting for forced listener stop",
      )
      await withTimeout(socket.closed, 5_000, "timed out waiting for websocket close after forced stop")
      stopped = true
    } finally {
      if (!stopped) await stop(listener, "timed out cleaning up forced stop listener").catch(() => undefined)
    }
  })

  testPty("graceful stop waits for an overlapping forced stop", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const listener = await startListener()
    let stopped = false
    try {
      const socket = await openPtySocket(listener, tmp.path)
      const forced = listener.stop(true)
      await withTimeout(listener.stop(), 10_000, "timed out waiting for graceful stop after forced stop")
      stopped = true
      await withTimeout(forced, 5_000, "timed out waiting for overlapping forced stop")
      await withTimeout(socket.closed, 5_000, "timed out waiting for websocket close before graceful stop resolved")
    } finally {
      if (!stopped) await stop(listener, "timed out cleaning up overlapping stop listener").catch(() => undefined)
    }
  })

  test("stop() gracefully closes an idle listener and is repeat-safe", async () => {
    const listener = await startListener()
    await withTimeout(listener.stop(), 10_000, "timed out waiting for graceful listener.stop()")
    await withTimeout(listener.stop(), 5_000, "timed out waiting for repeated graceful listener.stop()")
    await expect(
      fetch(new URL(PtyPaths.shells, listener.url), { headers: { authorization: authorization() } }),
    ).rejects.toThrow()
  })

  test("default in-process handler does not emit Effect HTTP response logs", async () => {
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
  })

  test("port 0 prefers 4096 when free", async () => {
    if (!(await isPortFree(4096))) return
    const listener = await startListener()
    try {
      expect(listener.port).toBe(4096)
    } finally {
      await stop(listener, "timed out cleaning up port-0 prefers-4096 listener")
    }
  })

  test("port 0 falls back when 4096 is taken", async () => {
    const blocker = await occupyPort(4096)
    if (!blocker) return
    try {
      const listener = await startListener()
      try {
        expect(listener.port).not.toBe(4096)
        expect(listener.port).toBeGreaterThan(0)
      } finally {
        await stop(listener, "timed out cleaning up port-0 fallback listener")
      }
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  testPty("rejects unsafe PTY ticket mint and connect requests", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const listener = await startListener()
    try {
      const info = await createCat(listener, tmp.path)

      expect((await requestTicket(listener, info.id, tmp.path, { ticketHeader: false })).status).toBe(403)
      expect((await requestTicket(listener, info.id, tmp.path, { origin: "https://evil.example" })).status).toBe(403)

      // Regression for #25698: minting without a directory uses the server cwd
      // and cannot find a PTY registered in a project directory.
      const ambiguous = await fetch(new URL(PtyPaths.connectToken.replace(":ptyID", info.id), listener.url), {
        method: "POST",
        headers: { authorization: authorization(), "x-opencode-ticket": "1" },
      })
      expect(ambiguous.status).toBe(404)

      const directoryScoped = await fetch(
        new URL(
          `${PtyPaths.connectToken.replace(":ptyID", info.id)}?directory=${encodeURIComponent(tmp.path)}`,
          listener.url,
        ),
        {
          method: "POST",
          headers: { authorization: authorization(), "x-opencode-ticket": "1" },
        },
      )
      expect(directoryScoped.status).toBe(200)
      const mint = (await directoryScoped.json()) as { ticket: string }
      const scopedWs = await openSocket(socketURL(listener, info.id, tmp.path, mint.ticket))
      scopedWs.close(1000)

      await expectSocketRejected(socketURL(listener, info.id, tmp.path, "not-a-ticket"))

      const reusable = await connectTicket(listener, info.id, tmp.path)
      const ws = await openSocket(socketURL(listener, info.id, tmp.path, reusable.ticket))
      await expectSocketRejected(socketURL(listener, info.id, tmp.path, reusable.ticket))
      ws.close(1000)

      const other = await createCat(listener, tmp.path)
      const scoped = await connectTicket(listener, info.id, tmp.path)
      await expectSocketRejected(socketURL(listener, other.id, tmp.path, scoped.ticket))

      const crossOrigin = await connectTicket(listener, info.id, tmp.path)
      await expectSocketRejected(socketURL(listener, info.id, tmp.path, crossOrigin.ticket), {
        headers: { origin: "https://evil.example" },
      })
    } finally {
      await stop(listener, "timed out cleaning up rejected ticket listener").catch(() => undefined)
    }
  })

  testPty("keeps PTY websocket tickets optional when server auth is disabled", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const listener = await startNoAuthListener()
    try {
      const info = await createCat(listener, tmp.path)
      const ws = await openSocket(socketURL(listener, info.id, tmp.path))
      const message = waitForMessage(ws, (message) => message.includes("ping-no-auth"))
      ws.send("ping-no-auth\n")
      expect(await message).toContain("ping-no-auth")
      ws.close(1000)
    } finally {
      await stop(listener, "timed out cleaning up no-auth listener").catch(() => undefined)
    }
  })
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
