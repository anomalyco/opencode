import { describe, expect } from "bun:test"
import { Agent } from "@opencode/schema/agent"
import { Clock, Duration, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { it } from "../../../core/test/lib/effect"
import { ACPCatalog } from "../../src/acp/catalog"
import { buildAgent, makeClient, planAgent, startWire, testModel, type Wire, type WireOptions } from "./wire-fixture"

describe("acp catalog service", () => {
  it.effect("coalesces reloads requested during a reload into one more load", () => {
    const gate = { held: false, release: Promise.withResolvers<void>() }
    return withCatalog(
      {
        fetch: (request) =>
          request.path === "/api/agent" && gate.held ? gate.release.promise.then(() => undefined) : undefined,
      },
      (acp) =>
        Effect.gen(function* () {
          const catalog = yield* ACPCatalog.Service
          yield* catalog.get("/workspace")
          gate.held = true

          const running = yield* catalog.reload("/workspace").pipe(Effect.forkChild({ startImmediately: true }))
          yield* Effect.promise(() => acp.until(() => requests(acp, "/api/agent") === 2, "the held reload"))
          const queued = yield* Effect.all(
            [0, 1].map(() => catalog.reload("/workspace").pipe(Effect.forkChild({ startImmediately: true }))),
          )
          acp.server.catalog.agents = [planAgent, buildAgent]
          gate.held = false
          gate.release.resolve()
          yield* Fiber.join(running)
          yield* Fiber.joinAll(queued)

          expect(reads(acp, "agent")).toBe(3)
          expect((yield* catalog.get("/workspace")).defaultModeID).toBe(Agent.ID.make("plan"))
        }),
    )
  })

  it.effect("keeps the previous catalog when a reload fails", () => {
    const failing = { model: false }
    return withCatalog(
      {
        fetch: (request) =>
          failing.model && request.path === "/api/model"
            ? Response.json({ name: "ModelsNotReadyError", data: { message: "catalog is warming" } }, { status: 503 })
            : undefined,
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* ACPCatalog.Service
          const before = yield* catalog.get("/workspace")
          failing.model = true

          yield* catalog.reload("/workspace")

          expect(yield* catalog.get("/workspace")).toBe(before)
        }),
    )
  })

  it.effect("waits 25ms between readiness reads", () =>
    withCatalog({}, (acp) =>
      Effect.gen(function* () {
        const catalog = yield* ACPCatalog.Service
        acp.server.catalog.models = []

        const loading = yield* catalog.get("/workspace").pipe(Effect.forkChild)
        yield* Effect.promise(() => acp.until(() => reads(acp, "model") === 1, "the first model read"))
        acp.server.catalog.models = [testModel]
        yield* advance("5 millis", () => reads(acp, "model") === 2)
        const retriedAt = yield* Clock.currentTimeMillis
        const loaded = yield* Fiber.join(loading)

        expect(retriedAt).toBeGreaterThanOrEqual(25)
        expect(loaded.defaultModel).toMatchObject({ providerID: "test", id: "test-model", variant: "default" })
      }),
    ),
  )

  it.effect("gives up with the last readiness failure after 5 seconds", () =>
    withCatalog({}, (acp) =>
      Effect.gen(function* () {
        const catalog = yield* ACPCatalog.Service
        acp.server.catalog.agents = []

        const loading = yield* catalog.get("/workspace").pipe(Effect.flip, Effect.timed, Effect.forkChild)
        yield* advance("25 millis", () => loading.pollUnsafe() !== undefined)
        const [elapsed, error] = yield* Fiber.join(loading)

        expect(error).toEqual(new ACPCatalog.NotReadyError({ reason: "agents" }))
        expect(error.message).toBe("No primary agents are available")
        // Reads in flight while the clock steps push the last attempt slightly past the deadline.
        expect(Duration.toMillis(elapsed)).toBeGreaterThanOrEqual(5_000)
        expect(Duration.toMillis(elapsed)).toBeLessThan(6_000)
      }),
    ),
  )
})

function withCatalog<A, E>(options: WireOptions, body: (acp: Wire) => Effect.Effect<A, E, ACPCatalog.Service>) {
  return Effect.acquireRelease(
    Effect.promise(() => startWire(options)),
    (acp) => Effect.promise(() => acp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((acp) =>
      body(acp).pipe(
        Effect.provideServiceEffect(
          ACPCatalog.Service,
          makeClient(acp.server.url).pipe(Effect.flatMap(ACPCatalog.make)),
        ),
      ),
    ),
  )
}

// Catalog reads are real HTTP that settles between sleeps, so the clock moves in steps until the reads catch up.
function advance(step: Duration.Input, done: () => boolean) {
  return TestClock.adjust(step).pipe(
    Effect.andThen(TestClock.withLive(Effect.sleep("1 millis"))),
    Effect.repeat({ until: done }),
  )
}

function reads(acp: Wire, kind: "model" | "agent") {
  return acp.server.catalogReads.filter((read) => read.kind === kind).length
}

function requests(acp: Wire, path: string) {
  return acp.server.requests.filter((request) => request.path === path).length
}
