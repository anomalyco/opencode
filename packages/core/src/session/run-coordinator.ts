export * as SessionRunCoordinator from "./run-coordinator"

import { Cause, Context, Deferred, Effect, FiberSet, Layer, Option, Scope } from "effect"
import { SessionRunner } from "./runner"
import { SessionSchema } from "./schema"

export type Mode = "run" | "wake"

export interface Coordinator<Key, A, E> {
  /** Starts or joins one explicit drain generation. */
  readonly run: (key: Key) => Effect.Effect<A, E>
  /** Coalesces one wake-up after durable work is recorded. */
  readonly wake: (key: Key) => Effect.Effect<void>
}

type Entry<A, E> = {
  readonly done: Deferred.Deferred<A, E>
  mode: Mode
  rerun?: Mode
}

const strongest = (left: Mode | undefined, right: Mode): Mode => left === "run" || right === "run" ? "run" : "wake"

/**
 * Coalesces process-local wakeups while keeping durable work in the caller's store.
 * Every map transition is synchronous: JavaScript execution linearizes the small
 * ownership handoff without a second synchronization primitive.
 */
export const make = <Key, A, E>(options: {
  readonly drain: (key: Key, mode: Mode) => Effect.Effect<A, E>
  readonly onFailure?: (key: Key, error: E) => Effect.Effect<void>
}): Effect.Effect<Coordinator<Key, A, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<A, E>>()
    const scope = yield* Effect.scope
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    yield* Effect.addFinalizer(() => Effect.sync(() => active.clear()))

    const start = (key: Key, entry: Entry<A, E>, mode: Mode) => {
      fork(own(key, entry, mode))
    }

    const own = (key: Key, entry: Entry<A, E>, mode: Mode): Effect.Effect<void> =>
      Effect.suspend(() => options.drain(key, mode)).pipe(
        Effect.exit,
        Effect.flatMap((exit) => {
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

          const successor = active.get(key) === entry && entry.rerun !== undefined
            ? { done: Deferred.makeUnsafe<A, E>(), mode: entry.rerun }
            : undefined
          if (successor === undefined) active.delete(key)
          else active.set(key, successor)
          const report = (() => {
            const error = Cause.findErrorOption(exit.cause)
            return mode === "wake" && Option.isSome(error) && options.onFailure !== undefined
              ? options.onFailure(key, error.value).pipe(Effect.forkIn(scope), Effect.asVoid)
              : Effect.void
          })()
          if (successor !== undefined) start(key, successor, successor.mode)
          return Deferred.done(entry.done, exit).pipe(
            Effect.tap(() => {
              return report
            }),
            Effect.asVoid,
          )
        }),
      )

    const wake = (key: Key) => Effect.sync(() => {
        const entry = active.get(key)
        if (entry !== undefined) {
          entry.rerun = strongest(entry.rerun, "wake")
          return
        }

        const next = { done: Deferred.makeUnsafe<A, E>(), mode: "wake" as const }
        active.set(key, next)
        start(key, next, "wake")
      })

    return { run, wake }

    function run(key: Key): Effect.Effect<A, E> {
      return Effect.uninterruptibleMask((restore) => {
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.mode !== "wake") return restore(Deferred.await(entry.done))
          entry.rerun = "run"
          return restore(Deferred.await(entry.done))
        }

        const next = { done: Deferred.makeUnsafe<A, E>(), mode: "run" as const }
        active.set(key, next)
        start(key, next, "run")
        return restore(Deferred.await(next.done))
      })
    }
  })

export interface Interface extends Coordinator<SessionSchema.ID, void, SessionRunner.RunError> {}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunCoordinator") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const runner = yield* SessionRunner.Service
    return Service.of(yield* make<SessionSchema.ID, void, SessionRunner.RunError>({
      drain: (sessionID, mode) => runner.run({ sessionID, force: mode === "run" }),
      onFailure: (sessionID, error) => Effect.logError("Failed to drain Session").pipe(
        Effect.annotateLogs("sessionID", sessionID),
        Effect.annotateLogs("error", error),
      ),
    }))
  }),
)
