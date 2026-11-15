export * as BlobStore from "./blob-store.js"

import { createHash } from "node:crypto"
import path from "path"
import { Clock, Context, Duration, Effect, Layer, Option, Schedule, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Database } from "./database/database.js"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { SessionBlob } from "./session/blob.js"

/** One folder for every blob stored as a file, next to the database's other data, like `tool-output/`. */
const DIRECTORY = "blobs"
const SWEEP_INTERVAL = Duration.hours(1)
// Enough leading bytes for `Media.detectMediaType`.
const HEAD_BYTES = 64

/** A staged file's contents: the hash that names it, its size and its first bytes, for sniffing its type. */
export interface Staged {
  readonly hash: string
  readonly bytes: number
  readonly head: Uint8Array
}

export interface Interface {
  /** Where a blob stored as a file lives: `<data>/blobs/<first 2 hex>/<hash>`. */
  readonly path: (hash: string) => string
  /**
   * Streams bytes into `blobs/<id>.part`, hashing them as they arrive, and syncs the file. A retry with the same `id`
   * overwrites the earlier attempt; a failure deletes the staged file.
   */
  readonly stage: <E, R>(
    id: string,
    stream: Stream.Stream<Uint8Array, E, R>,
  ) => Effect.Effect<Staged, E | PlatformError, R>
  /**
   * Moves `id`'s staged file to its hash's path, or drops it when an intact copy is already there, then runs `insert`
   * (which records the row) while holding the hash's lock, so a sweep can't delete the file in between.
   */
  readonly commit: <A, E, R>(
    id: string,
    staged: Staged,
    insert: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | PlatformError, R>
  /** Deletes `id`'s staged file, if any. */
  readonly discard: (id: string) => Effect.Effect<void>
  /** The path of a blob's file when it is there with the expected size. Otherwise logs an error; the row is kept. */
  readonly open: (hash: string, bytes: number) => Effect.Effect<string | undefined>
  /** Deletes blobs that expired with no ref, row first and then the file. */
  readonly sweep: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BlobStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const { db } = yield* Database.Service
    const directory = path.join((yield* Global.Service).data, DIRECTORY)
    const locks = KeyedMutex.makeUnsafe<string>()
    // Files whose row is gone but whose delete failed, such as a file another process holds open on Windows. They
    // are retried on the next sweep; a restart forgets them.
    const leftover = new Set<string>()

    const file = (hash: string) => path.join(directory, hash.slice(0, 2), hash)
    const part = (id: string) => path.join(directory, `${id}.part`)

    const discard = (id: string) => fs.remove(part(id), { force: true }).pipe(Effect.ignore)

    const stage = <E, R>(id: string, stream: Stream.Stream<Uint8Array, E, R>) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(directory, { recursive: true })
        const hash = createHash("sha256")
        const state = { bytes: 0, head: new Uint8Array(0) }
        yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* fs.open(part(id), { flag: "w", mode: 0o600 })
            yield* stream.pipe(
              Stream.runForEach((chunk) =>
                Effect.suspend(() => {
                  hash.update(chunk)
                  if (state.head.byteLength < HEAD_BYTES)
                    state.head = concat(state.head, chunk.subarray(0, HEAD_BYTES - state.head.byteLength))
                  state.bytes += chunk.byteLength
                  return handle.writeAll(chunk)
                }),
              ),
            )
            yield* handle.sync
          }),
        )
        return { hash: hash.digest("hex"), bytes: state.bytes, head: state.head } satisfies Staged
      }).pipe(Effect.onError(() => discard(id)))

    const commit = <A, E, R>(id: string, staged: Staged, insert: Effect.Effect<A, E, R>) =>
      locks.withLock(staged.hash)(
        Effect.gen(function* () {
          const target = file(staged.hash)
          const existing = yield* fs.stat(target).pipe(Effect.option)
          // An intact copy is the same bytes; a short one, from a write that never finished, is replaced.
          const intact = Option.isSome(existing) && Number(existing.value.size) === staged.bytes
          if (intact) yield* discard(id)
          if (!intact) {
            yield* fs.makeDirectory(path.dirname(target), { recursive: true })
            yield* fs.rename(part(id), target)
          }
          leftover.delete(staged.hash)
          return yield* insert
        }),
      )

    const open = Effect.fn("BlobStore.open")(function* (hash: string, bytes: number) {
      const target = file(hash)
      const info = yield* fs.stat(target).pipe(Effect.option)
      if (Option.isNone(info)) {
        yield* Effect.logError("blob file is missing", { hash, path: target })
        return undefined
      }
      if (Number(info.value.size) !== bytes) {
        yield* Effect.logError("blob file has the wrong size", {
          hash,
          path: target,
          bytes,
          size: Number(info.value.size),
        })
        return undefined
      }
      return target
    })

    const unlink = (hash: string) =>
      fs.remove(file(hash), { force: true }).pipe(
        Effect.tap(() => Effect.sync(() => leftover.delete(hash))),
        Effect.catch((error) =>
          Effect.sync(() => leftover.add(hash)).pipe(
            Effect.andThen(
              Effect.logWarning("could not delete blob file; retrying on the next sweep", { hash, error }),
            ),
          ),
        ),
      )

    const sweep = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      yield* Effect.forEach(
        yield* SessionBlob.sweepable(db, now),
        (hash) =>
          locks.withLock(hash)(
            Effect.gen(function* () {
              if (yield* SessionBlob.sweep(db, hash, now)) yield* unlink(hash)
            }),
          ),
        { discard: true },
      )
      // A leftover whose hash was stored again since is that row's file now.
      yield* Effect.forEach(
        [...leftover],
        (hash) =>
          locks.withLock(hash)(
            Effect.gen(function* () {
              if (yield* SessionBlob.has(db, hash)) return leftover.delete(hash)
              yield* unlink(hash)
            }),
          ),
        { discard: true },
      )
    }).pipe(Effect.withSpan("BlobStore.sweep"))

    return Service.of({ path: file, stage, commit, discard, open, sweep })
  }),
)

function concat(left: Uint8Array, right: Uint8Array) {
  const joined = new Uint8Array(left.byteLength + right.byteLength)
  joined.set(left)
  joined.set(right, left.byteLength)
  return joined
}

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Database.node, Global.node],
})

/** Sweeps at startup, then every hour. */
export const sweepNode = makeGlobalNode({
  name: "blob-sweep",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const store = yield* Service
      yield* store.sweep.pipe(
        Effect.ignoreCause({ log: "Error", message: "Blob sweep failed" }),
        Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
        Effect.forkScoped,
      )
    }),
  ),
  deps: [node],
})
