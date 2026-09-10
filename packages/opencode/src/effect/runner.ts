import { Cause, Deferred, Effect, Exit, Fiber, Latch, Schema, Scope, SynchronizedRef } from "effect"

export interface Lifecycle {
  readonly register: (token: object, dispose: Effect.Effect<void>) => Effect.Effect<void, Cancelled>
  readonly unregister: (token: object) => Effect.Effect<void>
}

export interface Runner<A, E = never> {
  readonly state: State<A, E>
  readonly busy: boolean
  /** Legacy join-or-start arbitration. Running work still wins and the supplied work is discarded. */
  readonly ensureRunning: (work: Effect.Effect<A, E>) => Effect.Effect<A, E>
  /** Reply-required FIFO publication. Every accepted call owns its own completion barrier. */
  readonly publish: (
    work: (scope: Scope.Scope) => Effect.Effect<A, E>,
    release: Deferred.Deferred<void>,
  ) => Effect.Effect<Publication<A, E>, E>
  readonly startShell: (work: Effect.Effect<A, E>, ready?: Latch.Latch) => Effect.Effect<A, E | Busy>
  readonly cancel: Effect.Effect<void>
  readonly dispose: Effect.Effect<void>
}

export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("RunnerCancelled", {}) {}
export class Busy extends Schema.TaggedErrorClass<Busy>()("RunnerBusy", {}) {}

export interface Published<A, E> {
  readonly type: "published"
  readonly id: number
  readonly release: Deferred.Deferred<void>
  readonly done: Deferred.Deferred<A, E | Cancelled>
  readonly await: Effect.Effect<A, E>
}

export type Publication<A, E> = { readonly type: "completed"; readonly value: A } | Published<A, E>

interface Prepared<A, E> {
  readonly id: number
  readonly start: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
  readonly done: Deferred.Deferred<A, E | Cancelled>
  readonly fiber: Fiber.Fiber<A, E>
}

interface LegacySelection<A, E> {
  readonly wait: Effect.Effect<A, E | Cancelled>
  readonly start?: Deferred.Deferred<void>
}

interface ShellHandle<A, E> {
  readonly id: number
  readonly generation: Generation
  readonly cancelled: Deferred.Deferred<void>
  readonly done: Deferred.Deferred<A, E | Cancelled>
  readonly ready?: Latch.Latch
  readonly fiber: Fiber.Fiber<A, E>
}

type GenerationPhase = "open" | "closing" | "closed"

interface Generation {
  readonly token: object
  readonly scope: Scope.Closeable
  readonly phase: SynchronizedRef.SynchronizedRef<GenerationPhase>
  readonly closed: Deferred.Deferred<void>
}

export type State<A, E> =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Running"
      readonly generation: Generation
      readonly run: Prepared<A, E>
      readonly queue: readonly Prepared<A, E>[]
    }
  | { readonly _tag: "Shell"; readonly generation: Generation; readonly shell: ShellHandle<A, E> }
  | {
      readonly _tag: "ShellThenRun"
      readonly generation: Generation
      readonly shell: ShellHandle<A, E>
      readonly queue: readonly Prepared<A, E>[]
    }

type Cell<A, E> = {
  readonly disposed: boolean
  readonly state: State<A, E>
}

const defaultLifecycle: Lifecycle = {
  register: () => Effect.void,
  unregister: () => Effect.void,
}

