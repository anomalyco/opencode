export * as FileMutation from "./file-mutation"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { KeyedMutex } from "./effect/keyed-mutex"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Bom } from "@opencode-ai/util/bom"
import { Formatter } from "./formatter"
import { WorkspaceEnvironment } from "./workspace/environment"

export interface Target {
  readonly canonical: string
  /** Lexical path for entry operations; remove unlinks the name, not the referent. */
  readonly absolute: string
  readonly resource: string
}

/** Seam-owned absence so tools never see backend error vocabularies. */
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("FileMutation.NotFoundError", {
  path: Schema.String,
}) {}

/** The target resolved to a directory where a file operation was required. */
export class NotAFileError extends Schema.TaggedErrorClass<NotAFileError>()("FileMutation.NotAFileError", {
  path: Schema.String,
}) {}

/** A move wrote its destination but failed to remove the source. */
export class MoveIncompleteError extends Schema.TaggedErrorClass<MoveIncompleteError>()(
  "FileMutation.MoveIncompleteError",
  {
    from: Schema.String,
    to: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface WriteInput {
  readonly target: Target
  readonly content: string
}

export interface MoveInput {
  readonly from: Target
  readonly to: Target
  /** Text for the destination; may differ from the source content. */
  readonly content: string
}

export interface WriteResult {
  readonly operation: "write"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
  /** Final text on disk after BOM handling and formatting. */
  readonly content: string
}

export interface Interface {
  /** Read a text file with the BOM stripped. BOM handling stays inside the seam. */
  readonly read: (target: Target) => Effect.Effect<string, NotFoundError | NotAFileError | FSUtil.Error>
  /**
   * Write logical text while retaining an existing UTF-8 BOM and emitting at
   * most one BOM. Runs configured formatters where the files live and reports
   * the final text.
   */
  readonly write: (input: WriteInput) => Effect.Effect<WriteResult, FSUtil.Error>
  /**
   * Write `content` to `to` with write semantics, then remove `from`. The
   * destination inherits the source's BOM when it has none of its own.
   */
  readonly move: (input: MoveInput) => Effect.Effect<WriteResult, MoveIncompleteError | FSUtil.Error>
  readonly remove: (target: Target) => Effect.Effect<void, NotFoundError | FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileMutation") {}

/** Normalize model-provided text to the BOM-free representation tools consume. */
export const normalizeText = (content: string) => Bom.split(content).text

/**
 * Backend primitives the shared seam orchestrates. Errors arrive already in
 * the seam vocabulary so tool-level messages stay uniform across backends.
 */
interface Backend {
  /** Full file bytes, or undefined when the path does not exist. */
  readonly readOptional: (path: string) => Effect.Effect<Uint8Array | undefined, FSUtil.Error>
  /** Classifies read failures; absence and errors report false. */
  readonly isDirectory: (path: string) => Effect.Effect<boolean>
  /** Creates parent directories, matching FSUtil.writeWithDirs. */
  readonly write: (path: string, content: Uint8Array) => Effect.Effect<void, FSUtil.Error>
  /** Unlink the lexical path; a symlink is removed, never its referent. */
  readonly remove: (path: string) => Effect.Effect<void, NotFoundError | FSUtil.Error>
  /** Format after write and report the final text, or undefined when no formatter applies. */
  readonly format?: (path: string, bom: boolean) => Effect.Effect<string | undefined, FSUtil.Error>
}

const encoder = new TextEncoder()

/**
 * Serialize file changes by canonical target. Conditional writes compare and
 * write under the same process-local lock so cooperating OpenCode mutations do
 * not overwrite changes made from the same stale content.
 */
const make = (backend: Backend): Interface => {
  const locks = KeyedMutex.makeUnsafe<string>()
  // Locks are acquired in sorted canonical order so multi-target operations
  // cannot deadlock.
  const withTargetLocks =
    (...targets: readonly Target[]) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      [...new Set(targets.map((target) => target.canonical))]
        .sort()
        .reduceRight((locked, key) => locks.withLock(key)(locked), Effect.uninterruptible(effect))

  // Happy-path reads are one operation; only the failure path checks whether
  // the target is a directory.
  const read = Effect.fn("FileMutation.read")((target: Target) =>
    Effect.gen(function* () {
      const content = yield* backend
        .readOptional(target.canonical)
        .pipe(
          Effect.catch((error) =>
            backend
              .isDirectory(target.canonical)
              .pipe(
                Effect.flatMap((directory) =>
                  Effect.fail(directory ? new NotAFileError({ path: target.canonical }) : error),
                ),
              ),
          ),
        )
      if (content === undefined) return yield* new NotFoundError({ path: target.canonical })
      return Bom.fromBytes(content).text
    }),
  )

  const writeText = (target: Target, content: string, inheritedBom: boolean) =>
    Effect.gen(function* () {
      const next = Bom.split(content)
      const current = yield* backend.readOptional(target.canonical)
      const bom = Boolean(current && Bom.has(current)) || inheritedBom || next.bom
      yield* backend.write(target.canonical, encoder.encode(Bom.join(next.text, bom)))
      // Formatters may rewrite the file, so the backend re-syncs the BOM and
      // reports the final text.
      const formatted = backend.format ? yield* backend.format(target.canonical, bom) : undefined
      return {
        operation: "write" as const,
        target: target.canonical,
        resource: target.resource,
        existed: current !== undefined,
        content: formatted ?? next.text,
      }
    })

  const write = Effect.fn("FileMutation.write")((input: WriteInput) =>
    withTargetLocks(input.target)(writeText(input.target, input.content, false)),
  )

  const move = Effect.fn("FileMutation.move")((input: MoveInput) =>
    withTargetLocks(
      input.from,
      input.to,
    )(
      Effect.gen(function* () {
        const source = yield* backend.readOptional(input.from.canonical)
        const result = yield* writeText(input.to, input.content, Boolean(source && Bom.has(source)))
        yield* backend
          .remove(input.from.absolute)
          .pipe(
            Effect.mapError(
              (cause) => new MoveIncompleteError({ from: input.from.canonical, to: input.to.canonical, cause }),
            ),
          )
        return result
      }),
    ),
  )

  const remove = Effect.fn("FileMutation.remove")((target: Target) =>
    withTargetLocks(target)(backend.remove(target.absolute)),
  )

  return Service.of({ read, write, move, remove })
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const formatter = yield* Formatter.Service
    return make({
      readOptional: (path) =>
        fs.readFile(path).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined))),
      isDirectory: (path) =>
        fs.stat(path).pipe(
          Effect.map((info) => info.type === "Directory"),
          Effect.catch(() => Effect.succeed(false)),
        ),
      write: (path, content) => fs.writeWithDirs(path, content),
      remove: (path) =>
        fs.remove(path).pipe(Effect.catchReason("PlatformError", "NotFound", () => new NotFoundError({ path }))),
      format: (path, bom) =>
        formatter
          .file(path)
          .pipe(Effect.flatMap((formatted) => (formatted ? Bom.syncFile(fs, path, bom) : Effect.succeed(undefined)))),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node, Formatter.node] })

