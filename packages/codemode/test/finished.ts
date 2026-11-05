import { Effect, type Scope } from "effect"
import type { CodeMode } from "../src/index.js"

/** Runs a started program to its end in a scope of its own: its result. */
export const finished = <E, R>(
  started: Effect.Effect<CodeMode.Execution, E, R>,
): Effect.Effect<CodeMode.Result, E, Exclude<R, Scope.Scope>> =>
  Effect.scoped(
    Effect.flatMap(started, (execution) =>
      Effect.map(execution.result, (outcome) => {
        if (outcome.ok === "suspended") throw new Error("The program suspended.")
        return outcome
      }),
    ),
  )
