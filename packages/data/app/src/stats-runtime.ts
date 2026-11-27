import { Effect } from "effect"

export function runStatsEffect<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect)
}
