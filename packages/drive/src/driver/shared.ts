import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"

/** Starts a terminal operation once in its owner's scope, independently of callers. */
export const make = Effect.fn("SharedEffect.make")(function* <A, E>(
  effect: Effect.Effect<A, E>,
) {
  const scope = yield* Scope.Scope
  const result = yield* Deferred.make<A, E>()
  const started = yield* Ref.make(false)
  const lock = yield* Semaphore.make(1)

  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* lock.withPermit(
        Effect.gen(function* () {
          if (yield* Ref.get(started)) return
          yield* Ref.set(started, true)
          yield* Deferred.complete(result, effect).pipe(
            Effect.asVoid,
            Effect.forkIn(scope, { uninterruptible: true }),
          )
        }),
      )
      return yield* restore(Deferred.await(result))
    }),
  )
})
