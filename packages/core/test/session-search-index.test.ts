import { describe, expect } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { DateTime, Effect, Exit, Layer, Schema, SchemaAST } from "effect"
import { and, eq, sql } from "drizzle-orm"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
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
import { SessionSearchQuery } from "@opencode/core/session/search-query"
import { SessionMessageTable, SessionPartTable, SessionTable } from "@opencode/core/session/sql"
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

const build = (db: Db, limit?: number) =>
  Effect.gen(function* () {
    while (!(yield* SessionSearchIndex.buildChunk(db, { limit })).done) {}
  })

/** Creates the index in `layout` and builds it. A `text` index stands in for an SQLite without contentless_delete. */
const index = (db: Db, layout: SessionSearchIndex.Layout = "compact") =>
  Effect.gen(function* () {
    if (layout === "text") yield* writeState(db, { layout })
    expect(yield* SessionSearchIndex.ensure(db)).toMatchObject({ status: "ready", state: { layout } })
    yield* build(db)
  })

const writeState = (db: Db, state: Partial<SessionSearchIndex.State>) =>
  Effect.gen(function* () {
    const value = {
      version: SessionSearchIndex.Version,
      layout: "compact",
      status: "building",
      phase: "titles",
      processed: 0,
      total: 0,
      skipped: 0,
      ...((yield* SessionSearchIndex.state(db)) ?? {}),
      ...state,
    }
    yield* db
      .insert(KVTable)
      .values({ key: "session.search", value })
      .onConflictDoUpdate({ target: KVTable.key, set: { value } })
      .run()
  })

const find = (db: Db, query: string) =>
  SessionSearchQuery.search(db, { query }).pipe(
    Effect.map((hits) => hits.map((hit) => hit.messageID ?? hit.sessionID).toSorted()),
  )

/** Sources with an index entry. */
const documents = (db: Db) =>
  db
    .all<{ source: string }>(
      sql`
      SELECT document.source_id AS source FROM session_search_document AS document
      JOIN session_search_docsize AS size ON size.id = document.id ORDER BY document.source_id
    `,
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.source)))

