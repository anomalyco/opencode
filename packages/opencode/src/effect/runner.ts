import { Cause, Deferred, Duration, Effect, Exit, Fiber, Latch, Schema, Scope, SynchronizedRef } from "effect"

export interface Runner<A, E = never> {
  readonly state: State<A, E>
  readonly busy: boolean
  readonly ensureRunning: <R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly startShell: <R>(work: Effect.Effect<A, E, R>, ready?: Latch.Latch) => Effect.Effect<A, E | Busy, R>
  readonly cancel: Effect.Effect<void>
}

export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("RunnerCancelled", {}) {}
export class Busy extends Schema.TaggedErrorClass<Busy>()("RunnerBusy", {}) {}

interface RunHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | Cancelled>
  fiber: Fiber.Fiber<A, E>
}

interface ShellHandle<A, E> {
  id: number
  cancelled: Deferred.Deferred<void>
  ready?: Latch.Latch
  fiber: Fiber.Fiber<A, E>
}

interface PendingHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | Cancelled>
  work: Effect.Effect<A, E, unknown>
}

export type State<A, E> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running"; readonly run: RunHandle<A, E> }
  // Cancellation requested and in flight. Distinct from Idle on purpose: the
  // turn is not over yet, so `busy` must stay true, and a second cancel must
  // find something to escalate rather than a state that looks already-finished.
  | { readonly _tag: "Cancelling"; readonly run: RunHandle<A, E>; readonly escalate: Deferred.Deferred<void> }
  | { readonly _tag: "Shell"; readonly shell: ShellHandle<A, E> }
  | { readonly _tag: "ShellThenRun"; readonly shell: ShellHandle<A, E>; readonly run: PendingHandle<A, E> }

// How long to wait for a fiber to honour interruption before abandoning it.
// A turn parked on a half-open socket is uninterruptible in practice, and an
// unbounded wait is what turns one wedged request into an 18-hour hang.
export const DefaultInterruptGrace = "10 seconds"

