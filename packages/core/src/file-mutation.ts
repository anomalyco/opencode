export * as FileMutation from "./file-mutation"

import { Context, Effect, Layer, Semaphore } from "effect"
import { FSUtil } from "./fs-util"
import { LocationMutation } from "./location-mutation"

export interface WriteInput {
  readonly plan: LocationMutation.Plan
  readonly content: string | Uint8Array
}

export interface RemoveInput {
  readonly plan: LocationMutation.Plan
}

export interface WriteReceipt {
  readonly operation: "write"
  /** Canonical target actually passed to the filesystem mutation. */
  readonly target: string
  /** Stable permission/output resource captured by LocationMutation planning. */
  readonly resource: string
  readonly existed: boolean
}

export interface RemoveReceipt {
  readonly operation: "remove"
  /** Canonical target actually passed to the filesystem mutation. */
  readonly target: string
  /** Stable permission/output resource captured by LocationMutation planning. */
  readonly resource: string
  readonly existed: boolean
}

export interface Interface {
  /** Commit one planned write after immediately re-proving its mutation authority. */
  readonly write: (input: WriteInput) => Effect.Effect<WriteReceipt, LocationMutation.RevalidationError | FSUtil.Error>
  /** Commit one planned removal after immediately re-proving its mutation authority. */
  readonly remove: (input: RemoveInput) => Effect.Effect<RemoveReceipt, LocationMutation.RevalidationError | FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileMutation") {}

/**
 * Narrow V2 commit mechanics after LocationMutation authority planning.
 *
 * This boundary deliberately does not ask for permission. Future leaf tools own
 * the policy sequence: resolve a plan, approve external_directory when present,
 * approve edit, then call write/remove. Each commit locks its canonical target
 * and revalidates inside that lock immediately before filesystem mechanics. The
 * revalidation narrows the TOCTOU window; path-based filesystem APIs cannot make
 * the proof and final syscall atomic.
 *
 * Locks are process-local and scoped to this service layer. They serialize only
 * identical canonical targets, so unrelated files remain independent.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const mutation = yield* LocationMutation.Service
    const locks = new Map<string, { readonly semaphore: Semaphore.Semaphore; users: number }>()

    const withTargetLock = (target: string) => {
      const current = locks.get(target)
      const entry = current ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
      if (!current) locks.set(target, entry)
      entry.users++
      return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        entry.semaphore.withPermit(effect).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              entry.users--
              if (entry.users === 0) locks.delete(target)
            }),
          ),
        )
    }

    const write = Effect.fn("FileMutation.write")((input: WriteInput) =>
      withTargetLock(input.plan.target.canonical)(
        Effect.gen(function* () {
          const target = yield* mutation.revalidate(input.plan)
          yield* fs.writeWithDirs(target.canonical, input.content)
          return {
            operation: "write",
            target: target.canonical,
            resource: target.resource,
            existed: target.exists,
          } satisfies WriteReceipt
        }),
      ),
    )

    const remove = Effect.fn("FileMutation.remove")((input: RemoveInput) =>
      withTargetLock(input.plan.target.canonical)(
        Effect.gen(function* () {
          const target = yield* mutation.revalidate(input.plan)
          yield* fs.remove(target.canonical)
          return {
            operation: "remove",
            target: target.canonical,
            resource: target.resource,
            existed: target.exists,
          } satisfies RemoveReceipt
        }),
      ),
    )

    return Service.of({ write, remove })
  }),
)

export const locationLayer = layer

/**
 * Deliberately deferred mutation integrations. Keep this service a small commit
 * substrate until the corresponding V2 runtimes and contracts exist.
 */
// TODO: Add formatter integration after V2 formatter runtime exists.
// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add snapshots / undo after V2 snapshot design exists.
// TODO: Notify LSP and collect diagnostics after V2 LSP runtime exists.
// TODO: Add multi-file transaction / rollback design before apply_patch relies on batches.
// TODO: Revisit crash recovery and idempotency for side effects after Tool.Called but before durable settlement.
