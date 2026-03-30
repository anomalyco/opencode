import { Deferred, Effect, Exit, Fiber, SynchronizedRef } from "effect"

const TypeId = Symbol.for("@opencode/SingleFlight")

export interface SingleFlight<A = unknown, E = never> {
  readonly [TypeId]: typeof TypeId
  readonly done: Deferred.Deferred<A, E>
  readonly state: SynchronizedRef.SynchronizedRef<SingleFlight.State<A, E>>
}

export namespace SingleFlight {
  export type State<A, E> =
    | { readonly _tag: "Empty" }
    | { readonly _tag: "Pending"; readonly token: symbol }
    | { readonly _tag: "Starting"; readonly token: symbol }
    | { readonly _tag: "Running"; readonly token: symbol; readonly fiber: Fiber.Fiber<A, E> }
    | { readonly _tag: "Done" }

  export const make = <A = unknown, E = never>(): Effect.Effect<SingleFlight<A, E>> =>
    Effect.gen(function* () {
      return {
        [TypeId]: TypeId,
        done: yield* Deferred.make<A, E>(),
        state: yield* SynchronizedRef.make<State<A, E>>({ _tag: "Empty" }),
      }
    })

  export const wait = <A, E>(self: SingleFlight<A, E>): Effect.Effect<A, E> => Deferred.await(self.done)

  export const busy = <A, E>(self: SingleFlight<A, E>): Effect.Effect<boolean> =>
    SynchronizedRef.get(self.state).pipe(
      Effect.map((state) => state._tag === "Pending" || state._tag === "Starting" || state._tag === "Running"),
    )

  const complete = <A, E>(self: SingleFlight<A, E>) =>
    SynchronizedRef.update(self.state, (state): State<A, E> => (state._tag === "Done" ? state : { _tag: "Done" }))

  const launch = <A, E>(self: SingleFlight<A, E>, token: symbol, effect: Effect.Effect<A, E>): Effect.Effect<void> =>
    Effect.gen(function* () {
      const fiber = yield* effect.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            yield* complete(self)
            yield* Deferred.done(self.done, exit)
          }),
        ),
        Effect.forkChild,
      )

      const next = yield* SynchronizedRef.modifyEffect(self.state, (state) => {
        if (state._tag === "Starting" && state.token === token) {
          return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([Effect.void, { _tag: "Running", token, fiber }])
        }

        return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([Fiber.interrupt(fiber).pipe(Effect.asVoid), state])
      })

      return yield* next
    })

  export const run = <A, E>(self: SingleFlight<A, E>, effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    SynchronizedRef.modifyEffect(self.state, (state) => {
      if (state._tag !== "Empty") {
        return Effect.succeed<[Effect.Effect<A, E>, State<A, E>]>([wait(self), state])
      }

      const token = Symbol()
      return Effect.succeed<[Effect.Effect<A, E>, State<A, E>]>([
        launch(self, token, effect).pipe(Effect.flatMap(() => wait(self))),
        { _tag: "Starting", token },
      ])
    }).pipe(Effect.flatten)

  export const pend = <A, E>(self: SingleFlight<A, E>): Effect.Effect<A, E> =>
    SynchronizedRef.modifyEffect(self.state, (state) => {
      if (state._tag !== "Empty") {
        return Effect.succeed<[Effect.Effect<A, E>, State<A, E>]>([wait(self), state])
      }

      return Effect.succeed<[Effect.Effect<A, E>, State<A, E>]>([wait(self), { _tag: "Pending", token: Symbol() }])
    }).pipe(Effect.flatten)

  export const promote = <A, E>(self: SingleFlight<A, E>, effect: Effect.Effect<A, E>): Effect.Effect<void> =>
    SynchronizedRef.modifyEffect(self.state, (state) => {
      if (state._tag !== "Pending") {
        return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([Effect.void, state])
      }

      return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([
        launch(self, state.token, effect).pipe(Effect.ignore),
        { _tag: "Starting", token: state.token },
      ])
    }).pipe(Effect.flatten)

  export const interrupt = <A, E>(self: SingleFlight<A, E>): Effect.Effect<void> =>
    SynchronizedRef.modifyEffect(self.state, (state) => {
      switch (state._tag) {
        case "Empty":
        case "Done":
          return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([Effect.void, state])
        case "Pending":
        case "Starting":
          return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([
            Deferred.interrupt(self.done).pipe(Effect.asVoid),
            { _tag: "Done" },
          ])
        case "Running":
          return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([
            Fiber.interrupt(state.fiber).pipe(
              Effect.flatMap(() => Deferred.await(self.done).pipe(Effect.exit, Effect.asVoid)),
            ),
            { _tag: "Done" },
          ])
      }
    }).pipe(Effect.flatten)
}
