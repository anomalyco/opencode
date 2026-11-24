import { expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live("authenticates API requests behind the frontend transform while allowing browser preflight", () =>
  Effect.gen(function* () {
    const fallback = "fallback".repeat(256)
    const server = yield* ServerProcess.start<never, never>(
      {
        hostname: "127.0.0.1",
        port: 0,
        password: "secret",
        cors: ["http://192.168.1.10:3001", "https://example.com"],
        app: { version: "test-version" },
        database: { path: ":memory:" },
      },
      undefined,
      (api) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const url = new URL(request.url, "http://localhost")
          if (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/openapi.json")
            return yield* api
          return HttpServerResponse.raw(fallback, { contentType: "text/plain" })
        }),
    )
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/info", HttpServer.formatAddress(server.address)), {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      }),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    expect(response.headers.get("access-control-allow-headers")).toBe("authorization")

    const status = yield* Effect.promise(() =>
      fetch(new URL("/api/info", HttpServer.formatAddress(server.address)), {
        headers: {
          authorization: `Basic ${btoa("opencode:secret")}`,
          origin: "http://localhost:3000",
        },
      }),
    )

    expect(status.status).toBe(200)
    expect(status.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    expect(yield* Effect.promise(() => status.json())).toMatchObject({ version: "test-version" })

    yield* Effect.forEach(
      ["http://192.168.1.10:3001", "https://example.com", "https://untrusted.example.com"],
      (origin) =>
        Effect.gen(function* () {
          const allowed = origin === "https://untrusted.example.com" ? null : origin
          const preflight = yield* Effect.promise(() =>
            fetch(new URL("/api/info", HttpServer.formatAddress(server.address)), {
              method: "OPTIONS",
              headers: {
                origin,
                "access-control-request-method": "GET",
                "access-control-request-headers": "authorization",
              },
            }),
          )
          expect(preflight.status).toBe(204)
          expect(preflight.headers.get("access-control-allow-origin")).toBe(allowed)

          const status = yield* Effect.promise(() =>
            fetch(new URL("/api/info", HttpServer.formatAddress(server.address)), {
              headers: { origin, authorization: `Basic ${btoa("opencode:secret")}` },
            }),
          )
          expect(status.status).toBe(200)
          expect(status.headers.get("access-control-allow-origin")).toBe(allowed)
          yield* Effect.promise(() => status.arrayBuffer())

          const denied = yield* Effect.promise(() =>
            fetch(new URL("/api/info", HttpServer.formatAddress(server.address)), { headers: { origin } }),
          )
          expect(denied.status).toBe(401)
          expect(denied.headers.get("access-control-allow-origin")).toBe(allowed)
          yield* Effect.promise(() => denied.arrayBuffer())
        }),
    )

    const event = yield* Effect.promise(() =>
      fetch(new URL("/api/event", HttpServer.formatAddress(server.address)), {
        headers: {
          "accept-encoding": "br",
          authorization: `Basic ${btoa("opencode:secret")}`,
        },
      }),
    )
    expect(event.status).toBe(200)
    expect(event.headers.get("content-encoding")).toBeNull()
    const body = event.body
    if (!body) return yield* Effect.die(new Error("Event response has no body"))
    const reader = body.getReader()
    yield* Effect.promise(() => readUntil(reader, "server.connected"))
    yield* server.updateAvailable("2.0.0")
    yield* Effect.promise(() => readUntil(reader, "installation.update-available"))
    yield* server.updated("2.0.0")
    yield* Effect.promise(() => readUntil(reader, "installation.updated"))
    yield* Effect.promise(() => reader.cancel())

    const missing = yield* Effect.promise(() =>
      fetch(new URL("/missing", HttpServer.formatAddress(server.address)), {
        headers: {
          "accept-encoding": "br",
          authorization: `Basic ${btoa("opencode:secret")}`,
        },
      }),
    )
    expect(missing.status).toBe(200)
    expect(missing.headers.get("content-encoding")).toBe("br")
    expect(missing.headers.get("content-type")).toBe("text/plain")
    expect(missing.headers.get("vary")?.toLowerCase()).toContain("accept-encoding")
    expect(yield* Effect.promise(() => missing.text())).toBe(fallback)

    yield* Effect.forEach(["/api", "/api/missing", "/openapi.json"], (pathname) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => fetch(new URL(pathname, HttpServer.formatAddress(server.address))))
        expect(response.status).toBe(401)
        expect(yield* Effect.promise(() => response.json())).toEqual({
          _tag: "UnauthorizedError",
          message: "Authentication required",
        })
      }),
    )

    yield* Effect.forEach(["/", "/workspace/example", "/_assets/app.js", "/icons/icon.svg", "/sw.js"], (pathname) =>
      Effect.gen(function* () {
        yield* Effect.forEach(["GET", "HEAD"], (method) =>
          Effect.gen(function* () {
            yield* Effect.forEach([undefined, `Basic ${btoa("opencode:wrong")}`], (authorization) =>
              Effect.gen(function* () {
                const response = yield* Effect.promise(() =>
                  fetch(new URL(pathname, HttpServer.formatAddress(server.address)), {
                    method,
                    headers: authorization ? { authorization } : undefined,
                  }),
                )
                expect(response.status).toBe(200)
                expect(response.headers.get("www-authenticate")).toBeNull()
                expect(yield* Effect.promise(() => response.text())).toBe(method === "HEAD" ? "" : fallback)
              }),
            )
            const response = yield* Effect.promise(() =>
              fetch(new URL(pathname, HttpServer.formatAddress(server.address)), {
                method,
                headers: { authorization: `Basic ${btoa("opencode:secret")}` },
              }),
            )
            expect(response.status).toBe(200)
            expect(yield* Effect.promise(() => response.text())).toBe(method === "HEAD" ? "" : fallback)
          }),
        )
      }),
    )
  }),
)

