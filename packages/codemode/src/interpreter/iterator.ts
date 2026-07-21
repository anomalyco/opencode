import { Effect, Exit } from "effect"
import type { AstNode } from "./model.js"

export type IteratorCursor<R> = {
  readonly next: Effect.Effect<{ readonly done: boolean; readonly value: unknown }, unknown, R>
  readonly close: Effect.Effect<void, unknown, R>
}

export type SyncIteratorRunner<R> = {
  readonly syncIterator: (value: unknown, node: AstNode) => Effect.Effect<IteratorCursor<R> | undefined, unknown, R>
}

export const preserveConsumerError = <A, R>(
  cursor: IteratorCursor<R>,
  effect: Effect.Effect<A, unknown, R>,
): Effect.Effect<A, unknown, R> =>
  Effect.flatMap(Effect.exit(effect), (exit) =>
    Exit.isSuccess(exit)
      ? Effect.succeed(exit.value)
      : Effect.andThen(Effect.exit(cursor.close), Effect.failCause(exit.cause)),
  )
