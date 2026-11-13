export * as SessionSearchIndex from "./search-index.js"

import { eq, sql } from "drizzle-orm"
import { Cause, Effect, Option, Predicate, Schema } from "effect"
import { isSqlError } from "effect/sql/SqlError"
import { Database } from "../database/database.js"
import { KVTable } from "../kv/sql.js"
import { SessionMessage } from "./message.js"

/**
 * A full-text index of session titles and message text that SQLite maintains itself. Triggers on the source tables
 * queue a changed source ID; the queue's own trigger reindexes it from the `session_search_source` view and removes the
 * row, so the extraction rules live in one place and no process has to keep up. The `compact` layout is a contentless
 * FTS5 table that removes entries by rowid (contentless_delete, SQLite 3.43+). Older SQLite (e.g. macOS 13's) needs the
 * indexed text to remove an entry, so the `text` layout keeps it in `session_search_document`, at about three times the
 * size. Nothing here uses `->>`: SQLite before 3.38 could not even open a schema containing it.
 */

type DatabaseService = Database.Interface["db"]

/** Bump when the columns, tokenizer, triggers or extracted text change, so {@link ensure} rebuilds. */
export const Version = 1

export type Layout = "compact" | "text"

/** Whether each message type's text is indexed. A new type fails typecheck here until it is decided. */
export const MessageTypes = {
  user: true,
  assistant: true,
  compaction: true,
  "agent-switched": false,
  "model-switched": false,
  "location-switched": false,
  synthetic: false,
  system: false,
  skill: false,
  shell: false,
  idle: false,
} satisfies Record<SessionMessage.Type, boolean>

/** Characters indexed per column. Longer text is nearly always a pasted log or file; its start is enough to find it. */
export const MaxText = 64 * 1024
/** Stored bytes a build chunk reads at most, beyond its first message. */
export const MaxChunkBytes = 1024 * 1024
export const ChunkLimit = 50

export const State = Schema.Struct({
  version: Schema.Number,
  layout: Schema.Literals(["compact", "text"]),
  status: Schema.Literals(["building", "done", "failed"]),
  /** Titles go first, ascending ID (newest first); then messages, descending ID (newest first). */
  phase: Schema.Literals(["titles", "messages"]),
  after: Schema.optional(Schema.String),
  /** Sessions and messages visited, of `total` counted when the build started. */
  processed: Schema.Number,
  total: Schema.Number,
  skipped: Schema.Number,
  error: Schema.optional(Schema.String),
})
export type State = typeof State.Type

export type Ensured =
  | { readonly status: "absent" }
  | { readonly status: "newer" }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "ready"; readonly state: State }

/**
 * Runs before anything writes, so it must stay cheap when there is no index: one sqlite_master read. If search
 * triggers exist but this SQLite can't run them (a database moved to an older SQLite), they would fail every session
 * write, so they are dropped and search stays off here. If a migration rebuilt a source table, its triggers went with
 * it and changes since were missed, so the index is rebuilt from scratch. An older version's index is left to
 * {@link ensure}.
 */
export const check = Effect.fn("SessionSearchIndex.check")(function* (db: DatabaseService) {
  const result = yield* prepare(db, false)
  if (result.status === "unsupported" && result.dropped)
    yield* Effect.logWarning("session search turned off: this SQLite can't maintain the index", {
      reason: result.reason,
    })
  return result
})

Database.afterMigrate((db) =>
  check(db).pipe(Effect.ignoreCause({ log: "Error", message: "session search check failed" })),
)

/**
 * Creates the index and its triggers, or recreates them when the version is older or an object is gone, and starts a
 * build. An index from a newer version is left alone so two versions sharing a database don't keep rebuilding it.
 */
export const ensure = Effect.fn("SessionSearchIndex.ensure")(function* (db: DatabaseService) {
  const result = yield* prepare(db, true)
  if (result.status === "unsupported") return { status: "unsupported", reason: result.reason } satisfies Ensured
  return result
})

