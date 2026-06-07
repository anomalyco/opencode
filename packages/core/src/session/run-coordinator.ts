export * as SessionRunCoordinator from "./run-coordinator"

import { Cause, Context, Deferred, Effect, Exit, Fiber, FiberSet, Layer, Scope } from "effect"
import { SessionRunner } from "./runner"
import { logFailure } from "./logging"
import { SessionSchema } from "./schema"

export type Mode = "run" | "wake"

/** Why one drain generation should run. Explicit runs dominate advisory wakes when demands coalesce. */
type Demand = { readonly _tag: "run" } | { readonly _tag: "wake"; readonly seq?: number }

/**
 * Runs at most one drain chain per key while allowing different keys to drain concurrently.
 *
 * For each key:
 *
 *   idle --run/wake--> draining --run/wake--> draining + one coalesced rerun --> idle
 *
 * `run` is an explicit drain request. It starts a chain or joins the current chain and
 * upgrades a pending follow-up so the caller receives explicit-run semantics.
 *
 * `wake` reports that durable work may now be available. It starts a chain while idle or
 * requests one coalesced follow-up while draining. Repeated wakes collapse together.
 *
 * `interrupt` stops the current ownership chain. Advisory wakes from before the interrupt
 * boundary are suppressed; advisory wakes after the boundary run after cleanup.
 */
export interface Coordinator<Key, A, E> {
  /** Starts or joins one explicit drain generation. */
  readonly run: (key: Key) => Effect.Effect<A, E>
  /** Coalesces one wake-up after durable work is recorded. */
  readonly wake: (key: Key, seq?: number) => Effect.Effect<void>
  /** Waits until the current ownership chain settles. */
  readonly awaitIdle: (key: Key) => Effect.Effect<void, E>
  /** Interrupts the active ownership chain without automatically draining pending wakes. */
  readonly interrupt: (key: Key, seq?: number) => Effect.Effect<void>
}

/** One Session's process-local execution lane: one active demand and at most one coalesced follow-up. */
type Entry<A, E> = {
  readonly done: Deferred.Deferred<A, E>
  readonly settled: Deferred.Deferred<Exit.Exit<A, E>>
  current: Demand
  pending?: Demand
  explicitWaiter?: Deferred.Deferred<A, E>
  interruptSeq?: number
  owner?: Fiber.Fiber<void, never>
  stopping: boolean
}

/** Combines follow-up demand: runs dominate, while wakes retain the newest durable admission sequence. */
const coalesce = (left: Demand | undefined, right: Demand): Demand => {
  if (left?._tag === "run" || right._tag === "run") return { _tag: "run" }
  return { _tag: "wake", seq: maxSeq(left?.seq, right.seq) }
}

const maxSeq = (left: number | undefined, right: number | undefined) => {
  if (left === undefined) return right
  if (right === undefined) return left
  return Math.max(left, right)
}