export const make = <A, E = never>(
  // Retained for source compatibility with the legacy constructor. Generations are deliberately
  // detached and never fork into this Instance-owned Scope.
  _scope: Scope.Scope,
  opts?: {
    onIdle?: Effect.Effect<void>
    onBusy?: Effect.Effect<void>
    onInterrupt?: Effect.Effect<A, E>
    lifecycle?: Lifecycle
  },
): Runner<A, E> => {
  const ref = SynchronizedRef.makeUnsafe<Cell<A, E>>({ disposed: false, state: { _tag: "Idle" } })
  const idle = opts?.onIdle ?? Effect.void
  const onBusy = opts?.onBusy ?? Effect.void
  const onInterrupt = opts?.onInterrupt
  const lifecycle = opts?.lifecycle ?? defaultLifecycle
  const ids = { value: 0 }
  const interrupted = Exit.failCause(Cause.interrupt())

  const state = () => SynchronizedRef.getUnsafe(ref).state
  const next = () => {
    ids.value += 1
    return ids.value
  }
  const idleState = (): State<A, E> => ({ _tag: "Idle" })

  const complete = (done: Deferred.Deferred<A, E | Cancelled>, exit: Exit.Exit<A, E>) =>
    Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
      ? Deferred.fail(done, new Cancelled()).pipe(Effect.asVoid)
      : Deferred.done(done, exit).pipe(Effect.asVoid)

  const completeShell = (
    done: Deferred.Deferred<A, E | Cancelled>,
    cancelled: Deferred.Deferred<void>,
    exit: Exit.Exit<A, E>,
  ) => {
    if (Exit.isSuccess(exit)) return Deferred.succeed(done, exit.value).pipe(Effect.asVoid)
    const interruptedOnly = Cause.hasInterruptsOnly(exit.cause)
    return Deferred.isDone(cancelled).pipe(
      Effect.flatMap((marked) =>
        interruptedOnly || (marked && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause))
          ? Deferred.fail(done, new Cancelled()).pipe(Effect.asVoid)
          : Deferred.done(done, exit).pipe(Effect.asVoid),
      ),
    )
  }

  const settleAfter = (action: Effect.Effect<void>, settleResult: (result: Exit.Exit<void>) => Effect.Effect<void>) =>
    action.pipe(
      Effect.exit,
      Effect.flatMap((result) =>
        settleResult(result).pipe(
          Effect.andThen(Exit.isFailure(result) ? Effect.failCause(result.cause) : Effect.void),
        ),
      ),
    )

  const completeShellAfter = (
    done: Deferred.Deferred<A, E | Cancelled>,
    cancelled: Deferred.Deferred<void>,
    exit: Exit.Exit<A, E>,
    action: Effect.Effect<void>,
  ) =>
    settleAfter(action, (result) =>
      Exit.isFailure(result)
        ? Deferred.failCause(done, result.cause).pipe(Effect.asVoid)
        : completeShell(done, cancelled, exit),
    )

  // Cancel settles every barrier before physical cleanup. A selected entry still waits for only its
  // own fiber finalizers before projecting `onInterrupt`, so prompt callers observe the Assistant's
  // established terminal state; an unstarted queued entry projects immediately, including while a
  // shell cleanup is still waiting for `ready`.
  const awaitEntry = (entry: Prepared<A, E>) =>
    Deferred.await(entry.done).pipe(
      Effect.catchTag("RunnerCancelled", (error) =>
        Deferred.isDone(entry.start).pipe(
          Effect.flatMap((started) => (started ? Fiber.await(entry.fiber).pipe(Effect.asVoid) : Effect.void)),
          Effect.andThen(onInterrupt ?? Effect.die(error)),
        ),
      ),
    )

  const claimGeneration = (generation: Generation) =>
    SynchronizedRef.modify(generation.phase, (phase) =>
      phase === "open" ? ([true, "closing"] as const) : ([false, phase] as const),
    )

  const finalizeGeneration = (generation: Generation) =>
    lifecycle
      .unregister(generation.token)
      .pipe(
        Effect.ensuring(
          SynchronizedRef.set(generation.phase, "closed").pipe(
            Effect.andThen(Deferred.succeed(generation.closed, undefined).pipe(Effect.asVoid)),
          ),
        ),
      )

  const closeOwned = <A2, E2>(generation: Generation, exit: Exit.Exit<A2, E2>) =>
    Scope.close(generation.scope, exit).pipe(Effect.ensuring(finalizeGeneration(generation)))

  const closeUnregistered = <A2, E2>(generation: Generation, exit: Exit.Exit<A2, E2>) =>
    SynchronizedRef.set(generation.phase, "closing").pipe(
      Effect.andThen(Scope.close(generation.scope, exit)),
      Effect.ensuring(
        SynchronizedRef.set(generation.phase, "closed").pipe(
          Effect.andThen(Deferred.succeed(generation.closed, undefined).pipe(Effect.asVoid)),
        ),
      ),
    )

  const generationOf = (current: State<A, E>) => {
    if (current._tag === "Idle") return undefined
    return current.generation
  }

  const entriesOf = (current: State<A, E>): readonly Prepared<A, E>[] => {
    if (current._tag === "Running") return [current.run, ...current.queue]
    if (current._tag === "ShellThenRun") return current.queue
    return []
  }

  const shellOf = (current: State<A, E>) => {
    if (current._tag === "Shell" || current._tag === "ShellThenRun") return current.shell
    return undefined
  }

  const settle = (entries: readonly Prepared<A, E>[]) =>
    Effect.forEach(entries, (entry) => Deferred.fail(entry.done, new Cancelled()), {
      concurrency: "unbounded",
      discard: true,
    })

  const stopShell = (shell: ShellHandle<A, E>) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        if (shell.ready) yield* shell.ready.await.pipe(Effect.exit, Effect.asVoid)
        yield* Deferred.succeed(shell.cancelled, undefined).pipe(Effect.asVoid)
        yield* Fiber.interrupt(shell.fiber)
      }),
    )

  const cleanupDetached = (current: State<A, E>, generation: Generation, owner: boolean) => {
    if (!owner) return Deferred.await(generation.closed)
    const close = closeOwned(generation, interrupted)
    const shell = shellOf(current)
    const physical = shell ? stopShell(shell).pipe(Effect.ensuring(close)) : close
    const shellDone = shell ? Deferred.fail(shell.done, new Cancelled()).pipe(Effect.asVoid) : Effect.void
    const barriers = settle(entriesOf(current)).pipe(Effect.ensuring(shellDone))
    // Retire the Session lookup/status before releasing any waiter that can publish replacement
    // work. Barriers still settle before the potentially indefinite shell-ready/physical-close path,
    // and nested finalizers ensure an idle or settlement defect cannot strand exact cleanup.
    return idle.pipe(Effect.ensuring(barriers.pipe(Effect.ensuring(physical))))
  }

  const disposeExact = (generation: Generation) =>
    Effect.uninterruptible(
      SynchronizedRef.modifyEffect(
        ref,
        Effect.fnUntraced(function* (cell) {
          const current = generationOf(cell.state)
          if (current !== generation) {
            return [Deferred.await(generation.closed), { disposed: true, state: cell.state }] as const
          }
          const owner = yield* claimGeneration(generation)
          return [cleanupDetached(cell.state, generation, owner), { disposed: true, state: idleState() }] as const
        }),
      ).pipe(Effect.flatten),
    )

  const makeGeneration = Effect.fn("Runner.makeGeneration")(function* () {
    const generation: Generation = {
      token: {},
      scope: yield* Scope.make("sequential"),
      phase: SynchronizedRef.makeUnsafe<GenerationPhase>("open"),
      closed: yield* Deferred.make<void>(),
    }
    yield* lifecycle
      .register(generation.token, disposeExact(generation))
      .pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? closeUnregistered(generation, exit) : Effect.void)))
    return generation
  })

  const abortGeneration = <A2, E2>(generation: Generation, exit: Exit.Exit<A2, E2>) =>
    claimGeneration(generation).pipe(
      Effect.flatMap((owner) => (owner ? closeOwned(generation, exit) : Deferred.await(generation.closed))),
    )

  const finishRun = (
    generation: Generation,
    id: number,
    done: Deferred.Deferred<A, E | Cancelled>,
    exit: Exit.Exit<A, E>,
  ) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (cell) {
        const current = cell.state
        if (current._tag !== "Running" || current.generation !== generation || current.run.id !== id)
          return [Effect.void, cell] as const
        const head = current.queue[0]
        if (head) {
          const action = complete(done, exit).pipe(
            Effect.andThen(Deferred.succeed(head.start, undefined).pipe(Effect.asVoid)),
          )
          const nextState: State<A, E> = {
            _tag: "Running",
            generation,
            run: head,
            queue: current.queue.slice(1),
          }
          return [action, { disposed: cell.disposed, state: nextState }] as const
        }
        const owner = yield* claimGeneration(generation)
        const finish = owner
          ? settleAfter(idle, (result) =>
              Exit.isFailure(result)
                ? Deferred.failCause(done, result.cause).pipe(Effect.asVoid)
                : complete(done, exit),
            ).pipe(Effect.ensuring(closeOwned(generation, exit)))
          : Deferred.await(generation.closed)
        return [finish, { disposed: cell.disposed, state: idleState() }] as const
      }),
    ).pipe(Effect.flatten)

  const finishShell = (
    generation: Generation,
    id: number,
    done: Deferred.Deferred<A, E | Cancelled>,
    cancelled: Deferred.Deferred<void>,
    exit: Exit.Exit<A, E>,
  ) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (cell) {
        const current = cell.state
        const exact =
          (current._tag === "Shell" || current._tag === "ShellThenRun") &&
          current.generation === generation &&
          current.shell.id === id
        if (!exact) return [Effect.void, cell] as const
        const head = current._tag === "ShellThenRun" ? current.queue[0] : undefined
        if (head) {
          const nextState: State<A, E> = {
            _tag: "Running",
            generation,
            run: head,
            queue: current._tag === "ShellThenRun" ? current.queue.slice(1) : [],
          }
          return [
            completeShellAfter(done, cancelled, exit, Deferred.succeed(head.start, undefined).pipe(Effect.asVoid)),
            { disposed: cell.disposed, state: nextState },
          ] as const
        }
        const owner = yield* claimGeneration(generation)
        const finish = owner
          ? completeShellAfter(done, cancelled, exit, idle.pipe(Effect.ensuring(closeOwned(generation, exit))))
          : Deferred.await(generation.closed)
        return [finish, { disposed: cell.disposed, state: idleState() }] as const
      }),
    ).pipe(Effect.flatten)

  const prepare = Effect.fn("Runner.prepare")(function* (
    generation: Generation,
    work: (scope: Scope.Scope) => Effect.Effect<A, E>,
    release: Deferred.Deferred<void>,
  ) {
    const id = next()
    const start = yield* Deferred.make<void>()
    const done = yield* Deferred.make<A, E | Cancelled>()
    const fiber = yield* Effect.gen(function* () {
      yield* Deferred.await(start)
      yield* Deferred.await(release)
      return yield* work(generation.scope)
    }).pipe(
      Effect.onExit((exit) => finishRun(generation, id, done, exit)),
      Effect.forkIn(generation.scope),
    )
    return { id, start, release, done, fiber } satisfies Prepared<A, E>
  })

  const legacy = (work: Effect.Effect<A, E>) => (generation: Scope.Scope) =>
    work.pipe(Effect.provideService(Scope.Scope, generation))

  const prepareLegacy = Effect.fn("Runner.prepareLegacy")(function* (
    generation: Generation,
    work: Effect.Effect<A, E>,
  ) {
    const release = yield* Deferred.make<void>()
    yield* Deferred.succeed(release, undefined)
    return yield* prepare(generation, legacy(work), release)
  })

  const publishPrepared = (entry: Prepared<A, E>): Published<A, E> => ({
    type: "published",
    id: entry.id,
    release: entry.release,
    done: entry.done,
    await: awaitEntry(entry),
  })

  const publishInternal = (work: (scope: Scope.Scope) => Effect.Effect<A, E>, release: Deferred.Deferred<void>) =>
    Effect.uninterruptible(
      SynchronizedRef.modifyEffect(
        ref,
        Effect.fnUntraced(function* (cell) {
          if (cell.disposed) {
            const cancelled: Effect.Effect<Prepared<A, E>, Cancelled> = Effect.fail(new Cancelled())
            return [cancelled, cell] as const
          }
          const current = cell.state
          if (current._tag === "Running") {
            const entry = yield* prepare(current.generation, work, release)
            const nextState: State<A, E> = { ...current, queue: [...current.queue, entry] }
            return [Effect.succeed(entry), { disposed: false, state: nextState }] as const
          }
          if (current._tag === "Shell") {
            const entry = yield* prepare(current.generation, work, release)
            const nextState: State<A, E> = {
              _tag: "ShellThenRun",
              generation: current.generation,
              shell: current.shell,
              queue: [entry],
            }
            return [Effect.succeed(entry), { disposed: false, state: nextState }] as const
          }
          if (current._tag === "ShellThenRun") {
            const entry = yield* prepare(current.generation, work, release)
            const nextState: State<A, E> = { ...current, queue: [...current.queue, entry] }
            return [Effect.succeed(entry), { disposed: false, state: nextState }] as const
          }
          const generation = yield* makeGeneration()
          const entry = yield* prepare(generation, work, release).pipe(
            Effect.onExit((exit) => (Exit.isFailure(exit) ? abortGeneration(generation, exit) : Effect.void)),
          )
          const nextState: State<A, E> = { _tag: "Running", generation, run: entry, queue: [] }
          return [
            Deferred.succeed(entry.start, undefined).pipe(Effect.as(entry)),
            { disposed: false, state: nextState },
          ] as const
        }),
      ).pipe(Effect.flatten),
    )

  const publish = (
    work: (scope: Scope.Scope) => Effect.Effect<A, E>,
    release: Deferred.Deferred<void>,
  ): Effect.Effect<Publication<A, E>, E> =>
    publishInternal(work, release).pipe(
      Effect.map(publishPrepared),
      Effect.catchTag("RunnerCancelled", (error) =>
        (onInterrupt ?? Effect.die(error)).pipe(
          Effect.map((value) => ({ type: "completed", value }) satisfies Publication<A, E>),
        ),
      ),
    )

  const ensureRunning = (work: Effect.Effect<A, E>) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const selected: LegacySelection<A, E> = yield* SynchronizedRef.modifyEffect(
          ref,
          Effect.fnUntraced(function* (cell) {
            if (cell.disposed) {
              const cancelled: Effect.Effect<A, E | Cancelled> = Effect.fail(new Cancelled())
              return [{ wait: cancelled }, cell] as const
            }
            const current = cell.state
            if (current._tag === "Running") return [{ wait: awaitEntry(current.run) }, cell] as const
            if (current._tag === "ShellThenRun") {
              const head = current.queue[0]
              if (!head) return [{ wait: Effect.die(new Error("Runner ShellThenRun has no FIFO head")) }, cell] as const
              return [{ wait: awaitEntry(head) }, cell] as const
            }
            if (current._tag === "Shell") {
              const entry = yield* prepareLegacy(current.generation, work)
              const nextState: State<A, E> = {
                _tag: "ShellThenRun",
                generation: current.generation,
                shell: current.shell,
                queue: [entry],
              }
              return [{ wait: awaitEntry(entry) }, { disposed: false, state: nextState }] as const
            }
            const generation = yield* makeGeneration()
            const entry = yield* prepareLegacy(generation, work).pipe(
              Effect.onExit((exit) => (Exit.isFailure(exit) ? abortGeneration(generation, exit) : Effect.void)),
            )
            const nextState: State<A, E> = { _tag: "Running", generation, run: entry, queue: [] }
            return [
              { wait: awaitEntry(entry), start: entry.start },
              { disposed: false, state: nextState },
            ] as const
          }),
        )
        if (selected.start) yield* Deferred.succeed(selected.start, undefined)
        return yield* restore(selected.wait)
      }),
    ).pipe(Effect.catchTag("RunnerCancelled", (error) => onInterrupt ?? Effect.die(error)))

  const waitShell = (shell: ShellHandle<A, E>): Effect.Effect<A, E> =>
    Deferred.await(shell.done).pipe(
      Effect.catchTag("RunnerCancelled", (error) =>
        Fiber.await(shell.fiber).pipe(
          Effect.flatMap((exit) =>
            Exit.isFailure(exit) && Cause.hasDies(exit.cause)
              ? Effect.failCause(exit.cause)
              : (onInterrupt ?? Effect.die(error)),
          ),
        ),
      ),
      Effect.onInterrupt(() => stopShell(shell)),
    )

  const startShellInternal = (work: Effect.Effect<A, E>, ready?: Latch.Latch) =>
    Effect.uninterruptible(
      SynchronizedRef.modifyEffect(
        ref,
        Effect.fnUntraced(function* (cell) {
          if (cell.disposed) return [Effect.fail(new Cancelled()), cell] as const
          if (cell.state._tag !== "Idle") {
            const reject: Effect.Effect<A, E | Busy | Cancelled> = Effect.fail(new Busy())
            return [reject, cell] as const
          }
          const generation = yield* makeGeneration()
          const shell = yield* Effect.gen(function* () {
            yield* onBusy
            const id = next()
            const cancelled = yield* Deferred.make<void>()
            const done = yield* Deferred.make<A, E | Cancelled>()
            const fiber = yield* work.pipe(
              Effect.provideService(Scope.Scope, generation.scope),
              Effect.onExit((exit) => finishShell(generation, id, done, cancelled, exit)),
              Effect.forkIn(generation.scope),
            )
            return { id, generation, cancelled, done, ready, fiber } satisfies ShellHandle<A, E>
          }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? abortGeneration(generation, exit) : Effect.void)))
          const nextState: State<A, E> = { _tag: "Shell", generation, shell }
          return [waitShell(shell), { disposed: false, state: nextState }] as const
        }),
      ),
    ).pipe(Effect.flatten)

  const startShell = (work: Effect.Effect<A, E>, ready?: Latch.Latch): Effect.Effect<A, E | Busy> =>
    startShellInternal(work, ready).pipe(
      Effect.catchTag("RunnerCancelled", (error) => onInterrupt ?? Effect.die(error)),
    )

  const detach = (permanent: boolean) =>
    Effect.uninterruptible(
      SynchronizedRef.modifyEffect(
        ref,
        Effect.fnUntraced(function* (cell) {
          const generation = generationOf(cell.state)
          if (!generation) return [Effect.void, { disposed: permanent || cell.disposed, state: cell.state }] as const
          const owner = yield* claimGeneration(generation)
          return [
            cleanupDetached(cell.state, generation, owner),
            { disposed: permanent || cell.disposed, state: idleState() },
          ] as const
        }),
      ).pipe(Effect.flatten),
    )

  return {
    get state() {
      return state()
    },
    get busy() {
      return state()._tag !== "Idle"
    },
    ensureRunning,
    publish,
    startShell,
    cancel: detach(false),
    dispose: detach(true),
  }
}

export * as Runner from "./runner"
