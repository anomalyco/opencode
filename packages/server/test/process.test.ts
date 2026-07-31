import { Database } from "bun:sqlite"
import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import path from "node:path"
import { it } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { ServerAuth } from "../src/auth"
import { ServerProcess } from "../src/process"

it.live("allows browser preflight requests without credentials", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      app: { version: "test-version" },
      database: { path: ":memory:" },
    })
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
  }),
)

it.live("returns a structured error when session creation hits a database error", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir("opencode-server-test-")),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const database = path.join(tmp.path, "opencode.db")
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      app: { version: "test-version" },
      database: { path: database },
    })

    yield* Effect.sync(() => {
      const sqlite = new Database(database)
      sqlite.run("ALTER TABLE session DROP COLUMN title")
      sqlite.close()
    })

    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/session", HttpServer.formatAddress(server.address)), {
        method: "POST",
        headers: {
          authorization: ServerAuth.header({ password: "secret" })!,
          "content-type": "application/json",
        },
        body: JSON.stringify({ location: { directory: tmp.path } }),
      }),
    )
    const body = yield* Effect.promise(() => response.json())

    expect(response.status).toBe(500)
    expect(body).toMatchObject({
      _tag: "UnknownError",
      message: "Unexpected server error. Check server logs for details.",
    })
    if (typeof body !== "object" || body === null || !("ref" in body)) throw new Error("Expected an error reference")
    expect(body.ref).toMatch(/^err_[0-9a-f-]{8}$/)
  }),
)
