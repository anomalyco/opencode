import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm"
import { Message } from "@opencode/ai/effect"
import { Effect, Option, Schema } from "effect"
import type { Model } from "@opencode/schema/model"
import { SessionLegacy } from "@opencode/schema/session-legacy"
import { Database } from "../database/database.js"
import { MessageDecodeError } from "./error.js"
import { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"
import { Instructions } from "../instructions/index.js"
import { InstructionState } from "./instruction-state.js"
import { SessionBlob } from "./blob.js"
import { SessionRecentText } from "./recent-text.js"
import { SessionMessageTable, SessionPartTable } from "./sql.js"
import { SessionStored } from "./stored.js"

type DatabaseService = Database.Interface["db"]

const decode = Schema.decodeUnknownEffect(SessionMessage.Info)
const decodeSync = Schema.decodeUnknownSync(SessionMessage.Info)
const decodeStoredUser = Schema.decodeUnknownEffect(SessionStored.User)
const decodeMedia = Schema.decodeUnknownEffect(SessionMessage.MediaInfo)
const decodePartSync = Schema.decodeUnknownSync(SessionMessage.AssistantContent)
export const encodePart = Schema.encodeSync(SessionMessage.AssistantContent)
const PartQueryBatchSize = 500

/**
 * Which completed compactions bound a history read. Local summaries always do. Native
 * windows do for model-neutral readers (`latest`), never for the original transcript
 * (`local`), and only when the target model can replay them.
 */
export type Boundary = "latest" | "local" | Model.Ref

/** A completed provider compaction, which replays `native.messages` instead of a summary. */
export const isNativeCompaction = (
  message: SessionMessage.Info,
): message is SessionMessage.CompactionCompleted & { readonly native: { readonly messages: unknown } } =>
  message.type === "compaction" && message.status === "completed" && message.native?.messages !== undefined

/** A native compaction's window: canonical AI messages, stored as JSON. */
export const NativeWindow = Schema.toCodecJson(Schema.Array(Message))
const decodeNativeWindow = Schema.decodeUnknownOption(NativeWindow)
const decodesWindow = (messages: unknown) => Option.isSome(decodeNativeWindow(messages))

// Like other native data, a window only replays on the model that made it. One that no longer decodes, for example
// a malformed one from a compaction hook, is skipped the same way instead of failing the session.
const replayable = (message: SessionMessage.Info, boundary: Boundary) =>
  !isNativeCompaction(message) ||
  boundary === "latest" ||
  (boundary !== "local" &&
    message.model?.providerID === boundary.providerID &&
    message.model.id === boundary.id &&
    decodesWindow(message.native.messages))

const latestCompaction = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  boundary: Boundary,
  before?: number,
) {
  return yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        eq(SessionMessageTable.type, "compaction"),
        sql`json_extract(${SessionMessageTable.data}, '$.status') = 'completed'`,
        before === undefined ? undefined : lt(SessionMessageTable.seq, before),
        boundary === "latest"
          ? undefined
          : or(
              // Rows written before v2.1 hold the window in `providerContext`.
              sql`coalesce(json_extract(${SessionMessageTable.data}, '$.native.messages'), json_extract(${SessionMessageTable.data}, '$.providerContext')) is null`,
              boundary === "local"
                ? undefined
                : and(
                    sql`json_extract(${SessionMessageTable.data}, '$.model.providerID') = ${boundary.providerID}`,
                    sql`json_extract(${SessionMessageTable.data}, '$.model.id') = ${boundary.id}`,
                  ),
            ),
      ),
    )
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
})

export const hasInlineContent = (data: typeof SessionMessageTable.$inferSelect.data): boolean =>
  "content" in data && Array.isArray(data.content) && data.content.length > 0

/**
 * Puts each assistant row's `session_part` rows into its `data.content`, in ordinal order. Rows without parts keep
 * their inline content, so legacy rows read unchanged. Runs before blob hydration so media in parts restores too.
 */
