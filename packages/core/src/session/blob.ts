export * as SessionBlob from "./blob.js"

import { createHash } from "node:crypto"
import { and, eq, exists, gte, inArray, notExists, notInArray, type SQL, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { map } from "effect/Array"
import type { Attachment, FileAttachment } from "@opencode/schema/prompt"
import type { Tool } from "@opencode/schema/tool"
import { Config } from "../config.js"
import type { Database } from "../database/database.js"
import type { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"
import { BlobRefTable, BlobTable, SessionInboxTable, SessionMessageTable } from "./sql.js"
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

function unavailableFile(file: SessionStored.FileRef): FileAttachment {
  const { uri: _, ...rest } = file
  return { ...rest, data: Buffer.from(unavailable(file.mime, file.name)).toString("base64"), mime: "text/plain" }
}

const unavailableToolItem = (item: Tool.Content & { readonly type: "file" }): Tool.Content => ({
  type: "text",
  text: unavailable(item.mime, item.name),
})

function inlineFile(file: SessionStored.File, blobs: Blobs): SessionStored.File {
  if (!isFileRef(file)) return file
  const data = blobs.get(SessionStored.refHash(file.uri))
  if (data === undefined) return unavailableFile(file)
  const { uri: _, ...rest } = file
  return { ...rest, data }
}

function inlineToolItem(item: Tool.Content, blobs: Blobs): Tool.Content {
  if (!isToolFileRef(item)) return item
  const data = blobs.get(SessionStored.refHash(item.uri))
  if (data === undefined) return unavailableToolItem(item)
  return { ...item, uri: `data:${item.mime};base64,${data}` }
}

/** Rewrites the ref files in a message row, returning the row itself when it names none. */
function rewriteMessage(
  row: MessageRow,
  file: (file: SessionStored.File) => SessionStored.File,
  item: (item: Tool.Content) => Tool.Content,
): MessageRow {
  const data = row.data
  if ("files" in data && data.files?.some(isFileRef)) return { ...row, data: { ...data, files: data.files.map(file) } }
  if ("content" in data && data.content.some((part) => toolItems(part).some(isToolFileRef)))
    return {
      ...row,
      data: {
        ...data,
        content: data.content.map((part): Part => {
          if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return part
          const content = part.state.content
          if (!content?.some(isToolFileRef)) return part
          return { ...part, state: { ...part.state, content: map(content, item) } }
        }),
      },
    }
  return row
}

function rewriteInbox(row: InboxRow, file: (file: SessionStored.File) => SessionStored.File): InboxRow {
  const payload = row.payload
  if (!("files" in payload) || !payload.files?.some(isFileRef)) return row
  return { ...row, payload: { ...payload, files: payload.files.map(file) } }
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
  return rows.map((row) =>
    rewriteMessage(
      row,
      (file) => inlineFile(file, blobs),
      (item) => inlineToolItem(item, blobs),
    ),
  )
})

/** Restores inline media for the refs in `session_inbox` rows. Rows without refs are returned untouched. */
export const hydrateInbox = Effect.fnUntraced(function* (db: DatabaseService, rows: ReadonlyArray<InboxRow>) {
  const hashes = new Set<string>()
  for (const row of rows) collect(row.payload, hashes)
  if (hashes.size === 0) return rows
  const blobs = yield* load(db, hashes)
  return rows.map((row) => rewriteInbox(row, (file) => inlineFile(file, blobs)))
})

/** What a client that fetches bytes itself learns about a blob. */
export interface Meta {
  readonly bytes: number
  readonly width: number | null
  readonly height: number | null
}

/**
 * For clients that fetch media themselves: refs stay in `rows`, except those whose blob is gone or not referenced (the media route only serves referenced blobs), which become the
 * same unavailable placeholder {@link hydrate} gives. Returns the size and dimensions of every blob still named.
 */
export const keepRefs = Effect.fnUntraced(function* (db: DatabaseService, rows: ReadonlyArray<MessageRow>) {
  const hashes = new Set<string>()
  for (const row of rows) collect(row.data, hashes)
  const meta = yield* loadMeta(db, hashes)
  return { rows: rows.map((row) => rewriteMessage(row, keepFile(meta), keepToolItem(meta))), meta }
})

/** {@link keepRefs} for inbox rows. */
export const keepInboxRefs = Effect.fnUntraced(function* (db: DatabaseService, rows: ReadonlyArray<InboxRow>) {
  const hashes = new Set<string>()
  for (const row of rows) collect(row.payload, hashes)
  const meta = yield* loadMeta(db, hashes)
  return { rows: rows.map((row) => rewriteInbox(row, keepFile(meta))), meta }
})

const loadMeta = Effect.fnUntraced(function* (db: DatabaseService, hashes: ReadonlySet<string>) {
  const meta = new Map<string, Meta>()
  const all = [...hashes]
  for (let offset = 0; offset < all.length; offset += 500) {
    const found = yield* db
      .select({ hash: BlobTable.hash, bytes: BlobTable.bytes, width: BlobTable.width, height: BlobTable.height })
      .from(BlobTable)
      .where(
        and(
          inArray(BlobTable.hash, all.slice(offset, offset + 500)),
          exists(
            db
              .select({ one: sql`1` })
              .from(BlobRefTable)
              .where(eq(BlobRefTable.hash, BlobTable.hash)),
          ),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    for (const { hash, ...rest } of found) meta.set(hash, rest)
  }
  return meta
})

const keepFile =
  (meta: ReadonlyMap<string, Meta>) =>
  (file: SessionStored.File): SessionStored.File =>
    isFileRef(file) && !meta.has(SessionStored.refHash(file.uri)) ? unavailableFile(file) : file

const keepToolItem =
  (meta: ReadonlyMap<string, Meta>) =>
  (item: Tool.Content): Tool.Content =>
    isToolFileRef(item) && !meta.has(SessionStored.refHash(item.uri)) ? unavailableToolItem(item) : item

/** Adds each kept ref's blob size and dimensions to files decoded from {@link keepRefs} or {@link keepInboxRefs}. */
export function describe(files: ReadonlyArray<Attachment>, meta: ReadonlyMap<string, Meta>): Attachment[] {
  return files.map((file) => {
    if (!("uri" in file)) return file
    const blob = meta.get(SessionStored.refHash(file.uri))
    if (!blob) return file
    return {
      ...file,
      bytes: blob.bytes,
      ...(blob.width === null ? {} : { width: blob.width }),
      ...(blob.height === null ? {} : { height: blob.height }),
    }
  })
}

/**
 * One blob's type and bytes, for the experimental media route and `media:` prompt attachments. Only a blob some
 * message or inbox item still references is readable; an unreferenced one awaiting its sweep reads as missing.
 */
export const read = Effect.fnUntraced(function* (db: DatabaseService, hash: string) {
  const blob = yield* db
    .select({ mime: BlobTable.mime, data: BlobTable.data })
    .from(BlobTable)
    .where(
      and(
        eq(BlobTable.hash, hash),
        exists(
          db
            .select({ one: sql`1` })
            .from(BlobRefTable)
            .where(eq(BlobRefTable.hash, BlobTable.hash)),
        ),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  return blob && { mime: blob.mime, data: view(blob.data) }
})

/** A blob's hash is the lowercase hex SHA-256 of its raw bytes. */
export const hashBytes = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex")

/** The row a ref keeps its blob alive for: a message at its `seq`, or a pending inbox row at its `enqueued_seq`. */
export interface Owner {
  readonly sessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
  readonly seq: number
}

/** Blobs taken out of one row, by hash. */
type Pending = Map<string, typeof BlobTable.$inferInsert>
type AssistantPart = SessionMessage.Assistant["content"][number]

/** Reads `experimental.media_blob` from the Config in scope on every call; without one, it is off. */
export const enabled = Effect.gen(function* () {
  const config = yield* Effect.serviceOption(Config.Service)
  if (Option.isNone(config)) return false
  return Config.latest(yield* config.value.entries(), "experimental")?.media_blob === true
})

const DATA_URI = /^data:[^,]*;base64,(.*)$/s

function take(pending: Pending, raw: Buffer, mime: string) {
  const hash = hashBytes(raw)
  if (!pending.has(hash)) pending.set(hash, { hash, mime, bytes: raw.byteLength, data: raw })
  return SessionStored.ref(hash)
}

function fileRef(pending: Pending, file: SessionStored.File): SessionStored.File {
  if (isFileRef(file)) return file
  const { data, ...rest } = file
  return { ...rest, uri: take(pending, Buffer.from(data, "base64"), file.mime) }
}

function toolRef(pending: Pending, item: Tool.Content): Tool.Content {
  if (item.type !== "file") return item
  const data = DATA_URI.exec(item.uri)?.[1]
  return data === undefined ? item : { ...item, uri: take(pending, Buffer.from(data, "base64"), item.mime) }
}

function toolPartRefs(pending: Pending, part: AssistantPart): AssistantPart {
  if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return part
  const content = part.state.content
  if (!content) return part
  return { ...part, state: { ...part.state, content: map(content, (item) => toolRef(pending, item)) } }
}

const save = Effect.fnUntraced(function* (db: DatabaseService, pending: Pending) {
  if (pending.size === 0) return
  yield* db
    .insert(BlobTable)
    .values([...pending.values()])
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

/** {@link externalize} for a user message or pending inbox user payload. */
export const externalizePayload = Effect.fnUntraced(function* <
  T extends { readonly files?: ReadonlyArray<SessionStored.File> },
>(db: DatabaseService, input: T): Effect.fn.Return<T> {
  if (input.files === undefined || !(yield* enabled)) return input
  const pending: Pending = new Map()
  const files = input.files.map((file) => fileRef(pending, file))
  if (pending.size === 0) return input
  yield* save(db, pending)
  return { ...input, files }
})

/**
 * With `experimental.media_blob` on, moves inline user files and tool `data:` files into `blob` and returns the
 * message to store with refs in their place. Existing refs pass through.
 */
export const externalize = Effect.fnUntraced(function* (
  db: DatabaseService,
  message: SessionMessage.Info | SessionStored.User,
) {
  if (message.type === "user") return yield* externalizePayload(db, message)
  if (message.type !== "assistant" || !(yield* enabled)) return message
  const pending: Pending = new Map()
  const content = message.content.map((part) => toolPartRefs(pending, part))
  if (pending.size === 0) return message
  yield* save(db, pending)
  return { ...message, content }
})

const hashesOf = (data: MessageRow["data"] | InboxRow["payload"]) => {
  const hashes = new Set<string>()
  collect(data, hashes)
  return hashes
}

function storedPartRefs(pending: Pending, part: Part): Part {
  if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return part
  const content = part.state.content
  if (!content?.some((item) => item.type === "file" && DATA_URI.test(item.uri))) return part
  return { ...part, state: { ...part.state, content: map(content, (item) => toolRef(pending, item)) } }
}

/**
 * Moves a stored row's inline media into blobs whatever the flag says, for offline backfills. Returns the row to
 * store (the same object when nothing moved), the blobs to insert, and every hash the row then names.
 */
export function split(data: MessageRow["data"] | InboxRow["payload"]) {
  const pending: Pending = new Map()
  const stored =
    "files" in data && data.files?.some((file) => !isFileRef(file))
      ? { ...data, files: data.files.map((file) => fileRef(pending, file)) }
      : "content" in data
        ? { ...data, content: data.content.map((part) => storedPartRefs(pending, part)) }
        : data
  const result = pending.size > 0 ? stored : data
  return { data: result, moved: pending.size > 0, blobs: [...pending.values()], hashes: hashesOf(result) }
}

/** Records that `owner` references each blob its stored row names, so release keeps them until it lets go. */
export const recordRefs = Effect.fnUntraced(function* (
  db: DatabaseService,
  owner: Owner,
  data: MessageRow["data"] | InboxRow["payload"],
) {
  const hashes = hashesOf(data)
  if (hashes.size === 0) return
  // A ref whose blob is already gone keeps nothing alive; reads render it as unavailable.
  const found = yield* db
    .select({ hash: BlobTable.hash })
    .from(BlobTable)
    .where(inArray(BlobTable.hash, [...hashes]))
    .all()
    .pipe(Effect.orDie)
  if (found.length === 0) return
  yield* db
    .insert(BlobRefTable)
    .values(
      found.map(({ hash }) => ({ session_id: owner.sessionID, message_id: owner.messageID, hash, seq: owner.seq })),
    )
    .onConflictDoUpdate({
      target: [BlobRefTable.session_id, BlobRefTable.message_id, BlobRefTable.hash],
      set: { seq: owner.seq },
    })
    .run()
    .pipe(Effect.orDie)
})

/** Records the refs a rewritten message names and releases the ones it no longer does. */
export const syncRefs = Effect.fnUntraced(function* (db: DatabaseService, owner: Owner, data: MessageRow["data"]) {
  yield* recordRefs(db, owner, data)
  const present = [...hashesOf(data)]
  const own = [eq(BlobRefTable.session_id, owner.sessionID), eq(BlobRefTable.message_id, owner.messageID)] as const
  yield* present.length === 0 ? release(db, ...own) : release(db, ...own, notInArray(BlobRefTable.hash, present))
})

/** Deletes the matching refs, then every blob among theirs that no ref names anymore. */
const release = Effect.fnUntraced(function* (db: DatabaseService, ...where: readonly [SQL, ...SQL[]]) {
  const released = yield* db
    .delete(BlobRefTable)
    .where(and(...where))
    .returning({ hash: BlobRefTable.hash })
    .all()
    .pipe(Effect.orDie)
  const hashes = [...new Set(released.map((ref) => ref.hash))]
  for (let offset = 0; offset < hashes.length; offset += 500)
    yield* db
      .delete(BlobTable)
      .where(
        and(
          inArray(BlobTable.hash, hashes.slice(offset, offset + 500)),
          notExists(
            db
              .select({ one: sql`1` })
              .from(BlobRefTable)
              .where(eq(BlobRefTable.hash, BlobTable.hash)),
          ),
        ),
      )
      .run()
      .pipe(Effect.orDie)
})

/** Releases the blobs a removed message or cancelled inbox row referenced. */
export const releaseMessage = (db: DatabaseService, sessionID: SessionSchema.ID, messageID: SessionMessage.ID) =>
  release(db, eq(BlobRefTable.session_id, sessionID), eq(BlobRefTable.message_id, messageID))

/** Releases the blobs referenced at or after `seq`, for a revert. */
export const releaseFrom = (db: DatabaseService, sessionID: SessionSchema.ID, seq: number) =>
  release(db, eq(BlobRefTable.session_id, sessionID), gte(BlobRefTable.seq, seq))

/** Releases every blob a deleted session referenced. */
export const releaseSession = (db: DatabaseService, sessionID: SessionSchema.ID) =>
  release(db, eq(BlobRefTable.session_id, sessionID))
