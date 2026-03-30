import { Deferred, Effect, Fiber, SynchronizedRef } from "effect"

const TypeId = Symbol.for("@opencode/SingleFlight")

export interface SingleFlight<A = unknown, E = never> {
  readonly [TypeId]: typeof TypeId
  readonly effect: Effect.Effect<A, E>
  readonly done: Deferred.Deferred<A, E>
  readonly state: SynchronizedRef.SynchronizedRef<SingleFlight.State<A, E>>
}

export namespace SingleFlight {
  export type State<A, E> =
    | { readonly _tag: "Pending"; readonly token: symbol }
    | { readonly _tag: "Starting"; readonly token: symbol }
    | { readonly _tag: "Running"; readonly token: symbol; readonly fiber: Fiber.Fiber<A, E> }
    | { readonly _tag: "Done" }

  export const make = <A, E>(effect: Effect.Effect<A, E>, options?: { autoStart?: boolean }) =>
    Effect.gen(function* () {
      const token = Symbol()
      const self: SingleFlight<A, E> = {
        [TypeId]: TypeId,
        effect,
        done: yield* Deferred.make<A, E>(),
        state: yield* SynchronizedRef.make<State<A, E>>({ _tag: "Pending", token }),
      }

      if (options?.autoStart !== false) {
        yield* start(self)
      }

      return self
    })

  export const join = <A, E>(self: SingleFlight<A, E>): Effect.Effect<A, E> => Deferred.await(self.done)

  const finish = <A, E>(self: SingleFlight<A, E>) =>
    SynchronizedRef.update(self.state, (): State<A, E> => ({ _tag: "Done" }))

  const launch = <A, E>(self: SingleFlight<A, E>, token: symbol): Effect.Effect<void> =>
    Effect.gen(function* () {
      const fiber = yield* self.effect.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            yield* finish(self)
            yield* Deferred.done(self.done, exit)
          }),
        ),
        Effect.forkChild,
      )

      yield* SynchronizedRef.modifyEffect(self.state, (state) => {
        if (state._tag === "Starting" && state.token === token) {
          return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([Effect.void, { _tag: "Running", token, fiber }])
        }

        return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([Fiber.interrupt(fiber).pipe(Effect.asVoid), state])
      }).pipe(Effect.flatten)
    })

  export const start = <A, E>(self: SingleFlight<A, E>): Effect.Effect<void> =>
    SynchronizedRef.modifyEffect(self.state, (state) => {
      if (state._tag === "Running" || state._tag === "Starting" || state._tag === "Done") {
        return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([Effect.void, state])
      }

      return Effect.succeed<[Effect.Effect<void>, State<A, E>]>([
        launch(self, state.token).pipe(Effect.ignore),
        { _tag: "Starting", token: state.token },
      ])
    }).pipe(Effect.flatten)

  export const cancel = <A, E>(self: SingleFlight<A, E>): Effect.Effect<void> =>
    SynchronizedRef.modifyEffect(self.state, (state) => {
      switch (state._tag) {
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
