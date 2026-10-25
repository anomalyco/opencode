export * as SessionBlob from "./blob.js"

import { createHash } from "node:crypto"
import { inArray } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database.js"
import { BlobTable, SessionInboxTable, SessionMessageTable } from "./sql.js"

type DatabaseService = Database.Interface["db"]
type MessageRow = typeof SessionMessageTable.$inferSelect
type InboxRow = typeof SessionInboxTable.$inferSelect
type Data = MessageRow["data"] | InboxRow["payload"]

/** A blob's hash is the lowercase hex SHA-256 of its raw (decoded) bytes. */
export const hashBytes = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex")
export const HASH_PATTERN = /^[0-9a-f]{64}$/

/**
 * Stored rows reference a blob as `media:<hash>` in the existing `uri` field, next to `data:` and `file:` URIs.
 * The ref names no server route; clients that opt in see a fetchable path only in the response projection.
 */
export const REF_SCHEME = "media:"

export const ref = (hash: string) => `${REF_SCHEME}${hash}`

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

export const hashFromUri = (uri: string | undefined) => {
  const hash = uri?.startsWith(REF_SCHEME) ? uri.slice(REF_SCHEME.length) : undefined
  return hash !== undefined && HASH_PATTERN.test(hash) ? hash : undefined
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

/** Stands in for a ref whose blob is gone, so readers and the model never see a bare `media:` ref. */
export const unavailableText = (mime: string, name?: string) =>
  `[media unavailable: ${name === undefined ? mime : `${name} (${mime})`}]`

type Blobs = ReadonlyMap<string, { readonly mime: string; readonly base64: string }>

/** With `blobs`, restores each ref's bytes; without, empties user file data and leaves tool refs as stored. */
function hydrateData<T extends Data>(data: T, blobs: Blobs | undefined): T {
  let result = data
  if ("files" in data && data.files) {
    let changed = false
    const files = (data.files as ReadonlyArray<StoredUserFile>).map((file) => {
      const hash = hashFromUri(file.uri)
      if (!hash) return file
      const blob = blobs?.get(hash)
      const { uri: _u, bytes: _b, width: _w, height: _h, origin, source, ...rest } = file
      changed = true
      return {
        ...rest,
        ...(blobs === undefined
          ? { data: "", mime: file.mime }
          : blob
            ? { data: blob.base64, mime: file.mime || blob.mime }
            : { data: Buffer.from(unavailableText(file.mime, file.name)).toString("base64"), mime: "text/plain" }),
        source: source ?? origin ?? { type: "inline" as const },
      }
    })
    if (changed) result = { ...result, files }
  }
  if (blobs === undefined || !("content" in data)) return result
  let changed = false
  const content = data.content.map((part) => {
    if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return part
    if (!part.state.content) return part
    let partChanged = false
    const items = part.state.content.map((item) => {
      if (item.type !== "file") return item
      const hash = hashFromUri(item.uri)
      if (!hash) return item
      const blob = blobs.get(hash)
      partChanged = true
      if (!blob) return { type: "text" as const, text: unavailableText(item.mime, item.name) }
      const { bytes: _b, width: _w, height: _h, ...rest } = item as StoredToolFile
      return {
        ...rest,
        uri: `data:${item.mime || blob.mime};base64,${blob.base64}`,
      }
    })
    if (!partChanged) return part
    changed = true
    return { ...part, state: { ...part.state, content: [items[0]!, ...items.slice(1)] as const } }
  })
  return changed ? { ...result, content } : result
}

const loadBlobs = Effect.fnUntraced(function* (db: DatabaseService, hashes: ReadonlySet<string>) {
  const all = [...hashes]
  const blobs = new Map<string, { readonly mime: string; readonly base64: string }>()
  for (let offset = 0; offset < all.length; offset += 500) {
    const found = yield* db
      .select({ hash: BlobTable.hash, mime: BlobTable.mime, data: BlobTable.data })
      .from(BlobTable)
      .where(inArray(BlobTable.hash, all.slice(offset, offset + 500)))
      .all()
      .pipe(Effect.orDie)
    for (const blob of found) blobs.set(blob.hash, { mime: blob.mime, base64: view(blob.data).toString("base64") })
  }
  return blobs
})

const view = (data: Uint8Array) =>
  Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)

/** Restores inline base64 media for any `media:<hash>` refs in `rows`. Rows without refs are returned untouched. */
export const hydrate = Effect.fnUntraced(function* (db: DatabaseService, rows: ReadonlyArray<MessageRow>) {
  const hashes = new Set<string>()
  for (const row of rows) collectHashes(row.data, hashes)
  if (hashes.size === 0) return rows
  const blobs = yield* loadBlobs(db, hashes)
  return rows.map((row) => {
    const data = hydrateData(row.data, blobs)
    return data === row.data ? row : { ...row, data }
  })
})

/** Restores inline base64 media for any `media:<hash>` refs in `session_inbox` rows. */
export const hydrateInbox = Effect.fnUntraced(function* (db: DatabaseService, rows: ReadonlyArray<InboxRow>) {
  const hashes = new Set<string>()
  for (const row of rows) collectHashes(row.payload, hashes)
  if (hashes.size === 0) return rows
  const blobs = yield* loadBlobs(db, hashes)
  return rows.map((row) => {
    const payload = hydrateData(row.payload, blobs)
    return payload === row.payload ? row : { ...row, payload }
  })
})

/**
 * Makes rows decodable without reading any blob: user files keep their mime, name and source with empty data,
 * and tool file refs stay as stored. Only for readers that never use file bytes.
 */
export const elide = (rows: ReadonlyArray<MessageRow>) =>
  rows.map((row) => {
    const data = hydrateData(row.data, undefined)
    return data === row.data ? row : { ...row, data }
  })

/** {@link elide} for `session_inbox` rows. */
export const elideInbox = (rows: ReadonlyArray<InboxRow>) =>
  rows.map((row) => {
    const payload = hydrateData(row.payload, undefined)
    return payload === row.payload ? row : { ...row, payload }
  })
