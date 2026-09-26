import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live("serves requests without authentication when no password is configured on loopback", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      app: { version: "test-version" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/info", HttpServer.formatAddress(server.address))),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("www-authenticate")).toBeNull()
    expect(yield* Effect.promise(() => response.json())).toMatchObject({ version: "test-version" })
  }),
)

it.live("still requires authentication when a password is configured", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      app: { version: "test-version" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const url = new URL("/api/info", HttpServer.formatAddress(server.address))
    const anonymous = yield* Effect.promise(() => fetch(url))
    const authenticated = yield* Effect.promise(() =>
      fetch(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
    )

    expect(anonymous.status).toBe(401)
    expect(authenticated.status).toBe(200)
  }),
)