it.live("pairing links sign in browsers with a cookie and API clients with a token", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      app: { version: "test-version" },
      database: { path: ":memory:" },
    })
    const base = HttpServer.formatAddress(server.address)
    const request = (pathname: string, init?: RequestInit) =>
      Effect.promise(() => fetch(new URL(pathname, base), { redirect: "manual", ...init }))
    const pair = Effect.gen(function* () {
      const response = yield* request("/api/pair", {
        method: "POST",
        headers: { authorization: `Basic ${btoa("opencode:secret")}` },
      })
      expect(response.status).toBe(200)
      return (yield* Effect.promise(() => response.json())) as { code: string; expires_in: number }
    })

    const rejected = yield* request("/api/pair", { method: "POST" })
    expect(rejected.status).toBe(401)
    expect(rejected.headers.get("www-authenticate")).toBe('Basic realm="Secure Area"')
    // A Basic challenge on fetch makes browsers show a native prompt instead of the app's sign-in screen.
    const fetched = yield* request("/api/info", { headers: { "sec-fetch-mode": "cors" } })
    expect(fetched.status).toBe(401)
    expect(fetched.headers.get("www-authenticate")).toBeNull()

    const browser = yield* pair
    expect(browser.expires_in).toBe(300)
    const redirect = yield* request(`/auth/connect/${browser.code}`, { headers: { accept: "text/html" } })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get("location")).toBe("/")
    const setCookie = redirect.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`opencode_session_${new URL(base).port}=`)
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=Lax")
    const cookie = setCookie.split(";")[0]

    const reused = yield* request(`/auth/connect/${browser.code}`, { headers: { accept: "text/html" } })
    expect(reused.status).toBe(401)
    expect(yield* Effect.promise(() => reused.text())).toContain("opencode pair")

    expect((yield* request("/api/info", { headers: { cookie } })).status).toBe(200)
    expect((yield* request("/api/info", { headers: { cookie, origin: base } })).status).toBe(200)
    expect((yield* request("/api/info", { headers: { cookie, origin: "http://127.0.0.1:1" } })).status).toBe(401)
    expect((yield* request("/api/info", { headers: { cookie: `${cookie}x` } })).status).toBe(401)

    const client = yield* pair
    const redeemed = yield* request(`/auth/connect/${client.code}`)
    expect(redeemed.status).toBe(200)
    const session = (yield* Effect.promise(() => redeemed.json())) as { token: string }
    expect(
      (yield* request("/api/info", { headers: { authorization: `Basic ${btoa(`opencode:${session.token}`)}` } }))
        .status,
    ).toBe(200)
    expect((yield* request(`/auth/connect/${client.code}`)).status).toBe(401)
    expect((yield* request("/auth/connect/unknown")).status).toBe(401)
  }),
)

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string) {
  while (true) {
    const next = await reader.read()
    if (next.done) throw new Error(`Event stream ended before ${expected}`)
    if (new TextDecoder().decode(next.value).includes(expected)) return
  }
}