/**
 * Queues the next chunk of the build and advances the cursor in the same IMMEDIATE transaction, so concurrent servers
 * share one cursor. Titles are queued 50 at a time; messages also stop at {@link MaxChunkBytes} of stored rows, the
 * first always fitting. `skip` passes the next row without indexing it, for a row that fails on its own.
 */
export const buildChunk = Effect.fn("SessionSearchIndex.buildChunk")(function* (
  db: DatabaseService,
  options: { readonly limit?: number; readonly skip?: boolean } = {},
) {
  const limit = options.limit ?? ChunkLimit
  return yield* immediate(
    db,
    Effect.gen(function* () {
      const state = yield* readState(db)
      if (!current(state) || state.status !== "building") return { done: true }
      const counted = (visited: number) =>
        options.skip
          ? { processed: state.processed + visited, skipped: state.skipped + visited }
          : { processed: state.processed + visited }
      if (state.phase === "titles") {
        // Session IDs descend over time, so ascending order is newest first.
        const after = state.after === undefined ? sql`1 = 1` : sql`id > ${state.after}`
        const rows = yield* db.all<{ id: string }>(
          sql`SELECT id FROM session_v2 WHERE ${after} ORDER BY id LIMIT ${limit}`,
        )
        const last = rows.at(-1)?.id
        if (last !== undefined && !options.skip)
          yield* db.run(sql`
            INSERT OR IGNORE INTO session_search_queue (source_id)
            SELECT id FROM session_v2 WHERE ${after} AND id <= ${last}
          `)
        yield* writeState(db, {
          ...state,
          ...counted(rows.length),
          ...(rows.length < limit ? { phase: "messages", after: undefined } : { after: last }),
        })
        return { done: false }
      }
      // Message IDs ascend over time, so descending order is newest first. `octet_length` reads only the record
      // header but needs SQLite 3.43+, like the compact layout.
      const size = sql.raw(state.layout === "compact" ? "octet_length" : "length")
      const before = state.after === undefined ? sql`1 = 1` : sql`id < ${state.after}`
      const candidates = yield* db.all<{ id: string; bytes: number }>(sql`
        SELECT message.id, CASE WHEN message.type IN (${sql.raw(Indexed)}) THEN ${size}(message.data) + coalesce((
          SELECT sum(${size}(part.data)) FROM session_part AS part WHERE part.message_id = message.id
        ), 0) ELSE 0 END AS bytes
        FROM session_message AS message WHERE ${before}
        ORDER BY message.id DESC LIMIT ${limit}
      `)
      const ids = budget(candidates)
      const last = ids.at(-1)
      if (last !== undefined && !options.skip)
        yield* db.run(sql`
          INSERT OR IGNORE INTO session_search_queue (source_id)
          SELECT id FROM session_message
          WHERE type IN (${sql.raw(Indexed)}) AND ${before} AND id >= ${last}
        `)
      const done = last === undefined || (candidates.length < limit && ids.length === candidates.length)
      yield* writeState(db, { ...state, ...counted(ids.length), ...(done ? { status: "done" } : { after: last }) })
      return { done }
    }),
  )
})

/** Marks the build failed for this version, so it is not retried until the version changes or {@link retry}. */
export const fail = (db: DatabaseService, error: string) =>
  update(db, (state) => (state.status === "building" ? { ...state, status: "failed", error } : undefined))

/**
 * Restarts a failed build from the beginning: rows skipped just before it failed were probably victims of the same
 * failure. Reindexing replaces existing entries, so the index stays usable meanwhile.
 */
export const retry = (db: DatabaseService) =>
  update(db, (state) =>
    state.status === "failed"
      ? { ...state, status: "building", phase: "titles", after: undefined, processed: 0, skipped: 0, error: undefined }
      : undefined,
  )

export const state = (db: DatabaseService) => readState(db).pipe(Effect.orDie)

/**
 * SQLITE_BUSY or SQLITE_LOCKED: another connection held the write lock past busy_timeout. Worth waiting out, unlike a
 * failing row.
 */
export const isBusy = (cause: Cause.Cause<unknown>) => {
  const code = primaryCode(sqlError(Cause.squash(cause))?.reason)
  return code === 5 || code === 6
}

