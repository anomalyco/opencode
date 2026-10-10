import { expect, setDefaultTimeout } from "bun:test"
import { Instance } from "@opencode/core/instance/service"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

setDefaultTimeout(30_000)

it.live("interrupts without booting the session's location and re-steers idempotently", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-session-interrupt-")))
    const provided: Session.ID[] = []
    const interrupts: Array<{ sessionID: Session.ID; resume?: boolean }> = []
    const wakes: Session.ID[] = []
    const instances = makeGlobalNode({
      service: Instance.Service,
      deps: [LocationServiceMap.node],
      layer: Layer.effect(
        Instance.Service,
        Effect.gen(function* () {
          const locations = yield* LocationServiceMap.Service
          return Instance.Service.of({
            provide: (session) => (effect) =>
              Effect.suspend(() => {
                provided.push(session.id)
                return effect.pipe(Effect.provide(locations.get(session.location)))
              }),
          })
        }),
      ),
    })
    const execution = makeGlobalNode({
      service: SessionExecution.Service,
      layer: Layer.succeed(
        SessionExecution.Service,
        SessionExecution.Service.of({
          active: Effect.succeed(new Set()),
          isActive: () => Effect.succeed(true),
          resume: () => Effect.void,
          wake: (sessionID) => Effect.sync(() => void wakes.push(sessionID)),
          interrupt: (sessionID, options) =>
            Effect.sync(() => {
              interrupts.push({ sessionID, resume: options?.resume })
              return true
            }),
          awaitIdle: () => Effect.void,
        }),
      ),
      deps: [],
    })
    const handler = yield* ServerFetch.make(
      {
        app: { version: "test-version" },
        database: { path: ":memory:" },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      { overrides: [Instance.node.replace(instances), SessionExecution.node.replace(execution)] },
    )
    const request = (path: string, method: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: body === undefined ? undefined : { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        return { status: response.status, body: response.status === 204 ? undefined : await response.json() }
      })
    const created = yield* request("/api/session", "POST", { location: { directory: tmp.path } })
    const sessionID = Session.ID.make((created.body as { data: { id: string } }).data.id)

    const before = provided.length
    expect(yield* request(`/api/session/${sessionID}/interrupt?resume=true`, "POST")).toEqual({
      status: 200,
      body: { interrupted: true },
    })
    expect(provided.length).toBe(before)
    expect(interrupts).toEqual([{ sessionID, resume: true }])
    expect((yield* request(`/api/session/${Session.ID.create()}/interrupt`, "POST")).status).toBe(404)
    expect(interrupts).toHaveLength(1)

    const steer = yield* request(`/api/session/${sessionID}/prompt`, "POST", { text: "Steer", resume: false })
    const inboxID = (steer.body as { data: { id: string; delivery: string } }).data.id
    expect(steer.body).toMatchObject({ data: { delivery: "steer" } })
    // Location-scoped routes still select the Session's location through the recorded selector.
    expect(provided.length).toBeGreaterThan(before)
    // Steering a stranded steer again succeeds and wakes execution instead of conflicting.
    expect(yield* request(`/api/session/${sessionID}/inbox/${inboxID}`, "PATCH", { delivery: "steer" })).toEqual({
      status: 204,
      body: undefined,
    })
    expect(wakes).toEqual([sessionID])
  }),
)
