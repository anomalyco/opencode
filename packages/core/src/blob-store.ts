export * as BlobStore from "./blob-store.js"

import path from "path"
import { and, asc, eq } from "drizzle-orm"
import { Media } from "@opencode/ai/effect"
import { BlobStore } from "@opencode/schema/blob-store"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import type { FileSystem } from "effect"
import { Database } from "./database/database.js"
import type { SessionSchema } from "./session/schema.js"
import { BlobDataTable, BlobV2Table } from "./blob-store/sql.js"
import { probe, type Source } from "./blob-store/probe.js"

export const ID = BlobStore.ID
export type ID = BlobStore.ID
export type Info = BlobStore.Info
export const Metadata = BlobStore.Metadata
export type Metadata = BlobStore.Metadata
export const METADATA_LIMIT = BlobStore.METADATA_LIMIT

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("BlobStore.NotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("BlobStore.UnavailableError", {
  message: Schema.String,
}) {}

/** Blobs larger than {@link INLINE} are files here, named by their ID. */
export const DIRECTORY = "blobs"
/** Blobs up to this size are stored in SQLite, whatever their type. */
export const INLINE = 1024 * 1024

export interface WriteOptions {
  readonly sessionID?: SessionSchema.ID
  readonly name?: string
  /** The type the writer claims. The type read from the first bytes wins over it. */
  readonly mime?: string
}

export interface Range {
  readonly offset: number
  readonly length: number
}

export interface Interface {
  /** Stores the stream as a new blob, flushed before it returns. A failed write leaves no blob. */
  readonly write: <E>(
    stream: Stream.Stream<Uint8Array, E>,
    options?: WriteOptions,
  ) => Effect.Effect<Info, E | UnavailableError>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  /** Newest first, one session's blobs or every blob. */
  readonly list: (input?: { readonly sessionID?: SessionSchema.ID }) => Effect.Effect<readonly Info[]>
  /** The bytes, or the given range of them. */
  readonly content: (id: ID, range?: Range) => Effect.Effect<Stream.Stream<Uint8Array>, NotFoundError>
  /** Replaces the name or metadata given; the bytes and what was read from them never change. */
  readonly update: (
    id: ID,
    patch: { readonly name?: string; readonly metadata?: Metadata },
  ) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BlobStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const db = (yield* Database.Service).db
    const directory = path.join(global.data, DIRECTORY)
    const file = (id: ID) => path.join(directory, id)
    const missing = (id: string) => new NotFoundError({ id, message: `Blob not found: ${id}` })
    const readFile = (id: ID, range: Range) =>
      fs.stream(file(id), { offset: range.offset, bytesToRead: range.length })

    const get = Effect.fn("BlobStore.get")(function* (id: ID) {
      const row = yield* db.select().from(BlobV2Table).where(eq(BlobV2Table.id, id)).get().pipe(Effect.orDie)
      if (row === undefined) return yield* missing(id)
      return toInfo(row)
    })