/** Constructs a scoped coordinator. Every in-memory transition is synchronous. */
export const make = <Key, A, E>(options: {
  readonly drain: (key: Key, mode: Mode) => Effect.Effect<A, E>
  readonly onFailure?: (key: Key, cause: Cause.Cause<E>) => Effect.Effect<void>
}): Effect.Effect<Coordinator<Key, A, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<A, E>>()
    const interruptSeq = new Map<Key, number>()
    const report = yield* FiberSet.makeRuntime<never, void, never>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    const shutdown = Deferred.makeUnsafe<void>()
    let closed = false
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true
        Deferred.doneUnsafe(shutdown, Effect.void)
        active.clear()
        interruptSeq.clear()
      }),
    )

    const makeEntry = (current: Demand, explicitWaiter?: Deferred.Deferred<A, E>): Entry<A, E> => ({
      done: Deferred.makeUnsafe<A, E>(),
      settled: Deferred.makeUnsafe<Exit.Exit<A, E>>(),
      current,
      explicitWaiter,
      stopping: false,
    })

    const start = (key: Key, entry: Entry<A, E>, demand: Demand, successor = false) => {
      const ready = Deferred.makeUnsafe<void>()
      const drain = Effect.suspend(() => options.drain(key, demand._tag))
      // Initial work retains immediate-start behavior but cannot run before ownership is published.
      // Observer-started successors yield once so synchronous drains cannot recurse on the JS stack.
      const owner = fork(
        (successor
          ? Effect.yieldNow.pipe(Effect.andThen(drain))
          : Deferred.await(ready).pipe(Effect.andThen(drain))
        ).pipe(
          Effect.onExit((exit) => Effect.sync(() => settle(key, entry, demand, exit))),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      entry.owner = owner
      if (!successor) Deferred.doneUnsafe(ready, Effect.void)
    }

    const settle = (key: Key, entry: Entry<A, E>, demand: Demand, exit: Exit.Exit<A, E>) => {
      if (closed) {
        Deferred.doneUnsafe(entry.done, exit)
        Deferred.doneUnsafe(entry.settled, Effect.succeed(exit))
        return
      }
      if (demand._tag === "run" && entry.explicitWaiter !== undefined) {
        Deferred.doneUnsafe(entry.explicitWaiter, exit)
        entry.explicitWaiter = undefined
      }
      if (entry.stopping && demand._tag === "wake" && entry.explicitWaiter !== undefined) {
        Deferred.doneUnsafe(entry.explicitWaiter, exit)
        entry.explicitWaiter = undefined
      }
      if (active.get(key) !== entry) {
        Deferred.doneUnsafe(entry.done, exit)
        Deferred.doneUnsafe(entry.settled, Effect.succeed(exit))
        return
      }
      if (exit._tag === "Success" && !entry.stopping) {
        if (entry.pending !== undefined) {
          const pending = entry.pending
          entry.pending = undefined
          entry.current = pending
          start(key, entry, pending, true)
          return
        }
        active.delete(key)
        Deferred.doneUnsafe(entry.done, exit)
        Deferred.doneUnsafe(entry.settled, Effect.succeed(exit))
        return
      }

      const successor = entry.pending !== undefined ? makeEntry(entry.pending, entry.explicitWaiter) : undefined
      if (successor === undefined) active.delete(key)
      else active.set(key, successor)
      if (successor !== undefined) start(key, successor, successor.current, true)
      Deferred.doneUnsafe(entry.done, exit)
      Deferred.doneUnsafe(entry.settled, Effect.succeed(exit))
      if (
        exit._tag === "Failure" &&
        !(entry.stopping && Cause.hasInterruptsOnly(exit.cause)) &&
        demand._tag === "wake" &&
        options.onFailure !== undefined
      ) {
        report(Effect.suspend(() => options.onFailure!(key, exit.cause)))
      }
    }

    const wake = (key: Key, seq?: number) =>
      Effect.sync(() => {
        if (closed) return
        if (!isAfterInterrupt(key, seq)) return
        const entry = active.get(key)
        if (entry !== undefined) {
          if (!acceptsWake(entry, seq)) return
          entry.pending = coalesce(entry.pending, { _tag: "wake", seq })
          return
        }

        const next = makeEntry({ _tag: "wake", seq })
        active.set(key, next)
        start(key, next, next.current)
      })

    const awaitIdle = (key: Key): Effect.Effect<void, E> =>
      Effect.gen(function* () {
        let firstFailure: Cause.Cause<E> | undefined
        while (!closed) {
          const entry = active.get(key)
          if (entry === undefined) break
          const exit = yield* Effect.raceFirst(
            Deferred.await(entry.settled),
            Deferred.await(shutdown).pipe(Effect.as(Exit.void)),
          )
          if (closed) break
          if (exit._tag === "Failure" && firstFailure === undefined) firstFailure = exit.cause
        }
        if (firstFailure !== undefined) return yield* Effect.failCause(firstFailure)
      })

    const interrupt = (key: Key, seq?: number): Effect.Effect<void> =>
      Effect.suspend(() => {
        const entry = active.get(key)
        const latest = interruptSeq.get(key)
        if (seq !== undefined && latest !== undefined && seq <= latest)
          return entry?.stopping && entry.owner !== undefined ? Fiber.interrupt(entry.owner) : Effect.void
        if (seq !== undefined) interruptSeq.set(key, seq)
        if (entry?.owner === undefined) return Effect.void
        if (
          seq !== undefined &&
          entry.current._tag === "wake" &&
          entry.current.seq !== undefined &&
          entry.current.seq > seq
        )
          return Effect.void
        if (entry.stopping) {
          entry.interruptSeq = maxSeq(entry.interruptSeq, seq)
          suppressPendingAtOrBefore(entry, seq)
          return Fiber.interrupt(entry.owner)
        }
        entry.stopping = true
        entry.interruptSeq = seq
        suppressPendingAtOrBefore(entry, seq)
        return Fiber.interrupt(entry.owner)
      })

    return { run, wake, awaitIdle, interrupt }

    function run(key: Key): Effect.Effect<A, E> {
      return Effect.uninterruptibleMask((restore) => {
        if (closed) return Effect.interrupt
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.stopping) {
            return restore(Deferred.await(entry.settled).pipe(Effect.andThen(run(key))))
          }
          if (entry.current._tag === "wake") {
            entry.pending = coalesce(entry.pending, { _tag: "run" })
            entry.explicitWaiter ??= Deferred.makeUnsafe<A, E>()
            return restore(awaitRun(entry.explicitWaiter))
          }
          return restore(awaitRun(entry.done))
        }

        const next = makeEntry({ _tag: "run" })
        active.set(key, next)
        start(key, next, next.current)
        return restore(awaitRun(next.done))
      })
    }

    function awaitRun(done: Deferred.Deferred<A, E>): Effect.Effect<A, E> {
      return Effect.raceFirst(Deferred.await(done), Deferred.await(shutdown).pipe(Effect.andThen(Effect.interrupt)))
    }

    function acceptsWake(entry: Entry<A, E>, seq: number | undefined) {
      return !entry.stopping || (entry.interruptSeq !== undefined && seq !== undefined && seq > entry.interruptSeq)
    }

    function isAfterInterrupt(key: Key, seq: number | undefined) {
      const latest = interruptSeq.get(key)
      return latest === undefined || (seq !== undefined && seq > latest)
    }

    function suppressPendingAtOrBefore(entry: Entry<A, E>, seq: number | undefined) {
      if (
        entry.pending?._tag === "wake" &&
        seq !== undefined &&
        entry.pending.seq !== undefined &&
        entry.pending.seq > seq
      )
        return
      entry.pending = undefined
    }
  })

export interface Interface extends Coordinator<SessionSchema.ID, void, SessionRunner.RunError> {}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunCoordinator") {}

export const layer = Layer.effect(
  Service,
  SessionRunner.Service.pipe(
    Effect.flatMap((runner) =>
      make<SessionSchema.ID, void, SessionRunner.RunError>({
        drain: (sessionID, mode) => runner.run({ sessionID, force: mode === "run" }),
        onFailure: (sessionID, cause) => logFailure("Failed to drain Session", sessionID, cause),
      }),
    ),
    Effect.map(Service.of),
  ),
)
