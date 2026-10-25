export * as SessionBlob from "./blob.js"

import { inArray } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { map } from "effect/Array"
import type { FileAttachment } from "@opencode/schema/prompt"
import type { Tool } from "@opencode/schema/tool"
import type { Database } from "../database/database.js"
import { BlobTable, SessionInboxTable, SessionMessageTable } from "./sql.js"
import { SessionStored } from "./stored.js"

type DatabaseService = Database.Interface["db"]
type MessageRow = typeof SessionMessageTable.$inferSelect
type InboxRow = typeof SessionInboxTable.$inferSelect
type Part = Extract<MessageRow["data"], { readonly content: unknown }>["content"][number]
/** Base64 bytes by blob hash. */
type Blobs = ReadonlyMap<string, string>

const isFileRef = Schema.is(SessionStored.FileRef)
const isToolFileRef = Schema.is(SessionStored.ToolFileRef)

const toolItems = (part: Part): ReadonlyArray<Tool.Content> =>
  part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")
    ? (part.state.content ?? [])
    : []

function collect(data: MessageRow["data"] | InboxRow["payload"], hashes: Set<string>) {
  if ("files" in data)
    for (const file of data.files ?? []) if (isFileRef(file)) hashes.add(SessionStored.refHash(file.uri))
  if ("content" in data)
    for (const part of data.content)
      for (const item of toolItems(part)) if (isToolFileRef(item)) hashes.add(SessionStored.refHash(item.uri))
}

/** A ref whose blob is gone reads as this text, so clients and the model never see a bare ref. */
const unavailable = (mime: string, name?: string) =>
  `[media unavailable: ${name === undefined ? mime : `${name} (${mime})`}]`

function inlineFile(file: SessionStored.File, blobs: Blobs): FileAttachment {
  if (!isFileRef(file)) return file
  const { uri, ...rest } = file
  const data = blobs.get(SessionStored.refHash(uri))
  if (data === undefined)
    return { ...rest, data: Buffer.from(unavailable(file.mime, file.name)).toString("base64"), mime: "text/plain" }
  return { ...rest, data }
}

function inlineToolItem(item: Tool.Content, blobs: Blobs): Tool.Content {
  if (!isToolFileRef(item)) return item
  const data = blobs.get(SessionStored.refHash(item.uri))
  if (data === undefined) return { type: "text", text: unavailable(item.mime, item.name) }
  return { ...item, uri: `data:${item.mime};base64,${data}` }
}

function inlinePart(part: Part, blobs: Blobs): Part {
  if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return part
  const content = part.state.content
  if (!content?.some(isToolFileRef)) return part
  return { ...part, state: { ...part.state, content: map(content, (item) => inlineToolItem(item, blobs)) } }
}

const load = Effect.fnUntraced(function* (db: DatabaseService, hashes: ReadonlySet<string>) {
  const all = [...hashes]
  const blobs = new Map<string, string>()
  for (let offset = 0; offset < all.length; offset += 500) {
    const found = yield* db
      .select({ hash: BlobTable.hash, data: BlobTable.data })
      .from(BlobTable)
      .where(inArray(BlobTable.hash, all.slice(offset, offset + 500)))
      .all()
      .pipe(Effect.orDie)
    for (const blob of found) blobs.set(blob.hash, view(blob.data).toString("base64"))
  }
  return blobs
})

const view = (data: Uint8Array) =>
  Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)

/** Restores inline media for the refs in `session_message` rows. Rows without refs are returned untouched. */
export const hydrate = Effect.fnUntraced(function* (db: DatabaseService, rows: ReadonlyArray<MessageRow>) {
  const hashes = new Set<string>()
  for (const row of rows) collect(row.data, hashes)
  if (hashes.size === 0) return rows
  const blobs = yield* load(db, hashes)
  return rows.map((row): MessageRow => {
    const data = row.data
    if ("files" in data && data.files?.some(isFileRef))
      return { ...row, data: { ...data, files: data.files.map((file) => inlineFile(file, blobs)) } }
    if ("content" in data && data.content.some((part) => toolItems(part).some(isToolFileRef)))
      return { ...row, data: { ...data, content: data.content.map((part) => inlinePart(part, blobs)) } }
    return row
  })
})

/** Restores inline media for the refs in `session_inbox` rows. Rows without refs are returned untouched. */
export const hydrateInbox = Effect.fnUntraced(function* (db: DatabaseService, rows: ReadonlyArray<InboxRow>) {
  const hashes = new Set<string>()
  for (const row of rows) collect(row.payload, hashes)
  if (hashes.size === 0) return rows
  const blobs = yield* load(db, hashes)
  return rows.map((row): InboxRow => {
    const payload = row.payload
    if (!("files" in payload) || !payload.files?.some(isFileRef)) return row
    return { ...row, payload: { ...payload, files: payload.files.map((file) => inlineFile(file, blobs)) } }
  })
})
