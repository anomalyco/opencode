import { describe, expect } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { DateTime, Effect, Exit, Layer, Schema } from "effect"
import { and, eq, sql } from "drizzle-orm"
import { Agent } from "@opencode/core/agent"
import { DatabaseMigration } from "@opencode/core/database/migration"
import { migrations } from "@opencode/core/database/migration.gen"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { KVTable } from "@opencode/core/kv/sql"
import { Model } from "@opencode/core/model"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSearchIndex } from "@opencode/core/session/search-index"
import { SessionSearchText } from "@opencode/core/session/search-text"
import {
  SessionMessageTable,
  SessionPartTable,
  SessionSearchDirtyTable,
  SessionSearchDocumentTable,
  SessionSearchTextTable,
  SessionTable,
} from "@opencode/core/session/sql"
import { SessionID } from "@opencode/schema/session-id"
import { Skill } from "@opencode/schema/skill"
import { Global } from "@opencode/util/global"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.mergeAll(
    SqliteClient.layer({ filename: ":memory:", disableWAL: true }),
    Layer.succeed(Global.Service, Global.make({ data: "/nonexistent/opencode-session-search" })),
  ),
)

type Db = Effect.Success<ReturnType<typeof EffectDrizzleSqlite.makeWithDefaults>>

const created = DateTime.makeUnsafe(1_000)
const encode = Schema.encodeSync(SessionMessage.Info)
const encodePart = Schema.encodeSync(SessionMessage.AssistantContent)
const sessionA = SessionID.make("ses_search_a")
const sessionB = SessionID.make("ses_search_b")
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }
const large = "x".repeat(SessionSearchIndex.MaxBatchBytes * 0.6)

const user = (value: string, text: string) =>
  SessionMessage.User.make({ id: id(value), type: "user", text, time: { created } })
const assistant = (value: string, content: SessionMessage.AssistantContent[], completed = true) =>
  SessionMessage.Assistant.make({
    id: id(value),
    type: "assistant",
    agent: Agent.defaultID,
    model,
    content,
    time: completed ? { created, completed: created } : { created },
  })
const text = (value: string) => SessionMessage.AssistantText.make({ type: "text", text: value })
const tool = (callID: string, output: string) =>
  SessionMessage.AssistantTool.make({
    type: "tool",
    id: callID,
    name: "bash",
    state: SessionMessage.ToolStateCompleted.make({
      status: "completed",
      input: { command: `${output}input` },
      content: [{ type: "text", text: output }],
    }),
    time: { created },
  })

/** Migrated with a project; the index is created by the first `ensure`, so rows written before it are backfilled. */
const database = (migrate: (db: Db) => Effect.Effect<unknown, unknown, Global.Service> = DatabaseMigration.apply) =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* migrate(db)
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    return db
  })

const addSession = (db: Db, sessionID: SessionID, title: string | null) =>
  db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: Project.ID.global, slug: "s", directory: "/project", title, version: "test" })
    .run()

const addMessages = (db: Db, sessionID: SessionID, messages: SessionMessage.Info[], from = 1) =>
  Effect.forEach(messages, (message, index) => {
    const { id: _, type, ...data } = encode(message)
    return db
      .insert(SessionMessageTable)
      .values({ id: message.id, session_id: sessionID, type, seq: from + index, time_created: 1_000, data })
      .run()
  })

const addParts = (db: Db, messageID: SessionMessage.ID, parts: SessionMessage.AssistantContent[]) =>
  db
    .insert(SessionPartTable)
    .values(
      parts.map((part, ordinal) => ({
        message_id: messageID,
        session_id: sessionA,
        ordinal,
        type: part.type,
        call_id: part.type === "tool" ? part.id : null,
        time_created: 1,
        time_updated: 1,
        data: encodePart(part),
      })),
    )
    .run()

const rewrite = (db: Db, message: SessionMessage.Info) => {
  const { id: _, type, ...data } = encode(message)
  return db.update(SessionMessageTable).set({ type, data }).where(eq(SessionMessageTable.id, message.id)).run()
}

/** Changes whenever anything is written to the FTS table, including deletes. */
const ftsWrites = (db: Db) =>
  db.get<{ segments: number; bytes: number }>(
    sql`SELECT count(*) AS segments, coalesce(sum(length(block)), 0) AS bytes FROM session_search_data`,
  )

