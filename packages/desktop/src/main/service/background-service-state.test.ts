import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { BackgroundServiceState } from "./background-service-state"

test("new consumers receive the latest reconnected service", async () => {
  const initial = { url: "http://127.0.0.1:4100", password: "first" }
  const replacement = { url: "http://127.0.0.1:4200", password: "second" }
  const service = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* BackgroundServiceState.make({
          initial: Effect.succeed(initial),
          reconnect: Effect.succeed(replacement),
        })
        expect(yield* state.connection).toEqual(initial)
        expect(yield* state.reconnect).toEqual(replacement)
        return yield* state.connection
      }),
    ),
  )
  expect(service).toEqual(replacement)
})

test("the state is ready before the initial connect finishes and consumers wait for it", async () => {
  const initial = { url: "http://127.0.0.1:4100", password: "first" }
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const state = yield* BackgroundServiceState.make({
          initial: Deferred.await(gate).pipe(Effect.as(initial)),
          reconnect: Effect.succeed(initial),
        })
        const consumer = yield* Effect.forkChild(state.connection)
        yield* Effect.sleep("10 millis")
        expect(consumer.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(gate, undefined)
        expect(yield* Fiber.join(consumer)).toEqual(initial)
      }),
    ),
  )
})

test("a failed initial connect fails consumers instead of hanging them", async () => {
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* BackgroundServiceState.make({
          initial: Effect.fail(new Error("service unavailable")),
          reconnect: Effect.succeed({ url: "http://127.0.0.1:4100", password: "later" }),
        })
        return yield* state.connection.pipe(Effect.exit)
      }),
    ),
  )
  expect(result._tag).toBe("Failure")
})
