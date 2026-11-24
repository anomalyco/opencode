export * as DesktopCliState from "./desktop-cli-state"

import { Deferred, Effect, Exit } from "effect"

/** Where the lookup stands. A failed one returns to `idle`, so the next caller looks again. */
type State<A, E> =
  | { readonly status: "idle" }
  | { readonly status: "resolving"; readonly deferred: Deferred.Deferred<A, E> }
  | { readonly status: "resolved"; readonly value: A }

function idle<A, E>(): State<A, E> {
  return { status: "idle" }
}

/**
 * Runs `load` once for every caller that arrives while it runs, and keeps only a success. It runs in the layer's
 * scope, so a caller that gives up does not interrupt it for the others, and closing the scope interrupts it.
 */
export const make = Effect.fnUntraced(function* <A, E>(load: Effect.Effect<A, E>) {
  const scope = yield* Effect.scope
  const current = { state: idle<A, E>() }

  // The claim and the fork are one uninterruptible step, so a caller interrupted between them cannot leave a
  // `resolving` state that nothing settles.
  return Effect.uninterruptibleMask((restore) =>
    Effect.suspend(() => {
      const state = current.state

      if (state.status === "resolved") return Effect.succeed(state.value)

      if (state.status === "resolving") return restore(Deferred.await(state.deferred))
      const deferred = Deferred.makeUnsafe<A, E>()
      current.state = { status: "resolving", deferred }

      return Effect.forkIn(load, scope).pipe(
        Effect.map((fiber) =>
          // An observer also runs for a fiber that a closed scope interrupted before it started.
          fiber.addObserver((exit) => {
            current.state = Exit.isSuccess(exit) ? { status: "resolved", value: exit.value } : idle()
            Deferred.doneUnsafe(deferred, exit)
          }),
        ),
        Effect.andThen(restore(Deferred.await(deferred))),
      )
    }),
  )
})
