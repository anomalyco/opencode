export * as FileMutation from "./file-mutation"

import { Context, Effect, Layer, Schema } from "effect"
import { dirname } from "path"
import { KeyedMutex } from "./effect/keyed-mutex"
import { FSUtil } from "./fs-util"
import { LocationMutation } from "./location-mutation"

export interface WriteInput {
  readonly plan: LocationMutation.Plan
  readonly content: string | Uint8Array
}

export interface TextWriteInput {
  readonly plan: LocationMutation.Plan
  readonly content: string
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

export interface WriteResult {
  readonly operation: "write"
  /** Canonical target actually passed to the filesystem mutation. */
  readonly target: string
  /** Permission resource captured during planning. */
  readonly resource: string
  readonly existed: boolean
}

export interface RemoveResult {
  readonly operation: "remove"
  /** Canonical target actually passed to the filesystem mutation. */
  readonly target: string
  /** Permission resource captured during planning. */
  readonly resource: string
  readonly existed: boolean
}

export interface Interface {
  /** Create only while the planned target remains absent. */
  readonly create: (
    input: WriteInput,
  ) => Effect.Effect<WriteResult, TargetExistsError | LocationMutation.RevalidationError | FSUtil.Error>
  /** Write after immediately revalidating the planned target. */
  readonly write: (input: WriteInput) => Effect.Effect<WriteResult, LocationMutation.RevalidationError | FSUtil.Error>
  /** Write text while retaining an existing UTF-8 BOM and emitting at most one BOM. */
  readonly writeTextPreservingBom: (
    input: TextWriteInput,
  ) => Effect.Effect<WriteResult, LocationMutation.RevalidationError | FSUtil.Error>
  /** Commit only if an existing target still has the expected bytes. */
  readonly writeIfUnchanged: (
    input: ConditionalWriteInput,
  ) => Effect.Effect<WriteResult, StaleContentError | LocationMutation.RevalidationError | FSUtil.Error>
  /** Remove after immediately revalidating the planned target. */
  readonly remove: (
    input: RemoveInput,
  ) => Effect.Effect<RemoveResult, LocationMutation.RevalidationError | FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileMutation") {}

/**
 * Commit planned file changes.
 *
 *   resolve(path) -> approve -> lock target -> revalidate(plan) -> mutate
 *
 * The caller approves the plan first. This service locks the canonical target,
 * revalidates the plan immediately before the filesystem operation, then mutates.
 *
 * `writeIfUnchanged` compares and writes while holding the same in-memory lock,
 * so cooperating calls in this process cannot overwrite from the same stale
 * content. Locks apply only within this service layer and only to identical
 * canonical targets.
 *
 * Revalidation reduces the race window but is not atomic with the next
 * path-based filesystem operation. A hostile local process can still race it.
 *
 * TODO: Use descriptor-relative no-follow operations where supported to close
 * the final race.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const mutation = yield* LocationMutation.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const withTargetLock =
      (target: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        locks.withLock(target)(Effect.uninterruptible(effect))

    const withValidatedTarget =
      (plan: LocationMutation.Plan) =>
      <A, E, R>(commit: (target: LocationMutation.Target) => Effect.Effect<A, E, R>) =>
        withTargetLock(plan.target.canonical)(mutation.revalidate(plan).pipe(Effect.flatMap(commit)))

    const writeResult = (target: LocationMutation.Target, existed = target.exists): WriteResult => ({
      operation: "write",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    const removeResult = (target: LocationMutation.Target): RemoveResult => ({
      operation: "remove",
      target: target.canonical,
      resource: target.resource,
      existed: target.exists,
    })

    const write = Effect.fn("FileMutation.write")((input: WriteInput) =>
      withValidatedTarget(input.plan)((target) =>
        Effect.gen(function* () {
          yield* fs.writeWithDirs(target.canonical, input.content)
          return writeResult(target)
        }),
      ),
    )

    const writeTextPreservingBom = Effect.fn("FileMutation.writeTextPreservingBom")((input: TextWriteInput) =>
      withValidatedTarget(input.plan)((target) =>
        Effect.gen(function* () {
          const next = splitBom(input.content)
          const preserveBom = target.exists && hasUtf8Bom(yield* fs.readFile(target.canonical))
          yield* fs.writeWithDirs(target.canonical, joinBom(next.text, preserveBom || next.bom))
          return writeResult(target)
        }),
      ),
    )

    const create = Effect.fn("FileMutation.create")((input: WriteInput) =>
      withValidatedTarget(input.plan)((target) =>
        Effect.gen(function* () {
          if (target.exists) return yield* new TargetExistsError({ path: target.canonical })
          yield* fs.ensureDir(dirname(target.canonical))
          if (typeof input.content === "string")
            yield* fs.writeFileString(target.canonical, input.content, { flag: "wx" })
          else yield* fs.writeFile(target.canonical, input.content, { flag: "wx" })
          return writeResult(target, false)
        }),
      ),
    )

    const writeIfUnchanged = Effect.fn("FileMutation.writeIfUnchanged")((input: ConditionalWriteInput) =>
      withValidatedTarget(input.plan)((target) =>
        Effect.gen(function* () {
          const current = yield* fs.readFile(target.canonical)
          if (!sameBytes(current, input.expected)) return yield* new StaleContentError({ path: target.canonical })
          yield* fs.writeWithDirs(target.canonical, input.content)
          return writeResult(target)
        }),
      ),
    )

    const remove = Effect.fn("FileMutation.remove")((input: RemoveInput) =>
      withValidatedTarget(input.plan)((target) =>
        Effect.gen(function* () {
          yield* fs.remove(target.canonical)
          return removeResult(target)
        }),
      ),
    )

    return Service.of({ create, write, writeTextPreservingBom, writeIfUnchanged, remove })
  }),
)

function splitBom(text: string) {
  const stripped = text.replace(/^\uFEFF+/, "")
  return { bom: stripped.length !== text.length, text: stripped }
}

function joinBom(text: string, bom: boolean) {
  const stripped = splitBom(text).text
  return bom ? `\uFEFF${stripped}` : stripped
}

function hasUtf8Bom(content: Uint8Array) {
  return content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  return left.every((byte, index) => byte === right[index])
}

export const locationLayer = layer

/**
 * Deferred until the corresponding V2 integrations exist.
 */
// TODO: Add formatter integration after V2 formatter runtime exists.
// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add snapshots / undo after V2 snapshot design exists.
// TODO: Notify LSP and collect diagnostics after V2 LSP runtime exists.
// TODO: Design multi-file transactions / rollback if apply_patch needs atomic edits.
// Until then, edits are sequential and report partial application.
// TODO: Define crash recovery and idempotency for side effects between Tool.Called and durable settlement.
