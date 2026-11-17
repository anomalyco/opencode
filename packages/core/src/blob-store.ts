export * as BlobStore from "./blob-store.js"

import path from "path"
import { Media } from "@opencode/ai/effect"
import { BlobStore } from "@opencode/schema/blob-store"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema, Stream } from "effect"
import { FileRetention } from "./file-retention.js"

export const ID = BlobStore.ID
export type ID = BlobStore.ID
export type Info = BlobStore.Info

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("BlobStore.NotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("BlobStore.UnavailableError", {
  message: Schema.String,
}) {}

export const RETENTION = Duration.days(7)
/** Blobs are files named by their ID, with no extension; their type is read from their first bytes. */
export const DIRECTORY = "blobs"

/** A stored blob and where its file is. */
export interface Content extends Info {
  readonly path: string
}

export interface Interface {
  /** Stores the stream as the blob `id`, replacing any earlier one. The file appears only once it's whole. */
  readonly write: <E>(id: ID, stream: Stream.Stream<Uint8Array, E>) => Effect.Effect<Info, E | UnavailableError>
  readonly read: (id: ID) => Effect.Effect<Content, NotFoundError>
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BlobStore") {}

/**
 * Files under `<data>/blobs/`, deleted 7 days after they're written, at startup and hourly. Nothing tracks who uses a
 * blob, so a caller that keeps one longer copies it.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const directory = path.join(global.data, DIRECTORY)
    const file = (id: ID) => path.join(directory, id)

    const read = Effect.fn("BlobStore.read")(function* (id: ID) {
      const missing = new NotFoundError({ id, message: `Blob not found: ${id}` })
      const info = yield* fs.stat(file(id)).pipe(Effect.mapError(() => missing))
      const written = Option.getOrUndefined(info.mtime)?.getTime() ?? 0
      const head = yield* fs.stream(file(id), { bytesToRead: 64 }).pipe(
        Stream.runCollect,
        Effect.mapError(() => missing),
      )
      return {
        id,
        path: file(id),
        mime: Media.detectMediaType(Buffer.concat([...head])) ?? "application/octet-stream",
        bytes: Number(info.size),
        expiresAt: written + Duration.toMillis(RETENTION),
      }
    })

    // Written to `<id>.part`, synced, then renamed, so a stored blob is always whole.
    const write = <E>(id: ID, stream: Stream.Stream<Uint8Array, E>) =>
      Effect.gen(function* () {
        const part = `${file(id)}.part`
        const unavailable = (cause: unknown) =>
          new UnavailableError({ message: `Could not store blob ${id}: ${String(cause)}` })
        yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(unavailable))
        yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* fs.open(part, { flag: "w", mode: 0o600 }).pipe(Effect.mapError(unavailable))
            yield* stream.pipe(Stream.runForEach((chunk) => handle.writeAll(chunk).pipe(Effect.mapError(unavailable))))
            yield* handle.sync.pipe(Effect.mapError(unavailable))
          }),
        ).pipe(Effect.onError(() => fs.remove(part, { force: true }).pipe(Effect.ignore)))
        yield* fs.rename(part, file(id)).pipe(Effect.mapError(unavailable))
        const stored = yield* read(id).pipe(Effect.mapError(unavailable))
        return { id, mime: stored.mime, bytes: stored.bytes, expiresAt: stored.expiresAt } satisfies Info
      }).pipe(Effect.withSpan("BlobStore.write"))

    const remove = (id: ID) => fs.remove(file(id), { force: true }).pipe(Effect.ignore)

    // Blobs and leftover `.part` files are deleted once older than the retention.
    yield* fs.readDirectory(directory).pipe(
      Effect.orElseSucceed((): string[] => []),
      Effect.flatMap((entries) =>
        FileRetention.cleanup(
          fs,
          entries.filter((entry) => entry.startsWith("video_")).map((entry) => path.join(directory, entry)),
          RETENTION,
        ),
      ),
      Effect.ignoreCause({ log: "Error", message: "Blob cleanup failed" }),
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
      Effect.forkScoped,
    )

    return Service.of({ write, read, remove })
  }),
)

/** Blobs need a local disk, which Durable Objects don't have. */
export const unsupportedLayer = Layer.succeed(
  Service,
  Service.of({
    write: () => Effect.fail(new UnavailableError({ message: "Blob storage is not supported in this runtime" })),
    read: (id) => Effect.fail(new NotFoundError({ id, message: `Blob not found: ${id}` })),
    remove: () => Effect.void,
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node],
})
