import { test, type TestOptions } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import type * as Scope from "effect/Scope"
import * as TestClock from "effect/testing/TestClock"
import * as TestConsole from "effect/testing/TestConsole"

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)

const body = <A, E, R>(value: Body<A, E, R>) => Effect.suspend(() => (typeof value === "function" ? value() : value))

// Effect's default logger writes through the Console service, and TestConsole
// captures it, so a failing test printed its assertion with none of the logs
// that led to it, and no sign that any had been captured. Read the capture back
// here, where the test console is still the current one, and replay it verbatim.
// `console.error` is the host console, which TestConsole does not replace, and
// is the only way to reach the real output from inside the captured region.
const replayCaptured = TestConsole.testConsoleWith((testConsole) =>
  Effect.gen(function* () {
    if (testConsole.logLines === undefined) return
    const captured = [...(yield* testConsole.logLines), ...(yield* testConsole.errorLines)]
    if (captured.length === 0) return
    console.error("--- console output captured during the failing test ---")
    for (const entry of captured) console.error(entry)
    console.error("--- end of captured output ---")
  }),
)

const run = <A, E, R, E2>(value: Body<A, E, R | Scope.Scope>, layer: Layer.Layer<R, E2>) =>
  Effect.gen(function* () {
    const exit = yield* body(value).pipe(
      Effect.scoped,
      Effect.onExit((exit) => (Exit.isFailure(exit) ? replayCaptured : Effect.void)),
      Effect.provide(layer),
      Effect.exit,
    )
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err)
      }
    }
    return yield* exit
  }).pipe(Effect.runPromise)

const make = <R, E>(testLayer: Layer.Layer<R, E>, liveLayer: Layer.Layer<R, E>) => {
  const effect = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test(name, () => run(value, testLayer), opts)

  effect.only = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.only(name, () => run(value, testLayer), opts)

  effect.skip = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.skip(name, () => run(value, testLayer), opts)

  const live = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test(name, () => run(value, liveLayer), opts)

  live.only = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.only(name, () => run(value, liveLayer), opts)

  live.skip = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.skip(name, () => run(value, liveLayer), opts)

  return { effect, live }
}

const testEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())
const liveEnv = TestConsole.layer

export const it = make(testEnv, liveEnv)

export const testEffect = <R, E>(layer: Layer.Layer<R, E>) =>
  make(Layer.provideMerge(layer, testEnv), Layer.provideMerge(layer, liveEnv))