    const list = Effect.fn("BlobStore.list")(function* (input?: { readonly sessionID?: SessionSchema.ID }) {
      const rows = yield* db
        .select()
        .from(BlobV2Table)
        .where(input?.sessionID === undefined ? undefined : eq(BlobV2Table.session_id, input.sessionID))
        .orderBy(asc(BlobV2Table.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map(toInfo)
    })

    const content = Effect.fn("BlobStore.content")(function* (id: ID, range?: Range) {
      const info = yield* get(id)
      const wanted = range ?? { offset: 0, length: info.bytes }
      const inline = yield* db
        .select({ data: BlobDataTable.data })
        .from(BlobDataTable)
        .where(and(eq(BlobDataTable.blob_id, id), eq(BlobDataTable.seq, 0)))
        .get()
        .pipe(Effect.orDie)
      if (inline !== undefined)
        return Stream.make(new Uint8Array(inline.data.subarray(wanted.offset, wanted.offset + wanted.length)))
      return readFile(id, wanted).pipe(Stream.orDie)
    })

    const update = Effect.fn("BlobStore.update")(function* (
      id: ID,
      patch: { readonly name?: string; readonly metadata?: Metadata },
    ) {
      if (patch.name === undefined && patch.metadata === undefined) return yield* get(id)
      const row = yield* db
        .update(BlobV2Table)
        .set({ name: patch.name, metadata: patch.metadata })
        .where(eq(BlobV2Table.id, id))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (row === undefined) return yield* missing(id)
      return toInfo(row)
    })

    const remove = Effect.fn("BlobStore.remove")(function* (id: ID) {
      const removed = yield* db
        .delete(BlobV2Table)
        .where(eq(BlobV2Table.id, id))
        .returning({ id: BlobV2Table.id })
        .get()
        .pipe(Effect.orDie)
      if (removed === undefined) return yield* missing(id)
      yield* fs.remove(file(id), { force: true }).pipe(Effect.ignore)
    })

    const store = Effect.fnUntraced(function* <E>(
      id: ID,
      stream: Stream.Stream<Uint8Array, E>,
      options: WriteOptions,
    ) {
      const part = file(id) + ".part"
      const unavailable = (cause: unknown) =>
        new UnavailableError({ message: `Could not store blob ${id}: ${String(cause)}` })
      // Held in memory up to the inline size. Past it, what came so far moves to a file and the rest streams there.
      const state: { chunks: Uint8Array[]; bytes: number; handle?: FileSystem.File } = { chunks: [], bytes: 0 }
      const keep = Effect.fnUntraced(function* (chunk: Uint8Array) {
        state.bytes += chunk.length
        if (state.handle) return yield* state.handle.writeAll(chunk)
        state.chunks.push(chunk)
        if (state.bytes <= INLINE) return
        yield* fs.makeDirectory(directory, { recursive: true })
        const handle = yield* fs.open(part, { flag: "w", mode: 0o600 })
        yield* Effect.forEach(state.chunks, (item) => handle.writeAll(item), { discard: true })
        state.chunks = []
        state.handle = handle
      })
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* stream.pipe(Stream.runForEach((chunk) => keep(chunk).pipe(Effect.mapError(unavailable))))
          if (state.handle) yield* state.handle.sync.pipe(Effect.mapError(unavailable))
        }),
      )
      const data = state.handle ? undefined : Buffer.concat(state.chunks)
      if (state.handle) yield* fs.rename(part, file(id)).pipe(Effect.mapError(unavailable))
      const source: Source = data
        ? { size: data.length, read: (offset, length) => Effect.succeed(data.subarray(offset, offset + length)) }
        : {
            size: state.bytes,
            read: (offset, length) =>
              readFile(id, { offset, length }).pipe(
                Stream.runCollect,
                Effect.map((chunks) => Buffer.concat([...chunks])),
              ),
          }
      const head = yield* source.read(0, 64).pipe(Effect.mapError(unavailable))
      const mime = Media.detectMediaType(head) ?? options.mime ?? "application/octet-stream"
      const facts = yield* probe(mime, source)
      const now = Date.now()
      const row: Row = {
        id,
        session_id: options.sessionID ?? null,
        mime,
        bytes: state.bytes,
        name: options.name ?? null,
        width: facts.width ?? null,
        height: facts.height ?? null,
        duration_ms: facts.durationMs ?? null,
        metadata: null,
        time_created: now,
        time_updated: now,
      }
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(BlobV2Table).values(row).run()
            if (data) yield* tx.insert(BlobDataTable).values({ blob_id: id, seq: 0, data }).run()
          }),
        )
        .pipe(Effect.mapError(unavailable))
      return toInfo(row)
    })

    const write = <E>(stream: Stream.Stream<Uint8Array, E>, options: WriteOptions = {}) =>
      Effect.suspend(() => {
        const id = ID.create()
        return store(id, stream, options).pipe(
          Effect.onError(() =>
            Effect.all(
              [fs.remove(file(id) + ".part", { force: true }), fs.remove(file(id), { force: true })],
              { discard: true },
            ).pipe(Effect.ignore),
          ),
        )
      }).pipe(Effect.withSpan("BlobStore.write"))

    return Service.of({ write, get, list, content, update, remove })
  }),
)

type Row = typeof BlobV2Table.$inferSelect

function toInfo(row: Row): Info {
  return {
    id: row.id,
    ...(row.session_id === null ? {} : { sessionID: row.session_id }),
    mime: row.mime,
    bytes: row.bytes,
    ...(row.name === null ? {} : { name: row.name }),
    ...(row.metadata === null ? {} : { metadata: row.metadata }),
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
    time: { created: row.time_created, updated: row.time_updated },
  }
}

/** Blobs need a local disk, which Durable Objects don't have. */
export const unsupportedLayer = Layer.succeed(
  Service,
  Service.of({
    write: () => Effect.fail(new UnavailableError({ message: "Blob storage is not supported in this runtime" })),
    get: (id) => Effect.fail(new NotFoundError({ id, message: `Blob not found: ${id}` })),
    list: () => Effect.succeed([]),
    content: (id) => Effect.fail(new NotFoundError({ id, message: `Blob not found: ${id}` })),
    update: (id) => Effect.fail(new NotFoundError({ id, message: `Blob not found: ${id}` })),
    remove: (id) => Effect.fail(new NotFoundError({ id, message: `Blob not found: ${id}` })),
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, FSUtil.node, Global.node],
})
