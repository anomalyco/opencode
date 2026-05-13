import { createHash } from "node:crypto"
import { describe, expect } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigProvider, Effect, Layer } from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ServerAuth } from "../../src/server/auth"
import { authorizationRouterMiddleware } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { serveEmbeddedUIEffect, serveUIEffect } from "../../src/server/shared/ui"
import { Server } from "../../src/server/server"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = {
      OPENCODE_DISABLE_EMBEDDED_WEB_UI: Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI,
      OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
      OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
      envPassword: process.env.OPENCODE_SERVER_PASSWORD,
      envUsername: process.env.OPENCODE_SERVER_USERNAME,
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = original.OPENCODE_DISABLE_EMBEDDED_WEB_UI
        Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
        Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
        restoreEnv("OPENCODE_SERVER_PASSWORD", original.envPassword)
        restoreEnv("OPENCODE_SERVER_USERNAME", original.envUsername)
      }),
    )
  }),
)

const it = testEffect(Layer.mergeAll(testStateLayer, AppFileSystem.defaultLayer))

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

function app(input?: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    ExperimentalHttpApiServer.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            OPENCODE_SERVER_PASSWORD: input?.password,
            OPENCODE_SERVER_USERNAME: input?.username,
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise(() =>
        Promise.resolve(
          handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            ExperimentalHttpApiServer.context,
          ),
        ),
      )
    },
  }
}

function uiApp(input?: { password?: string; username?: string; client?: Layer.Layer<HttpClient.HttpClient> }) {
  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        yield* router.add("*", "/*", (request) => serveUIEffect(request, { fs, client }))
      }),
    ).pipe(
      Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))),
      Layer.provide([
        AppFileSystem.defaultLayer,
        input?.client ?? httpClient(new Response("ui")),
        HttpServer.layerServices,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            OPENCODE_SERVER_PASSWORD: input?.password,
            OPENCODE_SERVER_USERNAME: input?.username,
          }),
        ),
      ]),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise(() =>
        Promise.resolve(
          handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            ExperimentalHttpApiServer.context,
          ),
        ),
      )
    },
  }
}

function httpClient(response: Response, onRequest?: (request: HttpClientRequest.HttpClientRequest) => void) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      onRequest?.(request)
      return Effect.succeed(HttpClientResponse.fromWeb(request, response))
    }),
  )
}

function responseText(response: Response) {
  return Effect.promise(() => response.text())
}