const triggers = (db: Db) =>
  db
    .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name GLOB 'session_search*'`)
    .pipe(Effect.map((rows) => rows.length))

/** Changes whenever anything is written to the FTS table, including deletes. */
const ftsWrites = (db: Db) =>
  db.get<{ segments: number; bytes: number }>(
    sql`SELECT count(*) AS segments, coalesce(sum(length(block)), 0) AS bytes FROM session_search_data`,
  )

describe("SessionSearchIndex", () => {
  it.effect("decides for every message type whether it is indexed", () =>
    Effect.sync(() => {
      // A new message type fails this until MessageTypes (and so the source view) says whether it is indexed.
      const tags = (ast: SchemaAST.AST): string[] => {
        if (SchemaAST.isUnion(ast)) return ast.types.flatMap(tags)
        const type = SchemaAST.isObjects(ast)
          ? ast.propertySignatures.find((field) => field.name === "type")
          : undefined
        return type && SchemaAST.isLiteral(type.type) ? [String(type.type.literal)] : []
      }
      const types = [...new Set(tags(SessionMessage.Info.ast))]
      expect(types.length).toBeGreaterThan(5)
      expect(Object.keys(SessionSearchIndex.MessageTypes).toSorted()).toEqual(types.toSorted())
    }),
  )

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
      yield* index(db)

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
      expect(yield* documents(db)).toEqual([id("01"), id("02"), id("03"), id("04"), sessionA])
    }),
  )

  for (const layout of ["compact", "text"] as const)
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
        yield* index(db, layout)
        expect(yield* find(db, "firstpart secondpart")).toEqual([id("a3")])

        // The triggers keep the index current in the same transaction as the write.
        yield* db
          .update(SessionPartTable)
          .set({ data: encodePart(text("editedpart")) })
          .where(and(eq(SessionPartTable.message_id, id("a3")), eq(SessionPartTable.ordinal, 2)))
          .run()
        yield* rewrite(db, user("a1", "rewritten alpha prompt"))
        yield* db.update(SessionTable).set({ title: "gamma title" }).where(eq(SessionTable.id, sessionA)).run()
        expect(yield* find(db, "first secondpart")).toEqual([])
        expect(yield* find(db, "rewritten editedpart")).toEqual([id("a1"), id("a3")])
        expect(yield* find(db, "alpha")).not.toContain(sessionA)
        expect(yield* find(db, "gamma")).toEqual([sessionA])

        // Revert deletes every message from the boundary on.
        yield* db
          .delete(SessionMessageTable)
          .where(and(eq(SessionMessageTable.session_id, sessionA), sql`${SessionMessageTable.seq} >= 2`))
          .run()
        expect(yield* find(db, "rewritten editedpart second")).toEqual([id("a1")])

        yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionA)).run()
        expect(yield* documents(db)).toEqual([id("b1"), sessionB])

        // Deleting a project cascades through its sessions and their messages.
        yield* db.delete(ProjectTable).run()
        expect(yield* documents(db)).toEqual([])
        expect(yield* find(db, "beta")).toEqual([])
        expect(yield* db.all(sql`SELECT * FROM session_search_queue`)).toEqual([])
      }),
    )

  it.effect("writes nothing to the index while an assistant streams, then indexes it once", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* index(db)
      yield* addMessages(db, sessionA, [assistant("1", [text("firstanswer")])])
      const before = yield* ftsWrites(db)
      // A retried step reopens its assistant; until it finishes again, search keeps the finished text.
      const parts: SessionMessage.AssistantContent[] = []
      for (let event = 0; event < 6; event++) {
        parts.push(event % 2 === 0 ? text(`partial${event}`) : tool(`call_${event}`, `output${event}`))
        yield* rewrite(db, assistant("1", parts, false))
      }
      // With part rows the envelope stays unfinished while parts stream in.
      yield* addMessages(db, sessionA, [assistant("2", [], false)], 2)
      yield* addParts(db, id("2"), [text("streamedpart")])
      expect(yield* ftsWrites(db)).toEqual(before)
      expect(yield* find(db, "firstanswer")).toEqual([id("1")])

      yield* rewrite(db, assistant("1", parts))
      yield* rewrite(db, assistant("2", []))
      expect(yield* find(db, "partial0 partial4 streamedpart")).toEqual([id("1"), id("2")])
      expect(yield* find(db, "firstanswer output1")).toEqual([])
    }),
  )

  it.effect("accepts malformed rows and parts without failing the write or indexing them", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* index(db)
      yield* db.run(sql`
        INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
        VALUES (${id("1")}, ${sessionA}, 'user', 1, 1000, 1000, 'not json'),
          (${id("2")}, ${sessionA}, 'user', 2, 1000, 1000, '["an array"]'),
          (${id("3")}, ${sessionA}, 'assistant', 3, 1000, 1000, 'not json either'),
          (${id("4")}, ${sessionA}, 'assistant', 4, 1000, 1000, ${JSON.stringify({
            agent: Agent.defaultID,
            model,
            content: ["bare string", 7, null, { type: "text", text: "inlinesurvivor" }],
            time: { created: 1_000, completed: 1_000 },
          })})
      `)
      yield* db.run(sql`
        INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data)
        VALUES (${id("4")}, ${sessionA}, 0, 'text', NULL, 1, 1, 'not json'),
          (${id("4")}, ${sessionA}, 1, 'text', NULL, 1, 1, ${JSON.stringify({ type: "text", text: "partsurvivor" })}),
          (${id("3")}, ${sessionA}, 0, 'text', NULL, 1, 1, ${JSON.stringify({ type: "text", text: "orphanpart" })})
      `)
      expect(yield* find(db, "inlinesurvivor partsurvivor")).toEqual([id("4")])
      expect(yield* find(db, "bare string array json orphanpart")).toEqual([])
      // The build reads the same rows the same way.
      yield* writeState(db, { status: "building", phase: "titles", after: undefined })
      yield* build(db)
      expect(yield* documents(db)).toEqual([id("4")])
    }),
  )

  it.effect("builds newest first in byte-capped chunks and resumes from the cursor after a rollback", () =>
    Effect.gen(function* () {
      const large = "x".repeat(SessionSearchIndex.MaxChunkBytes * 0.6)
      const db = yield* database()
      yield* addSession(db, sessionA, "puffin colony")
      yield* addMessages(db, sessionA, [
        user("1", `gannet ${large}`),
        user("2", `skua ${large}`),
        SessionMessage.Synthetic.make({ id: id("3"), type: "synthetic", text: large, time: { created } }),
        user("4", "tern"),
      ])
      expect(yield* SessionSearchIndex.ensure(db)).toMatchObject({ status: "ready", state: { total: 5 } })
      // Titles first.
      expect(yield* SessionSearchIndex.buildChunk(db)).toEqual({ done: false })
      expect(yield* find(db, "puffin")).toEqual([sessionA])
      // Newest first: the small message, the unindexed one (no bytes) and one large one fit; the next goes alone.
      expect(yield* SessionSearchIndex.buildChunk(db)).toEqual({ done: false })
      expect(yield* find(db, "tern skua gannet")).toEqual([id("2"), id("4")])

      // A chunk that fails rolls back with its cursor, so the next run starts from the same row.
      yield* db.run(
        "CREATE TRIGGER fail_queue BEFORE INSERT ON session_search_queue BEGIN SELECT RAISE(ABORT, 'induced'); END",
      )
      expect(Exit.isFailure(yield* SessionSearchIndex.buildChunk(db).pipe(Effect.exit))).toBe(true)
      yield* db.run("DROP TRIGGER fail_queue")
      expect(yield* SessionSearchIndex.buildChunk(db)).toEqual({ done: true })
      expect(yield* find(db, "gannet")).toEqual([id("1")])
      expect(yield* SessionSearchIndex.state(db)).toMatchObject({ status: "done", processed: 5, total: 5, skipped: 0 })
      // Done stays done.
      expect(yield* SessionSearchIndex.ensure(db)).toMatchObject({ status: "ready", state: { status: "done" } })
      expect(yield* SessionSearchIndex.buildChunk(db)).toEqual({ done: true })
    }),
  )

  it.effect("rebuilds an index from an older version and leaves a newer version's alone", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* addMessages(db, sessionA, [user("1", "kept prompt")])
      yield* index(db)

      yield* writeState(db, { version: SessionSearchIndex.Version - 1 })
      expect(yield* SessionSearchIndex.check(db)).toEqual({ status: "absent" })
      expect(yield* SessionSearchIndex.ensure(db)).toMatchObject({ status: "ready", state: { status: "building" } })
      expect(yield* documents(db)).toEqual([])
      yield* build(db)
      expect(yield* find(db, "kept")).toEqual([id("1")])

      yield* writeState(db, { version: SessionSearchIndex.Version + 1 })
      yield* db.run("DROP TRIGGER session_search_message_insert")
      expect(yield* SessionSearchIndex.ensure(db)).toEqual({ status: "newer" })
      expect(yield* SessionSearchIndex.check(db)).toEqual({ status: "newer" })
      expect(yield* SessionSearchIndex.buildChunk(db)).toEqual({ done: true })
      expect(yield* find(db, "kept")).toEqual([id("1")])
    }),
  )

  it.effect("drops the triggers on an SQLite that can't run them, so writes keep working, and rebuilds later", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* addMessages(db, sessionA, [user("1", "before the move")])
      yield* index(db)
      // Stands in for an FTS table this SQLite can't open (no FTS5, or compact on SQLite before 3.43). Legacy renames
      // leave the triggers pointing at it.
      yield* db.run("PRAGMA legacy_alter_table = ON")
      yield* db.run("ALTER TABLE session_search RENAME TO session_search_moved")
      yield* db.run(`CREATE VIEW session_search AS SELECT json_extract('not json', '$') AS rowid`)
      expect(Exit.isFailure(yield* addMessages(db, sessionA, [user("2", "fails")], 2).pipe(Effect.exit))).toBe(true)

      // Opening the database runs the registered check after migrations.
      yield* Database.Service.pipe(Effect.provide(Database.layerFromClient))
      expect(yield* triggers(db)).toBe(0)
      yield* addMessages(db, sessionA, [user("2", "written while off")], 2)
      expect(yield* SessionSearchIndex.check(db)).toMatchObject({ status: "unsupported", dropped: false })

      // Back on a capable SQLite, the missed writes are covered by a rebuild.
      yield* db.run("DROP VIEW session_search")
      yield* db.run("ALTER TABLE session_search_moved RENAME TO session_search")
      yield* db.run("PRAGMA legacy_alter_table = OFF")
      expect(yield* SessionSearchIndex.check(db)).toMatchObject({ status: "ready", state: { status: "building" } })
      yield* build(db)
      expect(yield* find(db, "before written")).toEqual([id("1"), id("2")])
    }),
  )

  it.effect("keeps its triggers across every migration since the index exists", () =>
    Effect.gen(function* () {
      // The index needs session_part, so it can exist from that migration on; every later one runs over it.
      const first = migrations.findIndex((migration) => migration.id.endsWith("_session_part")) + 1
      const db = yield* database((db) => DatabaseMigration.applyOnly(db, migrations.slice(0, first)))
      // Columns as of that migration.
      yield* db.run(sql`
        INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES (${sessionA}, ${Project.ID.global}, 's', '/project', 'migrated title', 'test', 1, 1)
      `)
      yield* db.run(sql`
        INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
        VALUES (${id("1")}, ${sessionA}, 'user', 1, 1, 1, ${JSON.stringify({ text: "migrated prompt", time: { created: 1 } })})
      `)
      yield* index(db)
      yield* DatabaseMigration.applyOnly(db, migrations)
      expect(yield* SessionSearchIndex.check(db)).toMatchObject({ status: "ready", state: { status: "done" } })

      // A migration that rebuilds a source table drops its triggers; check restores them and rebuilds.
      yield* db.run("PRAGMA foreign_keys = OFF")
      yield* db.run("CREATE TABLE __new_session_message AS SELECT * FROM session_message")
      yield* db.run("DROP TABLE session_message")
      yield* db.run("ALTER TABLE __new_session_message RENAME TO session_message")
      yield* addMessages(db, sessionA, [user("2", "unqueued prompt")], 2)
      expect(yield* SessionSearchIndex.check(db)).toMatchObject({ status: "ready", state: { status: "building" } })
      yield* build(db)
      yield* addMessages(db, sessionA, [user("3", "queued prompt")], 3)
      expect(yield* find(db, "migrated unqueued queued")).toEqual([id("1"), id("2"), id("3"), sessionA])
    }),
  )

  it.effect("matches any word, and indexes only the start of long text", () =>
    Effect.gen(function* () {
      const filler = "lorem ".repeat(SessionSearchIndex.MaxText / 6)
      const db = yield* database()
      yield* addSession(db, sessionA, null)
      yield* index(db)
      yield* addMessages(db, sessionA, [
        user("1", "decodeMessageRow throws on legacy rows"),
        user("2", "unrelated quokka"),
        user("3", `pelican ${filler} albatross`),
        assistant("4", [text(`heron ${filler}`), text("cormorant")]),
      ])

      expect(yield* find(db, "zebra quokka")).toEqual([id("2")])
      expect(yield* find(db, 'GLM-5.3 OR "rows" NEAR(')).toEqual([id("1")])
      expect(yield* find(db, "  -- ")).toEqual([])
      expect(yield* find(db, "pelican heron")).toEqual([id("3"), id("4")])
      expect(yield* find(db, "albatross cormorant")).toEqual([])
    }),
  )
})
