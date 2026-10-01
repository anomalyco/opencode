import { describe, expect } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { it } from "../../../core/test/lib/effect"
import { ACPCatalog } from "../../src/acp/catalog"
import {
  buildAgent,
  ephemeralEvent,
  planAgent,
  startWire,
  testModel,
  type Wire,
  type WireOptions,
} from "./wire-fixture"

describe("acp catalog service", () => {
  it.effect("shares one load between concurrent callers and does not cache a failed load", () => {
    const failure = { pending: true }
    const fetch = (request: { readonly path: string }) => {
      if (request.path !== "/api/model" || !failure.pending) return undefined
      failure.pending = false
      return unavailable()
    }
    return withCatalog({ fetch }, (acp) =>
      Effect.gen(function* () {
        const catalog = yield* ACPCatalog.Service

        const failed = yield* catalog.get("/workspace").pipe(Effect.flip)
        const [first, second] = yield* Effect.all([catalog.get("/workspace"), catalog.get("/workspace")], {
          concurrency: "unbounded",
        })

        expect(failed._tag).toBe("ACPCatalogLoadError")
        expect(second).toBe(first)
        expect(reads(acp, "model")).toBe(1)
      }),
    )
  })

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
          expect((yield* catalog.get("/workspace")).defaultModeID).toBe("plan")
        }),
    )
  })

  it.effect("keeps the previous catalog when a reload fails", () => {
    const failing = { model: false }
    return withCatalog(
      { fetch: (request) => (failing.model && request.path === "/api/model" ? unavailable() : undefined) },
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

  it.effect("publishes changes for update events in its directory", () =>
    withCatalog({}, (acp) =>
      Effect.gen(function* () {
        const catalog = yield* ACPCatalog.Service
        const changes = yield* catalog
          .changes("/workspace")
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
        yield* Effect.promise(() => acp.until(() => reads(acp, "agent") === 1, "the first load"))

        acp.server.catalog.agents = [planAgent, buildAgent]
        acp.server.send(ephemeralEvent("agent.updated", {}, { directory: "/other" }))
        acp.server.send(ephemeralEvent("agent.updated", {}, { directory: "/workspace" }))
        const [change] = yield* Fiber.join(changes)

        expect([change?.previous.defaultModeID, change?.current.defaultModeID]).toEqual(["build", "plan"])
        expect(reads(acp, "agent")).toBe(2)
      }),
    ),
  )

  it.effect("retries every 25ms until the catalog is ready", () =>
    withCatalog({}, (acp) =>
      Effect.gen(function* () {
        const catalog = yield* ACPCatalog.Service
        acp.server.catalog.models = []

        const loading = yield* catalog.get("/workspace").pipe(Effect.forkChild)
        yield* Effect.promise(() => acp.until(() => reads(acp, "model") === 1, "the first model read"))
        acp.server.catalog.models = [testModel]
        const loaded = yield* advance(loading)

        expect(loaded.defaultModel).toEqual({ providerID: "test", id: "test-model", variant: "default" })
        expect(reads(acp, "model")).toBe(2)
      }),
    ),
  )

  it.effect("gives up with the last readiness failure after 5 seconds", () =>
    withCatalog({}, (acp) =>
      Effect.gen(function* () {
        const catalog = yield* ACPCatalog.Service
        acp.server.catalog.agents = []

        const error = yield* advance(yield* catalog.get("/workspace").pipe(Effect.flip, Effect.forkChild))

        expect(error).toEqual(new ACPCatalog.NotReadyError({ message: "No primary agents are available" }))
        expect(reads(acp, "agent")).toBeGreaterThan(1)
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
      body(acp).pipe(Effect.provide(ACPCatalog.layer(OpenCode.make({ baseUrl: acp.server.url })))),
    ),
  )
}

// Reads are real HTTP between sleeps, so step the clock until the load settles.
function advance<A, E>(fiber: Fiber.Fiber<A, E>) {
  return TestClock.adjust("25 millis").pipe(
    Effect.andThen(TestClock.withLive(Effect.sleep("1 millis"))),
    Effect.repeat({ until: () => fiber.pollUnsafe() !== undefined }),
    Effect.andThen(Fiber.join(fiber)),
  )
}

function unavailable() {
  return Response.json({ name: "ModelsNotReadyError", data: { message: "catalog is warming" } }, { status: 503 })
}

function reads(acp: Wire, kind: "model" | "agent") {
  return acp.server.catalogReads.filter((read) => read.kind === kind).length
}

function requests(acp: Wire, path: string) {
  return acp.server.requests.filter((request) => request.path === path).length
}
