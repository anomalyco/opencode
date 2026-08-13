export * as FileMutation from "./file-mutation.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Bom } from "@opencode-ai/util/bom"
import { Environment } from "./environment/index.js"
import type { Files } from "./environment/index.js"

export interface Target {
  readonly absolute: string
  readonly resource: string
}

export interface WriteInput {
  readonly target: Target
  readonly content: string | Uint8Array
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
  readonly write: (input: WriteInput) => Effect.Effect<WriteResult, Environment.Failed>
  /** Write text while retaining an existing UTF-8 BOM and emitting at most one BOM. */
  readonly writeTextPreservingBom: (
    input: TextWriteInput,
  ) => Effect.Effect<WriteResult, Environment.WrongKind | Environment.Failed>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileMutation") {}

export const readText = Effect.fn("FileMutation.readText")(function* (files: Files, target: string) {
  return Bom.decodeBytes((yield* files.read(target)).bytes)
})

export const syncTextBom = Effect.fn("FileMutation.syncTextBom")(function* (
  files: Files,
  target: string,
  bom: boolean,
) {
  const synced = Bom.syncBytes((yield* files.read(target)).bytes, bom)
  if (synced.bytes) yield* files.write(target, synced.bytes)
  return synced.text
})

/** Share transaction locks across Location graphs that address the same file. */
const transactionLocks = KeyedMutex.makeUnsafe<string>()

/**
 * Serialize file changes by absolute target. Conditional writes compare and
 * write under the same process-local lock so cooperating OpenCode mutations do
 * not overwrite changes made from the same stale content.
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
          yield* environment.files.write(
            input.target.absolute,
            typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content,
          )
          return writeResult(input.target, existed)
        }),
      ),
    )

    const writeTextPreservingBom = Effect.fn("FileMutation.writeTextPreservingBom")((input: TextWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const next = Bom.split(input.content)
          const current = yield* environment.files.read(input.target.absolute, { offset: 0, length: 3 }).pipe(
            Effect.map((result) => result.bytes),
            Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)),
          )
          yield* environment.files.write(
            input.target.absolute,
            new TextEncoder().encode(Bom.join(next.text, Boolean(current && Bom.has(current)) || next.bom)),
          )
          return writeResult(input.target, current !== undefined)
        }),
      ),
    )

    return Service.of({ withLock, write, writeTextPreservingBom })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Environment.node] })

/**
 * Deferred until the corresponding integrations exist.
 */
// TODO: Add formatter integration after formatter runtime exists.
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after snapshot design exists.
// TODO: Notify LSP and collect diagnostics after LSP runtime exists.
// TODO: Design multi-file transactions / rollback if patch needs atomic edits.
// Until then, edits are sequential and report partial application.
// TODO: Define crash recovery and idempotency for side effects between Tool.Called and durable settlement.
