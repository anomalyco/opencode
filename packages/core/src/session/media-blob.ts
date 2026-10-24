export * as SessionMediaBlob from "./media-blob.js"

import { createHash } from "node:crypto"
import { and, eq, gte, inArray, notExists, sql } from "drizzle-orm"
import { Context, Effect, Option } from "effect"
import { Config } from "../config.js"
import type { Database } from "../database/database.js"
import type { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"
import { MediaBlobTable, MediaRefTable, SessionInboxTable, SessionMessageTable } from "./sql.js"

type DatabaseService = Database.Interface["db"]
type MessageRow = typeof SessionMessageTable.$inferSelect
type InboxRow = typeof SessionInboxTable.$inferSelect
type Data = MessageRow["data"] | InboxRow["payload"]

export const URI_PREFIX = "/api/media/"
export const CAPABILITIES_HEADER = "x-opencode-capabilities"
export const MEDIA_URI_CAPABILITY = "media-uri"

export const MediaUriCapability = Context.Reference<boolean>("@opencode/SessionMediaBlob/MediaUriCapability", {
  defaultValue: () => false,
})

export const withMediaUri =
  (enabled: boolean) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(effect, MediaUriCapability, enabled)

export const hasMediaUriCapability = (headers: Readonly<Record<string, string | undefined>>) => {
  const raw = headers[CAPABILITIES_HEADER]
  if (!raw) return false
  return raw.split(",").some((token) => token.trim().toLowerCase() === MEDIA_URI_CAPABILITY)
}

export const get = Effect.fn("SessionMediaBlob.get")(function* (db: DatabaseService, hash: string) {
  return yield* db
    .select({
      hash: MediaBlobTable.hash,
      mime: MediaBlobTable.mime,
      bytes: MediaBlobTable.bytes,
      width: MediaBlobTable.width,
      height: MediaBlobTable.height,
      data: MediaBlobTable.data,
    })
    .from(MediaBlobTable)
    .where(eq(MediaBlobTable.hash, hash))
    .get()
    .pipe(Effect.orDie)
})

export type Blob = {
  readonly hash: string
  readonly mime: string
  readonly bytes: number
  readonly width: number | null
  readonly height: number | null
  readonly data: Buffer
}

export type RefOwner = {
  readonly sessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
  readonly seq: number
}

type BlobMeta = {
  readonly mime: string
  readonly bytes: number
  readonly width: number | null
  readonly height: number | null
}

type StoredUserFile = {
  readonly data?: string
  readonly uri?: string
  readonly mime: string
  readonly bytes?: number
  readonly width?: number
  readonly height?: number
  readonly source?: unknown
  readonly origin?: unknown
  readonly name?: string
  readonly description?: string
  readonly mention?: unknown
}

type StoredToolFile = {
  readonly type: "file"
  readonly uri: string
  readonly mime: string
  readonly bytes?: number
  readonly width?: number
  readonly height?: number
  readonly name?: string
}

let configuredWriteEnabled = false

export const configure = (input: { readonly enabled?: boolean }) => {
  if (input.enabled !== undefined) configuredWriteEnabled = input.enabled
}

export const WriteEnabled = Context.Reference<boolean | undefined>("@opencode/SessionMediaBlob/WriteEnabled", {
  defaultValue: () => undefined,
})

export const withWriteEnabled =
  (enabled: boolean) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, WriteEnabled, enabled)

export const isWriteEnabled = Effect.gen(function* () {
  const explicit = yield* WriteEnabled
  if (explicit !== undefined) return explicit
  const config = yield* Effect.serviceOption(Config.Service)
  if (Option.isSome(config)) {
    const fromConfig = Config.latest(yield* config.value.entries(), "experimental")?.mediaBlob
    if (fromConfig !== undefined) return fromConfig
  }
  return configuredWriteEnabled
})

export const hashFromUri = (uri: string | undefined) =>
  uri?.startsWith(URI_PREFIX) ? uri.slice(URI_PREFIX.length) : undefined

const isUriSource = (value: unknown): value is { readonly type: "uri"; readonly uri: string } =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  value.type === "uri" &&
  "uri" in value &&
  typeof value.uri === "string"

const u16be = (bytes: Uint8Array, offset: number) => (bytes[offset]! << 8) | bytes[offset + 1]!
const u16le = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8)
const u32be = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
const u32le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0

