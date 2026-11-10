export * as SessionSearchIndex from "./search-index.js"

import { eq, inArray, sql, type SQL } from "drizzle-orm"
import { Cause, Effect, Option, Predicate, Schema } from "effect"
import { isSqlError } from "effect/sql/SqlError"
import type { Database } from "../database/database.js"
import { KVTable } from "../kv/sql.js"
import { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"
import { SessionSearchText } from "./search-text.js"
import {
  SessionMessageTable,
  SessionPartTable,
  SessionSearchDirtyTable,
  SessionSearchDocumentTable,
  SessionTable,
} from "./sql.js"

/**
 * A contentless FTS5 index over session titles and message text. Triggers on the source tables only queue IDs in
 * `session_search_dirty`, so any writer, including a binary that predates the index or runs a SQLite without FTS5,
 * keeps working and leaves a record of what changed. {@link processBatch} drains that queue and {@link backfillBatch}
 * indexes rows that existed before the triggers. `SessionSearchMaintenance` runs them in the background.
 */

type DatabaseService = Database.Interface["db"]

/** Bump when the index columns, tokenizer, triggers, or extracted text change: {@link ensure} then rebuilds. */
export const Version = 1

export type Capability = { readonly supported: true; readonly rebuilt: boolean } | Unsupported
export interface Unsupported {
  readonly supported: false
  readonly reason: string
}

export interface Status {
  /** The index version this database was built for, if any. */
  readonly version?: number
  readonly backfill?: Backfill
  /** Sources queued for reindexing. */
  readonly pending: number
  readonly documents: number
}

export interface Hit {
  readonly sessionID: SessionSchema.ID
  /** Undefined when the session title matched. */
  readonly messageID?: SessionMessage.ID
  /** BM25 score; lower is better. */
  readonly rank: number
}

/**
 * Creates the index and its triggers when missing, or rebuilds them from scratch when the stored version differs or a
 * trigger is gone (a migration that rebuilt a source table drops its triggers, and changes made meanwhile were never
 * queued). A rebuild empties the index and restarts the backfill. Reports whether this SQLite supports the index.
 */
export const ensure = Effect.fn("SessionSearchIndex.ensure")(function* (db: DatabaseService) {
  const unsupported = yield* probe(db)
  if (unsupported) return unsupported
  const rebuilt = yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const present = new Set(
            (yield* db.all<{ name: string }>(
              sql`SELECT name FROM sqlite_master WHERE name IN (${list([
                IndexTable,
                ...triggers.map((trigger) => trigger.name),
              ])})`,
            )).map((row) => row.name),
          )
          const state = yield* readState(db)
          if (
            state?.version === Version &&
            present.has(IndexTable) &&
            triggers.every((trigger) => present.has(trigger.name))
          )
            return false
          for (const trigger of triggers) yield* db.run(`DROP TRIGGER IF EXISTS ${trigger.name}`)
          yield* db.run(`DROP TABLE IF EXISTS ${IndexTable}`)
          yield* db.delete(SessionSearchDocumentTable).run()
          yield* db.delete(SessionSearchDirtyTable).run()
          yield* db.run(createIndex(IndexTable))
          for (const trigger of triggers) yield* db.run(`CREATE TRIGGER ${trigger.name} ${trigger.body}`)
          yield* writeState(db, { version: Version, backfill: "titles" })
          return true
        }),
      Immediate,
    )
    .pipe(Effect.orDie)
  return { supported: true, rebuilt } satisfies Capability
})

/**
 * Reindexes up to `limit` queued sources and dequeues them in one transaction, so a write queued meanwhile is either
 * seen by this batch or stays queued. An assistant still streaming is dequeued without touching the index: finishing
 * rewrites its row, which queues it again, so streaming never blocks other sources or keeps the queue busy. Returns
 * how many sources it dequeued; 0 means the queue is empty.
 */
