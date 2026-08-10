import { afterAll, describe, expect, test } from "bun:test"
import { WebUi } from "../src/services/web-ui"
import type { Endpoint } from "@opencode-ai/client/effect/service"
import { Effect, Ref } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const root = await mkdtemp(path.join(tmpdir(), "opencode-web-ui-"))
afterAll(() => rm(root, { recursive: true, force: true }))

describe("TUI web UI", () => {
  test("bootstraps a private browser session and proxies the current API endpoint", async () => {
    const index = path.join(root, "index.html")
    await writeFile(index, "<html><body>embedded</body></html>")
    const first = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ server: "first" }),
    })
    const second = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ server: "second" }),
    })

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const endpoint = yield* Ref.make({ url: first.url.toString() })
            const launch = yield* WebUi.start(endpoint, { assets: { "index.html": index } })
            const origin = new URL(launch).origin

            expect((yield* Effect.promise(() => fetch(origin))).status).toBe(401)
            const bootstrap = yield* Effect.promise(() => fetch(launch, { redirect: "manual" }))
            expect(bootstrap.status).toBe(302)
            expect(bootstrap.headers.get("location")).toBe("/")
            const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0]
            expect(cookie).toStartWith("opencode-web=")

            const page = yield* Effect.promise(() => fetch(origin, { headers: { cookie: cookie ?? "" } }))
            expect(yield* Effect.promise(() => page.text())).toContain("embedded")
            expect(page.headers.get("content-security-policy")).toContain("default-src 'self'")

            const before = yield* Effect.promise(() => fetch(`${origin}/api/health`, { headers: { cookie: cookie ?? "" } }))
            expect(yield* Effect.promise(() => before.json())).toEqual({ server: "first" })
            yield* Ref.set(endpoint, { url: second.url.toString() })
            const after = yield* Effect.promise(() => fetch(`${origin}/api/health`, { headers: { cookie: cookie ?? "" } }))
            expect(yield* Effect.promise(() => after.json())).toEqual({ server: "second" })
          }),
        ),
      )
    } finally {
      first.stop(true)
      second.stop(true)
    }
  })

  test("rejects foreign origins", async () => {
    const index = path.join(root, "origin.html")
    await writeFile(index, "embedded")
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const endpoint = yield* Ref.make({ url: "http://127.0.0.1:1" })
          const launch = yield* WebUi.start(endpoint, { assets: { "index.html": index } })
          const bootstrap = yield* Effect.promise(() => fetch(launch, { redirect: "manual" }))
          const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0]
          const response = yield* Effect.promise(() =>
            fetch(new URL(launch).origin, {
              headers: { cookie: cookie ?? "", origin: "https://example.com" },
            }),
          )
          expect(response.status).toBe(403)
        }),
      ),
    )
  })

  test("forwards websocket messages", async () => {
    const index = path.join(root, "websocket.html")
    await writeFile(index, "embedded")
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return
        return new Response(null, { status: 426 })
      },
      websocket: {
        message(socket, message) {
          socket.send(message)
        },
      },
    })
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const endpoint = yield* Ref.make({ url: upstream.url.toString() })
            const launch = yield* WebUi.start(endpoint, { assets: { "index.html": index } })
            const target = new URL("/api/pty/test/connect?ticket=test", launch)
            target.searchParams.set("cli_token", new URL(launch).searchParams.get("cli_token") ?? "")
            target.protocol = "ws:"
            const message = yield* Effect.promise(
              () =>
                new Promise<string>((resolve, reject) => {
                  const socket = new WebSocket(target)
                  socket.addEventListener("open", () => socket.send("hello"), { once: true })
                  socket.addEventListener("message", (event) => {
                    resolve(event.data.toString())
                    socket.close()
                  }, { once: true })
                  socket.addEventListener("error", reject, { once: true })
                }),
            )
            expect(message).toBe("hello")
          }),
        ),
      )
    } finally {
      upstream.stop(true)
    }
  })

  test("serves foreground UI with server credentials", async () => {
    const index = path.join(root, "serve.html")
    await writeFile(index, "<html>foreground</html>")
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/api/server"
          ? Response.json({ urls: ["http://private"] })
          : Response.json({ url: request.url }),
    })
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const endpoint = yield* Ref.make<Endpoint>({
              url: upstream.url.toString(),
              auth: { type: "basic", username: "opencode", password: "private" },
            })
            const origin = yield* WebUi.serve(endpoint, {
              hostname: "127.0.0.1",
              port: 0,
              password: "secret",
              assets: { "index.html": index },
            })
            const denied = yield* Effect.promise(() => fetch(origin))
            expect(denied.status).toBe(401)
            expect(denied.headers.get("www-authenticate")).toContain("Basic")

            const authorization = `Basic ${Buffer.from("opencode:secret").toString("base64")}`
            const page = yield* Effect.promise(() => fetch(origin, { headers: { authorization } }))
            expect(yield* Effect.promise(() => page.text())).toContain("foreground")

            const token = Buffer.from("opencode:secret").toString("base64")
            const query = yield* Effect.promise(() => fetch(`${origin}/?auth_token=${encodeURIComponent(token)}`))
            expect(query.status).toBe(200)

            const proxied = yield* Effect.promise(() =>
              fetch(`${origin}/api/health?auth_token=${encodeURIComponent(token)}&keep=yes`),
            )
            const proxiedBody = yield* Effect.promise(() => proxied.json())
            expect(new URL(proxiedBody.url).search).toBe("?keep=yes")

            const info = yield* Effect.promise(() => fetch(`${origin}/api/server`, { headers: { authorization } }))
            expect(yield* Effect.promise(() => info.json())).toEqual({ urls: [origin] })
          }),
        ),
      )
    } finally {
      upstream.stop(true)
    }
  })

  test("formats localhost listeners as valid URLs", async () => {
    const index = path.join(root, "localhost.html")
    await writeFile(index, "embedded")
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const endpoint = yield* Ref.make({ url: "http://127.0.0.1:1" })
          const origin = yield* WebUi.serve(endpoint, {
            hostname: "localhost",
            port: 0,
            password: "secret",
            assets: { "index.html": index },
          })
          expect(new URL(origin).protocol).toBe("http:")
        }),
      ),
    )
  })

  test("shuts down with an active websocket", async () => {
    const index = path.join(root, "shutdown.html")
    await writeFile(index, "embedded")
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return
        return new Response(null, { status: 426 })
      },
      websocket: { message() {} },
    })
    let socket: WebSocket | undefined
    try {
      const run = Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const endpoint = yield* Ref.make({ url: upstream.url.toString() })
            const launch = yield* WebUi.start(endpoint, { assets: { "index.html": index } })
            const target = new URL("/api/pty/test/connect?ticket=test", launch)
            target.searchParams.set("cli_token", new URL(launch).searchParams.get("cli_token") ?? "")
            target.protocol = "ws:"
            socket = new WebSocket(target)
            yield* Effect.promise(
              () => new Promise<void>((resolve, reject) => {
                socket?.addEventListener("open", () => resolve(), { once: true })
                socket?.addEventListener("error", reject, { once: true })
              }),
            )
          }),
        ),
      )
      await Promise.race([
        run,
        new Promise((_, reject) => setTimeout(() => reject(new Error("web UI shutdown timed out")), 2_000)),
      ])
    } finally {
      socket?.close()
      upstream.stop(true)
    }
  })
})