/**
 * Reads image width and height directly from PNG, JPEG, GIF, or WebP headers without decoding pixel data.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  mime?: string,
): { readonly width: number; readonly height: number } | undefined {
  if (mime !== undefined && !mime.startsWith("image/")) return undefined

  // PNG: 8-byte signature + IHDR chunk (4-byte length, "IHDR", 4-byte width BE, 4-byte height BE)
  if (
    bytes.byteLength >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52
  ) {
    const width = u32be(bytes, 16)
    const height = u32be(bytes, 20)
    return width > 0 && height > 0 ? { width, height } : undefined
  }

  // GIF: "GIF87a" or "GIF89a" + 2-byte width LE + 2-byte height LE
  if (
    bytes.byteLength >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    const width = u16le(bytes, 6)
    const height = u16le(bytes, 8)
    return width > 0 && height > 0 ? { width, height } : undefined
  }

  // WebP: "RIFF" + size + "WEBP" + ("VP8 " | "VP8L" | "VP8X")
  if (
    bytes.byteLength >= 25 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 &&
    bytes[12] === 0x56 &&
    bytes[13] === 0x50 &&
    bytes[14] === 0x38
  ) {
    const kind = bytes[15]
    if (
      kind === 0x20 &&
      bytes.byteLength >= 30 &&
      (bytes[20]! & 1) === 0 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      const width = u16le(bytes, 26) & 0x3fff
      const height = u16le(bytes, 28) & 0x3fff
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    if (kind === 0x4c && bytes[20] === 0x2f) {
      const bits = u32le(bytes, 21)
      const width = (bits & 0x3fff) + 1
      const height = ((bits >>> 14) & 0x3fff) + 1
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    if (kind === 0x58 && bytes.byteLength >= 30) {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16))
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16))
      return width > 0 && height > 0 ? { width, height } : undefined
    }
  }

  // JPEG: walk markers from SOI (0xff 0xd8) to SOFn
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 1 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset++
        continue
      }
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset++
      if (offset >= bytes.byteLength) break
      const marker = bytes[offset]!
      offset++
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (marker === 0xd9 || marker === 0xda) break
      if (offset + 1 >= bytes.byteLength) break
      const segLength = u16be(bytes, offset)
      if (segLength < 2 || offset + segLength > bytes.byteLength) break
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (isSof && segLength >= 7) {
        const height = u16be(bytes, offset + 3)
        const width = u16be(bytes, offset + 5)
        return width > 0 && height > 0 ? { width, height } : undefined
      }
      offset += segLength
    }
  }

  return undefined
}

const withMeta = <T extends { readonly mime: string }>(
  item: T,
  hash: string,
  meta: { readonly mime: string; readonly bytes: number; readonly width?: number | null; readonly height?: number | null },
) => ({
  ...item,
  uri: `${URI_PREFIX}${hash}`,
  mime: meta.mime,
  bytes: meta.bytes,
  ...(meta.width == null ? {} : { width: meta.width }),
  ...(meta.height == null ? {} : { height: meta.height }),
})

/**
 * Replaces inline user attachments and tool `data:` files with `/api/media/<hash>` refs + metadata
 * `{ uri, mime, width, height, bytes }` and returns the raw blobs to persist in `media_blob`.
 * Never modifies or re-encodes the input bytes; dimensions are read from image headers when available.
 */
