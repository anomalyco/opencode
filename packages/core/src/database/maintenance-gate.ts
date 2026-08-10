export * as DatabaseMaintenanceGate from "./maintenance-gate"

import { Context, Deferred, Effect, Schema, Semaphore } from "effect"

const MAX_MUTATIONS = 1_000_000
const mutations = Semaphore.makeUnsafe(MAX_MUTATIONS)
const maintenance = Semaphore.makeUnsafe(1)
const Lease = Context.Reference<boolean>("@opencode/DatabaseMaintenanceGate/Lease", {
  defaultValue: () => false,
})

export type Operation = "compact" | "vacuum"
export type Status =
  | { readonly phase: "idle"; readonly activeMutations: number }
  | {
      readonly phase: "draining" | "active"
      readonly operation: Operation
      readonly activeMutations: number
    }

export class ActiveError extends Schema.TaggedErrorClass<ActiveError>()("DatabaseMaintenanceActive", {
  operation: Schema.Literals(["compact", "vacuum"]),
}) {}

type Entry = {
  readonly operation: Operation
  readonly done: Deferred.Deferred<void>
  readonly onStatus?: (status: Status) => void
  phase: "draining" | "active"
}

let activeMutations = 0
let current: Entry | undefined

function notify(entry: Entry) {
  try {
    entry.onStatus?.(status())
  } catch {
    // Progress reporting must never prevent a lease or maintenance lock from being released.
  }
}

export function status(): Status {
  if (!current) return { phase: "idle", activeMutations }
  return { phase: current.phase, operation: current.operation, activeMutations }
}

export function mutation<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | ActiveError, R> {
  return runMutation(effect, false, false)
}

export function mutationOrElse<A, E, R, A2, E2, R2>(
  effect: Effect.Effect<A, E, R>,
  onActive: (error: ActiveError) => Effect.Effect<A2, E2, R2>,
): Effect.Effect<A | A2, E | E2, R | R2> {
  return mutation(effect).pipe(Effect.catchIf((error): error is ActiveError => error instanceof ActiveError, onActive))
}

export function waitForMutation<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return runMutation(effect, true, false)
}

export function waitForDetachedMutation<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return runMutation(effect, true, true)
}

export function exclusive<A, E, R>(
  operation: Operation,
  effect: Effect.Effect<A, E, R>,
  options: { readonly onStatus?: (status: Status) => void } = {},
): Effect.Effect<A, E, R> {
  return maintenance.withPermit(
    Effect.uninterruptibleMask((restore) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const entry: Entry = {
            operation,
            phase: "draining",
            done: Deferred.makeUnsafe<void>(),
            onStatus: options.onStatus,
          }
          current = entry
          notify(entry)
          return entry
        }),
        (entry) =>
          mutations.withPermits(MAX_MUTATIONS)(
            Effect.sync(() => {
              entry.phase = "active"
              notify(entry)
            }).pipe(Effect.andThen(restore(effect))),
          ),
        (entry) =>
          Effect.sync(() => {
            if (current === entry) current = undefined
            notify(entry)
          }).pipe(Effect.andThen(Deferred.succeed(entry.done, undefined)), Effect.ignore),
      ),
    ),
  )
}

function runMutation<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  wait: false,
  detached: boolean,
): Effect.Effect<A, E | ActiveError, R>
function runMutation<A, E, R>(effect: Effect.Effect<A, E, R>, wait: true, detached: boolean): Effect.Effect<A, E, R>
function runMutation<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  wait: boolean,
  detached: boolean,
): Effect.Effect<A, E | ActiveError, R> {
  return Effect.gen(function* () {
    if (!detached && (yield* Lease)) return yield* effect
    return yield* acquireMutation(effect, wait)
  })
}

function acquireMutation<A, E, R>(effect: Effect.Effect<A, E, R>, wait: boolean): Effect.Effect<A, E | ActiveError, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const blocked = current
      if (blocked) {
        if (!wait) return yield* new ActiveError({ operation: blocked.operation })
        yield* restore(Deferred.await(blocked.done))
        return yield* acquireMutation(effect, wait)
      }

      yield* restore(mutations.take(1))
      const raced = current
      if (raced) {
        yield* mutations.release(1)
        if (!wait) return yield* new ActiveError({ operation: raced.operation })
        yield* restore(Deferred.await(raced.done))
        return yield* acquireMutation(effect, wait)
      }

      activeMutations += 1
      return yield* restore(effect.pipe(Effect.provideService(Lease, true))).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            activeMutations -= 1
            if (current) notify(current)
          }).pipe(Effect.andThen(mutations.release(1)), Effect.asVoid),
        ),
      )
    }),
  )
}
