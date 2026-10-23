import { NodeFileSystem, NodeHttpServer } from "@effect/platform-node"
import { ServerProcess } from "@opencode/server/process"
import { afterAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpServer, HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/http"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { brotliCompressSync } from "node:zlib"
import { WebUi } from "../src/services/web-ui"
import { it } from "../../core/test/lib/effect"

const root = await mkdtemp(path.join(tmpdir(), "opencode-web-ui-"))
afterAll(() => rm(root, { recursive: true, force: true }))

describe("web UI", () => {
  it.live("serves the web shell and assets before server authentication", () =>
    Effect.gen(function* () {
      const transform = yield* WebUi.handler({
        assets: {
          "index.html": "<html><body>connect</body></html>",
          "_assets/app.js": "console.log('connect')",
          "_assets/app.css": "body { color: black; }",
          "icons/icon.svg": "<svg></svg>",
          "font.woff2": new Uint8Array([0, 1, 2, 255]),
          "sw.js": "service worker",
        },
      })
      const server = yield* ServerProcess.start<never, never>(
        { hostname: "127.0.0.1", port: 0, password: "secret", database: { path: ":memory:" } },
        undefined,
        transform,
      )
      const origin = HttpServer.formatAddress(server.address)
      yield* Effect.forEach(
        [
          "/",
          "/settings",
          "/workspace/example",
          "/_assets/app.js",
          "/_assets/app.css",
          "/icons/icon.svg",
          "/font.woff2",
          "/sw.js",
        ],
        (pathname) =>
          Effect.gen(function* () {
            yield* Effect.forEach(["GET", "HEAD"], (method) =>
              Effect.gen(function* () {
                const response = yield* Effect.promise(() => fetch(new URL(pathname, origin), { method }))
                expect(response.status).toBe(200)
                expect(response.headers.get("www-authenticate")).toBeNull()
                yield* Effect.promise(() => response.arrayBuffer())
              }),
            )
          }),
      )
      yield* Effect.forEach(["/api", "/api/info", "/api/event", "/api/missing", "/openapi.json"], (pathname) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() => fetch(new URL(pathname, origin)))
          expect(response.status).toBe(401)
          expect(response.headers.get("www-authenticate")).toBe('Basic realm="Secure Area"')
          yield* Effect.promise(() => response.arrayBuffer())
        }),
      )
      const response = yield* Effect.promise(() =>
        fetch(new URL("/api/info", origin), { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
      )
      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toHaveProperty("pid")

      const pairing = yield* Effect.promise(() =>
        fetch(new URL("/api/pair", origin), {
          method: "POST",
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        }).then((response) => response.json() as Promise<{ code: string }>),
      )
      const redirect = yield* Effect.promise(() =>
        fetch(new URL(`/auth/connect/${pairing.code}`, origin), {
          redirect: "manual",
          headers: { accept: "text/html" },
        }),
      )
      expect(redirect.status).toBe(302)
      const cookie = (redirect.headers.get("set-cookie") ?? "").split(";")[0]
      const authorized = yield* Effect.promise(() => fetch(new URL("/api/info", origin), { headers: { cookie } }))
      expect(authorized.status).toBe(200)
      yield* Effect.promise(() => authorized.arrayBuffer())
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )

  test("sends embedded brotli bytes as they are to browsers that accept them", async () => {
    const script = "console.log('compressed')".repeat(50)
    const html = "<html><body>compressed</body></html>"
    const brotli = { "_assets/app.js": brotliCompressSync(script), "index.html": brotliCompressSync(html) }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transform = yield* WebUi.handler({ assets: { "_assets/app.js": script, "index.html": html }, brotli })
          const http = yield* NodeHttpServer.make(createServer, { host: "127.0.0.1", port: 0 })
          yield* http.serve(transform(Effect.succeed(HttpServerResponse.empty({ status: 404 }))))
          const origin = HttpServer.formatAddress(http.address)
          const get = (pathname: string, encoding: string) =>
            Effect.promise(async () => {
              const response = await fetch(`${origin}${pathname}`, {
                headers: { "accept-encoding": encoding },
                decompress: false,
              })
              return { headers: response.headers, body: new Uint8Array(await response.arrayBuffer()) }
            })

          const encoded = yield* get("/_assets/app.js", "gzip, deflate, br")
          expect(encoded.headers.get("content-encoding")).toBe("br")
          expect(encoded.headers.get("vary")).toBe("accept-encoding")
          expect(encoded.headers.get("content-type")).toContain("javascript")
          expect(encoded.body).toEqual(new Uint8Array(brotli["_assets/app.js"]))

          yield* Effect.forEach(["gzip", "br;q=0"], (encoding) =>
            Effect.gen(function* () {
              const plain = yield* get("/_assets/app.js", encoding)
              expect(plain.headers.get("content-encoding")).toBeNull()
              expect(plain.headers.get("vary")).toBe("accept-encoding")
              expect(new TextDecoder().decode(plain.body)).toBe(script)
            }),
          )

          const page = yield* get("/", "br")
          expect(page.headers.get("content-encoding")).toBeNull()
          expect(new TextDecoder().decode(page.body)).toBe(html)
        }),
      ).pipe(Effect.provide(NodeFileSystem.layer)),
    )
  })

  test("falls back from API routes to assets and the SPA index", async () => {
    const index = path.join(root, "index.html")
    const asset = path.join(root, "app-Ab1cD2e3.js")
    await writeFile(index, "<html><body>embedded</body></html>")
    await writeFile(asset, "console.log('embedded')")
    const assets = {
      "index.html": await Bun.file(index).text(),
      "_assets/app-Ab1cD2e3.js": await Bun.file(asset).text(),
      "sw.js": "service worker",
      "registerSW.js": "registration",
      "font.woff2": new Uint8Array([0, 1, 2, 255]),
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transform = yield* WebUi.handler({ assets })
          const http = yield* NodeHttpServer.make(createServer, { host: "127.0.0.1", port: 0 })
          yield* http.serve(
            transform(
              Effect.gen(function* () {
                const request = yield* HttpServerRequest.HttpServerRequest
                const pathname = new URL(request.url, "http://localhost").pathname
                if (pathname === "/api/info")
                  return HttpServerResponse.jsonUnsafe({
                    version: "test",
                    pid: 1,
                    urls: [origin],
                    paths: { tmp: "/tmp/opencode" },
                  })
                return yield* Effect.fail(
                  new HttpServerError.HttpServerError({
                    reason: new HttpServerError.RouteNotFound({ request }),
                  }),
                )
              }),
            ),
          )
          const origin = HttpServer.formatAddress(http.address)

          const status = yield* Effect.promise(() => fetch(`${origin}/api/info`))
          expect(yield* Effect.promise(() => status.json())).toEqual({
            version: "test",
            pid: 1,
            urls: [origin],
            paths: { tmp: "/tmp/opencode" },
          })

          const missing = yield* Effect.promise(() => fetch(`${origin}/api/missing`))
          expect(missing.status).toBe(404)
          expect(yield* Effect.promise(() => missing.text())).toBe("")

          yield* Effect.forEach(["/_assets/old.js", "/_assets/old.css", "/_assets/missing"], (pathname) =>
            Effect.gen(function* () {
              const missing = yield* Effect.promise(() => fetch(`${origin}${pathname}`))
              expect(missing.status).toBe(404)
              expect(missing.headers.get("cache-control")).toBe("no-store")
              expect(yield* Effect.promise(() => missing.text())).toBe("")
            }),
          )

          const script = yield* Effect.promise(() => fetch(`${origin}/_assets/app-Ab1cD2e3.js`))
          expect(yield* Effect.promise(() => script.text())).toBe("console.log('embedded')")
          expect(script.headers.get("content-type")).toContain("javascript")
          expect(script.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")

          const worker = yield* Effect.promise(() => fetch(`${origin}/sw.js`))
          expect(worker.headers.get("cache-control")).toBe("no-cache")

          const registration = yield* Effect.promise(() => fetch(`${origin}/registerSW.js`))
          expect(registration.headers.get("cache-control")).toBe("no-cache")

          const font = yield* Effect.promise(() => fetch(`${origin}/font.woff2`))
          expect(font.headers.get("content-type")).toBe("font/woff2")
          expect(font.headers.get("cache-control")).toBe("no-cache")
          expect(new Uint8Array(yield* Effect.promise(() => font.arrayBuffer()))).toEqual(
            new Uint8Array([0, 1, 2, 255]),
          )

          const fallback = yield* Effect.promise(() => fetch(`${origin}/workspace/example`))
          expect(yield* Effect.promise(() => fallback.text())).toContain("embedded")
          expect(fallback.headers.get("content-security-policy")).toContain("default-src 'self'")
          expect(fallback.headers.get("content-security-policy")).toContain("connect-src * data: blob:")
          expect(fallback.headers.get("content-security-policy")).toContain("worker-src 'self' blob:")

          const dotted = yield* Effect.promise(() => fetch(`${origin}/workspace/example.js`))
          expect(dotted.status).toBe(200)
          expect(yield* Effect.promise(() => dotted.text())).toContain("embedded")

          const legacy = yield* Effect.promise(() => fetch(`${origin}/assets/missing.js`))
          expect(legacy.status).toBe(200)
          expect(yield* Effect.promise(() => legacy.text())).toContain("embedded")
        }),
      ).pipe(Effect.provide(NodeFileSystem.layer)),
    )
  })

  test("revalidates every unhashed file with an etag while hashed assets stay immutable", async () => {
    const assets = {
      "index.html": "<html><body>embedded</body></html>",
      "_assets/app-Ab1cD2e3.js": "console.log('embedded')",
      "_assets/unhashed.js": "console.log('unhashed')",
      "icons/icon.svg": "<svg></svg>",
      "site.webmanifest": "{}",
      "font.woff2": new Uint8Array([0, 1, 2, 255]),
      "sw.js": "service worker",
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transform = yield* WebUi.handler({ assets })
          const http = yield* NodeHttpServer.make(createServer, { host: "127.0.0.1", port: 0 })
          yield* http.serve(transform(Effect.succeed(HttpServerResponse.empty({ status: 404 }))))
          const origin = HttpServer.formatAddress(http.address)
          const get = (pathname: string, headers?: Record<string, string>) =>
            Effect.promise(() => fetch(`${origin}${pathname}`, { headers }))

          for (const [pathname, cache] of [
            ["/_assets/app-Ab1cD2e3.js", "public, max-age=31536000, immutable"],
            ["/_assets/unhashed.js", "no-cache"],
            ["/icons/icon.svg", "no-cache"],
            ["/site.webmanifest", "no-cache"],
            ["/font.woff2", "no-cache"],
            ["/sw.js", "no-cache"],
            ["/", "no-cache"],
          ] as const) {
            const response = yield* get(pathname)
            expect(response.headers.get("cache-control")).toBe(cache)
            expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/)
            expect(response.headers.get("x-opencode-version")).toBeTruthy()
            yield* Effect.promise(() => response.arrayBuffer())
          }

          const page = yield* get("/")
          const etag = page.headers.get("etag")!
          const revalidated = yield* get("/", { "if-none-match": etag })
          expect(revalidated.status).toBe(304)
          expect(revalidated.headers.get("etag")).toBe(etag)
          expect(revalidated.headers.get("cache-control")).toBe("no-cache")
          expect(yield* Effect.promise(() => revalidated.text())).toBe("")
        }),
      ).pipe(Effect.provide(NodeFileSystem.layer)),
    )
  })
})