export function split<T extends Data>(data: T): { readonly data: T; readonly blobs: ReadonlyArray<Blob> } {
  const blobs = new Map<string, Blob>()
  const store = (raw: Buffer, mime: string) => {
    const hash = createHash("sha256").update(raw).digest("hex")
    const existing = blobs.get(hash)
    if (existing) return existing
    const dimensions = readImageDimensions(raw, mime)
    const blob: Blob = {
      hash,
      mime,
      bytes: raw.byteLength,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      data: raw,
    }
    blobs.set(hash, blob)
    return blob
  }

  if ("files" in data && data.files) {
    let changed = false
    const files = (data.files as ReadonlyArray<StoredUserFile>).map((file) => {
      if (typeof file.data !== "string" || file.data.length === 0) return file
      const blob = store(Buffer.from(file.data, "base64"), file.mime)
      const { data: _, source, origin, ...rest } = file
      const nextOrigin = origin ?? (isUriSource(source) ? source : undefined)
      changed = true
      return withMeta(
        {
          ...rest,
          ...(nextOrigin === undefined ? {} : { origin: nextOrigin }),
        },
        blob.hash,
        blob,
      )
    })
    return {
      data: (changed ? { ...data, files } : data) as T,
      blobs: [...blobs.values()],
    }
  }

  if (!("content" in data)) return { data, blobs: [] }
  let changed = false
  const content = data.content.map((part) => {
    if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return part
    if (!part.state.content) return part
    let partChanged = false
    const items = part.state.content.map((item) => {
      if (item.type !== "file" || item.uri.startsWith(URI_PREFIX)) return item
      const match = /^data:[^,]*;base64,(.+)$/s.exec(item.uri)
      if (!match) return item
      const blob = store(Buffer.from(match[1]!, "base64"), item.mime)
      partChanged = true
      return withMeta(item, blob.hash, blob)
    })
    if (!partChanged) return part
    changed = true
    return { ...part, state: { ...part.state, content: [items[0]!, ...items.slice(1)] as const } }
  })
  return {
    data: (changed ? { ...data, content } : data) as T,
    blobs: [...blobs.values()],
  }
}

function missingMetaHashes(data: Data) {
  const hashes = new Set<string>()
  if ("files" in data && data.files) {
    for (const file of data.files as ReadonlyArray<StoredUserFile>) {
      const hash = hashFromUri(file.uri)
      if (hash && file.bytes === undefined) hashes.add(hash)
    }
  }
  if ("content" in data) {
    for (const part of data.content) {
      if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) continue
      for (const item of (part.state.content ?? []) as ReadonlyArray<StoredToolFile | { readonly type: "text" }>) {
        if (item.type !== "file") continue
        const hash = hashFromUri(item.uri)
        if (hash && item.bytes === undefined) hashes.add(hash)
      }
    }
  }
  return hashes
}

function attachMeta<T extends Data>(data: T, metas: ReadonlyMap<string, BlobMeta>): T {
  if (metas.size === 0) return data
  if ("files" in data && data.files) {
    let changed = false
    const files = (data.files as ReadonlyArray<StoredUserFile>).map((file) => {
      const hash = hashFromUri(file.uri)
      const meta = hash ? metas.get(hash) : undefined
      if (!hash || !meta || file.bytes !== undefined) return file
      changed = true
      return withMeta(file, hash, meta)
    })
    return (changed ? { ...data, files } : data) as T
  }
  if (!("content" in data)) return data
  let changed = false
  const content = data.content.map((part) => {
    if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return part
    if (!part.state.content) return part
    let partChanged = false
    const items = part.state.content.map((item) => {
      if (item.type !== "file") return item
      const typed = item as StoredToolFile
      const hash = hashFromUri(typed.uri)
      const meta = hash ? metas.get(hash) : undefined
      if (!hash || !meta || typed.bytes !== undefined) return item
      partChanged = true
      return withMeta(typed, hash, meta)
    })
    if (!partChanged) return part
    changed = true
    return { ...part, state: { ...part.state, content: [items[0]!, ...items.slice(1)] as const } }
  })
  return (changed ? { ...data, content } : data) as T
}

export function collectHashes(data: Data, target = new Set<string>()) {
  if ("files" in data && data.files) {
    for (const file of data.files as ReadonlyArray<StoredUserFile>) {
      const hash = hashFromUri(file.uri)
      if (hash) target.add(hash)
    }
  }
  if ("content" in data) {
    for (const part of data.content) {
      if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) continue
      for (const item of part.state.content ?? []) {
        if (item.type !== "file") continue
        const hash = hashFromUri(item.uri)
        if (hash) target.add(hash)
      }
    }
  }
  return target
}

export const hasRefs = (data: Data) => collectHashes(data).size > 0

export const recordRefs = Effect.fnUntraced(function* (db: DatabaseService, owner: RefOwner, data: Data) {
  const hashes = [...collectHashes(data)]
  if (hashes.length === 0) return
  for (const hash of hashes) {
    yield* db
      .insert(MediaRefTable)
      .values({
        session_id: owner.sessionID,
        message_id: owner.messageID,
        hash,
        seq: owner.seq,
      })
      .onConflictDoUpdate({
        target: [MediaRefTable.session_id, MediaRefTable.message_id, MediaRefTable.hash],
        set: { seq: owner.seq },
      })
      .run()
      .pipe(Effect.orDie)
  }
})

