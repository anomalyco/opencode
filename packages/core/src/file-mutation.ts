export * as FileMutation from "./file-mutation"

import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { dirname } from "path"
import { FSUtil } from "./fs-util"
import { LocationMutation } from "./location-mutation"

export interface WriteInput {
  readonly plan: LocationMutation.Plan
  readonly content: string | Uint8Array
}

export interface ConditionalWriteInput extends WriteInput {
  readonly expected: Uint8Array
}

export interface RemoveInput {
  readonly plan: LocationMutation.Plan
}

export class StaleContentError extends Schema.TaggedErrorClass<StaleContentError>()("FileMutation.StaleContentError", {
  path: Schema.String,
}) {}

export class TargetExistsError extends Schema.TaggedErrorClass<TargetExistsError>()("FileMutation.TargetExistsError", {
  path: Schema.String,
}) {}

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
  /** Commit one planned create only while the target remains absent. */
  readonly create: (input: WriteInput) => Effect.Effect<WriteReceipt, TargetExistsError | LocationMutation.RevalidationError | FSUtil.Error>
  /** Commit one planned write after immediately re-proving its mutation authority. */
  readonly write: (input: WriteInput) => Effect.Effect<WriteReceipt, LocationMutation.RevalidationError | FSUtil.Error>
  /** Commit only if an existing target still has the expected bytes. */
  readonly writeIfUnchanged: (
    input: ConditionalWriteInput,
  ) => Effect.Effect<WriteReceipt, StaleContentError | LocationMutation.RevalidationError | FSUtil.Error>
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
 * and revalidates inside that lock immediately before filesystem mechanics.
 * Conditional writes additionally compare and write under that same lock so
 * cooperating process-local edits cannot both stale-pass and clobber. The
 * revalidation narrows the TOCTOU window; path-based filesystem APIs cannot make
 * the proof and final syscall atomic.
 *
 * TODO: Replace path-based commit mechanics with descriptor-relative no-follow
 * operations where supported. Current revalidation detects swaps before the
 * syscall but cannot contain a hostile local process racing the final pathname.
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
        entry.semaphore.withPermit(Effect.uninterruptible(effect)).pipe(
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

    const create = Effect.fn("FileMutation.create")((input: WriteInput) =>
      withTargetLock(input.plan.target.canonical)(
        Effect.gen(function* () {
          const target = yield* mutation.revalidate(input.plan)
          if (target.exists) return yield* new TargetExistsError({ path: target.canonical })
          yield* fs.makeDirectory(dirname(target.canonical), { recursive: true })
          if (typeof input.content === "string") yield* fs.writeFileString(target.canonical, input.content, { flag: "wx" })
          else yield* fs.writeFile(target.canonical, input.content, { flag: "wx" })
          return {
            operation: "write",
            target: target.canonical,
            resource: target.resource,
            existed: false,
          } satisfies WriteReceipt
        }),
      ),
    )

    const writeIfUnchanged = Effect.fn("FileMutation.writeIfUnchanged")((input: ConditionalWriteInput) =>
      withTargetLock(input.plan.target.canonical)(
        Effect.gen(function* () {
          const target = yield* mutation.revalidate(input.plan)
          const current = yield* fs.readFile(target.canonical)
          if (!sameBytes(current, input.expected)) return yield* new StaleContentError({ path: target.canonical })
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

    return Service.of({ create, write, writeIfUnchanged, remove })
  }),
)

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  return left.every((byte, index) => byte === right[index])
}

export const locationLayer = layer

/**
 * Deliberately deferred mutation integrations. Keep this service a small commit
 * substrate until the corresponding V2 runtimes and contracts exist.
 */
// TODO: Add formatter integration after V2 formatter runtime exists.
// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add snapshots / undo after V2 snapshot design exists.
// TODO: Notify LSP and collect diagnostics after V2 LSP runtime exists.
// TODO: Add multi-file transaction / rollback design if apply_patch needs an atomic mode. The first V2 leaf is intentionally sequential and reports partial application explicitly.
// TODO: Revisit crash recovery and idempotency for side effects after Tool.Called but before durable settlement.
