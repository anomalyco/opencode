import { Deferred, Effect, Fiber } from "effect"

const TypeId = Symbol.for("@opencode/SingleFlight")

export interface SingleFlight<A = unknown, E = never> {
  readonly [TypeId]: typeof TypeId
  readonly effect: Effect.Effect<A, E>
  readonly done: Deferred.Deferred<A, E>
  state: SingleFlight.State<A, E>
}

export namespace SingleFlight {
  export type State<A, E> =
    | { readonly _tag: "Idle" }
    | { readonly _tag: "Running"; readonly fiber: Fiber.Fiber<A, E> }
    | { readonly _tag: "Done" }

  export const make = <A, E>(
    effect: Effect.Effect<A, E>,
    options?: { autoStart?: boolean },
  ) =>
    Effect.gen(function* () {
      const self: SingleFlight<A, E> = {
        [TypeId]: TypeId,
        effect,
        done: yield* Deferred.make<A, E>(),
        state: { _tag: "Idle" },
      }
      if (options?.autoStart !== false) {
        yield* start(self)
      }
      return self
    })

  export const join = <A, E>(self: SingleFlight<A, E>): Effect.Effect<A, E> => Deferred.await(self.done)

  export const start = <A, E>(self: SingleFlight<A, E>): Effect.Effect<void> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        if (self.state._tag !== "Idle") return
        const fiber = yield* self.effect.pipe(
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              self.state = { _tag: "Done" }
              yield* Deferred.done(self.done, exit)
            }),
          ),
          Effect.forkChild,
        )
        self.state = { _tag: "Running", fiber }
      }),
    )

  export const cancel = <A, E>(self: SingleFlight<A, E>): Effect.Effect<void> =>
    Effect.gen(function* () {
      const state = self.state
      switch (state._tag) {
        case "Done":
          return
        case "Idle":
          self.state = { _tag: "Done" }
          yield* Deferred.interrupt(self.done).pipe(Effect.asVoid)
          return
        case "Running":
          self.state = { _tag: "Done" }
          yield* Fiber.interrupt(state.fiber)
          yield* Deferred.await(self.done).pipe(Effect.exit, Effect.asVoid)
      }
    })
}
