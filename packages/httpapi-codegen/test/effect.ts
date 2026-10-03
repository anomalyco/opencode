import { test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import type { Scope } from "effect/Scope"
import { TestClock, TestConsole } from "effect/testing"

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)

const layer = Layer.mergeAll(TestConsole.layer, TestClock.layer())

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

const make =
  <R>(testLayer: Layer.Layer<R>) =>
  <A, E>(name: string, body: Body<A, E, Scope>, options?: Parameters<typeof test>[2]) =>
    test(
      name,
      () =>
        Effect.gen(function* () {
          const exit = yield* Effect.suspend(() => (typeof body === "function" ? body() : body)).pipe(
            Effect.scoped,
            Effect.onExit((exit) => (Exit.isFailure(exit) ? replayCaptured : Effect.void)),
            Effect.provide(testLayer),
            Effect.exit,
          )
          if (Exit.isFailure(exit)) {
            yield* Effect.forEach(Cause.prettyErrors(exit.cause), Effect.logError, { discard: true })
          }
          return yield* exit
        }).pipe(Effect.runPromise),
      options,
    )

export const it = { effect: make(layer), live: make(TestConsole.layer) }
