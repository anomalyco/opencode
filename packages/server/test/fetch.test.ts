import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const options = {
  app: { version: "test-version" },
  database: { path: ":memory:" },
  fs: { filewatcher: false },
} as const

it.live("serves the HttpApi and enforces Basic auth like the Node server", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({ ...options, password: "secret" })

    const denied = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/health")))
    expect(denied.status).toBe(401)

    const response = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/health", {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        }),
      ),
    )
    expect(response.status).toBe(200)
    const body: unknown = yield* Effect.promise(() => response.json())
    if (typeof body !== "object" || body === null) throw new Error("Expected a health response object")
    expect((body as Record<string, unknown>)["healthy"]).toBe(true)
  }).pipe(Effect.scoped),
)

it.live("serves unauthenticated and answers CORS preflight when no password is configured", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)

    const response = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/health")))
    expect(response.status).toBe(200)

    const preflight = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/health", {
          method: "OPTIONS",
          headers: {
            origin: "http://localhost:3000",
            "access-control-request-method": "GET",
          },
        }),
      ),
    )
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
  }).pipe(Effect.scoped),
)

it.live("serves the session view operation and missing-session error", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)
    const created = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      ).then((response) => response.json()),
    )
    if (typeof created !== "object" || created === null || !("data" in created))
      return yield* Effect.die(new Error("Expected a session response"))
    const data = created.data
    if (typeof data !== "object" || data === null || !("id" in data) || typeof data.id !== "string")
      return yield* Effect.die(new Error("Expected a session ID"))

    const viewed = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/session/${data.id}/view`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idle: 0 }),
        }),
      ),
    )
    expect(viewed.status).toBe(204)

    const invalid = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/session/${data.id}/view`, { method: "POST" })),
    )
    expect(invalid.status).toBe(400)

    const missing = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session/ses_missing_view/view", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idle: 0 }),
        }),
      ),
    )
    expect(missing.status).toBe(404)
  }).pipe(Effect.scoped),
)

// Pins the eager-boot guarantee: the application layer is built before the handler returns, so
// an aborted first request cannot interrupt layer construction and wedge every later request
// (the Effect-TS/effect#6319 failure class that lazy first-request builds are prone to).
it.live("stays serviceable when the first request aborts", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)

    const aborted = yield* Effect.promise(() => {
      const controller = new AbortController()
      const first = handler(new Request("http://opencode.local/api/health", { signal: controller.signal }))
      controller.abort()
      return first.then(
        () => "resolved" as const,
        () => "rejected" as const,
      )
    })
    expect(["resolved", "rejected"]).toContain(aborted)

    const second = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/health")))
    expect(second.status).toBe(200)
  }).pipe(Effect.scoped),
)