const Columns = "title, summary, user_text, assistant_text"
const Tokenizer = "tokenize='porter unicode61 remove_diacritics 2'"
const Indexed = Object.entries(MessageTypes)
  .filter((entry) => entry[1])
  .map((entry) => `'${entry[0]}'`)
  .join(", ")

/**
 * One row per title or message with text to index: user text, a finished assistant's text (part rows, then inline
 * content), a completed compaction's summary. Rows that are not JSON objects are passed rather than failing the write
 * that queued them; each column keeps its first {@link MaxText} characters.
 */
const SourceView = `CREATE VIEW session_search_source AS
SELECT * FROM (
  SELECT id AS source_id, id AS session_id, substr(title, 1, ${MaxText}) AS title, NULL AS summary, NULL AS user_text, NULL AS assistant_text
  FROM session_v2 WHERE trim(coalesce(title, '')) <> ''
  UNION ALL
  SELECT m.id, m.session_id, NULL,
    CASE WHEN m.type = 'compaction' AND json_extract(m.data, '$.status') = 'completed'
      THEN nullif(substr(json_extract(m.data, '$.summary'), 1, ${MaxText}), '') END,
    CASE WHEN m.type = 'user' THEN nullif(substr(json_extract(m.data, '$.text'), 1, ${MaxText}), '') END,
    CASE WHEN m.type = 'assistant' AND json_extract(m.data, '$.time.completed') IS NOT NULL THEN substr((
      SELECT group_concat(t, char(10) || char(10)) FROM (
        SELECT 0 AS o, p.ordinal AS k, substr(json_extract(p.data, '$.text'), 1, ${MaxText}) AS t
        FROM session_part AS p WHERE p.message_id = m.id AND p.type = 'text' AND json_valid(p.data)
        UNION ALL
        SELECT 1, c.key, substr(json_extract(m.data, c.fullkey || '.text'), 1, ${MaxText})
        FROM json_each(m.data, '$.content') AS c WHERE json_extract(m.data, c.fullkey || '.type') = 'text'
        ORDER BY 1, 2
      ) WHERE trim(t) <> ''
    ), 1, ${MaxText}) END
  FROM session_message AS m
  WHERE m.type IN (${Indexed}) AND json_valid(m.data) AND json_type(m.data) = 'object'
) WHERE coalesce(title, summary, user_text, assistant_text) IS NOT NULL`

const queue = (id: string) => `INSERT OR IGNORE INTO session_search_queue (source_id) VALUES (${id});`
// OR and CASE short-circuit, so json_extract never sees invalid JSON.
const finished = (row: string) =>
  `(${row}.type <> 'assistant' OR NOT json_valid(${row}.data) OR json_extract(${row}.data, '$.time.completed') IS NOT NULL)`
const parentFinished = (row: string) =>
  `EXISTS (SELECT 1 FROM session_message AS m WHERE m.id = ${row}.message_id AND m.type = 'assistant' AND json_valid(m.data) AND json_extract(m.data, '$.time.completed') IS NOT NULL)`

/** A streaming assistant is not queued, so it keeps its last finished text and only the finishing write reindexes it. */
const SourceTriggers = {
  session_search_message_insert: `AFTER INSERT ON session_message WHEN NEW.type IN (${Indexed}) AND ${finished("NEW")} BEGIN ${queue("NEW.id")} END`,
  session_search_message_update: `AFTER UPDATE OF type, data ON session_message WHEN (NEW.type IN (${Indexed}) AND ${finished("NEW")}) OR (OLD.type IN (${Indexed}) AND NEW.type NOT IN (${Indexed})) BEGIN ${queue("NEW.id")} END`,
  session_search_message_delete: `AFTER DELETE ON session_message WHEN OLD.type IN (${Indexed}) BEGIN ${queue("OLD.id")} END`,
  session_search_part_insert: `AFTER INSERT ON session_part WHEN NEW.type = 'text' AND ${parentFinished("NEW")} BEGIN ${queue("NEW.message_id")} END`,
  session_search_part_update: `AFTER UPDATE OF type, data, ordinal ON session_part WHEN (NEW.type = 'text' OR OLD.type = 'text') AND ${parentFinished("NEW")} BEGIN ${queue("NEW.message_id")} END`,
  // In a cascade the message is already gone, so this is skipped and the message's own trigger reindexes.
  session_search_part_delete: `AFTER DELETE ON session_part WHEN OLD.type = 'text' AND ${parentFinished("OLD")} BEGIN ${queue("OLD.message_id")} END`,
  session_search_session_insert: `AFTER INSERT ON session_v2 WHEN trim(coalesce(NEW.title, '')) <> '' BEGIN ${queue("NEW.id")} END`,
  session_search_session_update: `AFTER UPDATE OF title ON session_v2 WHEN NEW.title IS NOT OLD.title BEGIN ${queue("NEW.id")} END`,
  session_search_session_delete: `AFTER DELETE ON session_v2 BEGIN ${queue("OLD.id")} END`,
}

