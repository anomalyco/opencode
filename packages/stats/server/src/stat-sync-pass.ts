import { Cause, Effect } from "effect"

export function runSyncPass<E, R>(input: {
  today: string
  lastFullDay: string
  sync: (full: boolean) => Effect.Effect<unknown, E, R>
}): Effect.Effect<string, E, R> {
  return Effect.gen(function* () {
    if (input.lastFullDay === input.today) {
      yield* input.sync(false)
      return input.today
    }

    const full = yield* input.sync(true).pipe(
      Effect.as(true),
      Effect.catchCause((cause) =>
        Effect.logWarning(`full stats sync failed; falling back to incremental sync ${Cause.pretty(cause)}`).pipe(
          Effect.as(false),
        ),
      ),
    )
    if (!full) yield* input.sync(false)
    return input.today
  })
}