export const removeMessageRefs = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
) {
  yield* db
    .delete(MediaRefTable)
    .where(and(eq(MediaRefTable.session_id, sessionID), eq(MediaRefTable.message_id, messageID)))
    .run()
    .pipe(Effect.orDie)
})

export const removeRefsFromSeq = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  fromSeq: number,
) {
  yield* db
    .delete(MediaRefTable)
    .where(and(eq(MediaRefTable.session_id, sessionID), gte(MediaRefTable.seq, fromSeq)))
    .run()
    .pipe(Effect.orDie)
})

export const removeSessionRefs = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  yield* db.delete(MediaRefTable).where(eq(MediaRefTable.session_id, sessionID)).run().pipe(Effect.orDie)
})

export const sweep = Effect.fnUntraced(function* (db: DatabaseService) {
  yield* db
    .delete(MediaBlobTable)
    .where(
      notExists(
        db
          .select({ one: sql`1` })
          .from(MediaRefTable)
          .where(eq(MediaRefTable.hash, MediaBlobTable.hash)),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

/**
 * Stores inline media as blobs when `experimental.mediaBlob` is enabled and returns the row data to persist,
 * recording `media_ref` entries in the same transaction when `owner` is supplied.
 */
export const externalize = Effect.fnUntraced(function* <T extends Data>(
  db: DatabaseService,
  data: T,
  owner?: RefOwner,
) {
  const writeEnabled = yield* isWriteEnabled
  const result = writeEnabled ? split(data) : { data, blobs: [] as ReadonlyArray<Blob> }
  if (result.blobs.length > 0)
    yield* db
      .insert(MediaBlobTable)
      .values([...result.blobs])
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  const missing = missingMetaHashes(result.data)
  const nextData =
    missing.size === 0
      ? result.data
      : attachMeta(
          result.data,
          new Map(
            (yield* db
              .select({
                hash: MediaBlobTable.hash,
                mime: MediaBlobTable.mime,
                bytes: MediaBlobTable.bytes,
                width: MediaBlobTable.width,
                height: MediaBlobTable.height,
              })
              .from(MediaBlobTable)
              .where(inArray(MediaBlobTable.hash, [...missing]))
              .all()
              .pipe(Effect.orDie)).map((row) => [row.hash, row] as const),
          ),
        )
  if (owner) yield* recordRefs(db, owner, nextData)
  return nextData
})

function hydrateData<T extends Data>(
  data: T,
  blobs: ReadonlyMap<string, { readonly mime: string; readonly base64: string }>,
): T {
  if ("files" in data && data.files) {
    let changed = false
    const files = (data.files as ReadonlyArray<StoredUserFile>).map((file) => {
      const hash = hashFromUri(file.uri)
      const blob = hash ? blobs.get(hash) : undefined
      if (!blob) return file
      const { uri: _u, bytes: _b, width: _w, height: _h, origin, source, ...rest } = file
      changed = true
      return {
        ...rest,
        data: blob.base64,
        mime: file.mime || blob.mime,
        source: source ?? origin ?? { type: "inline" as const },
      }
    })
    return (changed ? { ...data, files } : data) as T
  }
  if (!("content" in data)) return data
  let changed = false
  const content = data.content.map((part) => {
    if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return part
    if (!part.state.content) return part
    let partChanged = false
    const items = part.state.content.map((item) => {
      if (item.type !== "file") return item
      const hash = hashFromUri(item.uri)
      const blob = hash ? blobs.get(hash) : undefined
      if (!blob) return item
      const { bytes: _b, width: _w, height: _h, ...rest } = item as StoredToolFile
      partChanged = true
      return {
        ...rest,
        uri: `data:${item.mime || blob.mime};base64,${blob.base64}`,
      }
    })
    if (!partChanged) return part
    changed = true
    return { ...part, state: { ...part.state, content: [items[0]!, ...items.slice(1)] as const } }
  })
  return (changed ? { ...data, content } : data) as T
}

const loadBlobMetas = Effect.fnUntraced(function* (db: DatabaseService, hashes: ReadonlySet<string>) {
  const all = [...hashes]
  const metas = new Map<string, BlobMeta>()
  for (let offset = 0; offset < all.length; offset += 500) {
    const found = yield* db
      .select({
        hash: MediaBlobTable.hash,
        mime: MediaBlobTable.mime,
        bytes: MediaBlobTable.bytes,
        width: MediaBlobTable.width,
        height: MediaBlobTable.height,
      })
      .from(MediaBlobTable)
      .where(inArray(MediaBlobTable.hash, all.slice(offset, offset + 500)))
      .all()
      .pipe(Effect.orDie)
    for (const row of found) metas.set(row.hash, row)
  }
  return metas
})

function toMediaUriData<T extends Data>(data: T): T {
  if ("files" in data && data.files) {
    let changed = false
    const files = (data.files as ReadonlyArray<StoredUserFile>).map((file) => {
      if (!hashFromUri(file.uri)) return file
      if (file.data === undefined && file.source === undefined) return file
      const { data: _d, source, origin, ...rest } = file
      const nextOrigin = origin ?? (isUriSource(source) ? source : undefined)
      changed = true
      return {
        ...rest,
        ...(nextOrigin === undefined ? {} : { origin: nextOrigin }),
      }
    })
    return (changed ? { ...data, files } : data) as T
  }
  return data
}

const loadBlobs = Effect.fnUntraced(function* (db: DatabaseService, hashes: ReadonlySet<string>) {
  const all = [...hashes]
  const blobs = new Map<string, { readonly mime: string; readonly base64: string }>()
  for (let offset = 0; offset < all.length; offset += 500) {
    const found = yield* db
      .select({ hash: MediaBlobTable.hash, mime: MediaBlobTable.mime, data: MediaBlobTable.data })
      .from(MediaBlobTable)
      .where(inArray(MediaBlobTable.hash, all.slice(offset, offset + 500)))
      .all()
      .pipe(Effect.orDie)
    for (const blob of found)
      blobs.set(blob.hash, { mime: blob.mime, base64: Buffer.from(blob.data).toString("base64") })
  }
  return blobs
})

/** Restores inline base64 media for any `/api/media/<hash>` refs in `rows` unless `MediaUriCapability` is enabled. */
export const hydrate = Effect.fnUntraced(function* (db: DatabaseService, rows: ReadonlyArray<MessageRow>) {
  if (yield* MediaUriCapability) {
    const missing = new Set<string>()
    for (const row of rows) for (const hash of missingMetaHashes(row.data)) missing.add(hash)
    const metas = missing.size === 0 ? new Map<string, BlobMeta>() : yield* loadBlobMetas(db, missing)
    return rows.map((row) => {
      const data = toMediaUriData(attachMeta(row.data, metas))
      return data === row.data ? row : { ...row, data }
    })
  }
  const hashes = new Set<string>()
  for (const row of rows) collectHashes(row.data, hashes)
  if (hashes.size === 0) return rows
  const blobs = yield* loadBlobs(db, hashes)
  return rows.map((row) => {
    const data = hydrateData(row.data, blobs)
    return data === row.data ? row : { ...row, data }
  })
})

/** Restores inline base64 media for any `/api/media/<hash>` refs in `session_inbox` rows unless `MediaUriCapability` is enabled. */
export const hydrateInbox = Effect.fnUntraced(function* (db: DatabaseService, rows: ReadonlyArray<InboxRow>) {
  if (yield* MediaUriCapability) {
    const missing = new Set<string>()
    for (const row of rows) for (const hash of missingMetaHashes(row.payload)) missing.add(hash)
    const metas = missing.size === 0 ? new Map<string, BlobMeta>() : yield* loadBlobMetas(db, missing)
    return rows.map((row) => {
      const payload = toMediaUriData(attachMeta(row.payload, metas))
      return payload === row.payload ? row : { ...row, payload }
    })
  }
  const hashes = new Set<string>()
  for (const row of rows) collectHashes(row.payload, hashes)
  if (hashes.size === 0) return rows
  const blobs = yield* loadBlobs(db, hashes)
  return rows.map((row) => {
    const payload = hydrateData(row.payload, blobs)
    return payload === row.payload ? row : { ...row, payload }
  })
})
