import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope } from "effect"

export interface Runner<A, E = never> {
  readonly state: Runner.State<A, E>
  readonly busy: boolean
  readonly ensureRunning: (work: Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly startShell: (work: (signal: AbortSignal) => Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly cancel: Effect.Effect<void>
}

export namespace Runner {
  export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("RunnerCancelled", {}) {}

  interface ShellHandle<A, E> {
    fiber: Fiber.Fiber<A, E>
    abort: AbortController
  }

  export type State<A, E> =
    | { readonly _tag: "Idle" }
    | { readonly _tag: "Running"; readonly done: Deferred.Deferred<A, E | Cancelled>; readonly fiber: Fiber.Fiber<A, E> }
    | { readonly _tag: "Shell"; readonly shell: ShellHandle<A, E> }
    | { readonly _tag: "ShellThenRun"; readonly shell: ShellHandle<A, E>; readonly done: Deferred.Deferred<A, E | Cancelled>; readonly work: Effect.Effect<A, E> }

  export const make = <A, E = never>(scope: Scope.Scope, opts?: {
    onIdle?: Effect.Effect<void>
    onBusy?: Effect.Effect<void>
    onInterrupt?: Effect.Effect<A, E>
    busy?: () => never
  }): Runner<A, E> => {
    let state: State<A, E> = { _tag: "Idle" }
    const idle = opts?.onIdle ?? Effect.void
    const busy = opts?.onBusy ?? Effect.void
    const onInterrupt = opts?.onInterrupt

    const startRun = (work: Effect.Effect<A, E>, done: Deferred.Deferred<A, E | Cancelled>) =>
      Effect.gen(function* () {
        const fiber = yield* work.pipe(
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              if (state._tag === "Running") {
                state = { _tag: "Idle" }
                yield* idle
              }
              if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
                yield* Deferred.fail(done, new Cancelled())
              } else {
                yield* Deferred.done(done, exit)
              }
            }),
          ),
          Effect.forkIn(scope),
        )
        state = { _tag: "Running", done, fiber }
      })

    const ensureRunning = (work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        switch (state._tag) {
          case "Running":
            return yield* Deferred.await(state.done)
          case "ShellThenRun":
            return yield* Deferred.await(state.done)
          case "Shell": {
            const done = yield* Deferred.make<A, E | Cancelled>()
            state = { _tag: "ShellThenRun", shell: state.shell, done, work }
            return yield* Deferred.await(done)
          }
          case "Idle": {
            const done = yield* Deferred.make<A, E | Cancelled>()
            yield* startRun(work, done)
            return yield* Deferred.await(done)
          }
        }
      }).pipe(
        Effect.catch((e) =>
          e instanceof Cancelled && onInterrupt ? onInterrupt : Effect.fail(e),
        ),
      ) as Effect.Effect<A, E>

    const startShell = (work: (signal: AbortSignal) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        if (state._tag !== "Idle") {
          if (opts?.busy) opts.busy()
          throw new Error("Runner is busy")
        }
        yield* busy
        const ctrl = new AbortController()
        const fiber = yield* work(ctrl.signal).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              if (state._tag === "ShellThenRun") {
                const { done, work: pending } = state
                yield* startRun(pending, done)
              } else {
                state = { _tag: "Idle" }
                yield* idle
              }
            }),
          ),
          Effect.forkChild,
        )
        state = { _tag: "Shell", shell: { fiber, abort: ctrl } }
        const exit = yield* Fiber.await(fiber)
        if (Exit.isSuccess(exit)) return exit.value
        if (Cause.hasInterruptsOnly(exit.cause) && onInterrupt) return yield* onInterrupt
        return yield* Effect.failCause(exit.cause)
      }) as Effect.Effect<A, E>

    const cancel = Effect.gen(function* () {
      const st = state
      switch (st._tag) {
        case "Idle":
          return
        case "Running": {
          state = { _tag: "Idle" }
          yield* Fiber.interrupt(st.fiber)
          yield* Deferred.await(st.done).pipe(Effect.exit, Effect.asVoid)
          yield* idle
          return
        }
        case "Shell": {
          state = { _tag: "Idle" }
          st.shell.abort.abort()
          yield* Fiber.await(st.shell.fiber).pipe(Effect.exit, Effect.asVoid)
          yield* idle
          return
        }
        case "ShellThenRun": {
          state = { _tag: "Idle" }
          yield* Deferred.fail(st.done, new Cancelled()).pipe(Effect.asVoid)
          st.shell.abort.abort()
          yield* Fiber.await(st.shell.fiber).pipe(Effect.exit, Effect.asVoid)
          yield* idle
          return
        }
      }
    })

    return {
      get state() { return state },
      get busy() { return state._tag !== "Idle" },
      ensureRunning,
      startShell,
      cancel,
    }
  }
}
