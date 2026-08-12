import { expect, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import * as SharedEffect from "../../src/driver/shared.js"

it.effect("does not let an interrupted caller poison terminal work", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>()
    const runs = yield* Ref.make(0)
    const shared = yield* SharedEffect.make(
      Ref.update(runs, (count) => count + 1).pipe(
        Effect.andThen(Deferred.await(gate)),
        Effect.as("settled"),
      ),
    )
    const first = yield* Effect.forkChild(shared)
    yield* Effect.yieldNow
    yield* Fiber.interrupt(first)
    yield* Deferred.succeed(gate, undefined)

    expect(yield* shared).toBe("settled")
    expect(yield* Ref.get(runs)).toBe(1)
  }),
)
