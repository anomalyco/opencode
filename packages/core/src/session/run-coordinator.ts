export * as SessionRunCoordinator from "./run-coordinator"

import { Cause, Context, Deferred, Effect, Exit, FiberSet, Layer, Scope } from "effect"
import { SessionRunner } from "./runner"
import { SessionSchema } from "./schema"

export type Mode = "run" | "wake"

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
 */
export interface Coordinator<Key, A, E> {
  /** Starts or joins one explicit drain generation. */
  readonly run: (key: Key) => Effect.Effect<A, E>
  /** Coalesces one wake-up after durable work is recorded. */
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Waits until the current ownership chain settles. */
  readonly awaitIdle: (key: Key) => Effect.Effect<void, E>
}

type Entry<A, E> = {
  readonly done: Deferred.Deferred<A, E>
  mode: Mode
  rerun?: Mode
  explicit?: Deferred.Deferred<A, E>
}

const strongest = (left: Mode | undefined, right: Mode): Mode => (left === "run" || right === "run" ? "run" : "wake")

/** Constructs a scoped coordinator. Every in-memory transition is synchronous. */
export const make = <Key, A, E>(options: {
  readonly drain: (key: Key, mode: Mode) => Effect.Effect<A, E>
  readonly onFailure?: (key: Key, cause: Cause.Cause<E>) => Effect.Effect<void>
}): Effect.Effect<Coordinator<Key, A, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<A, E>>()
    const scope = yield* Effect.scope
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    const shutdown = Deferred.makeUnsafe<void>()
    let closed = false
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true
        Deferred.doneUnsafe(shutdown, Effect.void)
        active.clear()
      }),
    )

    const makeEntry = (mode: Mode, explicit?: Deferred.Deferred<A, E>): Entry<A, E> => ({
      done: Deferred.makeUnsafe<A, E>(),
      mode,
      explicit,
    })

    const start = (key: Key, entry: Entry<A, E>, mode: Mode) => {
      fork(own(key, entry, mode))
    }

    const own = (key: Key, entry: Entry<A, E>, mode: Mode): Effect.Effect<void> =>
      Effect.suspend(() => options.drain(key, mode)).pipe(
        Effect.exit,
        Effect.flatMap((exit) => {
          if (closed) return Deferred.done(entry.done, exit).pipe(Effect.asVoid)
          if (mode === "run" && entry.explicit !== undefined) {
            Deferred.doneUnsafe(entry.explicit, exit)
            entry.explicit = undefined
          }
          if (exit._tag === "Success") {
            if (active.get(key) !== entry) return Deferred.done(entry.done, exit).pipe(Effect.asVoid)
            if (entry.rerun !== undefined) {
              const mode = entry.rerun
              entry.rerun = undefined
              entry.mode = mode
              return own(key, entry, mode)
            }
            active.delete(key)
            return Deferred.done(entry.done, exit).pipe(Effect.asVoid)
          }

          const successor =
            active.get(key) === entry && entry.rerun !== undefined ? makeEntry(entry.rerun, entry.explicit) : undefined
          if (successor === undefined) active.delete(key)
          else {
            active.set(key, successor)
          }
          if (successor !== undefined) start(key, successor, successor.mode)
          const report =
            mode === "wake" && options.onFailure !== undefined
              ? options.onFailure(key, exit.cause).pipe(Effect.forkIn(scope), Effect.asVoid)
              : Effect.void
          return Deferred.done(entry.done, exit).pipe(Effect.andThen(report), Effect.asVoid)
        }),
      )

    const wake = (key: Key) =>
      Effect.sync(() => {
        if (closed) return
        const entry = active.get(key)
        if (entry !== undefined) {
          entry.rerun = strongest(entry.rerun, "wake")
          return
        }

        const next = makeEntry("wake")
        active.set(key, next)
        start(key, next, "wake")
      })

    const awaitIdle = (key: Key): Effect.Effect<void, E> =>
      Effect.gen(function* () {
        let firstFailure: Cause.Cause<E> | undefined
        while (!closed) {
          const entry = active.get(key)
          if (entry === undefined) break
          const exit = yield* Effect.raceFirst(
            Deferred.await(entry.done).pipe(Effect.exit),
            Deferred.await(shutdown).pipe(Effect.as(Exit.void)),
          )
          if (closed) break
          if (exit._tag === "Failure" && firstFailure === undefined) firstFailure = exit.cause
        }
        if (firstFailure !== undefined) return yield* Effect.failCause(firstFailure)
      })

    return { run, wake, awaitIdle }

    function run(key: Key): Effect.Effect<A, E> {
      return Effect.uninterruptibleMask((restore) => {
        if (closed) return Effect.interrupt
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.mode === "wake") {
            entry.rerun = "run"
            entry.explicit ??= Deferred.makeUnsafe<A, E>()
            return restore(awaitRun(entry.explicit))
          }
          return restore(awaitRun(entry.done))
        }

        const next = makeEntry("run")
        active.set(key, next)
        start(key, next, "run")
        return restore(awaitRun(next.done))
      })
    }

    function awaitRun(done: Deferred.Deferred<A, E>): Effect.Effect<A, E> {
      return Effect.raceFirst(Deferred.await(done), Deferred.await(shutdown).pipe(Effect.andThen(Effect.interrupt)))
    }
  })

export interface Interface extends Coordinator<SessionSchema.ID, void, SessionRunner.RunError> {}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunCoordinator") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const runner = yield* SessionRunner.Service
    return Service.of(
      yield* make<SessionSchema.ID, void, SessionRunner.RunError>({
        drain: (sessionID, mode) => runner.run({ sessionID, force: mode === "run" }),
        onFailure: (sessionID, cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError("Failed to drain Session").pipe(
                Effect.annotateLogs("sessionID", sessionID),
                Effect.annotateLogs("cause", cause),
              ),
      }),
    )
  }),
)
