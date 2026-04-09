import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope, SynchronizedRef } from "effect"

export interface Runner<A, E = never> {
  readonly state: Runner.State<A, E>
  readonly busy: boolean
  readonly ensureRunning: (work: Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly startShell: (work: Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly cancel: Effect.Effect<void>
}

export namespace Runner {
  export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("RunnerCancelled", {}) {}

  interface RunHandle<A, E> {
    id: number
    done: Deferred.Deferred<A, E | Cancelled>
    fiber: Fiber.Fiber<A, E>
  }

  interface ShellHandle<A, E> {
    id: number
    fiber: Fiber.Fiber<A, E>
  }

  interface PendingHandle<A, E> {
    id: number
    done: Deferred.Deferred<A, E | Cancelled>
    work: Effect.Effect<A, E>
  }

  export type State<A, E> =
    | { readonly _tag: "Idle" }
    | { readonly _tag: "Running"; readonly run: RunHandle<A, E> }
    | { readonly _tag: "Shell"; readonly shell: ShellHandle<A, E> }
    | { readonly _tag: "ShellThenRun"; readonly shell: ShellHandle<A, E>; readonly run: PendingHandle<A, E> }

  export const make = <A, E = never>(
    scope: Scope.Scope,
    opts?: {
      onIdle?: Effect.Effect<void>
      onBusy?: Effect.Effect<void>
      onInterrupt?: Effect.Effect<A, E>
      busy?: () => never
    },
  ): Runner<A, E> => {
    const ref = SynchronizedRef.makeUnsafe<State<A, E>>({ _tag: "Idle" })
    const idle = opts?.onIdle ?? Effect.void
    const busy = opts?.onBusy ?? Effect.void
    const onInterrupt = opts?.onInterrupt
    let ids = 0

    const state = () => SynchronizedRef.getUnsafe(ref)
    const next = () => {
      ids += 1
      return ids
    }

    const complete = (done: Deferred.Deferred<A, E | Cancelled>, exit: Exit.Exit<A, E>) =>
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
        ? Deferred.fail(done, new Cancelled()).pipe(Effect.asVoid)
        : Deferred.done(done, exit).pipe(Effect.asVoid)

    const idleIfCurrent = () =>
      SynchronizedRef.modify(ref, (st) => [st._tag === "Idle" ? idle : Effect.void, st] as const).pipe(Effect.flatten)

    const finishRun = (id: number, done: Deferred.Deferred<A, E | Cancelled>, exit: Exit.Exit<A, E>) =>
      SynchronizedRef.modify(
        ref,
        (st) =>
          [
            Effect.gen(function* () {
              if (st._tag === "Running" && st.run.id === id) yield* idle
              yield* complete(done, exit)
            }),
            st._tag === "Running" && st.run.id === id ? ({ _tag: "Idle" } as const) : st,
          ] as const,
      ).pipe(Effect.flatten)

    const startRun = (work: Effect.Effect<A, E>, done: Deferred.Deferred<A, E | Cancelled>) =>
      Effect.gen(function* () {
        const id = next()
        const fiber = yield* work.pipe(
          Effect.onExit((exit) => finishRun(id, done, exit)),
          Effect.forkIn(scope),
        )
        return { id, done, fiber } satisfies RunHandle<A, E>
      })

    const finishShell = (id: number) =>
      SynchronizedRef.modifyEffect(
        ref,
        Effect.fnUntraced(function* (st) {
          if (st._tag === "Shell" && st.shell.id === id) return [idle, { _tag: "Idle" }] as const
          if (st._tag === "ShellThenRun" && st.shell.id === id) {
            const run = yield* startRun(st.run.work, st.run.done)
            return [Effect.void, { _tag: "Running", run }] as const
          }
          return [Effect.void, st] as const
        }),
      ).pipe(Effect.flatten)

    const stopShell = (shell: ShellHandle<A, E>) => Fiber.interrupt(shell.fiber)

    const ensureRunning = (work: Effect.Effect<A, E>) =>
      SynchronizedRef.modifyEffect(
        ref,
        Effect.fnUntraced(function* (st) {
          switch (st._tag) {
            case "Running":
            case "ShellThenRun":
              return [Deferred.await(st.run.done), st] as const
            case "Shell": {
              const run = {
                id: next(),
                done: yield* Deferred.make<A, E | Cancelled>(),
                work,
              } satisfies PendingHandle<A, E>
              return [Deferred.await(run.done), { _tag: "ShellThenRun", shell: st.shell, run }] as const
            }
            case "Idle": {
              const done = yield* Deferred.make<A, E | Cancelled>()
              const run = yield* startRun(work, done)
              return [Deferred.await(done), { _tag: "Running", run }] as const
            }
          }
        }),
      ).pipe(
        Effect.flatten,
        Effect.catch(
          (e): Effect.Effect<A, E> => (e instanceof Cancelled ? (onInterrupt ?? Effect.die(e)) : Effect.fail(e as E)),
        ),
      )

    const startShell = (work: Effect.Effect<A, E>) =>
      SynchronizedRef.modifyEffect(
        ref,
        Effect.fnUntraced(function* (st) {
          if (st._tag !== "Idle") {
            return [
              Effect.sync(() => {
                if (opts?.busy) opts.busy()
                throw new Error("Runner is busy")
              }),
              st,
            ] as const
          }
          yield* busy
          const id = next()
          const fiber = yield* work.pipe(Effect.ensuring(finishShell(id)), Effect.forkChild)
          const shell = { id, fiber } satisfies ShellHandle<A, E>
          return [
            Effect.gen(function* () {
              const exit = yield* Fiber.await(fiber)
              if (Exit.isSuccess(exit)) return exit.value
              if (Cause.hasInterruptsOnly(exit.cause) && onInterrupt) return yield* onInterrupt
              return yield* Effect.failCause(exit.cause)
            }),
            { _tag: "Shell", shell },
          ] as const
        }),
      ).pipe(Effect.flatten)

    const cancel = SynchronizedRef.modify(ref, (st) => {
      switch (st._tag) {
        case "Idle":
          return [Effect.void, st] as const
        case "Running":
          return [
            Effect.gen(function* () {
              yield* Fiber.interrupt(st.run.fiber)
              yield* Deferred.await(st.run.done).pipe(Effect.exit, Effect.asVoid)
              yield* idleIfCurrent()
            }),
            { _tag: "Idle" } as const,
          ] as const
        case "Shell":
          return [
            Effect.gen(function* () {
              yield* stopShell(st.shell)
              yield* idleIfCurrent()
            }),
            { _tag: "Idle" } as const,
          ] as const
        case "ShellThenRun":
          return [
            Effect.gen(function* () {
              yield* Deferred.fail(st.run.done, new Cancelled()).pipe(Effect.asVoid)
              yield* stopShell(st.shell)
              yield* idleIfCurrent()
            }),
            { _tag: "Idle" } as const,
          ] as const
      }
    }).pipe(Effect.flatten)

    return {
      get state() {
        return state()
      },
      get busy() {
        return state()._tag !== "Idle"
      },
      ensureRunning,
      startShell,
      cancel,
    }
  }
}
