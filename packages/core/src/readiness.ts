import { Clock, Effect, Exit } from "effect"

/** Reports success, failure and interruption without changing the phase's result. */
export function readiness<A, E, R>(phase: string, attributes: Record<string, unknown>, effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis
    yield* Effect.logInfo("runtime readiness phase started", { phase, ...attributes })
    return yield* effect.pipe(Effect.onExit((exit) => Effect.gen(function* () {
      const durationMs = Math.max(0, (yield* Clock.currentTimeMillis) - started)
      yield* Effect.logInfo("runtime readiness phase completed", {
        phase, ...attributes, durationMs, outcome: Exit.isSuccess(exit) ? "success" : "failure",
      })
    })))
  }).pipe(Effect.annotateLogs(attributes))
}
