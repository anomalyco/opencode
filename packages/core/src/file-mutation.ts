export * as FileMutation from "./file-mutation.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { FSUtil } from "@opencode/util/fs-util"
import { Encoding } from "./encoding.js"
import { Environment } from "./environment/index.js"
import type { Files } from "./environment/index.js"
import type { FileAccess } from "./file-access.js"

export type Target = Pick<FileAccess.Target, "absolute" | "resource">

export interface WriteInput {
  readonly target: Target
  readonly content: string | Uint8Array
  /** Encoding for string content; defaults to UTF-8 without BOM. */
  readonly source?: Encoding.Source
}

export interface TextWriteInput {
  readonly target: Target
  readonly content: string
}

export interface WriteResult {
  readonly operation: "write"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface Interface {
  /** Serialize a complete read/prepare/write mutation transaction by resolved path. */
  readonly withLock: (
    targets: ReadonlyArray<string>,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly write: (
    input: WriteInput,
  ) => Effect.Effect<WriteResult, Environment.Failed | Encoding.UnrepresentableError>
  /** Write text in the given source encoding, stripping any leading BOM from the content and emitting at most one. */
  readonly writeText: (
    input: TextWriteInput & { readonly source: Encoding.Source },
  ) => Effect.Effect<WriteResult, Environment.Failed | Encoding.UnrepresentableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileMutation") {}

export const readText = Effect.fn("FileMutation.readText")(function* (files: Files, target: string) {
  const bytes = (yield* files.read(target)).bytes
  const detected = yield* Encoding.detect(bytes)
  const decoded = Encoding.split(yield* Encoding.decodeText(bytes, detected))
  const bom = detected.encoding === "utf-8" ? decoded.bom : detected.bom
  return { ...detected, bom, text: decoded.text }
})

/**
 * Re-reads a file after an external formatter may have rewritten it and
 * re-encodes it in the source encoding unless the bytes are already canonical.
 */
export const syncTextEncoding = Effect.fn("FileMutation.syncTextEncoding")(function* (
  files: Files,
  target: string,
  source: Encoding.Source,
) {
  const current = yield* files.read(target)
  const detected = yield* Encoding.detect(current.bytes)
  const text = Encoding.split(yield* Encoding.decodeText(current.bytes, detected)).text
  const canonical = yield* Encoding.encodeText(text, source)
  if (!Buffer.from(canonical).equals(current.bytes)) yield* files.write(target, canonical)
  return text
})
/** Share transaction locks across Location graphs that address the same file. */
const transactionLocks = KeyedMutex.makeUnsafe<string>()

/**
 * Mutation locking is process-local and serializes cooperating OpenCode
 * changes; external writes can still race.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const withLock: Interface["withLock"] = (targets) => (effect) =>
      [...new Set(targets.map(FSUtil.resolve))]
        .sort()
        .reduceRight((result, target) => transactionLocks.withLock(target)(result), effect)
    const withTargetLock =
      (target: Target) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        locks.withLock(target.absolute)(Effect.uninterruptible(effect))

    const writeResult = (target: Target, existed: boolean): WriteResult => ({
      operation: "write",
      target: target.absolute,
      resource: target.resource,
      existed,
    })

    const write = Effect.fn("FileMutation.write")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* environment.files.stat(input.target.absolute).pipe(
            Effect.as(true),
            Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
          )
          const bytes =
            typeof input.content === "string"
              ? yield* Encoding.encodeText(input.content, input.source ?? { encoding: "utf-8", bom: false })
              : input.content
          yield* environment.files.write(input.target.absolute, bytes)
          return writeResult(input.target, existed)
        }),
      ),
    )

    const writeText = Effect.fn("FileMutation.writeText")(
      (input: TextWriteInput & { readonly source: Encoding.Source }) =>
        withTargetLock(input.target)(
          Effect.gen(function* () {
            const existed = yield* environment.files.stat(input.target.absolute).pipe(
              Effect.as(true),
              Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
            )
            const bom = input.source.bom || input.content.charCodeAt(0) === 0xfeff
            yield* environment.files.write(
              input.target.absolute,
              yield* Encoding.encodeText(input.content, { ...input.source, bom }),
            )
            return writeResult(input.target, existed)
          }),
        ),
    )

    return Service.of({ withLock, write, writeText })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Environment.node] })

/**
 * Deferred until the corresponding integrations exist.
 */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after snapshot design exists.
// TODO: Notify LSP and collect diagnostics after LSP runtime exists.
// TODO: Design multi-file transactions / rollback if patch needs atomic edits.
// Until then, edits are sequential and report partial application.
// TODO: Define crash recovery and idempotency for side effects between Tool.Called and durable settlement.