// Same seam through WorkspaceEnvironment.Files. Absence stays typed; other
// environment failures surface as filesystem errors. No formatting: formatters
// are host binaries and cannot run against provider paths until an environment
// formatter runtime exists.
const hostedLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* WorkspaceEnvironment.Service
    return make({
      readOptional: (path) =>
        env.files.read(path).pipe(
          Effect.catchTag("WorkspaceEnvironment.NotFoundError", () => Effect.succeed(undefined)),
          Effect.mapError(WorkspaceEnvironment.toFileSystemError("read")),
        ),
      isDirectory: (path) =>
        env.files.stat(path).pipe(
          Effect.map((info) => info.type === "Directory"),
          Effect.catch(() => Effect.succeed(false)),
        ),
      write: (path, content) =>
        env.files.write(path, content).pipe(Effect.mapError(WorkspaceEnvironment.toFileSystemError("write"))),
      remove: (path) =>
        env.files
          .remove(path)
          .pipe(
            Effect.mapError((error) =>
              error._tag === "WorkspaceEnvironment.NotFoundError"
                ? new NotFoundError({ path })
                : WorkspaceEnvironment.toFileSystemError("remove")(error),
            ),
          ),
    })
  }),
)

export const hostedNode = makeLocationNode({
  service: Service,
  layer: hostedLayer,
  deps: [WorkspaceEnvironment.node],
})

/**
 * Deferred until the corresponding integrations exist.
 */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after snapshot design exists.
// TODO: Notify LSP and collect diagnostics after LSP runtime exists.
// TODO: Design multi-file transactions / rollback if patch needs atomic edits.
// Until then, edits are sequential and report partial application.
// TODO: Define crash recovery and idempotency for side effects between Tool.Called and durable settlement.
