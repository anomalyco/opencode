import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { expect } from "bun:test"
import { DatabaseMaintenanceGate } from "@opencode-ai/core/database/maintenance-gate"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { maintenanceGateLayer } from "../../src/server/routes/instance/httpapi/middleware/maintenance-gate"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer))

const response = HttpServerResponse.jsonUnsafe({ ok: true })

const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("POST", "/write", () => Effect.succeed(response))
    yield* router.add("GET", "/read", () => Effect.succeed(response))
    yield* router.add("POST", "/global/storage/vacuum", () => Effect.succeed(response))
    yield* router.add("POST", "/question/request/reply", () => Effect.succeed(response))
  }),
).pipe(Layer.provide(maintenanceGateLayer), HttpRouter.serve)

it.live("rejects writes while active but keeps reads and storage routes available", () =>
  Effect.gen(function* () {
    yield* Layer.build(routes)
    const maintenanceStarted = yield* Deferred.make<void>()
    const releaseMaintenance = yield* Deferred.make<void>()
    const maintenanceFiber = yield* DatabaseMaintenanceGate.exclusive(
      "vacuum",
      Deferred.succeed(maintenanceStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseMaintenance))),
    ).pipe(Effect.forkScoped)
    yield* Deferred.await(maintenanceStarted)

    const write = yield* HttpClientRequest.post("/write").pipe(HttpClient.execute)
    expect(write.status).toBe(503)
    expect(write.headers["retry-after"]).toBe("5")
    expect(yield* write.json).toMatchObject({
      _tag: "ServiceUnavailableError",
      service: "storage-maintenance",
    })

    const read = yield* HttpClientRequest.get("/read").pipe(HttpClient.execute)
    expect(read.status).toBe(200)

    const maintenance = yield* HttpClientRequest.post("/global/storage/vacuum").pipe(HttpClient.execute)
    expect(maintenance.status).toBe(200)

    const control = yield* HttpClientRequest.post("/question/request/reply").pipe(HttpClient.execute)
    expect(control.status).toBe(503)

    yield* Deferred.succeed(releaseMaintenance, undefined)
    yield* Fiber.join(maintenanceFiber)
  }),
)

it.live("keeps session control responses available while active work drains", () =>
  Effect.gen(function* () {
    yield* Layer.build(routes)
    const mutationStarted = yield* Deferred.make<void>()
    const releaseMutation = yield* Deferred.make<void>()
    const draining = yield* Deferred.make<void>()

    const mutationFiber = yield* DatabaseMaintenanceGate.mutation(
      Deferred.succeed(mutationStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseMutation))),
    ).pipe(Effect.forkScoped)
    yield* Deferred.await(mutationStarted)

    const maintenanceFiber = yield* DatabaseMaintenanceGate.exclusive("vacuum", Effect.void, {
      onStatus: (status) => {
        if (status.phase === "draining") Effect.runSync(Deferred.succeed(draining, undefined))
      },
    }).pipe(Effect.forkScoped)
    yield* Deferred.await(draining)

    const control = yield* HttpClientRequest.post("/question/request/reply").pipe(HttpClient.execute)
    expect(control.status).toBe(200)

    yield* Deferred.succeed(releaseMutation, undefined)
    yield* Fiber.join(mutationFiber)
    yield* Fiber.join(maintenanceFiber)
  }),
)