const fts = (name: string, layout: Layout) =>
  layout === "compact"
    ? `CREATE VIRTUAL TABLE ${name} USING fts5(${Columns}, content='', contentless_delete=1, ${Tokenizer})`
    : `CREATE VIRTUAL TABLE ${name} USING fts5(${Columns}, content='session_search_document', content_rowid='id', ${Tokenizer})`

const dequeue = "DELETE FROM session_search_queue WHERE source_id = NEW.source_id;"

/**
 * Per layout: the document table and the triggers that reindex a queued source. Each reads the source view once,
 * filtered by the source ID so SQLite pushes it into both arms of the view.
 */
const Layouts = {
  compact: {
    document: `CREATE TABLE session_search_document (id INTEGER PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL)`,
    // A document row per existing source, even one without text, so the index row can be written from one read.
    triggers: {
      session_search_queue_insert: `AFTER INSERT ON session_search_queue BEGIN
        DELETE FROM session_search WHERE rowid = (SELECT id FROM session_search_document WHERE source_id = NEW.source_id);
        DELETE FROM session_search_document WHERE source_id = NEW.source_id;
        INSERT INTO session_search_document (source_id, session_id)
          SELECT id, session_id FROM session_message WHERE id = NEW.source_id
          UNION ALL SELECT id, id FROM session_v2 WHERE id = NEW.source_id;
        INSERT INTO session_search (rowid, ${Columns})
          SELECT document.id, source.title, source.summary, source.user_text, source.assistant_text
          FROM session_search_source AS source, session_search_document AS document
          WHERE source.source_id = NEW.source_id AND document.source_id = NEW.source_id;
        ${dequeue}
      END`,
    },
  },
  text: {
    document: `CREATE TABLE session_search_document (id INTEGER PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL, ${Columns})`,
    triggers: {
      session_search_queue_insert: `AFTER INSERT ON session_search_queue BEGIN
        DELETE FROM session_search_document WHERE source_id = NEW.source_id;
        INSERT INTO session_search_document (source_id, session_id, ${Columns})
          SELECT source_id, session_id, ${Columns} FROM session_search_source WHERE source_id = NEW.source_id;
        ${dequeue}
      END`,
      // External content: removing an entry takes the text it was indexed with.
      session_search_document_insert: `AFTER INSERT ON session_search_document BEGIN
        INSERT INTO session_search (rowid, ${Columns}) VALUES (NEW.id, NEW.title, NEW.summary, NEW.user_text, NEW.assistant_text);
      END`,
      session_search_document_delete: `AFTER DELETE ON session_search_document BEGIN
        INSERT INTO session_search (session_search, rowid, ${Columns}) VALUES ('delete', OLD.id, OLD.title, OLD.summary, OLD.user_text, OLD.assistant_text);
      END`,
    },
  },
} satisfies Record<Layout, { document: string; triggers: Record<string, string> }>

const Tables = ["session_search", "session_search_document", "session_search_queue"]
const expected = (layout: Layout) => [
  ...Tables,
  "session_search_source",
  ...Object.keys(SourceTriggers),
  ...Object.keys(Layouts[layout].triggers),
]