it.live("server info lists remote URLs alongside local addresses while they are available", () =>
  Effect.gen(function* () {
    const remote = { urls: ["https://example.opentunnel.xyz"] as ReadonlyArray<string> }
    const server = yield* ServerProcess.start<never, never>(
      { hostname: "127.0.0.1", port: 0, password: "secret", database: { path: ":memory:" } },
      undefined,
      undefined,
      () => remote.urls,
    )
    const base = HttpServer.formatAddress(server.address)
    const info = () =>
      Effect.promise(() =>
        fetch(new URL("/api/info", base), { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }).then(
          (response) => response.json() as Promise<{ urls: ReadonlyArray<string> }>,
        ),
      )

    expect((yield* info()).urls).toEqual([base, "https://example.opentunnel.xyz"])
    remote.urls = []
    expect((yield* info()).urls).toEqual([base])
  }),
)

it.live("a listener's readiness waits for boot before /api/info reports ready", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>()
    const base = yield* Deferred.make<string>()
    const ready = yield* Deferred.make<Effect.Effect<void>>()
    const fiber = yield* Effect.forkChild(
      ServerProcess.start<never, never>(
        { hostname: "127.0.0.1", port: 0, password: "secret", database: { path: ":memory:" } },
        {
          onListen: (address, _shutdown, readyEffect) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(base, HttpServer.formatAddress(address))
              yield* Deferred.succeed(ready, readyEffect)
              yield* Deferred.await(release)
              return Effect.void
            }),
        },
      ),
    )
    const url = yield* Deferred.await(base)
    const readyEffect = yield* Deferred.await(ready)
    const infoStatus = () =>
      Effect.promise(() =>
        fetch(new URL("/api/info", url), { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }).then(
          (response) => response.status,
        ),
      )

    // Boot is gated, so the effect handed to the listener must still be pending and the health
    // endpoint must stay unavailable. With `status.ready` passed directly this flipped the status.
    const completion = yield* Deferred.make<void>()
    yield* Effect.forkChild(readyEffect.pipe(Effect.andThen(Deferred.succeed(completion, undefined))))
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(completion)).toBe(false)
    expect(yield* infoStatus()).toBe(503)

    yield* Deferred.succeed(release, undefined)
    yield* readyEffect
    expect(yield* Deferred.isDone(completion)).toBe(true)
    expect(yield* infoStatus()).toBe(200)
    yield* Fiber.join(fiber)
  }),
)

it.live("a failed boot fails readiness and keeps /api/info reporting failure", () =>
  Effect.gen(function* () {
    const database = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-boot-")))
    const release = yield* Deferred.make<void>()
    const base = yield* Deferred.make<string>()
    const ready = yield* Deferred.make<Effect.Effect<void>>()
    yield* Effect.forkChild(
      ServerProcess.start<never, never>(
        { hostname: "127.0.0.1", port: 0, password: "secret", database: { path: database } },
        {
          onListen: (address, _shutdown, readyEffect) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(base, HttpServer.formatAddress(address))
              yield* Deferred.succeed(ready, readyEffect)
              yield* Deferred.await(release)
              return Effect.void
            }),
        },
      ),
    )
    const url = yield* Deferred.await(base)
    const readyEffect = yield* Deferred.await(ready)
    const infoStatus = () =>
      Effect.promise(() =>
        fetch(new URL("/api/info", url), { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }).then(
          (response) => response.status,
        ),
      )
    expect(yield* infoStatus()).toBe(503)

    yield* Deferred.succeed(release, undefined)
    // A failed boot never advertises readiness: a client waiting on this effect sees the failure
    // instead of a success that would hand out an endpoint whose routes were never built.
    expect(Exit.isFailure(yield* Effect.exit(readyEffect))).toBe(true)
    expect(yield* infoStatus()).toBe(500)
    yield* Effect.promise(() => fs.rm(database, { recursive: true, force: true }))
  }),
)
