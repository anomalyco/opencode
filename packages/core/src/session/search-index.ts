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
  SessionSearchTextTable,
  SessionTable,
} from "./sql.js"

/**
 * A contentless FTS5 index over session titles and message text. Triggers only queue IDs in `session_search_dirty`,
 * so writers that predate the index or lack FTS5 keep working. The `compact` layout removes entries by rowid
 * (contentless_delete, SQLite 3.43+). Older SQLite (e.g. macOS 13's system SQLite) needs the indexed text to remove
 * an entry, so the `text` layout keeps it in `session_search_text`, at about three times the size.
 */

type DatabaseService = Database.Interface["db"]

/** Bump when the columns, tokenizer, triggers or extracted text change, so {@link ensure} rebuilds. */
export const Version = 1

export type Layout = "compact" | "text"

export type Capability = { readonly supported: true; readonly rebuilt: boolean; readonly layout: Layout } | Unsupported
export interface Unsupported {
  readonly supported: false
  readonly reason: string
}

export interface Status {
  readonly version?: number
  readonly backfill?: Backfill
  readonly layout?: Layout
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
 * Creates the index, or rebuilds it when the version is older or a trigger is gone (a migration that rebuilds a source
 * table drops its triggers, so changes meanwhile were never queued). An index from a newer version is left alone so
 * two versions sharing a database don't keep rebuilding each other's index.
 */
export const ensure = Effect.fn("SessionSearchIndex.ensure")(function* (db: DatabaseService) {
  const before = yield* readState(db).pipe(Effect.orDie)
  if (before && before.version > Version) return newer
  const layout = yield* probe(db, before)
  if (typeof layout !== "string") return layout
  const names = Object.keys(Triggers)
  const rebuilt = yield* immediate(
    db,
    Effect.gen(function* () {
      const state = yield* readState(db)
      if (state && state.version > Version) return undefined
      const present = new Set(
        (yield* db.all<{ name: string }>(
          sql`SELECT name FROM sqlite_master WHERE name IN (${list([IndexTable, ...names])})`,
        )).map((row) => row.name),
      )
      if (
        state?.version === Version &&
        state.layout === layout &&
        [IndexTable, ...names].every((name) => present.has(name))
      )
        return false
      for (const name of names) yield* db.run(`DROP TRIGGER IF EXISTS ${name}`)
      yield* db.run(`DROP TABLE IF EXISTS ${IndexTable}`)
      yield* db.delete(SessionSearchDocumentTable).run()
      yield* db.delete(SessionSearchTextTable).run()
      yield* db.delete(SessionSearchDirtyTable).run()
      yield* db.run(createIndex(IndexTable, layout))
      for (const [name, body] of Object.entries(Triggers)) yield* db.run(`CREATE TRIGGER ${name} ${body}`)
      yield* writeState(db, layout, "titles")
      return true
    }),
  )
  if (rebuilt === undefined) return newer
  return { supported: true, rebuilt, layout } satisfies Capability
})

const newer: Unsupported = { supported: false, reason: "The session search index was built by a newer version" }

/**
 * Reindexes and dequeues up to `limit` sources in one transaction. A streaming assistant is dequeued untouched: the
 * write that finishes it queues it again. Returns how many sources were read; 0 means the queue is empty.
 */
// `remove` binds the IDs twice, so 50 stays under Durable Object SQLite's 100-parameter cap.
export const processBatch = Effect.fn("SessionSearchIndex.processBatch")(function* (db: DatabaseService, limit = 50) {
  return yield* immediate(
    db,
    Effect.gen(function* () {
      const state = yield* readState(db)
      if (!current(state)) return 0
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
      const sized = yield* messageSizes(db, state.layout, sql`message.id IN (${list(ids)})`)
      const taken = budget(sized)
      const messages = taken.length === 0 ? [] : yield* messageSources(db, sql`message.id IN (${list(taken)})`)
      const existing = new Set([...titles.map((row) => row.id), ...sized.map((row) => row.id)])
      const removed = yield* remove(
        db,
        state.layout,
        ids.filter((id) => !existing.has(id)),
      )
      yield* write(db, state.layout, [...titles.map(titleDocument), ...messages])
      const done = [...titles.map((row) => row.id), ...taken, ...removed]
      if (done.length > 0)
        yield* db.delete(SessionSearchDirtyTable).where(inArray(SessionSearchDirtyTable.source_id, done)).run()
      return ids.length
    }),
  )
})

/**
 * Indexes the next `limit` titles, then messages, newest first, and advances the cursor in the same transaction.
 * Message batches also stop at {@link MaxBatchBytes} of stored rows. Streaming assistants are passed, not queued:
 * the write that finishes one queues it.
 */
export const backfillBatch = Effect.fn("SessionSearchIndex.backfillBatch")(function* (db: DatabaseService, limit = 50) {
  return yield* immediate(
    db,
    Effect.gen(function* () {
      const state = yield* readState(db)
      if (!current(state) || state.backfill === "done") return { indexed: 0, done: true }
      if (state.backfill === "titles") {
        // Session IDs descend over time, so ascending order is newest first.
        const rows = yield* db
          .select({ id: SessionTable.id, title: SessionTable.title })
          .from(SessionTable)
          .where(state.after === undefined ? undefined : sql`${SessionTable.id} > ${state.after}`)
          .orderBy(SessionTable.id)
          .limit(limit)
          .all()
        yield* write(db, state.layout, rows.map(titleDocument))
        const last = rows.at(-1)
        yield* rows.length < limit || !last
          ? writeState(db, state.layout, "messages")
          : writeState(db, state.layout, "titles", last.id)
        return { indexed: rows.length, done: false }
      }
      // Message IDs ascend over time, so descending order is newest first.
      const candidates = yield* messageSizes(
        db,
        state.layout,
        state.after === undefined ? sql`1 = 1` : sql`message.id < ${state.after}`,
        sql`ORDER BY message.id DESC LIMIT ${limit}`,
      )
      const ids = budget(candidates)
      const rows = ids.length === 0 ? [] : yield* messageSources(db, sql`message.id IN (${list(ids)})`)
      yield* write(db, state.layout, rows)
      const last = ids.at(-1)
      const done = candidates.length < limit && ids.length === candidates.length
      yield* done || last === undefined
        ? writeState(db, state.layout, "done")
        : writeState(db, state.layout, "messages", last)
      return { indexed: rows.length, done }
    }),
  )
})

export const status = Effect.fn("SessionSearchIndex.status")(function* (db: DatabaseService) {
  const state = yield* readState(db)
  const pending = yield* db.get<{ count: number }>(sql`SELECT count(*) AS count FROM ${SessionSearchDirtyTable}`)
  const documents = yield* db.get<{ count: number }>(sql`SELECT count(*) AS count FROM ${SessionSearchDocumentTable}`)
  return {
    version: state?.version,
    backfill: state?.backfill,
    layout: state?.layout,
    pending: pending?.count ?? 0,
    documents: documents?.count ?? 0,
  } satisfies Status
}, Effect.orDie)

/** Ranks entries matching any word of `query` by BM25, skipping sources deleted but not yet dequeued. */
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
/** Stored bytes a batch reads at most, beyond its first message. */
export const MaxBatchBytes = 1024 * 1024
const Columns = "title, summary, user_text, assistant_text"
// Equal column weights ranked better than favoring titles and summaries on 534 recorded agent searches.
const Rank = `bm25(${IndexTable})`
const Word = /[\p{L}\p{M}\p{N}]+/gu

const createIndex = (name: string, layout: Layout) =>
  `CREATE VIRTUAL TABLE ${name} USING fts5(${Columns}, content=''${layout === "compact" ? ", contentless_delete=1" : ""}, tokenize='porter unicode61 remove_diacritics 2')`

const IndexedTypes = `'user', 'assistant', 'compaction'`
const queue = (id: string) => `INSERT INTO session_search_dirty (source_id) VALUES (${id}) ON CONFLICT DO NOTHING;`

const Triggers = {
  session_search_message_insert: `AFTER INSERT ON session_message WHEN NEW.type IN (${IndexedTypes}) BEGIN ${queue("NEW.id")} END`,
  session_search_message_update: `AFTER UPDATE OF type, data ON session_message WHEN NEW.type IN (${IndexedTypes}) OR OLD.type IN (${IndexedTypes}) BEGIN ${queue("NEW.id")} END`,
  session_search_message_delete: `AFTER DELETE ON session_message WHEN OLD.type IN (${IndexedTypes}) BEGIN ${queue("OLD.id")} END`,
  // Any part insert or delete can change which content is read; updates matter only for text parts.
  session_search_part_insert: `AFTER INSERT ON session_part BEGIN ${queue("NEW.message_id")} END`,
  session_search_part_update: `AFTER UPDATE OF type, data, ordinal ON session_part WHEN NEW.type = 'text' OR OLD.type = 'text' BEGIN ${queue("NEW.message_id")} END`,
  session_search_part_delete: `AFTER DELETE ON session_part BEGIN ${queue("OLD.message_id")} END`,
  session_search_session_insert: `AFTER INSERT ON session_v2 WHEN NEW.title IS NOT NULL BEGIN ${queue("NEW.id")} END`,
  session_search_session_update: `AFTER UPDATE OF title ON session_v2 WHEN NEW.title IS NOT OLD.title BEGIN ${queue("NEW.id")} END`,
  session_search_session_delete: `AFTER DELETE ON session_v2 BEGIN ${queue("OLD.id")} END`,
}

/**
 * Batches read, then write. A deferred transaction that has read gets SQLITE_BUSY at once when it needs the write lock
 * while another connection writes, skipping busy_timeout; IMMEDIATE takes the lock up front and waits instead.
 */
const immediate = <A, E>(db: DatabaseService, effect: Effect.Effect<A, E>) =>
  db.transaction(() => effect, { behavior: "immediate" }).pipe(Effect.orDie)

/**
 * Picks the layout this SQLite can maintain, keeping an existing index's layout if it opens. Only a generic
 * SQLITE_ERROR (unknown module or option) means unsupported; locks, read-only files and corruption are defects.
 */
const probe = Effect.fnUntraced(function* (db: DatabaseService, state: State | undefined) {
  const existing = yield* db
    .get<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${IndexTable}`)
    .pipe(Effect.orDie)
  if (existing) {
    const unopened = yield* db.all(sql.raw(`SELECT rowid FROM ${IndexTable} WHERE rowid = 0`)).pipe(capability)
    if (unopened) return unopened
    if (state?.version === Version && state.layout) return state.layout
  }
  // Reading sources uses `->>` (3.38+).
  const json = yield* db.all(sql.raw(`SELECT '{}' ->> '$.a'`)).pipe(capability)
  if (json) return json
  if (!(yield* creatable(db, "compact"))) return "compact" as const
  return (yield* creatable(db, "text")) ?? ("text" as const)
})

const creatable = (db: DatabaseService, layout: Layout) =>
  db
    .transaction(
      () =>
        Effect.gen(function* () {
          yield* db.run(createIndex("session_search_probe", layout))
          yield* db.run("DROP TABLE session_search_probe")
        }),
      { behavior: "immediate" },
    )
    .pipe(capability)

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

// drizzle wraps the SqlError in a Cause.
const sqlError = (error: unknown) => {
  if (isSqlError(error)) return error
  if (!Predicate.hasProperty(error, "cause") || !Cause.isCause(error.cause)) return
  const failure = Cause.squash(error.cause)
  return isSqlError(failure) ? failure : undefined
}

// Bun reports the result code as `errno`, Node as `errcode`.
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
  layout: Schema.optional(Schema.Literals(["compact", "text"])),
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

const current = (state: State | undefined): state is State & { readonly layout: Layout } =>
  state?.version === Version && state.layout !== undefined

const writeState = (db: DatabaseService, layout: Layout, backfill: Backfill, after?: string) => {
  const value: Schema.Json =
    after === undefined ? { version: Version, layout, backfill } : { version: Version, layout, backfill, after }
  return db
    .insert(KVTable)
    .values({ key: StateKey, value })
    .onConflictDoUpdate({ target: KVTable.key, set: { value, time_updated: Date.now() } })
    .run()
}

interface Document {
  readonly sourceID: string
  readonly sessionID: SessionSchema.ID
  readonly columns?: Columns
  /** A streaming assistant: its entry is left as it was. */
  readonly unfinished?: true
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

const MaxText = sql.raw(String(SessionSearchText.MaxText))

/**
 * Indexable messages matching `where`, reduced in SQLite to their searchable fields (each cut to MaxText) so tool
 * output and attachments never reach JS. An assistant is finished once `time.completed` is set. SQLite's JSON
 * functions raise on invalid JSON and would fail the whole batch, so `state` checks the row first (CASE evaluates in
 * order) and elements are read by path from the row rather than parsed one by one. `json_patch` drops nulls so absent
 * fields decode as missing.
 */
const messageSources = (db: DatabaseService, where: SQL, suffix: SQL = sql``) =>
  db
    .all<{
      sourceID: string
      sessionID: SessionSchema.ID
      state: "ready" | "unfinished" | "empty" | "malformed"
      message: string | null
    }>(
      sql`
      WITH source AS (
        SELECT message.id, message.session_id, message.type, message.time_created, message.data, CASE
          WHEN NOT json_valid(message.data) THEN 'malformed'
          WHEN json_type(message.data) <> 'object' THEN 'malformed'
          WHEN message.type = 'assistant' AND message.data ->> '$.time.completed' IS NULL THEN 'unfinished'
          WHEN message.type = 'compaction' AND message.data ->> '$.status' IS NOT 'completed' THEN 'empty'
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
        'content', CASE WHEN message.type = 'assistant' THEN (
          SELECT json_group_array(json_object('type', 'text', 'text', text)) FROM (
            SELECT 0 AS origin, part.ordinal AS position, substr(part.data ->> '$.text', 1, ${MaxText}) AS text
            FROM ${SessionPartTable} AS part
            WHERE part.session_id = message.session_id AND part.message_id = message.id AND part.type = 'text'
              AND json_valid(part.data)
            UNION ALL
            SELECT 1, CAST(content.key AS INTEGER), substr(message.data ->> (content.fullkey || '.text'), 1, ${MaxText})
            FROM json_each(message.data, '$.content') AS content
            WHERE message.data ->> (content.fullkey || '.type') = 'text'
            ORDER BY origin, position
          )
        ) END
      )) END AS message
      FROM source AS message
    `,
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): Document => {
          const document = { sourceID: row.sourceID, sessionID: row.sessionID }
          if (row.state === "unfinished") return { ...document, unfinished: true }
          if (row.state === "empty") return document
          const message = row.message === null ? Option.none() : decodeMessage(row.message)
          if (Option.isNone(message)) return { ...document, malformed: true }
          const fields = SessionSearchText.fromMessage(message.value)
          return { ...document, columns: fields ? { title: "", ...fields } : undefined }
        }),
      ),
    )

/** `octet_length` reads only record headers but needs SQLite 3.43+, like the `compact` layout. */
const messageSizes = (db: DatabaseService, layout: Layout, where: SQL, suffix: SQL = sql``) => {
  const size = sql.raw(layout === "compact" ? "octet_length" : "length")
  return db.all<{ id: string; bytes: number }>(sql`
    SELECT message.id, ${size}(message.data) + coalesce((
      SELECT sum(${size}(part.data)) FROM ${SessionPartTable} AS part
      WHERE part.session_id = message.session_id AND part.message_id = message.id
    ), 0) AS bytes
    FROM ${SessionMessageTable} AS message
    WHERE message.type IN (${sql.raw(IndexedTypes)}) AND ${where}
    ${suffix}
  `)
}

/** The first message always fits, so a larger one still progresses. */
const budget = (rows: ReadonlyArray<{ id: string; bytes: number }>) => {
  const ids: string[] = []
  let bytes = 0
  for (const row of rows) {
    if (ids.length > 0 && bytes + row.bytes > MaxBatchBytes) break
    ids.push(row.id)
    bytes += row.bytes
  }
  return ids
}

const write = Effect.fnUntraced(function* (db: DatabaseService, layout: Layout, input: ReadonlyArray<Document>) {
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
    if (current !== undefined) yield* unindex(db, layout, sql`SELECT ${current}`)
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
    if (layout === "text")
      yield* db
        .insert(SessionSearchTextTable)
        .values({ id, ...document.columns })
        .run()
  }
})

const unindex = Effect.fnUntraced(function* (db: DatabaseService, layout: Layout, ids: SQL) {
  if (layout === "compact") return yield* db.run(sql`DELETE FROM ${sql.raw(IndexTable)} WHERE rowid IN (${ids})`)
  yield* db.run(sql`
    INSERT INTO ${sql.raw(IndexTable)} (${sql.raw(IndexTable)}, rowid, ${sql.raw(Columns)})
    SELECT 'delete', id, ${sql.raw(Columns)} FROM ${SessionSearchTextTable} WHERE id IN (${ids})
  `)
  yield* db.run(sql`DELETE FROM ${SessionSearchTextTable} WHERE id IN (${ids})`)
})

/** Removes at most {@link MaxRemove} entries per call; sources with entries left stay queued. */
const remove = Effect.fnUntraced(function* (db: DatabaseService, layout: Layout, ids: ReadonlyArray<string>) {
  if (ids.length === 0) return []
  const matching = sql`source_id IN (${list(ids)}) OR session_id IN (${list(ids)})`
  const count = yield* db.get<{ count: number }>(
    sql`SELECT count(*) AS count FROM (SELECT 1 FROM ${SessionSearchDocumentTable} WHERE ${matching} LIMIT ${sql.raw(String(MaxRemove + 1))})`,
  )
  const removed = sql`SELECT id FROM ${SessionSearchDocumentTable} WHERE ${matching} ORDER BY id LIMIT ${sql.raw(String(MaxRemove))}`
  yield* unindex(db, layout, removed)
  yield* db.run(sql`DELETE FROM ${SessionSearchDocumentTable} WHERE id IN (${removed})`)
  return (count?.count ?? 0) > MaxRemove ? [] : ids
})

const MaxRemove = 200

const list = (values: ReadonlyArray<string>) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )
