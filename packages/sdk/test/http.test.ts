import { createServer } from "node:http"
import { expect } from "bun:test"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/unstable/http"
import { testEffect } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import type { OpenCode } from "../src/effect"

const it = testEffect(Layer.empty)
const ptyTest = process.platform === "win32" ? it.live.skip : it.live
const auth = { authorization: `Basic ${btoa("opencode:secret")}` }

// Serves the embedded instance as an embedder would: the server is acquired after the instance, so it stops first.
type Sdk = typeof import("../src/effect")
type Served = {
  sdk: Sdk
  opencode: OpenCode.Interface
  base: string
  location: string
  directory: string
  urls: Array<string>
}

const served = <A, E, R>(f: (input: Served) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir("opencode-sdk-http-")),
    (directory) => Effect.promise(() => directory[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((directory) =>
      Effect.gen(function* () {
        const sdk = yield* Effect.promise(() => import("../src/effect"))
        const urls: Array<string> = []
        const opencode = yield* sdk.OpenCode.create({
          config: { directory: directory.path, project: false, content: "{}" },
          models: { fetch: false },
          fs: { filewatcher: false },
          password: "secret",
          urls: () => urls,
        })
        const node = createServer()
        const server = yield* NodeHttpServer.make(() => node, { host: "127.0.0.1", port: 0 })
        yield* server.serve(opencode.http).pipe(Effect.provide(NodeHttpServer.layerHttpServices))
        // Close open SSE streams before the serving fiber stops.
        yield* Effect.addFinalizer(() => Effect.sync(() => node.closeAllConnections()))
        return yield* f({
          sdk,
          opencode,
          urls,
          base: HttpServer.formatAddress(server.address),
          location: `directory=${encodeURIComponent(directory.path)}`,
          directory: directory.path,
        })
      }),
    ),
    Effect.scoped,
  )

it.live("serves the embedded instance to external clients", () =>
  served(({ sdk, opencode, base, location, directory, urls }) =>
    Effect.gen(function* () {
      // In-process SDK calls still work once the routes require the password.
      const created = yield* opencode.sessions.create({
        id: sdk.Session.ID.create(),
        location: sdk.Location.Ref.make({ directory: sdk.AbsolutePath.make(directory) }),
      })
      const page = yield* opencode.sessions.list({ directory: sdk.AbsolutePath.make(directory) })
      expect(page.data.map((session) => session.id)).toContain(created.id)
      yield* Effect.promise(async () => {
        expect((await fetch(`${base}/api/session?${location}`)).status).toBe(401)
        expect((await fetch(`${base}/api/session?${location}`, { headers: auth })).status).toBe(200)
        // Addresses known only after startup are reported once they exist.
        expect((await (await fetch(`${base}/api/info`, { headers: auth })).json()).urls).toEqual([])
        urls.push("https://opencode.example")
        expect((await (await fetch(`${base}/api/info`, { headers: auth })).json()).urls).toEqual([
          "https://opencode.example",
        ])

        const preflight = await fetch(`${base}/api/session`, {
          method: "OPTIONS",
          headers: { origin: "https://app.opencode.ai", "access-control-request-method": "GET" },
        })
        expect(preflight.headers.get("access-control-allow-origin")).toBe("https://app.opencode.ai")

        const events = await fetch(`${base}/api/event`, { headers: auth })
        expect(events.headers.get("content-type")).toContain("text/event-stream")
        const reader = events.body!.getReader()
        expect(new TextDecoder().decode((await reader.read()).value)).toContain("server.connected")
        await reader.cancel()

        // A pairing code yields a session token that works as the password.
        const pairing = await (await fetch(`${base}/api/pair`, { method: "POST", headers: auth })).json()
        const session = await (
          await fetch(`${base}/auth/connect/${pairing.code}`, { headers: { accept: "application/json" } })
        ).json()
        const paired = await fetch(`${base}/api/session?${location}`, {
          headers: { authorization: `Basic ${btoa(`opencode:${session.token}`)}` },
        })
        expect(paired.status).toBe(200)
      })
    }),
  ),
)

ptyTest("accepts PTY WebSockets", () =>
  served(({ base, location }) =>
    Effect.promise(async () => {
      const pty = await (
        await fetch(`${base}/api/pty?${location}`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ command: "/bin/sh", args: ["-c", "echo http-pty-ready; exec cat"] }),
        })
      ).json()
      const ticket = await (
        await fetch(`${base}/api/pty/${pty.data.id}/connect-token?${location}`, {
          method: "POST",
          headers: { ...auth, "x-opencode-ticket": "1" },
        })
      ).json()
      const url = new URL(`/api/pty/${pty.data.id}/connect?${location}`, base)
      url.protocol = "ws:"
      url.searchParams.set("ticket", ticket.data.ticket)
      const output = await new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(url)
        let text = ""
        const timeout = setTimeout(() => reject(new Error(`PTY output missing: ${text}`)), 5_000)
        socket.addEventListener("message", (event) => {
          text += typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data)
          if (!text.includes("http-pty-ready")) return
          clearTimeout(timeout)
          socket.close()
          resolve(text)
        })
        socket.addEventListener("error", () => {
          clearTimeout(timeout)
          reject(new Error("PTY WebSocket failed"))
        })
      })
      expect(output).toContain("http-pty-ready")
    }),
  ),
)