// Small batches keep each transaction, and the JS thread it blocks, short. `remove` binds the IDs twice, so 50 also
// stays under the 100-parameter cap of Durable Object SQLite.
export const processBatch = Effect.fn("SessionSearchIndex.processBatch")(function* (db: DatabaseService, limit = 50) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const ids = (yield* db
            .select({ id: SessionSearchDirtyTable.source_id })
            .from(SessionSearchDirtyTable)
            .limit(limit)
            .all()).map((row) => row.id)
          if (ids.length === 0) return 0
          const titles = yield* db
            .select({ id: SessionTable.id, title: SessionTable.title })
            .from(SessionTable)
            .where(sql`${SessionTable.id} IN (${list(ids)})`)
            .all()
          const messages = yield* messageSources(db, sql`message.id IN (${list(ids)})`)
          const found = new Set([...titles.map((row) => row.id), ...messages.map((row) => row.sourceID)])
          // A source that is gone was deleted. When it was a session, its message entries go with it.
          yield* remove(
            db,
            ids.filter((id) => !found.has(id)),
          )
          yield* write(db, [...titles.map(titleDocument), ...messages])
          yield* db.delete(SessionSearchDirtyTable).where(inArray(SessionSearchDirtyTable.source_id, ids)).run()
          return ids.length
        }),
      Immediate,
    )
    .pipe(Effect.orDie)
})

/**
 * Indexes the next `limit` titles, then messages, that existed before the triggers, newest first, and advances the
 * stored cursor in the same transaction. A message batch also stops before {@link MaxBatchBytes} of stored rows, so a
 * stretch of huge messages, whose whole JSON SQLite parses to find the text, is split across transactions. Cursors follow the sources' primary keys, never their implicit rowids.
 * Rows written after {@link ensure} are queued by the triggers too; indexing one twice is harmless. The cursor passes
 * assistants still streaming without queuing them: the write that finishes one is queued then, and one that never
 * finishes would otherwise sit in the queue forever.
 */
export const backfillBatch = Effect.fn("SessionSearchIndex.backfillBatch")(function* (db: DatabaseService, limit = 50) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const state = yield* readState(db)
          if (state?.version !== Version) return yield* Effect.die(new Error("Session search index is not ensured"))
          if (state.backfill === "done") return { indexed: 0, done: true }
          if (state.backfill === "titles") {
            // Session IDs descend over time, so ascending order is newest first.
            const rows = yield* db
              .select({ id: SessionTable.id, title: SessionTable.title })
              .from(SessionTable)
              .where(state.after === undefined ? undefined : sql`${SessionTable.id} > ${state.after}`)
              .orderBy(SessionTable.id)
              .limit(limit)
              .all()
            yield* write(db, rows.map(titleDocument))
            const last = rows.at(-1)
            yield* writeState(
              db,
              rows.length < limit || !last
                ? { version: Version, backfill: "messages" }
                : { version: Version, backfill: "titles", after: last.id },
            )
            return { indexed: rows.length, done: false }
          }
          // Message IDs ascend over time, so descending order is newest first. Sizes come from the record headers,
          // so choosing the batch reads no message body.
          const candidates = yield* db.all<{ id: string; bytes: number }>(sql`
            SELECT message.id, octet_length(message.data) + coalesce((
              SELECT sum(octet_length(part.data)) FROM ${SessionPartTable} AS part
              WHERE part.session_id = message.session_id AND part.message_id = message.id
            ), 0) AS bytes
            FROM ${SessionMessageTable} AS message
            WHERE message.type IN (${sql.raw(IndexedTypes)})
              ${state.after === undefined ? sql`` : sql`AND message.id < ${state.after}`}
            ORDER BY message.id DESC
            LIMIT ${limit}
          `)
          // The first message always goes in, so one larger than the budget still makes progress on its own.
          const ids: string[] = []
          let bytes = 0
          for (const row of candidates) {
            if (ids.length > 0 && bytes + row.bytes > MaxBatchBytes) break
            ids.push(row.id)
            bytes += row.bytes
          }
          const rows = ids.length === 0 ? [] : yield* messageSources(db, sql`message.id IN (${list(ids)})`)
          yield* write(db, rows)
          const last = ids.at(-1)
          const done = candidates.length < limit && ids.length === candidates.length
          yield* writeState(
            db,
            done || last === undefined
              ? { version: Version, backfill: "done" }
              : { version: Version, backfill: "messages", after: last },
          )
          return { indexed: rows.length, done }
        }),
      Immediate,
    )
    .pipe(Effect.orDie)
})

