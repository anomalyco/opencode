import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Ref } from "effect"
import { SingleFlight } from "../../src/effect/single-flight"

type Result = { value: string }

describe("SingleFlight", () => {
  test("autoStart true runs immediately and join returns the result", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const flight = yield* SingleFlight.make(Effect.succeed({ value: "ok" }))
          const result = yield* SingleFlight.join(flight)
          expect(result.value).toBe("ok")
        }),
      ),
    )
  })

  test("concurrent joins share the same run", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const calls = yield* Ref.make(0)
          const work = Effect.gen(function* () {
            yield* Ref.update(calls, (n) => n + 1)
            yield* Effect.sleep("10 millis")
            return { value: "shared" }
          })

          const flight = yield* SingleFlight.make<Result, never>(work)
          const [a, b] = yield* Effect.all([SingleFlight.join(flight), SingleFlight.join(flight)], {
            concurrency: "unbounded",
          })

          expect(a.value).toBe("shared")
          expect(b.value).toBe("shared")
          expect(yield* Ref.get(calls)).toBe(1)
        }),
      ),
    )
  })

  test("autoStart false does not begin until started", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Ref.make(false)
          const work = Effect.gen(function* () {
            yield* Ref.set(started, true)
            return { value: "later" }
          })

          const flight = yield* SingleFlight.make<Result, never>(work, { autoStart: false })
          const waiter = yield* SingleFlight.join(flight).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          expect(yield* Ref.get(started)).toBe(false)

          yield* SingleFlight.start(flight)

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

  test("cancel fails pending joins", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const flight = yield* SingleFlight.make<Result, never>(Effect.succeed({ value: "never" }), {
            autoStart: false,
          })
          const waiter = yield* SingleFlight.join(flight).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          yield* SingleFlight.cancel(flight)

          const exit = yield* Fiber.await(waiter)
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      ),
    )
  })

  test("cancel waits for running fiber cleanup", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const cleanup = yield* Deferred.make<void>()
          const work = Effect.never.pipe(
            Effect.ensuring(Deferred.succeed(cleanup, undefined).pipe(Effect.asVoid)),
            Effect.as({ value: "never" as const }),
          )

          const flight = yield* SingleFlight.make<Result, never>(work)
          const waiter = yield* SingleFlight.join(flight).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          yield* SingleFlight.cancel(flight)
          yield* Deferred.await(cleanup)

          const exit = yield* Fiber.await(waiter)
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      ),
    )
  })
})