const drain = (db: Db) =>
  Effect.gen(function* () {
    while ((yield* SessionSearchIndex.processBatch(db, 2)) > 0) {}
  })

const backfill = (db: Db) =>
  Effect.gen(function* () {
    while (!(yield* SessionSearchIndex.backfillBatch(db, 2)).done) {}
  })

const sync = (db: Db) =>
  Effect.gen(function* () {
    yield* SessionSearchIndex.ensure(db)
    yield* backfill(db)
    yield* drain(db)
  })

/**
 * Starts the index in `layout`. An existing index keeps its layout, so a `text` index built here stands in for an
 * SQLite without contentless_delete, which picks that layout itself.
 */
const startIn = (db: Db, layout: SessionSearchIndex.Layout) =>
  layout === "compact"
    ? Effect.void
    : Effect.gen(function* () {
        yield* db.run(
          "CREATE VIRTUAL TABLE session_search USING fts5(title, summary, user_text, assistant_text, content='', tokenize='porter unicode61 remove_diacritics 2')",
        )
        yield* db
          .insert(KVTable)
          .values({ key: "session.search", value: { version: SessionSearchIndex.Version, layout, backfill: "titles" } })
          .run()
      })

const find = (db: Db, query: string) =>
  SessionSearchIndex.search(db, { query }).pipe(
    Effect.map((hits) => hits.map((hit) => hit.messageID ?? hit.sessionID).toSorted()),
  )

const sources = (db: Db) =>
  db
    .select({ source: SessionSearchDocumentTable.source_id })
    .from(SessionSearchDocumentTable)
    .orderBy(SessionSearchDocumentTable.source_id)
    .all()
    .pipe(Effect.map((rows) => rows.map((row) => row.source)))

const setVersion = (db: Db, version: number) =>
  db
    .update(KVTable)
    .set({ value: { version, layout: "compact", backfill: "done" } })
    .where(eq(KVTable.key, "session.search"))
    .run()

