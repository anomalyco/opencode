import { test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import type { Scope } from "effect/Scope"
import { TestClock, TestConsole } from "effect/testing"

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)

const layer = Layer.mergeAll(TestConsole.layer, TestClock.layer())

const effect = <A, E>(name: string, body: Body<A, E, Scope>, options?: Parameters<typeof test>[2]) =>
  test(
    name,
    () =>
      Effect.gen(function* () {
        const exit = yield* Effect.suspend(() => (typeof body === "function" ? body() : body)).pipe(
          Effect.scoped,
          Effect.provide(layer),
          Effect.exit,
        )
        if (Exit.isFailure(exit)) {
          yield* Effect.forEach(Cause.prettyErrors(exit.cause), Effect.logError, { discard: true })
        }
        return yield* exit
      }).pipe(Effect.runPromise),
    options,
  )

export const it = { effect }
