export * as SessionRunCoordinator from "./run-coordinator"

import { Cause, Context, Deferred, Effect, Exit, Fiber, FiberSet, Layer, Scope } from "effect"
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
 *
 * `interrupt` stops the current ownership chain. Wakes and explicit runs arriving after the
 * interruption request become a fresh successor; previously queued reruns are suppressed.
 */
export interface Coordinator<Key, A, E> {
  /** Starts or joins one explicit drain generation. */
  readonly run: (key: Key) => Effect.Effect<A, E>
  /** Coalesces one wake-up after durable work is recorded. */
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Waits until the current ownership chain settles. */
  readonly awaitIdle: (key: Key) => Effect.Effect<void, E>
  /** Interrupts the active ownership chain. Later requests may start a fresh successor. */
  readonly interrupt: (key: Key) => Effect.Effect<void>
}

type Entry<A, E> = {
  readonly done: Deferred.Deferred<A, E>
  readonly settled: Deferred.Deferred<Exit.Exit<A, E>>
  mode: Mode
  rerun?: Mode
  explicit?: Deferred.Deferred<A, E>
  successorExplicit?: Deferred.Deferred<A, E>
  owner?: Fiber.Fiber<void, never>
  stopping: boolean
}

const strongest = (left: Mode | undefined, right: Mode): Mode => (left === "run" || right === "run" ? "run" : "wake")

/** Constructs a scoped coordinator. Every in-memory transition is synchronous. */
export const make = <Key, A, E>(options: {
  readonly drain: (key: Key, mode: Mode) => Effect.Effect<A, E>
  readonly onFailure?: (key: Key, cause: Cause.Cause<E>) => Effect.Effect<void>
}): Effect.Effect<Coordinator<Key, A, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<A, E>>()
    const report = yield* FiberSet.makeRuntime<never, void, never>()
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
      settled: Deferred.makeUnsafe<Exit.Exit<A, E>>(),
      mode,
      explicit,
      stopping: false,
    })

    const start = (key: Key, entry: Entry<A, E>, mode: Mode, successor = false) => {
      const ready = Deferred.makeUnsafe<void>()
      const drain = Effect.suspend(() => options.drain(key, mode))
      // Initial work retains immediate-start behavior but cannot run before ownership is published.
      // Observer-started successors yield once so synchronous drains cannot recurse on the JS stack.
      const owner = fork(
        (successor ? Effect.yieldNow.pipe(Effect.andThen(drain)) : Deferred.await(ready).pipe(Effect.andThen(drain))).pipe(
          Effect.onExit((exit) => Effect.sync(() => settle(key, entry, mode, exit))),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      entry.owner = owner
      if (!successor) Deferred.doneUnsafe(ready, Effect.void)
    }

    const settle = (key: Key, entry: Entry<A, E>, mode: Mode, exit: Exit.Exit<A, E>) => {
      if (closed) {
        Deferred.doneUnsafe(entry.done, exit)
        Deferred.doneUnsafe(entry.settled, Effect.succeed(exit))
        return
      }
      if (mode === "run" && entry.explicit !== undefined) {
        Deferred.doneUnsafe(entry.explicit, exit)
        entry.explicit = undefined
      }
      if (entry.stopping && mode === "wake" && entry.explicit !== undefined) {
        Deferred.doneUnsafe(entry.explicit, exit)
        entry.explicit = undefined
      }
      if (active.get(key) !== entry) {
        Deferred.doneUnsafe(entry.done, exit)
        Deferred.doneUnsafe(entry.settled, Effect.succeed(exit))
        return
      }
      if (exit._tag === "Success" && !entry.stopping) {
        if (entry.rerun !== undefined) {
          const mode = entry.rerun
          entry.rerun = undefined
          entry.mode = mode
          start(key, entry, mode, true)
          return
        }
        active.delete(key)
        Deferred.doneUnsafe(entry.done, exit)
        Deferred.doneUnsafe(entry.settled, Effect.succeed(exit))
        return
      }

      const successorExplicit = entry.successorExplicit ?? (mode === "wake" ? entry.explicit : undefined)
      const successor = entry.rerun !== undefined ? makeEntry(entry.rerun, successorExplicit) : undefined
      if (successor === undefined) active.delete(key)
      else active.set(key, successor)
      if (successor !== undefined) start(key, successor, successor.mode, true)
      Deferred.doneUnsafe(entry.done, exit)
      Deferred.doneUnsafe(entry.settled, Effect.succeed(exit))
      if (
        exit._tag === "Failure" &&
        !(entry.stopping && Cause.hasInterruptsOnly(exit.cause)) &&
        mode === "wake" &&
        options.onFailure !== undefined
      ) {
        report(Effect.suspend(() => options.onFailure!(key, exit.cause)))
      }
    }

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
            Deferred.await(entry.settled),
            Deferred.await(shutdown).pipe(Effect.as(Exit.void)),
          )
          if (closed) break
          if (exit._tag === "Failure" && firstFailure === undefined) firstFailure = exit.cause
        }
        if (firstFailure !== undefined) return yield* Effect.failCause(firstFailure)
      })

    const interrupt = (key: Key): Effect.Effect<void> =>
      Effect.suspend(() => {
        const entry = active.get(key)
        if (entry?.owner === undefined) return Effect.void
        if (!entry.stopping) {
          entry.stopping = true
          entry.rerun = undefined
        }
        return Fiber.interrupt(entry.owner)
      })

    return { run, wake, awaitIdle, interrupt }

    function run(key: Key): Effect.Effect<A, E> {
      return Effect.uninterruptibleMask((restore) => {
        if (closed) return Effect.interrupt
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.stopping) {
            entry.rerun = strongest(entry.rerun, "run")
            entry.successorExplicit ??=
              entry.mode === "wake" ? (entry.explicit ?? Deferred.makeUnsafe<A, E>()) : Deferred.makeUnsafe<A, E>()
            return restore(awaitRun(entry.successorExplicit))
          }
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
  SessionRunner.Service.pipe(
    Effect.flatMap((runner) =>
      make<SessionSchema.ID, void, SessionRunner.RunError>({
        drain: (sessionID, mode) => runner.run({ sessionID, force: mode === "run" }),
        onFailure: (sessionID, cause) =>
          Effect.logError("Failed to drain Session").pipe(
            Effect.annotateLogs("sessionID", sessionID),
            Effect.annotateLogs("cause", cause),
          ),
      }),
    ),
    Effect.map(Service.of),
  ),
)
