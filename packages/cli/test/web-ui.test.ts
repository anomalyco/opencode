import { NodeHttpServer } from "@effect/platform-node"
import { afterAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpServer, HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { WebUi } from "../src/services/web-ui"

const root = await mkdtemp(path.join(tmpdir(), "opencode-web-ui-"))
afterAll(() => rm(root, { recursive: true, force: true }))

describe("web UI", () => {
  test("falls back from API routes to assets and the SPA index", async () => {
    const index = path.join(root, "index.html")
    const asset = path.join(root, "app.js")
    await writeFile(index, "<html><body>embedded</body></html>")
    await writeFile(asset, "console.log('embedded')")

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transform = yield* WebUi.handler({ assets: { "index.html": index, "app.js": asset } })
          const http = yield* NodeHttpServer.make(createServer, { host: "127.0.0.1", port: 0 })
          yield* http.serve(
            transform(
              Effect.gen(function* () {
                const request = yield* HttpServerRequest.HttpServerRequest
                const pathname = new URL(request.url, "http://localhost").pathname
                if (pathname === "/api/health") return HttpServerResponse.jsonUnsafe({ healthy: true })
                if (pathname === "/api/missing")
                  return HttpServerResponse.jsonUnsafe({ code: "missing" }, { status: 404 })
                return yield* Effect.fail(
                  new HttpServerError.HttpServerError({
                    reason: new HttpServerError.RouteNotFound({ request }),
                  }),
                )
              }),
            ),
          )
          const origin = HttpServer.formatAddress(http.address)

          const health = yield* Effect.promise(() => fetch(`${origin}/api/health`))
          expect(yield* Effect.promise(() => health.json())).toEqual({ healthy: true })

          const missing = yield* Effect.promise(() => fetch(`${origin}/api/missing`))
          expect(missing.status).toBe(404)
          expect(yield* Effect.promise(() => missing.json())).toEqual({ code: "missing" })

          const script = yield* Effect.promise(() => fetch(`${origin}/app.js`))
          expect(yield* Effect.promise(() => script.text())).toBe("console.log('embedded')")

          const fallback = yield* Effect.promise(() => fetch(`${origin}/workspace/example`))
          expect(yield* Effect.promise(() => fallback.text())).toContain("embedded")
          expect(fallback.headers.get("content-security-policy")).toContain("default-src 'self'")
        }),
      ),
    )
  })

  test("adds server credentials to browser URLs", () => {
    const target = new URL(
      WebUi.url({
        url: "http://localhost:4096",
        auth: { type: "basic", username: "opencode", password: "secret" },
      }),
    )
    expect(target.searchParams.get("auth_token")).toBe(btoa("opencode:secret"))
  })
})