export const status = Effect.fn("SessionSearchIndex.status")(function* (db: DatabaseService) {
  const state = yield* readState(db)
  const pending = yield* db.get<{ count: number }>(sql`SELECT count(*) AS count FROM ${SessionSearchDirtyTable}`)
  const documents = yield* db.get<{ count: number }>(sql`SELECT count(*) AS count FROM ${SessionSearchDocumentTable}`)
  return {
    version: state?.version,
    backfill: state?.backfill,
    pending: pending?.count ?? 0,
    documents: documents?.count ?? 0,
  } satisfies Status
}, Effect.orDie)

/**
 * Ranks entries matching any word of `query` by BM25, best first. Entries whose source was deleted but not yet
 * dequeued are left out.
 */
export const search = Effect.fn("SessionSearchIndex.search")(function* (
  db: DatabaseService,
  input: { readonly query: string; readonly limit?: number },
) {
  const words = [...new Set(Array.from(SessionSearchText.expand(input.query).matchAll(Word), (match) => match[0]))]
  if (words.length === 0) return []
  const match = words.map((word) => `"${word.replaceAll('"', '""')}"`).join(" OR ")
  // `score`, not `rank`: FTS5 tables have a hidden `rank` column.
  const rows = yield* db.all<{ sessionID: SessionSchema.ID; sourceID: string; score: number }>(sql`
    SELECT document.session_id AS sessionID, document.source_id AS sourceID, ${sql.raw(Rank)} AS score
    FROM ${sql.raw(IndexTable)}
    JOIN ${SessionSearchDocumentTable} AS document ON document.id = ${sql.raw(IndexTable)}.rowid
    JOIN ${SessionTable} AS session ON session.id = document.session_id
    LEFT JOIN ${SessionMessageTable} AS message ON message.id = document.source_id
    WHERE ${sql.raw(IndexTable)} MATCH ${match}
      AND (document.source_id = document.session_id OR message.id IS NOT NULL)
    ORDER BY score
    LIMIT ${input.limit ?? 20}
  `)
  return rows.map(
    (row): Hit =>
      row.sourceID === row.sessionID
        ? { sessionID: row.sessionID, rank: row.score }
        : { sessionID: row.sessionID, messageID: SessionMessage.ID.make(row.sourceID), rank: row.score },
  )
}, Effect.orDie)

const IndexTable = "session_search"
/** Stored bytes of messages and their parts a backfill batch reads, at most, beyond its first message. */
export const MaxBatchBytes = 1024 * 1024
const Columns = "title, summary, user_text, assistant_text"
// Title once per session, then summaries, what the user typed, and assistant text.
const Rank = `bm25(${IndexTable}, 3.0, 4.0, 2.0, 1.0)`
const Word = /[\p{L}\p{M}\p{N}]+/gu

const createIndex = (name: string) =>
  `CREATE VIRTUAL TABLE ${name} USING fts5(${Columns}, content='', contentless_delete=1, tokenize='porter unicode61 remove_diacritics 2')`

const IndexedTypes = `'user', 'assistant', 'compaction'`
const queue = (id: string) => `INSERT INTO session_search_dirty (source_id) VALUES (${id}) ON CONFLICT DO NOTHING;`

