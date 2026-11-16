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

export interface Staged {
  readonly hash: string
  readonly bytes: number
}

export interface Interface {
  /** `<data>/blobs/<first 2 hex>/<hash>`. */
  readonly path: (hash: string) => string
  /** Streams into `blobs/<id>.part` while hashing, then syncs it. A retry overwrites it; a failure deletes it. */
  readonly stage: <E, R>(
    id: string,
    stream: Stream.Stream<Uint8Array, E, R>,
  ) => Effect.Effect<Staged, E | PlatformError, R>
  /**
   * Moves the staged file to its hash's path, or drops it when an intact copy is there, then runs `insert` under the
   * hash's lock, so a sweep can't delete the file before its row exists.
   */
  readonly commit: <A, E, R>(
    id: string,
    staged: Staged,
    insert: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | PlatformError, R>
  readonly discard: (id: string) => Effect.Effect<void>
  /** The file's path when it exists with the expected size; otherwise logs an error and keeps the row. */
  readonly open: (hash: string, bytes: number) => Effect.Effect<string | undefined>
  /** Deletes expired blobs no ref holds: row first, then file. */
  readonly sweep: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BlobStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const { db } = yield* Database.Service
    const directory = path.join((yield* Global.Service).data, "blobs")
    const locks = KeyedMutex.makeUnsafe<string>()
    // Files whose row is gone but whose delete failed, such as one held open on Windows; retried each sweep.
    const leftover = new Set<string>()

    const file = (hash: string) => path.join(directory, hash.slice(0, 2), hash)
    const part = (id: string) => path.join(directory, `${id}.part`)
    const discard = (id: string) => fs.remove(part(id), { force: true }).pipe(Effect.ignore)

    const stage = <E, R>(id: string, stream: Stream.Stream<Uint8Array, E, R>) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(directory, { recursive: true })
        const hash = createHash("sha256")
        const handle = yield* fs.open(part(id), { flag: "w", mode: 0o600 })
        const bytes = yield* stream.pipe(
          Stream.runFoldEffect(
            () => 0,
            (total, chunk) => {
              hash.update(chunk)
              return handle.writeAll(chunk).pipe(Effect.as(total + chunk.byteLength))
            },
          ),
        )
        yield* handle.sync
        return { hash: hash.digest("hex"), bytes }
      }).pipe(
        Effect.scoped,
        Effect.onError(() => discard(id)),
      )

    const commit = <A, E, R>(id: string, staged: Staged, insert: Effect.Effect<A, E, R>) =>
      locks.withLock(staged.hash)(
        Effect.gen(function* () {
          const target = file(staged.hash)
          // A short copy, from a write that never finished, is replaced.
          const existing = yield* fs.stat(target).pipe(Effect.option)
          yield* Option.isSome(existing) && Number(existing.value.size) === staged.bytes
            ? discard(id)
            : fs
                .makeDirectory(path.dirname(target), { recursive: true })
                .pipe(Effect.andThen(fs.rename(part(id), target)))
          leftover.delete(staged.hash)
          return yield* insert
        }),
      )

    const open = Effect.fn("BlobStore.open")(function* (hash: string, bytes: number) {
      const size = yield* fs.stat(file(hash)).pipe(
        Effect.map((info) => Number(info.size)),
        Effect.option,
      )
      if (Option.isSome(size) && size.value === bytes) return file(hash)
      yield* Effect.logError("blob file is missing or has the wrong size", {
        hash,
        bytes,
        size: Option.getOrUndefined(size),
      })
      return undefined
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
            SessionBlob.sweep(db, hash, now).pipe(Effect.flatMap((onDisk) => (onDisk ? unlink(hash) : Effect.void))),
          ),
        { discard: true },
      )
      // A leftover whose hash was stored again since belongs to that row now.
      yield* Effect.forEach(
        [...leftover],
        (hash) =>
          locks.withLock(hash)(
            SessionBlob.has(db, hash).pipe(
              Effect.flatMap((stored) => (stored ? Effect.sync(() => leftover.delete(hash)) : unlink(hash))),
            ),
          ),
        { discard: true },
      )
    }).pipe(Effect.withSpan("BlobStore.sweep"))

    return Service.of({ path: file, stage, commit, discard, open, sweep })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Database.node, Global.node],
})

/** Sweeps at startup, then hourly. */
export const sweepNode = makeGlobalNode({
  name: "blob-sweep",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const store = yield* Service
      yield* store.sweep.pipe(
        Effect.ignoreCause({ log: "Error", message: "Blob sweep failed" }),
        Effect.repeat(Schedule.spaced(Duration.hours(1))),
        Effect.forkScoped,
      )
    }),
  ),
  deps: [node],
})
