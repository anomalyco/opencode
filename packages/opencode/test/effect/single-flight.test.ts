import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Ref } from "effect"
import { SingleFlight } from "../../src/effect/single-flight"

type Result = { value: string }

describe("SingleFlight", () => {
  test("run starts immediately and returns the result", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const flight = yield* SingleFlight.make<Result, never>()
          const result = yield* SingleFlight.run(flight, Effect.succeed({ value: "ok" }))
          expect(result.value).toBe("ok")
          expect(yield* SingleFlight.busy(flight)).toBe(false)
        }),
      ),
    )
  })

  test("concurrent run callers share the same result", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const flight = yield* SingleFlight.make<Result, unknown>()
          const calls = yield* Ref.make(0)
          const work = Effect.gen(function* () {
            yield* Ref.update(calls, (n) => n + 1)
            yield* Effect.sleep("10 millis")
            return { value: "shared" }
          })

          const [a, b] = yield* Effect.all([SingleFlight.run(flight, work), SingleFlight.run(flight, work)], {
            concurrency: "unbounded",
          })

          expect(a.value).toBe("shared")
          expect(b.value).toBe("shared")
          expect(yield* Ref.get(calls)).toBe(1)
        }),
      ),
    )
  })

  test("pend reserves the slot and promote starts it later", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const flight = yield* SingleFlight.make<Result, unknown>()
          const started = yield* Ref.make(false)
          const work = Effect.gen(function* () {
            yield* Ref.set(started, true)
            return { value: "later" }
          })

          const waiter = yield* SingleFlight.pend(flight).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          expect(yield* SingleFlight.busy(flight)).toBe(true)
          expect(yield* Ref.get(started)).toBe(false)

          yield* SingleFlight.promote(flight, work)

          const exit = yield* Fiber.await(waiter)
          expect(yield* Ref.get(started)).toBe(true)
          expect(Exit.isSuccess(exit)).toBe(true)
          if (Exit.isSuccess(exit)) {
            expect(exit.value.value).toBe("later")
          }
        }),
      ),
    )
  })

  test("interrupt fails pending waiters", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const flight = yield* SingleFlight.make<Result, unknown>()
          const waiter = yield* SingleFlight.pend(flight).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          yield* SingleFlight.interrupt(flight)

          const exit = yield* Fiber.await(waiter)
          expect(Exit.isFailure(exit)).toBe(true)
          expect(yield* SingleFlight.busy(flight)).toBe(false)
        }),
      ),
    )
  })

  test("interrupt waits for running fiber cleanup", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const flight = yield* SingleFlight.make<Result, unknown>()
          const cleanup = yield* Deferred.make<void>()
          const work = Effect.never.pipe(
            Effect.ensuring(Deferred.succeed(cleanup, undefined).pipe(Effect.asVoid)),
            Effect.as({ value: "never" as const }),
          )

          const waiter = yield* SingleFlight.run(flight, work).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          yield* SingleFlight.interrupt(flight)
          yield* Deferred.await(cleanup)

          const exit = yield* Fiber.await(waiter)
          expect(Exit.isFailure(exit)).toBe(true)
          expect(yield* SingleFlight.busy(flight)).toBe(false)
        }),
      ),
    )
  })
})
