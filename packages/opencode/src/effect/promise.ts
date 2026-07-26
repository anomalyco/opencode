import { Cause, Effect } from "effect"

export function refineRejection<A, E>(
  evaluate: (signal: AbortSignal) => PromiseLike<A>,
  refine: (cause: unknown) => E | undefined,
) {
  return Effect.tryPromise(evaluate).pipe(
    Effect.catch((error) => {
      const cause = Cause.isUnknownError(error) ? error.cause : error
      const refined = refine(cause)
      if (refined !== undefined) return Effect.fail(refined)
      return Effect.die(cause)
    }),
  )
}

export * as EffectPromise from "./promise"