export const withParts = Effect.fnUntraced(function* (
  db: DatabaseService,
  rows: ReadonlyArray<typeof SessionMessageTable.$inferSelect>,
) {
  const assistantIDs = rows.flatMap((row) => (row.type === "assistant" ? [row.id] : []))
  if (assistantIDs.length === 0) return rows
  const partsByMessage = new Map<SessionMessage.ID, Array<(typeof SessionPartTable.$inferSelect)["data"]>>()
  for (let index = 0; index < assistantIDs.length; index += PartQueryBatchSize) {
    const partRows = yield* db
      .select()
      .from(SessionPartTable)
      .where(inArray(SessionPartTable.message_id, assistantIDs.slice(index, index + PartQueryBatchSize)))
      .orderBy(asc(SessionPartTable.message_id), asc(SessionPartTable.ordinal))
      .all()
      .pipe(Effect.orDie)
    for (const part of partRows) {
      const list = partsByMessage.get(part.message_id)
      if (list) list.push(part.data)
      else partsByMessage.set(part.message_id, [part.data])
    }
  }
  if (partsByMessage.size === 0) return rows
  return rows.map((row) => {
    const parts = partsByMessage.get(row.id)
    return parts && "content" in row.data ? { ...row, data: { ...row.data, content: parts } } : row
  })
})

// Every stored message row decodes through here, so rows written in older shapes are upgraded in one place.
const rowInput = (row: typeof SessionMessageTable.$inferSelect) => ({
  ...SessionLegacy.message(row.type, row.data),
  id: row.id,
  type: row.type,
})

export const decodePartRowSync = (row: typeof SessionPartTable.$inferSelect) =>
  decodePartSync(SessionLegacy.part({ ...row.data, type: row.type }))

export const decodeMessageRowSync = (row: typeof SessionMessageTable.$inferSelect) => decodeSync(rowInput(row))

const decodeError = (row: typeof SessionMessageTable.$inferSelect) => () =>
  new MessageDecodeError({
    sessionID: row.session_id,
    messageID: row.id,
  })

export const decodeMessageRow = (row: typeof SessionMessageTable.$inferSelect) =>
  decode(rowInput(row)).pipe(Effect.mapError(decodeError(row)))

/** Decodes a row without its blobs, so user files may stay refs. Only for readers that never use file bytes. */
const decodeStoredRow = (
  row: typeof SessionMessageTable.$inferSelect,
): Effect.Effect<SessionMessage.Info | SessionStored.User, MessageDecodeError> =>
  row.type === "user" ? decodeStoredUser(rowInput(row)).pipe(Effect.mapError(decodeError(row))) : decodeMessageRow(row)

/** Decodes rows after restoring media stored in `blob`. Reads that return media must use this. */
export const decodeMessageRows = Effect.fnUntraced(function* (
  db: DatabaseService,
  rows: ReadonlyArray<typeof SessionMessageTable.$inferSelect>,
) {
  return yield* Effect.forEach(yield* SessionBlob.hydrate(db, yield* withParts(db, rows)), decodeMessageRow, {
    concurrency: 1,
  })
})

/** Decodes rows for clients that fetch media themselves, so files stored in `blob` stay `media:` refs. */
export const decodeMessageRowsWithRefs = Effect.fnUntraced(function* (
  db: DatabaseService,
  rows: ReadonlyArray<typeof SessionMessageTable.$inferSelect>,
) {
  const kept = yield* SessionBlob.keepRefs(db, yield* withParts(db, rows))
  return yield* Effect.forEach(
    kept.rows,
    (row) =>
      decodeMedia(rowInput(row)).pipe(
        Effect.mapError(decodeError(row)),
        Effect.map((message) =>
          message.type === "user" && message.files
            ? { ...message, files: SessionBlob.describe(message.files, kept.meta) }
            : message,
        ),
      ),
    { concurrency: 1 },
  )
})

const messageEntries = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  boundary: Boundary,
  before?: number,
): Effect.fn.Return<
  ReadonlyArray<{ readonly seq: number; readonly message: SessionMessage.Info }>,
  MessageDecodeError
> {
  const compaction = yield* latestCompaction(db, sessionID, boundary, before)
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        compaction ? gte(SessionMessageTable.seq, compaction.seq) : undefined,
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  const decoded = yield* Effect.forEach(
    yield* SessionBlob.hydrate(db, yield* withParts(db, rows)),
    (row) => decodeMessageRow(row).pipe(Effect.map((message) => ({ seq: row.seq, message }))),
    { concurrency: 1 },
  )
  // A window that cannot replay leaves nothing to start from, so read from the compaction before it.
  const start = decoded[0]
  if (compaction && start && !replayable(start.message, boundary))
    return yield* messageEntries(db, sessionID, boundary, compaction.seq)
  const entries = compaction ? yield* withRecentText(db, sessionID, decoded) : decoded
  // Re-expansion may cross a native checkpoint whose completion already advanced the instruction
  // epoch: the baseline supersedes the chronological updates before it. Forks seed their baseline
  // at sequence 0 but retain parent sequences, so the copied checkpoint still retires them.
  const native = entries.findLast((entry) => isNativeCompaction(entry.message))
  // Skipped native checkpoints are not textual summaries. Their original transcript remains available.
  return entries.filter(
    (entry) =>
      !(entry.message.type === "system" && native && entry.seq < native.seq) && replayable(entry.message, boundary),
  )
})