describe("HttpApi UI fallback", () => {
  it.live("serves the web UI through the experimental backend", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true
      let proxiedUrl: string | undefined

      const response = yield* uiApp({
        client: httpClient(
          new Response("<html>opencode</html>", { headers: { "content-type": "text/html" } }),
          (request) => {
            proxiedUrl = request.url
          },
        ),
      }).request("/")

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(yield* responseText(response)).toBe("<html>opencode</html>")
      expect(proxiedUrl).toBe("https://app.opencode.ai/")
    }),
  )

  it.live("strips upstream transfer encoding headers from proxied assets", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true
      let proxiedUrl: string | undefined

      const response = yield* Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        return yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/assets/app.js")), {
          fs,
          client,
        })
      }).pipe(
        Effect.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              proxiedUrl = request.url
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response("console.log('ok')", {
                    headers: {
                      "content-encoding": "br",
                      "content-length": "999",
                      "content-type": "text/javascript",
                    },
                  }),
                ),
              )
            }),
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(response.status).toBe(200)
      expect(proxiedUrl).toBe("https://app.opencode.ai/assets/app.js")
      expect(response.headers.get("content-encoding")).toBeNull()
      expect(response.headers.get("content-length")).not.toBe("999")
      expect(response.headers.get("content-type")).toContain("text/javascript")
      expect(yield* responseText(response)).toBe("console.log('ok')")
    }),
  )

  // Regression for #25698 (Ope): upstream `transfer-encoding: chunked` was
  // forwarded through the proxy while the proxy itself re-frames the body,
  // causing browsers to fail with `ERR_INVALID_CHUNKED_ENCODING`.
  it.live("strips upstream transfer-encoding header from proxied assets", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      const response = yield* Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        return yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/")), {
          fs,
          client,
        })
      }).pipe(
        Effect.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response("<html>opencode</html>", {
                    headers: {
                      "transfer-encoding": "chunked",
                      "content-type": "text/html",
                    },
                  }),
                ),
              ),
            ),
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(response.status).toBe(200)
      expect(response.headers.get("transfer-encoding")).toBeNull()
      expect(yield* responseText(response)).toBe("<html>opencode</html>")
    }),
  )

  it.live("serves embedded UI assets when Bun can read them but access reports missing", () =>
    Effect.gen(function* () {
      let readPath: string | undefined

      const fs = yield* AppFileSystem.Service
      const response = yield* serveEmbeddedUIEffect(
        "/assets/app.js",
        {
          ...fs,
          existsSafe: () => Effect.die("embedded UI should not rely on filesystem access checks"),
          readFile: (path) => {
            readPath = path
            return path === "/$bunfs/root/assets/app.js"
              ? Effect.succeed(new TextEncoder().encode("console.log('embedded')"))
              : Effect.die(`unexpected embedded UI path: ${path}`)
          },
        },
        { "assets/app.js": "/$bunfs/root/assets/app.js" },
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      expect(response.status).toBe(200)
      expect(readPath).toBe("/$bunfs/root/assets/app.js")
      expect(response.headers.get("content-type")).toContain("text/javascript")
      expect(yield* responseText(response)).toBe("console.log('embedded')")
    }),
  )

  it.live("allows embedded UI terminal wasm and theme preload CSP", () =>
    Effect.gen(function* () {
      const script = 'document.documentElement.dataset.theme = "dark"'

      const fs = yield* AppFileSystem.Service
      const response = yield* serveEmbeddedUIEffect(
        "/",
        {
          ...fs,
          readFile: (path) => {
            return path === "/$bunfs/root/index.html"
              ? Effect.succeed(
                  new TextEncoder().encode(
                    `<html><head><script id="oc-theme-preload-script">${script}</script></head></html>`,
                  ),
                )
              : Effect.die(`unexpected embedded UI path: ${path}`)
          },
        },
        { "index.html": "/$bunfs/root/index.html" },
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      const csp = response.headers.get("content-security-policy") ?? ""
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
      expect(csp).toContain(`'sha256-${createHash("sha256").update(script).digest("base64")}'`)
      expect(csp).toContain("connect-src * data:")
    }),
  )

  it.live("keeps matched API routes ahead of the UI fallback", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => Promise.resolve(Server.Default().app.request("/session/ses_nope")))

      expect(response.status).toBe(404)
    }),
  )

  it.live("requires server password for the web UI", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      const response = yield* uiApp({ password: "secret", username: "opencode" }).request("/")

      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe('Basic realm="Secure Area"')
    }),
  )

  it.live("accepts auth token for the web UI", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      const response = yield* uiApp({
        password: "secret",
        username: "opencode",
        client: httpClient(new Response("<html>opencode</html>", { headers: { "content-type": "text/html" } })),
      }).request(`/?auth_token=${btoa("opencode:secret")}`)

      expect(response.status).toBe(200)
      expect(yield* responseText(response)).toBe("<html>opencode</html>")
    }),
  )

  it.live("accepts basic auth for the web UI", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      const response = yield* uiApp({ password: "secret", username: "opencode" }).request("/", {
        headers: { authorization: `Basic ${btoa("opencode:secret")}` },
      })

      expect(response.status).toBe(200)
    }),
  )

  // Regression for #25698 (Ope): the browser fetches the PWA manifest and
  // its icons via flows that don't carry app-managed credentials (the
  // `<link rel="manifest">` request is not under page-auth control), so the
  // server returning 401 breaks PWA install. These specific public assets
  // should bypass auth.
  it.live("serves the PWA manifest without auth even when a server password is set", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      for (const path of ["/site.webmanifest", "/web-app-manifest-192x192.png", "/web-app-manifest-512x512.png"]) {
        const response = yield* uiApp({
          password: "secret",
          username: "opencode",
          client: httpClient(new Response("ok")),
        }).request(path)
        expect(response.status).not.toBe(401)
      }
    }),
  )

  it.live("allows web UI preflight without auth", () =>
    Effect.gen(function* () {
      const response = yield* app({ password: "secret", username: "opencode" }).request("/", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "GET",
        },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    }),
  )
})
