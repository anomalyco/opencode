import { expect } from "bun:test"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationError, LocationServices } from "@opencode-ai/core/location-services"
import { Session } from "@opencode-ai/core/session"
import { Effect, Layer, LayerMap } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const fixture = Effect.gen(function* () {
  const acquisitions: Location.Ref[] = []
  const locations = Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make((ref: Location.Ref) => {
      acquisitions.push(ref)
      return Layer.effectContext<LocationServices, LocationError, never>(Effect.die("Location must not be acquired"))
    }),
  )
  const handler = yield* ServerFetch.make(
    {
      app: { version: "test-version" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      config: { project: false, content: "{}" },
    },
    { overrides: [[LocationServiceMap.node, locations]] },
  )
  const post = (pathname: string, body?: unknown) =>
    Effect.promise(() =>
      handler(
        new Request(`http://opencode.local${pathname}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      ),
    )
  return { acquisitions, post }
})

it.live("session controls preserve malformed and unknown session errors without acquiring a Location", () =>
  Effect.gen(function* () {
    const server = yield* fixture
    yield* Effect.forEach(
      ["wait", "interrupt", "interrupt?continue=invalid", "prompt", "synthetic", "compact"],
      (operation) =>
        Effect.gen(function* () {
          yield* Effect.forEach(["invalid", "msg_invalid", "SES_invalid"], (id) =>
            Effect.gen(function* () {
              const response = yield* server.post(`/api/session/${id}/${operation}`)
              expect(response.status).toBe(400)
              expect(yield* Effect.promise(() => response.json())).toEqual({
                _tag: "InvalidRequestError",
                message: "Invalid session ID",
                field: "sessionID",
              })
            }),
          )
          // Session IDs retain their existing loose prefix validation.
          yield* Effect.forEach(["ses", Session.ID.create()], (id) =>
            Effect.gen(function* () {
              const response = yield* server.post(`/api/session/${id}/${operation}`)
              expect(response.status).toBe(404)
              expect(yield* Effect.promise(() => response.json())).toEqual({
                _tag: "SessionNotFoundError",
                sessionID: id,
                message: `Session not found: ${id}`,
              })
            }),
          )
        }),
    )
    expect(server.acquisitions).toEqual([])
  }),
)

it.live("idle session controls do not acquire an unavailable Location", () =>
  Effect.gen(function* () {
    const server = yield* fixture
    const id = Session.ID.create()
    expect((yield* server.post("/api/session", { id })).status).toBe(200)
    expect(server.acquisitions).toEqual([])

    const waited = yield* server.post(`/api/session/${id}/wait`)
    expect(waited.status).toBe(204)
    expect(yield* Effect.promise(() => waited.text())).toBe("")
    yield* Effect.forEach(["", "?continue=false", "?continue=true"], (query) =>
      Effect.gen(function* () {
        const interrupted = yield* server.post(`/api/session/${id}/interrupt${query}`)
        expect(interrupted.status).toBe(200)
        expect(yield* Effect.promise(() => interrupted.json())).toEqual({ interrupted: false })
      }),
    )
    const invalidQuery = yield* server.post(`/api/session/${id}/interrupt?continue=invalid`)
    expect(invalidQuery.status).toBe(400)
    expect(yield* Effect.promise(() => invalidQuery.json())).toMatchObject({
      _tag: "InvalidRequestError",
      kind: "Query",
    })
    expect(server.acquisitions).toEqual([])
  }),
)

it.live("session admission endpoints still require the Location graph", () =>
  Effect.gen(function* () {
    const server = yield* fixture
    const id = Session.ID.create()
    expect((yield* server.post("/api/session", { id })).status).toBe(200)
    yield* Effect.forEach(["prompt", "synthetic", "compact"], (operation) =>
      Effect.gen(function* () {
        const response = yield* server.post(`/api/session/${id}/${operation}`, { text: "input", resume: false })
        expect(response.status).toBe(500)
      }),
    )
    expect(server.acquisitions.length).toBeGreaterThan(0)
  }),
)