/**
 * A summary compaction references its kept messages by `metadata.keepID` instead of storing them, so
 * history rebuilds their text from the messages between that one and the compaction, in memory only (see
 * `SessionRecentText.kept`). Compactions written before the reference have none and keep the text they stored.
 */
const withRecentText = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  entries: ReadonlyArray<{ readonly seq: number; readonly message: SessionMessage.Info }>,
) {
  const first = entries[0]
  const compaction = first?.message
  if (compaction?.type !== "compaction" || compaction.status !== "completed") return entries
  const keepID = compaction.metadata?.keepID
  if (!Schema.is(SessionMessage.ID)(keepID)) return entries
  const start = yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.id, keepID)))
    .get()
    .pipe(Effect.orDie)
  if (!start) return entries
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        gte(SessionMessageTable.seq, start.seq),
        lt(SessionMessageTable.seq, first.seq),
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  // The recent text names attachments by mime and name only, so their bytes are never read.
  const kept = yield* Effect.forEach(yield* withParts(db, rows), decodeStoredRow, { concurrency: 1 })
  const recent = kept.map(SessionRecentText.messageToText).filter(Boolean).join("\n\n")
  return [{ ...first, message: { ...compaction, metadata: { ...compaction.metadata, recent } } }, ...entries.slice(1)]
})

export const load = Effect.fn("SessionHistory.load")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  boundary: Boundary,
) {
  return (yield* messageEntries(db, sessionID, boundary)).map((entry) => entry.message)
})

export const entriesForRunner = Effect.fn("SessionHistory.entriesForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  instructions: Instructions.List,
  boundary: Boundary,
) {
  return yield* db
    .transaction(() =>
      Effect.gen(function* () {
        const messages = yield* messageEntries(db, sessionID, boundary)
        return {
          initial: yield* InstructionState.initial(db, sessionID, instructions),
          entries: messages,
        }
      }),
    )
    .pipe(Effect.orDie)
})

export const preview = Effect.fn("SessionHistory.preview")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  instructions: Instructions.List,
  boundary: Boundary,
) {
  const observed = yield* Instructions.read(instructions)
  return yield* db
    .transaction(() =>
      Effect.gen(function* () {
        const messages = yield* messageEntries(db, sessionID, boundary)
        // An active assistant may contain an unresolved tool call, so only preview the settled prefix.
        const unsettled = messages.findIndex(
          (entry) => entry.message.type === "assistant" && entry.message.time.completed === undefined,
        )
        const settled = unsettled === -1 ? messages : messages.slice(0, unsettled)
        const assembled = yield* InstructionState.preview(db, sessionID, instructions, observed)
        return {
          initial: assembled.initial,
          messages: settled.map((entry) => entry.message),
          instructionUpdate: assembled.update,
        }
      }),
    )
    .pipe(Effect.catch((error) => (error instanceof Instructions.InitializationBlocked ? error : Effect.die(error))))
})

/**
 * The synthetic messages `load(db, sessionID, "latest")` would return, read without the rest of the transcript. Under
 * that boundary every row from the latest completed compaction on is kept, and synthetic rows carry no media.
 */
export const synthetics = Effect.fn("SessionHistory.synthetics")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const compaction = yield* latestCompaction(db, sessionID, "latest")
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        eq(SessionMessageTable.type, "synthetic"),
        compaction ? gte(SessionMessageTable.seq, compaction.seq) : undefined,
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  return yield* Effect.forEach(rows, decodeMessageRow, { concurrency: 1 })
})

/** The id and text of the session's first user message. */
export const firstUserMessage = Effect.fn("SessionHistory.firstUserMessage")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select({
      id: SessionMessageTable.id,
      text: sql<unknown>`json_extract(${SessionMessageTable.data}, '$.text')`,
    })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "user")))
    .orderBy(asc(SessionMessageTable.seq))
    .get()
    .pipe(Effect.orDie)
  return row && Schema.is(Schema.String)(row.text) ? { id: row.id, text: row.text } : undefined
})

export * as SessionHistory from "./history.js"