const prepare = Effect.fnUntraced(function* (db: DatabaseService, create: boolean) {
  const objects = yield* db
    .all<{
      name: string
      type: string
    }>(
      sql`SELECT name, type FROM sqlite_master WHERE name GLOB 'session_search*' AND type IN ('table', 'view', 'trigger')`,
    )
    .pipe(Effect.orDie)
  if (!create && objects.length === 0) return { status: "absent" } as const
  const triggers = objects.filter((object) => object.type === "trigger").map((object) => object.name)
  const unsupported = yield* probe(
    db,
    objects.some((object) => object.name === "session_search"),
  )
  if (unsupported) {
    for (const name of triggers) yield* db.run(`DROP TRIGGER IF EXISTS ${name}`).pipe(Effect.orDie)
    return { status: "unsupported", reason: unsupported, dropped: triggers.length > 0 } as const
  }
  const before = yield* readState(db).pipe(Effect.orDie)
  if (before && before.version > Version) return { status: "newer" } as const
  const names = new Set(objects.map((object) => object.name))
  if (current(before) && expected(before.layout).every((name) => names.has(name)))
    return { status: "ready", state: before } as const
  if (!create && !current(before)) return { status: "absent" } as const
  // An index this version built keeps its layout while this SQLite can still create it.
  const kept = current(before) && (yield* creatable(db, before.layout)) === undefined ? before.layout : undefined
  const layout = kept ?? (yield* pick(db))
  if (typeof layout !== "string") return { status: "unsupported", reason: layout.reason, dropped: false } as const
  return yield* immediate(
    db,
    Effect.gen(function* () {
      // Another server may have rebuilt it meanwhile.
      const state = yield* readState(db)
      if (state && state.version > Version) return { status: "newer" } as const
      const present = new Set(
        (yield* db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE name GLOB 'session_search*'`)).map(
          (row) => row.name,
        ),
      )
      if (state && current(state) && state.layout === layout && expected(layout).every((name) => present.has(name)))
        return { status: "ready", state } as const
      yield* reset(db, layout)
      const next: State = {
        version: Version,
        layout,
        status: "building",
        phase: "titles",
        processed: 0,
        total: yield* total(db),
        skipped: 0,
      }
      yield* writeState(db, next)
      return { status: "ready", state: next } as const
    }),
  )
})

const reset = Effect.fnUntraced(function* (db: DatabaseService, layout: Layout) {
  const triggers = yield* db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name GLOB 'session_search*'`,
  )
  for (const row of triggers) yield* db.run(`DROP TRIGGER ${row.name}`)
  yield* db.run("DROP VIEW IF EXISTS session_search_source")
  // Includes the earlier draft's tables.
  for (const name of [...Tables, "session_search_text", "session_search_dirty"])
    yield* db.run(`DROP TABLE IF EXISTS ${name}`)
  yield* db.run("CREATE TABLE session_search_queue (source_id TEXT PRIMARY KEY)")
  yield* db.run(Layouts[layout].document)
  yield* db.run(fts("session_search", layout))
  yield* db.run(SourceView)
  for (const [name, body] of Object.entries({ ...Layouts[layout].triggers, ...SourceTriggers }))
    yield* db.run(`CREATE TRIGGER ${name} ${body}`)
})

const total = (db: DatabaseService) =>
  db
    .get<{
      count: number
    }>(sql`SELECT (SELECT count(*) FROM session_v2) + (SELECT count(*) FROM session_message) AS count`)
    .pipe(Effect.map((row) => row?.count ?? 0))

/**
 * Batches read, then write. A deferred transaction that has read gets SQLITE_BUSY at once when it needs the write lock
 * while another connection writes, skipping busy_timeout; IMMEDIATE takes the lock up front and waits instead.
 */
const immediate = <A, E>(db: DatabaseService, effect: Effect.Effect<A, E>) =>
  db.transaction(() => effect, { behavior: "immediate" }).pipe(Effect.orDie)

/** The triggers read sources with the JSON functions, and the index must open. Returns why not, if not. */
const probe = Effect.fnUntraced(function* (db: DatabaseService, index: boolean) {
  const json = yield* db
    .all(
      sql.raw(
        `SELECT json_extract('{"a":[1]}', '$.a'), json_valid('{}'), json_type('{}'), (SELECT count(*) FROM json_each('[1]'))`,
      ),
    )
    .pipe(capability)
  if (json) return json.reason
  if (!index) return undefined
  return (yield* db.all(sql.raw("SELECT rowid FROM session_search WHERE rowid = 0")).pipe(capability))?.reason
})

const pick = Effect.fnUntraced(function* (db: DatabaseService) {
  if (!(yield* creatable(db, "compact"))) return "compact" as const
  return (yield* creatable(db, "text")) ?? ("text" as const)
})

/** Undefined when this SQLite can create the layout's FTS table. */
const creatable = (db: DatabaseService, layout: Layout) =>
  db
    .transaction(
      () =>
        Effect.gen(function* () {
          yield* db.run(fts("session_search_probe", layout))
          yield* db.run("DROP TABLE session_search_probe")
        }),
      { behavior: "immediate" },
    )
    .pipe(capability)

/**
 * Only a generic SQLITE_ERROR (unknown module, option or function) means unsupported; locks, read-only files and
 * corruption are defects.
 */
const capability = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.as(undefined),
    Effect.catch((error) => {
      const native = sqlError(error)?.reason
      if (native?._tag !== "UnknownError" || primaryCode(native) !== 1) return Effect.die(error)
      return Effect.succeed({ reason: String(native.cause) })
    }),
  )

// drizzle wraps the SqlError in a Cause.
const sqlError = (error: unknown) => {
  if (isSqlError(error)) return error
  if (!Predicate.hasProperty(error, "cause") || !Cause.isCause(error.cause)) return
  const failure = Cause.squash(error.cause)
  return isSqlError(failure) ? failure : undefined
}

// Bun reports the result code as `errno`, Node as `errcode`.
const primaryCode = (reason: unknown) => {
  const cause = Predicate.hasProperty(reason, "cause") ? reason.cause : undefined
  const code = Predicate.hasProperty(cause, "errcode")
    ? cause.errcode
    : Predicate.hasProperty(cause, "errno")
      ? cause.errno
      : undefined
  return typeof code === "number" ? code & 0xff : undefined
}

const StateKey = "session.search"
const decodeState = Schema.decodeUnknownOption(State)
const decodeVersion = Schema.decodeUnknownOption(Schema.Struct({ version: Schema.Number }))

/** A state this version can't decode still reports its version, so a newer index is recognized. */
const readState = (db: DatabaseService) =>
  db
    .select({ value: KVTable.value })
    .from(KVTable)
    .where(eq(KVTable.key, StateKey))
    .get()
    .pipe(
      Effect.map((row) => {
        if (!row) return undefined
        return Option.getOrUndefined(decodeState(row.value)) ?? Option.getOrUndefined(decodeVersion(row.value))
      }),
    )

/** A state this version wrote and can read. */
export const current = (state: { readonly version: number } | undefined): state is State =>
  state?.version === Version && "status" in state

const writeState = (db: DatabaseService, state: State) => {
  const value = Schema.encodeSync(State)(state)
  return db
    .insert(KVTable)
    .values({ key: StateKey, value })
    .onConflictDoUpdate({ target: KVTable.key, set: { value, time_updated: Date.now() } })
    .run()
}

const update = (db: DatabaseService, change: (state: State) => State | undefined) =>
  immediate(
    db,
    Effect.gen(function* () {
      const state = yield* readState(db)
      const next = current(state) ? change(state) : undefined
      if (next) yield* writeState(db, next)
    }),
  )

/** The first message always fits, so a larger one still progresses. */
const budget = (rows: ReadonlyArray<{ id: string; bytes: number }>) => {
  const ids: string[] = []
  let bytes = 0
  for (const row of rows) {
    if (ids.length > 0 && bytes + row.bytes > MaxChunkBytes) break
    ids.push(row.id)
    bytes += row.bytes
  }
  return ids
}
