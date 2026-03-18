import { test, type TestOptions } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import type * as Scope from "effect/Scope"
import * as TestConsole from "effect/testing/TestConsole"

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)
const env = TestConsole.layer

const body = <A, E, R>(value: Body<A, E, R>) => Effect.suspend(() => (typeof value === "function" ? value() : value))

const run = <A, E, R, E2>(value: Body<A, E, R | Scope.Scope>, layer: Layer.Layer<R, E2, never>) =>
  Effect.gen(function* () {
    const exit = yield* body(value).pipe(Effect.scoped, Effect.provide(layer), Effect.exit)
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err)
      }
    }
    return yield* exit
  }).pipe(Effect.runPromise)

const make = <R, E>(layer: Layer.Layer<R, E, never>) => {
  const effect = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test(name, () => run(value, layer), opts)

  effect.only = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.only(name, () => run(value, layer), opts)

  effect.skip = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.skip(name, () => run(value, layer), opts)

  return { effect }
}

export const it = make(env)

export const testEffect = <R, E>(layer: Layer.Layer<R, E, never>) => make(Layer.provideMerge(layer, env))
