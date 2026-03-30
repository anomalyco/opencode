import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope } from "effect"

export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("Runner.Cancelled", {}) {}

interface ShellHandle<A> {
  fiber: Fiber.Fiber<A, unknown>
  abort: AbortController
}

type State<A> =
  | { type: "idle" }
  | { type: "running"; done: Deferred.Deferred<A, Cancelled>; fiber: Fiber.Fiber<A, unknown> }
  | { type: "shell"; shell: ShellHandle<A> }
  | { type: "shell_then_run"; shell: ShellHandle<A>; done: Deferred.Deferred<A, Cancelled>; work: Effect.Effect<A, unknown> }

export interface Runner<A> {
  readonly state: State<A>
  readonly busy: boolean
  readonly ensureRunning: (work: Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>
  readonly startShell: (work: (signal: AbortSignal) => Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>
  readonly cancel: Effect.Effect<void>
}

export const make = <A>(scope: Scope.Scope, opts?: {
  onIdle?: Effect.Effect<void>
  onBusy?: Effect.Effect<void>
  onInterrupt?: Effect.Effect<A, unknown>
  busy?: () => never
}): Runner<A> => {
  let state: State<A> = { type: "idle" }
  const idle = opts?.onIdle ?? Effect.void
  const busy = opts?.onBusy ?? Effect.void
  const onInterrupt = opts?.onInterrupt

  const startRun = (work: Effect.Effect<A, unknown>, done: Deferred.Deferred<A, Cancelled>) =>
    Effect.gen(function* () {
      const fiber = yield* work.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (state.type === "running") {
              state = { type: "idle" }
              yield* idle
            }
            if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
              yield* Deferred.fail(done, new Cancelled())
            } else {
              yield* Deferred.done(done, exit as Exit.Exit<A, Cancelled>)
            }
          }),
        ),
        Effect.forkIn(scope),
      )
      state = { type: "running", done, fiber }
    })

  const ensureRunning = (work: Effect.Effect<A, unknown>) =>
    Effect.gen(function* () {
      switch (state.type) {
        case "running":
          return yield* Deferred.await(state.done)
        case "shell_then_run":
          return yield* Deferred.await(state.done)
        case "shell": {
          const done = yield* Deferred.make<A, Cancelled>()
          state = { type: "shell_then_run", shell: state.shell, done, work }
          return yield* Deferred.await(done)
        }
        case "idle": {
          const done = yield* Deferred.make<A, Cancelled>()
          yield* startRun(work, done)
          return yield* Deferred.await(done)
        }
      }
    }).pipe(
      Effect.catch((e) =>
        e instanceof Cancelled && onInterrupt ? onInterrupt : Effect.fail(e),
      ),
    )

  const startShell = (work: (signal: AbortSignal) => Effect.Effect<A, unknown>) =>
    Effect.gen(function* () {
      if (state.type !== "idle") {
        if (opts?.busy) opts.busy()
        throw new Error("Runner is busy")
      }
      yield* busy
      const ctrl = new AbortController()
      const fiber = yield* work(ctrl.signal).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            if (state.type === "shell_then_run") {
              const { done, work: pending } = state
              yield* startRun(pending, done)
            } else {
              state = { type: "idle" }
              if (state.type === "idle") yield* idle
            }
          }),
        ),
        Effect.forkChild,
      )
      state = { type: "shell", shell: { fiber, abort: ctrl } }
      const exit = yield* Fiber.await(fiber)
      if (Exit.isSuccess(exit)) return exit.value
      if (Cause.hasInterruptsOnly(exit.cause) && onInterrupt) return yield* onInterrupt
      return yield* Effect.failCause(exit.cause)
    })

  const cancel = Effect.gen(function* () {
    const st = state
    switch (st.type) {
      case "idle":
        return
      case "running": {
        state = { type: "idle" }
        yield* Fiber.interrupt(st.fiber)
        yield* Deferred.await(st.done).pipe(Effect.exit, Effect.asVoid)
        yield* idle
        return
      }
      case "shell": {
        state = { type: "idle" }
        st.shell.abort.abort()
        yield* Fiber.await(st.shell.fiber).pipe(Effect.exit, Effect.asVoid)
        yield* idle
        return
      }
      case "shell_then_run": {
        state = { type: "idle" }
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
    get busy() { return state.type !== "idle" },
    ensureRunning,
    startShell,
    cancel,
  }
}
