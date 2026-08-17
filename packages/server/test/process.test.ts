import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer, HttpServerError, HttpServerResponse } from "effect/unstable/http"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live("allows browser preflight requests without credentials", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>(
      {
        hostname: "127.0.0.1",
        port: 0,
        password: "secret",
        app: { version: "test-version" },
        database: { path: ":memory:" },
      },
      undefined,
      (api) =>
        api.pipe(
          Effect.catchIf(
            (error) => error instanceof HttpServerError.HttpServerError && error.reason._tag === "RouteNotFound",
            () => Effect.succeed(HttpServerResponse.text("fallback")),
          ),
        ),
    )
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/health", HttpServer.formatAddress(server.address)), {
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

    const health = yield* Effect.promise(() =>
      fetch(new URL("/api/health", HttpServer.formatAddress(server.address)), {
        headers: {
          authorization: `Basic ${btoa("opencode:secret")}`,
          origin: "http://localhost:3000",
        },
      }),
    )

    expect(health.status).toBe(200)
    expect(health.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    expect(yield* Effect.promise(() => health.json())).toMatchObject({ version: "test-version" })

    const missing = yield* Effect.promise(() =>
      fetch(new URL("/missing", HttpServer.formatAddress(server.address)), {
        headers: { authorization: `Basic ${btoa("opencode:secret")}` },
      }),
    )
    expect(missing.status).toBe(200)
    expect(yield* Effect.promise(() => missing.text())).toBe("fallback")
  }),
)

it.live("allows requests without credentials when authentication is disabled", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      app: { version: "test-version" },
      database: { path: ":memory:" },
    })
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/health", HttpServer.formatAddress(server.address))),
    )

    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({ version: "test-version" })
  }),
)
