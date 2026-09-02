import { NodeFileSystem } from "@effect/platform-node"
import { ServerProcess } from "@opencode-ai/server/process"
import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { testEffect } from "../../core/test/lib/effect"
import { WebUi } from "../src/services/web-ui"

const it = testEffect(NodeFileSystem.layer)

it.live("serves the app and static assets publicly while authenticating only API requests", () =>
  Effect.gen(function* () {
    const icons = ["dev", "beta", "prod"].flatMap((channel) =>
      ["favicon.ico", "apple-touch-icon.png", "web-app-manifest-192x192.png", "web-app-manifest-512x512.png"].map(
        (name) => `icons/${channel}/${name}`,
      ),
    )
    const assets = Object.fromEntries([
      ["index.html", "app shell"],
      ["_assets/app.js", "app script"],
      ["_assets/app.css", "app styles"],
      ["sw.js", "service worker"],
      ["registerSW.js", "registration"],
      ["assets/font.woff2", "font"],
      ["other/image.png", "image"],
      ["site.webmanifest", '{"display":"standalone"}'],
      ...icons.filter((name) => name !== "icons/dev/favicon.ico").map((name) => [name, `icon:${name}`]),
    ])
    const transform = yield* WebUi.handler({ assets })
    const server = yield* ServerProcess.start<never, never>(
      { hostname: "127.0.0.1", port: 0, password: "secret", database: { path: ":memory:" } },
      undefined,
      transform,
    )
    const origin = HttpServer.formatAddress(server.address)

    yield* Effect.forEach([...Object.keys(assets), "icons/dev/favicon.ico", "_assets/missing.js"], (name) =>
      Effect.forEach(["GET", "HEAD"], (method) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() => fetch(`${origin}/${name}?install=1`, { method }))
          expect(response.headers.get("www-authenticate")).toBeNull()
          if (assets[name] === undefined) {
            expect(response.status).toBe(404)
            expect(response.headers.get("cache-control")).toBe("no-store")
            expect(yield* Effect.promise(() => response.text())).toBe("")
            return
          }
          expect(response.status).toBe(200)
          expect(response.headers.get("content-type")).not.toBeNull()
          expect(response.headers.get("x-content-type-options")).toBe("nosniff")
          expect(yield* Effect.promise(() => response.text())).toBe(method === "HEAD" ? "" : assets[name])
        }),
      ),
    )

    yield* Effect.forEach(["/", "/workspace/example", "/apiculture"], (pathname) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => fetch(`${origin}${pathname}`))
        expect(response.status).toBe(200)
        expect(response.headers.get("www-authenticate")).toBeNull()
        expect(yield* Effect.promise(() => response.text())).toBe("app shell")
      }),
    )

    yield* Effect.forEach(["GET", "HEAD", "POST", "PUT", "DELETE"], (method) =>
      Effect.forEach(
        ["/api", "/api/health", "/api/server", "/api/event", "/api/missing", "/openapi.json"],
        (pathname) =>
          Effect.gen(function* () {
            const response = yield* Effect.promise(() => fetch(`${origin}${pathname}`, { method }))
            expect(response.status).toBe(401)
            expect(response.headers.get("www-authenticate")).toContain("Basic")
            expect(yield* Effect.promise(() => response.text())).toBe("")
          }),
      ),
    )

    yield* Effect.forEach(["POST", "PUT", "DELETE"], (method) =>
      Effect.forEach(["site.webmanifest", "icons/beta/apple-touch-icon.png"], (name) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() => fetch(`${origin}/${name}`, { method }))
          expect(response.status).toBe(405)
          expect(response.headers.get("www-authenticate")).toBeNull()
          expect(yield* Effect.promise(() => response.text())).toBe("")
        }),
      ),
    )

    yield* Effect.forEach(["/", "/api/health"], (pathname) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(`${origin}${pathname}`, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
        )
        expect(response.status).toBe(200)
        const body = yield* Effect.promise(() => response.text())
        if (pathname === "/") expect(body).toBe("app shell")
        if (pathname === "/api/health") expect(JSON.parse(body)).toMatchObject({ healthy: true })
      }),
    )

    const missing = yield* Effect.promise(() =>
      fetch(`${origin}/api/missing`, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
    )
    expect(missing.status).toBe(404)
    expect(yield* Effect.promise(() => missing.text())).toBe("")
  }),
)