describe("SessionSearchIndex", () => {
  it.effect("indexes the title once, user text, finished assistant text and completed summaries only", () =>
    Effect.gen(function* () {
      const db = yield* database()
      const compaction = { type: "compaction", reason: "auto", time: { created } } as const
      yield* addSession(db, sessionA, "Titleword session")
      yield* addMessages(db, sessionA, [
        SessionMessage.User.make({
          id: id("01"),
          type: "user",
          text: "userword",
          files: [{ data: "", mime: "text/plain", source: { type: "inline" }, name: "attachmentword.txt" }],
          time: { created },
        }),
        assistant("02", [
          SessionMessage.AssistantReasoning.make({ type: "reasoning", text: "reasoningword" }),
          tool("call_1", "toolword"),
          text("assistantword"),
        ]),
        assistant("03", [text("inlineword")]),
        SessionMessage.CompactionCompleted.make({
          ...compaction,
          id: id("04"),
          status: "completed",
          summary: "summaryword",
        }),
        SessionMessage.CompactionRunning.make({ ...compaction, id: id("05"), status: "running", summary: "draftword" }),
        SessionMessage.CompactionFailed.make({
          ...compaction,
          id: id("06"),
          status: "failed",
          error: { type: "unknown", message: "failedword" },
        }),
        SessionMessage.Synthetic.make({ id: id("07"), type: "synthetic", text: "syntheticword", time: { created } }),
        SessionMessage.System.make({ id: id("08"), type: "system", text: "systemword", time: { created } }),
        SessionMessage.Skill.make({
          id: id("09"),
          type: "skill",
          skill: Skill.ID.make("skillword"),
          name: Skill.Name.make("skillword"),
          text: "skillword",
          time: { created },
        }),
      ])
      // Part rows and inline content left in the same message are both read.
      yield* addParts(db, id("03"), [text("partword"), tool("call_2", "parttool")])
      yield* sync(db)

      expect(yield* find(db, "titleword")).toEqual([sessionA])
      expect(yield* find(db, "userword")).toEqual([id("01")])
      expect(yield* find(db, "assistantword")).toEqual([id("02")])
      expect(yield* find(db, "inlineword partword")).toEqual([id("03")])
      expect(yield* find(db, "summaryword")).toEqual([id("04")])
      expect(
        yield* find(
          db,
          "attachmentword reasoningword toolword toolwordinput bash parttool draftword failedword syntheticword systemword skillword",
        ),
      ).toEqual([])
      expect(yield* sources(db)).toEqual([id("01"), id("02"), id("03"), id("04"), sessionA])
    }),
  )

  for (const layout of ["compact", "text"] as const) {
    it.effect(`follows part edits, updates, renames, reverts and cascading deletes (${layout} layout)`, () =>
      Effect.gen(function* () {
        const db = yield* database()
        yield* addSession(db, sessionA, "alpha title")
        yield* addSession(db, sessionB, "beta title")
        // A newer release keeps the parts in session_part and leaves an empty envelope.
        yield* addMessages(db, sessionA, [
          user("a1", "first alpha prompt"),
          user("a2", "second alpha prompt"),
          assistant("a3", []),
        ])
        yield* addParts(db, id("a3"), [text("firstpart"), tool("call_1", "parttool"), text("secondpart")])
        yield* addMessages(db, sessionB, [user("b1", "beta prompt")])
        yield* startIn(db, layout)
        yield* sync(db)
        expect((yield* SessionSearchIndex.status(db)).layout).toBe(layout)
        expect(yield* find(db, "firstpart secondpart")).toEqual([id("a3")])

        yield* db
          .update(SessionPartTable)
          .set({ data: encodePart(text("editedpart")) })
          .where(and(eq(SessionPartTable.message_id, id("a3")), eq(SessionPartTable.ordinal, 2)))
          .run()
        yield* rewrite(db, user("a1", "rewritten alpha prompt"))
        yield* db.update(SessionTable).set({ title: "gamma title" }).where(eq(SessionTable.id, sessionA)).run()
        yield* drain(db)
        expect(yield* find(db, "first secondpart")).toEqual([])
        expect(yield* find(db, "rewritten editedpart")).toEqual([id("a1"), id("a3")])
        expect(yield* find(db, "alpha")).not.toContain(sessionA)
        expect(yield* find(db, "gamma")).toEqual([sessionA])

        // Revert deletes every message from the boundary on; search hides them before the queue is processed.
        yield* db
          .delete(SessionMessageTable)
          .where(and(eq(SessionMessageTable.session_id, sessionA), sql`${SessionMessageTable.seq} >= 2`))
          .run()
        expect(yield* find(db, "second editedpart")).toEqual([])
        yield* drain(db)
        expect(yield* find(db, "rewritten editedpart")).toEqual([id("a1")])

        yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionA)).run()
        yield* drain(db)
        expect(yield* sources(db)).toEqual([id("b1"), sessionB])

        // Deleting a project cascades through its sessions and their messages.
        yield* db.delete(ProjectTable).run()
        yield* drain(db)
        expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 0, documents: 0 })
        expect(yield* find(db, "beta")).toEqual([])
      }),
    )

    it.effect(`removes a long deleted session across several batches (${layout} layout)`, () =>
      Effect.gen(function* () {
        const db = yield* database()
        yield* addSession(db, sessionA, "long session")
        yield* addMessages(
          db,
          sessionA,
          Array.from({ length: 205 }, (_, index) => user(`${index}`, `prompt number ${index}`)),
        )
        yield* startIn(db, layout)
        yield* sync(db)
        // Without the cascade only the session is queued, so its one queue entry removes every entry of the session.
        yield* db.run("PRAGMA foreign_keys = OFF")
        yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionA)).run()
        // One batch removes at most 200 entries and keeps the session queued.
        yield* SessionSearchIndex.processBatch(db)
        expect(yield* SessionSearchIndex.status(db)).toMatchObject({ documents: 6, pending: 1 })
        yield* drain(db)
        expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 0, documents: 0 })
        expect(yield* db.select().from(SessionSearchTextTable).all()).toEqual([])
        expect(yield* find(db, "prompt")).toEqual([])
      }),
    )
  }

  it.effect("backfills newest first and caps the stored bytes of each backfill and queue batch", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* addMessages(db, sessionA, [
        user("1", `puffin ${large}`),
        user("2", `gannet ${large}`),
        assistant("3", [text("inflight")], false),
        user("4", "tern"),
      ])
      yield* SessionSearchIndex.ensure(db)
      // Titles first: the session has none.
      expect(yield* SessionSearchIndex.backfillBatch(db)).toEqual({ indexed: 1, done: false })
      // Newest first: the two small messages and the next large one fit together, the last large one goes alone.
      // The streaming assistant is passed without being queued.
      expect(yield* SessionSearchIndex.backfillBatch(db)).toEqual({ indexed: 3, done: false })
      expect(yield* find(db, "puffin gannet tern")).toEqual([id("2"), id("4")])
      expect(yield* SessionSearchIndex.backfillBatch(db)).toEqual({ indexed: 1, done: true })
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ backfill: "done", pending: 0, documents: 3 })
      expect(yield* find(db, "inflight")).toEqual([])

      yield* rewrite(db, assistant("3", [text("inflight")]))
      yield* addMessages(db, sessionA, [user("5", `shearwater ${large}`), user("6", `skua ${large}`)], 5)
      yield* SessionSearchIndex.processBatch(db)
      expect((yield* SessionSearchIndex.status(db)).pending).toBe(1)
      yield* drain(db)
      expect(yield* find(db, "inflight shearwater skua")).toEqual([id("3"), id("5"), id("6")])
    }),
  )

  it.effect("writes nothing to the index while an assistant streams, then indexes it once", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* addMessages(db, sessionA, [assistant("1", [text("firstanswer")])])
      yield* sync(db)
      const before = yield* ftsWrites(db)
      // A retried step reopens its assistant; until it finishes again, search keeps the finished text.
      const parts: SessionMessage.AssistantContent[] = []
      for (let event = 0; event < 6; event++) {
        parts.push(event % 2 === 0 ? text(`partial${event}`) : tool(`call_${event}`, `output${event}`))
        yield* rewrite(db, assistant("1", parts, false))
        // Each poll dequeues the streaming assistant without indexing it, so it never holds the queue.
        expect(yield* SessionSearchIndex.processBatch(db)).toBe(1)
        expect(yield* SessionSearchIndex.processBatch(db)).toBe(0)
      }
      expect(yield* ftsWrites(db)).toEqual(before)
      expect(yield* find(db, "firstanswer")).toEqual([id("1")])

      yield* rewrite(db, assistant("1", parts))
      expect(yield* SessionSearchIndex.processBatch(db)).toBe(1)
      expect(yield* find(db, "partial0 partial4")).toEqual([id("1")])
      expect(yield* find(db, "firstanswer output1")).toEqual([])
    }),
  )

  it.effect("skips malformed rows and parts without blocking the queue or the backfill", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* sync(db)
      yield* db.run(sql`
        INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
        VALUES (${id("1")}, ${sessionA}, 'user', 1, 1000, 1000, 'not json'),
          (${id("2")}, ${sessionA}, 'user', 2, 1000, 1000, '["an array"]'),
          (${id("3")}, ${sessionA}, 'assistant', 3, 1000, 1000, ${JSON.stringify({
            agent: Agent.defaultID,
            model,
            content: ["bare string", 7, null, { type: "text", text: "inlinesurvivor" }],
            time: { created: 1_000, completed: 1_000 },
          })})
      `)
      yield* addMessages(db, sessionA, [assistant("4", []), user("5", "healthy prompt")], 4)
      yield* db.run(sql`
        INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data)
        VALUES (${id("4")}, ${sessionA}, 0, 'text', NULL, 1, 1, 'not json'),
          (${id("4")}, ${sessionA}, 1, 'text', NULL, 1, 1, ${JSON.stringify({ type: "text", text: "partsurvivor" })})
      `)

      yield* drain(db)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 0, documents: 3 })
      expect(yield* find(db, "inlinesurvivor partsurvivor healthy")).toEqual([id("3"), id("4"), id("5")])
      expect(yield* find(db, "bare string array json")).toEqual([])

      yield* setVersion(db, SessionSearchIndex.Version - 1)
      yield* sync(db)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ backfill: "done", pending: 0, documents: 3 })
    }),
  )

  it.effect("builds once, and rebuilds when a trigger is missing or the version is older", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* addMessages(db, sessionA, [user("1", "kept prompt")])
      expect(yield* SessionSearchIndex.ensure(db)).toEqual({ supported: true, rebuilt: true, layout: "compact" })
      expect(yield* SessionSearchIndex.ensure(db)).toEqual({ supported: true, rebuilt: false, layout: "compact" })
      yield* backfill(db)

      // A migration that rebuilds a source table drops its triggers; writes meanwhile were never queued.
      yield* db.run("DROP TRIGGER session_search_message_insert")
      yield* addMessages(db, sessionA, [user("2", "unqueued prompt")], 2)
      expect((yield* SessionSearchIndex.status(db)).pending).toBe(0)
      expect(yield* SessionSearchIndex.ensure(db)).toEqual({ supported: true, rebuilt: true, layout: "compact" })
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ backfill: "titles", documents: 0 })
      yield* backfill(db)
      expect(yield* find(db, "kept unqueued")).toEqual([id("1"), id("2")])

      yield* setVersion(db, SessionSearchIndex.Version - 1)
      expect(yield* SessionSearchIndex.ensure(db)).toEqual({ supported: true, rebuilt: true, layout: "compact" })
      expect((yield* SessionSearchIndex.status(db)).version).toBe(SessionSearchIndex.Version)
    }),
  )

  it.effect("leaves an index built by a newer version alone", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* addMessages(db, sessionA, [user("1", "kept prompt")])
      yield* sync(db)
      yield* setVersion(db, SessionSearchIndex.Version + 1)
      yield* addMessages(db, sessionA, [user("2", "queued for the newer version")], 2)

      expect(yield* SessionSearchIndex.ensure(db)).toMatchObject({ supported: false })
      expect(yield* SessionSearchIndex.processBatch(db)).toBe(0)
      expect(yield* SessionSearchIndex.backfillBatch(db)).toEqual({ indexed: 0, done: true })
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 1, documents: 1 })
      expect(yield* find(db, "kept")).toEqual([id("1")])
    }),
  )

  it.effect("keeps queued sources when a batch rolls back", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* sync(db)
      yield* addMessages(db, sessionA, [user("1", "durable prompt"), user("2", "another prompt")])

      // Fail the batch's last statement, the dequeue, after both entries were written.
      const before = yield* ftsWrites(db)
      yield* db.run(
        "CREATE TRIGGER fail_dequeue BEFORE DELETE ON session_search_dirty BEGIN SELECT RAISE(ABORT, 'induced'); END",
      )
      expect(Exit.isFailure(yield* SessionSearchIndex.processBatch(db).pipe(Effect.exit))).toBe(true)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 2, documents: 0 })
      expect(yield* ftsWrites(db)).toEqual(before)
      yield* db.run("DROP TRIGGER fail_dequeue")

      yield* drain(db)
      expect(yield* find(db, "durable another")).toEqual([id("1"), id("2")])
    }),
  )

  it.effect("matches any word and identifier subwords, and indexes only the start of long text", () =>
    Effect.gen(function* () {
      const filler = "lorem ".repeat(SessionSearchText.MaxText / 6)
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* addMessages(db, sessionA, [
        user("1", "decodeMessageRow throws on legacy rows"),
        user("2", "unrelated quokka"),
        user("3", `pelican ${filler} albatross`),
        assistant("4", [text(`heron ${filler}`), text("cormorant")]),
      ])
      yield* sync(db)

      expect(yield* find(db, "message")).toEqual([id("1")])
      expect(yield* find(db, "zebra quokka")).toEqual([id("2")])
      expect(yield* find(db, 'GLM-5.3 OR "rows" NEAR(')).toEqual([id("1")])
      expect(yield* find(db, "  -- ")).toEqual([])
      expect(yield* find(db, "pelican heron")).toEqual([id("3"), id("4")])
      expect(yield* find(db, "albatross cormorant")).toEqual([])
    }),
  )

  it.effect("upgrades a database created before the index", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        DatabaseMigration.applyOnly(
          db,
          migrations.filter((migration) => !migration.id.endsWith("_session_search")),
        ),
      )
      expect(yield* db.all(sql`SELECT name FROM sqlite_master WHERE name LIKE 'session_search%'`)).toEqual([])
      yield* addSession(db, sessionA, "Upgraded title")
      yield* addMessages(db, sessionA, [user("1", "written long before")])

      yield* DatabaseMigration.apply(db)
      expect(yield* db.select().from(SessionSearchDirtyTable).all()).toEqual([])
      yield* sync(db)
      expect(yield* find(db, "upgraded")).toEqual([sessionA])
      expect(yield* find(db, "before")).toEqual([id("1")])
    }),
  )
})