export const make = <A, E = never>(
  scope: Scope.Scope,
  opts?: {
    onIdle?: Effect.Effect<void>
    onBusy?: Effect.Effect<void>
    onInterrupt?: Effect.Effect<A, E>
    interruptGrace?: Duration.Input
  },
): Runner<A, E> => {
  const interruptGrace = opts?.interruptGrace ?? DefaultInterruptGrace
  const ref = SynchronizedRef.makeUnsafe<State<A, E>>({ _tag: "Idle" })
  const idle = opts?.onIdle ?? Effect.void
  const onBusy = opts?.onBusy ?? Effect.void
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

  const awaitDone = (done: Deferred.Deferred<A, E | Cancelled>) =>
    Deferred.await(done).pipe(Effect.catchTag("RunnerCancelled", (e) => onInterrupt ?? Effect.die(e)))

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

  const startRun = (work: Effect.Effect<A, E, unknown>, done: Deferred.Deferred<A, E | Cancelled>) =>
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
        if (st._tag === "Shell" && st.shell.id === id) {
          return [idle, { _tag: "Idle" }] as const
        }
        if (st._tag === "ShellThenRun" && st.shell.id === id) {
          const run = yield* startRun(st.run.work, st.run.done)
          return [Effect.void, { _tag: "Running", run }] as const
        }
        return [Effect.void, st] as const
      }),
    ).pipe(Effect.flatten)

  const stopShell = (shell: ShellHandle<A, E>) =>
    Effect.gen(function* () {
      if (shell.ready) yield* shell.ready.await.pipe(Effect.exit, Effect.asVoid)
      yield* Deferred.succeed(shell.cancelled, undefined).pipe(Effect.asVoid)
      yield* Fiber.interrupt(shell.fiber)
    })

  const ensureRunning = <R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        switch (st._tag) {
          case "Running":
          case "ShellThenRun":
            return [awaitDone(st.run.done), st] as const
          case "Shell": {
            const run = {
              id: next(),
              done: yield* Deferred.make<A, E | Cancelled>(),
              work: work as Effect.Effect<A, E, unknown>,
            } satisfies PendingHandle<A, E>
            return [awaitDone(run.done), { _tag: "ShellThenRun", shell: st.shell, run }] as const
          }
          // Cancelling behaves like Idle here on purpose: the user pressing Esc
          // and immediately submitting a new prompt must not have to wait for the
          // outgoing fiber to finish draining. The replacement run takes over the
          // state; finishCancel() is id-scoped, so the still-running cancellation
          // cannot clobber it when it completes.
          case "Cancelling":
          case "Idle": {
            const done = yield* Deferred.make<A, E | Cancelled>()
            const run = yield* startRun(work, done)
            return [awaitDone(done), { _tag: "Running", run }] as const
          }
        }
      }),
    ).pipe(Effect.flatten) as Effect.Effect<A, E, R>

  const startShell = <R>(work: Effect.Effect<A, E, R>, ready?: Latch.Latch): Effect.Effect<A, E | Busy, R> =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (st._tag !== "Idle") {
          const reject: Effect.Effect<A, E | Busy> = Effect.fail(new Busy())
          return [reject, st] as const
        }
        yield* onBusy
        const id = next()
        const cancelled = yield* Deferred.make<void>()
        const fiber = yield* work.pipe(Effect.ensuring(finishShell(id)), Effect.forkChild)
        const shell = { id, cancelled, ready, fiber } satisfies ShellHandle<A, E>
        return [
          Effect.gen(function* () {
            const exit = yield* Fiber.await(fiber)
            if (Exit.isSuccess(exit)) return exit.value
            if (
              Cause.hasInterruptsOnly(exit.cause) ||
              ((yield* Deferred.isDone(cancelled)) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause))
            ) {
              if (onInterrupt) return yield* onInterrupt
              return yield* Effect.die(new Cancelled())
            }
            return yield* Effect.failCause(exit.cause)
          }),
          { _tag: "Shell", shell },
        ] as const
      }),
    ).pipe(Effect.flatten) as Effect.Effect<A, E | Busy, R>

  // Commit Idle only once the run is genuinely released. Previously `cancel`
  // used SynchronizedRef.modify, which writes the new state BEFORE running the
  // returned effect — so the first cancel flipped to Idle and then parked
  // forever inside Fiber.interrupt on an unresponsive fiber. idleIfCurrent()
  // never ran, so onIdle never fired and the session stayed visibly busy, while
  // every subsequent cancel matched `case "Idle"` and returned Effect.void.
  // The first Esc disarmed the escape hatch and no later keypress could recover.
  const finishCancel = (id: number) =>
    SynchronizedRef.modify(ref, (st) => {
      const mine = st._tag === "Cancelling" && st.run.id === id
      return [mine ? idle : Effect.void, mine ? ({ _tag: "Idle" } as const) : st] as const
    }).pipe(Effect.flatten)

  const releaseRun = (run: RunHandle<A, E>, escalate: Deferred.Deferred<void>) =>
    Effect.gen(function* () {
      // Signal interruption on a detached fiber and wait on a Deferred rather
      // than on Fiber.interrupt itself. Racing Fiber.interrupt directly does
      // not work: the race must interrupt its loser and wait for it, and the
      // loser here is an await on a fiber that by definition will not die — so
      // the race never settles and we are back to the original hang. Detaching
      // means an unkillable fiber leaks (and is logged) instead of holding the
      // session hostage.
      const interrupted = yield* Deferred.make<void>()
      yield* Fiber.interrupt(run.fiber).pipe(
        Effect.andThen(Deferred.succeed(interrupted, undefined)),
        Effect.forkIn(scope),
      )
      const outcome = yield* Effect.raceFirst(
        Deferred.await(interrupted).pipe(Effect.as("interrupted" as const)),
        Deferred.await(escalate).pipe(Effect.as("escalated" as const)),
      ).pipe(Effect.timeoutOrElse({ duration: interruptGrace, orElse: () => Effect.succeed("timeout" as const) }))
      if (outcome !== "interrupted")
        yield* Effect.logWarning("runner: abandoning fiber that would not interrupt", { reason: outcome })
      // Release regardless. An abandoned fiber must not hold the session
      // hostage — the user gets control back and the leak is logged.
      yield* Deferred.fail(run.done, new Cancelled()).pipe(Effect.asVoid)
      yield* finishCancel(run.id)
    })

  const cancel = SynchronizedRef.modifyEffect(
    ref,
    Effect.fnUntraced(function* (st) {
      switch (st._tag) {
        case "Idle":
          return [Effect.void, st] as const
        case "Cancelling":
          // Escalate: skip the remaining grace period and force release.
          return [Deferred.succeed(st.escalate, undefined).pipe(Effect.asVoid), st] as const
        case "Running": {
          const escalate = yield* Deferred.make<void>()
          return [releaseRun(st.run, escalate), { _tag: "Cancelling", run: st.run, escalate } as const] as const
        }
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
              yield* stopShell(st.shell)
              yield* Deferred.fail(st.run.done, new Cancelled()).pipe(Effect.asVoid)
              yield* idleIfCurrent()
            }),
            { _tag: "Idle" } as const,
          ] as const
      }
    }),
  ).pipe(Effect.flatten)

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

export * as Runner from "./runner"
