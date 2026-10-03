import { describe, expect, test } from "bun:test"
import { DatabaseMaintenanceGate } from "@opencode-ai/core/database/maintenance-gate"
import { Deferred, Effect, Fiber, Option } from "effect"

describe("DatabaseMaintenanceGate", () => {
  test("drains active mutations and rejects new mutations while maintenance waits", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const mutationStarted = yield* Deferred.make<void>()
          const releaseMutation = yield* Deferred.make<void>()
          const draining = yield* Deferred.make<void>()
          const maintenanceStarted = yield* Deferred.make<void>()
          const releaseMaintenance = yield* Deferred.make<void>()

          const mutationFiber = yield* DatabaseMaintenanceGate.mutation(
            Deferred.succeed(mutationStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseMutation))),
          ).pipe(Effect.forkScoped)
          yield* Deferred.await(mutationStarted)

          const maintenanceFiber = yield* DatabaseMaintenanceGate.exclusive(
            "compact",
            Deferred.succeed(maintenanceStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseMaintenance))),
            {
              onStatus: (status) => {
                if (status.phase === "draining") Effect.runSync(Deferred.succeed(draining, undefined))
              },
            },
          ).pipe(Effect.forkScoped)

          yield* Deferred.await(draining)
          expect(DatabaseMaintenanceGate.status()).toEqual({
            phase: "draining",
            operation: "compact",
            activeMutations: 1,
          })

          const rejected = yield* DatabaseMaintenanceGate.mutation(Effect.void).pipe(Effect.flip)
          expect(rejected.operation).toBe("compact")

          yield* Deferred.succeed(releaseMutation, undefined)
          yield* Fiber.join(mutationFiber)
          yield* Deferred.await(maintenanceStarted)
          expect(DatabaseMaintenanceGate.status()).toEqual({
            phase: "active",
            operation: "compact",
            activeMutations: 0,
          })

          yield* Deferred.succeed(releaseMaintenance, undefined)
          yield* Fiber.join(maintenanceFiber)
          expect(DatabaseMaintenanceGate.status()).toEqual({ phase: "idle", activeMutations: 0 })
        }),
      ),
    )
  })

  test("waits detached work until maintenance completes", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const maintenanceStarted = yield* Deferred.make<void>()
          const releaseMaintenance = yield* Deferred.make<void>()
          const mutationStarted = yield* Deferred.make<void>()

          const maintenanceFiber = yield* DatabaseMaintenanceGate.exclusive(
            "vacuum",
            Deferred.succeed(maintenanceStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseMaintenance))),
          ).pipe(Effect.forkScoped)
          yield* Deferred.await(maintenanceStarted)

          const mutationFiber = yield* DatabaseMaintenanceGate.waitForDetachedMutation(
            Deferred.succeed(mutationStarted, undefined),
          ).pipe(Effect.forkScoped)
          expect(Option.isNone(yield* Deferred.poll(mutationStarted))).toBe(true)

          yield* Deferred.succeed(releaseMaintenance, undefined)
          yield* Fiber.join(maintenanceFiber)
          yield* Deferred.await(mutationStarted)
          yield* Fiber.join(mutationFiber)
          expect(DatabaseMaintenanceGate.status()).toEqual({ phase: "idle", activeMutations: 0 })
        }),
      ),
    )
  })

  test("reuses a mutation lease for nested session work", async () => {
    await Effect.runPromise(
      DatabaseMaintenanceGate.mutation(
        Effect.gen(function* () {
          expect(DatabaseMaintenanceGate.status()).toEqual({ phase: "idle", activeMutations: 1 })
          yield* DatabaseMaintenanceGate.waitForMutation(
            Effect.sync(() => {
              expect(DatabaseMaintenanceGate.status()).toEqual({ phase: "idle", activeMutations: 1 })
            }),
          )
        }),
      ),
    )
    expect(DatabaseMaintenanceGate.status()).toEqual({ phase: "idle", activeMutations: 0 })
  })

  test("releases the gate when progress reporting throws", async () => {
    await Effect.runPromise(
      DatabaseMaintenanceGate.exclusive("compact", Effect.void, {
        onStatus: () => {
          throw new Error("progress callback failed")
        },
      }),
    )
    await Effect.runPromise(DatabaseMaintenanceGate.mutation(Effect.void))
    expect(DatabaseMaintenanceGate.status()).toEqual({ phase: "idle", activeMutations: 0 })
  })
})