// Triggers write only the plain queue table, never the index, so writes keep working on any SQLite.
const triggers = [
  {
    name: "session_search_message_insert",
    body: `AFTER INSERT ON session_message WHEN NEW.type IN (${IndexedTypes}) BEGIN ${queue("NEW.id")} END`,
  },
  {
    name: "session_search_message_update",
    body: `AFTER UPDATE OF type, data ON session_message WHEN NEW.type IN (${IndexedTypes}) OR OLD.type IN (${IndexedTypes}) BEGIN ${queue("NEW.id")} END`,
  },
  {
    name: "session_search_message_delete",
    body: `AFTER DELETE ON session_message WHEN OLD.type IN (${IndexedTypes}) BEGIN ${queue("OLD.id")} END`,
  },
  // A message's first part row replaces its inline content, whatever the part's type, so inserts and deletes of any
  // part queue the message; updates matter only for text parts.
  {
    name: "session_search_part_insert",
    body: `AFTER INSERT ON session_part BEGIN ${queue("NEW.message_id")} END`,
  },
  {
    name: "session_search_part_update",
    body: `AFTER UPDATE OF type, data, ordinal ON session_part WHEN NEW.type = 'text' OR OLD.type = 'text' BEGIN ${queue("NEW.message_id")} END`,
  },
  {
    name: "session_search_part_delete",
    body: `AFTER DELETE ON session_part BEGIN ${queue("OLD.message_id")} END`,
  },
  {
    name: "session_search_session_insert",
    body: `AFTER INSERT ON session_v2 WHEN NEW.title IS NOT NULL BEGIN ${queue("NEW.id")} END`,
  },
  {
    name: "session_search_session_update",
    body: `AFTER UPDATE OF title ON session_v2 WHEN NEW.title IS NOT OLD.title BEGIN ${queue("NEW.id")} END`,
  },
  {
    name: "session_search_session_delete",
    body: `AFTER DELETE ON session_v2 BEGIN ${queue("OLD.id")} END`,
  },
]

/**
 * Every batch reads, then writes. A deferred transaction that has read gets SQLITE_BUSY at once when it needs the
 * write lock while another connection writes, skipping busy_timeout; taking the lock up front waits for it instead.
 */
const Immediate = { behavior: "immediate" } as const

/**
 * Checks that this SQLite has FTS5 and contentless_delete (3.43+). Opening the existing index proves it without
 * writing; an SQLite that lacks either cannot open it. Without a readable index, a throwaway table is created and
 * dropped instead, which changes the schema. Only a generic SQLITE_ERROR, as an unknown module or option raises, means
 * this SQLite lacks them; locks, read-only files, I/O errors and corruption are defects like any other failed write.
 */
const probe = Effect.fnUntraced(function* (db: DatabaseService) {
  const existing = yield* db
    .get<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${IndexTable}`)
    .pipe(Effect.orDie)
  // An index written by another version may use options this SQLite lacks, so failing to open it decides nothing.
  if (
    existing &&
    (yield* db.all(sql.raw(`SELECT rowid FROM ${IndexTable} WHERE rowid = 0`)).pipe(capability)) === undefined
  )
    return undefined
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          yield* db.run(createIndex("session_search_probe"))
          yield* db.run("DROP TABLE session_search_probe")
        }),
      Immediate,
    )
    .pipe(capability)
})

/** Succeeds with undefined, or with Unsupported when the statement failed with a generic SQLITE_ERROR. */
const capability = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.as(undefined),
    Effect.catch((error) => {
      const native = sqlError(error)?.reason
      if (native?._tag !== "UnknownError" || primaryCode(native.cause) !== SQLITE_ERROR) return Effect.die(error)
      return Effect.succeed({ supported: false, reason: String(native.cause) } satisfies Unsupported)
    }),
  )

const SQLITE_ERROR = 1

/** The SqlError behind a failed query; drizzle wraps it in a Cause. */
const sqlError = (error: unknown) => {
  if (isSqlError(error)) return error
  if (!Predicate.hasProperty(error, "cause") || !Cause.isCause(error.cause)) return
  const failure = Cause.squash(error.cause)
  return isSqlError(failure) ? failure : undefined
}

/** The primary SQLite result code of a driver error: Bun reports it as `errno`, Node as `errcode`. */
const primaryCode = (cause: unknown) => {
  const code = Predicate.hasProperty(cause, "errcode")
    ? cause.errcode
    : Predicate.hasProperty(cause, "errno")
      ? cause.errno
      : undefined
  return typeof code === "number" ? code & 0xff : undefined
}

type Backfill = "titles" | "messages" | "done"
const StateKey = "session.search"
const State = Schema.Struct({
  version: Schema.Number,
  backfill: Schema.Literals(["titles", "messages", "done"]),
  after: Schema.optional(Schema.String),
})
type State = typeof State.Type
const decodeState = Schema.decodeUnknownOption(State)

const readState = (db: DatabaseService) =>
  db
    .select({ value: KVTable.value })
    .from(KVTable)
    .where(eq(KVTable.key, StateKey))
    .get()
    .pipe(Effect.map((row) => (row ? Option.getOrUndefined(decodeState(row.value)) : undefined)))

const writeState = (db: DatabaseService, state: State) => {
  const value: Schema.Json =
    state.after === undefined
      ? { version: state.version, backfill: state.backfill }
      : { version: state.version, backfill: state.backfill, after: state.after }
  return db
    .insert(KVTable)
    .values({ key: StateKey, value })
    .onConflictDoUpdate({ target: KVTable.key, set: { value, time_updated: Date.now() } })
    .run()
}

interface Document {
  readonly sourceID: string
  readonly sessionID: SessionSchema.ID
  /** Undefined when the source has nothing to index. */
  readonly columns?: Columns
  /** An assistant still streaming: its entry, if any, is left as it was. */
  readonly unfinished?: true
  /** A row that is not JSON or does not decode: indexed as empty, and logged. */
  readonly malformed?: true
}

interface Columns extends SessionSearchText.Fields {
  readonly title: string
}

const titleDocument = (row: { id: SessionSchema.ID; title: string | null }): Document => ({
  sourceID: row.id,
  sessionID: row.id,
  columns:
    row.title === null || row.title.trim() === ""
      ? undefined
      : { title: SessionSearchText.expand(row.title), summary: "", user_text: "", assistant_text: "" },
})

const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(SessionMessage.Info))

/**
 * Indexable messages matching `where`, each read as a message holding only its searchable fields. The query reads
 * a user's text, a compaction's summary, and a finished assistant's text parts (from `session_part` when the message
 * has part rows, else inline), so tool output, attachments, and native data never leave SQLite, and an assistant
 * still streaming is not read at all. `json_patch` drops absent fields so they decode as missing rather than null.
 *
 * An assistant is finished once `time.completed` is set: when its step ends or fails, or a later step supersedes it.
 * Imports, exports and forks use the same test for settled history, and every later change to it rewrites the row,
 * which queues it again.
 *
 * SQLite's JSON functions raise on text that is not JSON, which would fail the whole batch, so `state` checks the row
 * first (CASE evaluates in order) and elements are read by path from the row's own JSON rather than parsed one by
 * one. Such rows, and rows that do not decode, have nothing to index; a content element or part row that is not a
 * text object is skipped like any other non-text part.
 *
 * Each text is cut to {@link SessionSearchText.MaxText} inside SQLite, so a pasted log or file of megabytes never
 * reaches JS or the index and cannot stall a batch.
 */
const MaxText = sql.raw(String(SessionSearchText.MaxText))

const messageSources = (db: DatabaseService, where: SQL, suffix: SQL = sql``) =>
  db
    .all<{
      sourceID: string
      sessionID: SessionSchema.ID
      state: "ready" | "unfinished" | "malformed"
      message: string | null
    }>(
      sql`
      WITH source AS (
        SELECT message.id, message.session_id, message.type, message.time_created, message.data, CASE
          WHEN NOT json_valid(message.data) THEN 'malformed'
          WHEN json_type(message.data) <> 'object' THEN 'malformed'
          WHEN message.type = 'assistant' AND message.data ->> '$.time.completed' IS NULL THEN 'unfinished'
          ELSE 'ready'
        END AS state
        FROM ${SessionMessageTable} AS message
        WHERE message.type IN (${sql.raw(IndexedTypes)}) AND ${where}
        ${suffix}
      )
      SELECT message.id AS sourceID, message.session_id AS sessionID, message.state, CASE WHEN message.state = 'ready' THEN json_patch('{}', json_object(
        'id', message.id,
        'type', message.type,
        'time', json_object('created', message.time_created),
        'text', CASE WHEN message.type = 'user' THEN substr(message.data ->> '$.text', 1, ${MaxText}) END,
        'status', CASE WHEN message.type = 'compaction' THEN message.data ->> '$.status' END,
        'reason', CASE WHEN message.type = 'compaction' THEN message.data ->> '$.reason' END,
        'summary', CASE WHEN message.type = 'compaction' THEN substr(message.data ->> '$.summary', 1, ${MaxText}) END,
        'agent', CASE WHEN message.type = 'assistant' THEN message.data ->> '$.agent' END,
        'model', CASE WHEN message.type = 'assistant' THEN json(message.data -> '$.model') END,
        'content', CASE WHEN message.type <> 'assistant' THEN NULL
          WHEN EXISTS (SELECT 1 FROM ${SessionPartTable} AS part WHERE part.message_id = message.id) THEN (
            SELECT json_group_array(json_object('type', 'text', 'text', text)) FROM (
              SELECT CASE WHEN json_valid(part.data) THEN substr(part.data ->> '$.text', 1, ${MaxText}) END AS text
              FROM ${SessionPartTable} AS part
              WHERE part.message_id = message.id AND part.type = 'text' AND json_valid(part.data)
              ORDER BY part.ordinal
            )
          )
          ELSE (
            SELECT json_group_array(json_object('type', 'text', 'text', substr(message.data ->> (content.fullkey || '.text'), 1, ${MaxText})))
            FROM json_each(message.data, '$.content') AS content
            WHERE message.data ->> (content.fullkey || '.type') = 'text'
          )
        END
      )) END AS message
      FROM source AS message
    `,
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): Document => {
          const document = { sourceID: row.sourceID, sessionID: row.sessionID }
          if (row.state === "unfinished") return { ...document, unfinished: true }
          const message = row.message === null ? Option.none() : decodeMessage(row.message)
          if (Option.isNone(message)) return { ...document, malformed: true }
          const fields = SessionSearchText.fromMessage(message.value)
          return {
            ...document,
            columns: fields ? { title: "", ...fields } : undefined,
          }
        }),
      ),
    )

/**
 * Replaces each source's index entry, reusing its document ID, or drops it when the source has nothing to index.
 * An unfinished assistant writes nothing: a reopened one keeps the entry from when it last finished.
 */
const write = Effect.fnUntraced(function* (db: DatabaseService, input: ReadonlyArray<Document>) {
  const malformed = input.filter((document) => document.malformed).map((document) => document.sourceID)
  if (malformed.length > 0)
    yield* Effect.logWarning("session search skipped malformed messages", { messageIDs: malformed })
  const documents = input.filter((document) => !document.unfinished)
  if (documents.length === 0) return
  const existing = new Map(
    (yield* db
      .select({ id: SessionSearchDocumentTable.id, sourceID: SessionSearchDocumentTable.source_id })
      .from(SessionSearchDocumentTable)
      .where(
        inArray(
          SessionSearchDocumentTable.source_id,
          documents.map((document) => document.sourceID),
        ),
      )
      .all()).map((row) => [row.sourceID, row.id]),
  )
  for (const document of documents) {
    const current = existing.get(document.sourceID)
    if (current !== undefined) yield* db.run(sql`DELETE FROM ${sql.raw(IndexTable)} WHERE rowid = ${current}`)
    if (!document.columns) {
      if (current !== undefined)
        yield* db.delete(SessionSearchDocumentTable).where(eq(SessionSearchDocumentTable.id, current)).run()
      continue
    }
    const id =
      current ??
      (yield* db
        .insert(SessionSearchDocumentTable)
        .values({ source_id: document.sourceID, session_id: document.sessionID })
        .returning({ id: SessionSearchDocumentTable.id })
        .get())?.id
    if (id === undefined)
      return yield* Effect.die(new Error(`Session search document not stored: ${document.sourceID}`))
    yield* db.run(sql`
      INSERT INTO ${sql.raw(IndexTable)} (rowid, ${sql.raw(Columns)})
      VALUES (${id}, ${document.columns.title}, ${document.columns.summary}, ${document.columns.user_text}, ${document.columns.assistant_text})
    `)
  }
})

/** Drops the entries of deleted sources: a message's own entry, or every entry of a deleted session. */
const remove = Effect.fnUntraced(function* (db: DatabaseService, ids: ReadonlyArray<string>) {
  if (ids.length === 0) return
  const removed = sql`SELECT id FROM ${SessionSearchDocumentTable} WHERE source_id IN (${list(ids)}) OR session_id IN (${list(ids)})`
  yield* db.run(sql`DELETE FROM ${sql.raw(IndexTable)} WHERE rowid IN (${removed})`)
  yield* db.run(sql`DELETE FROM ${SessionSearchDocumentTable} WHERE id IN (${removed})`)
})

const list = (values: ReadonlyArray<string>) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )
