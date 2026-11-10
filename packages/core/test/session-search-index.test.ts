import { describe, expect } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { DateTime, Effect, Exit, Layer, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionProjector } from "@opencode/core/session/projector"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Money } from "@opencode/schema/money"
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

const projected = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node])))

type Db = Effect.Success<ReturnType<typeof EffectDrizzleSqlite.makeWithDefaults>>

const created = DateTime.makeUnsafe(1_000)
const encode = Schema.encodeSync(SessionMessage.Info)
const sessionA = SessionID.make("ses_search_a")
const sessionB = SessionID.make("ses_search_b")
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }

const user = (value: string, text: string) =>
  SessionMessage.User.make({ id: id(value), type: "user", text, time: { created } })
const assistant = (value: string, content: SessionMessage.AssistantContent[]) =>
  SessionMessage.Assistant.make({
    id: id(value),
    type: "assistant",
    agent: Agent.defaultID,
    model,
    content,
    time: { created, completed: created },
  })
/** An assistant whose step has not ended yet. */
const streaming = (value: string, content: SessionMessage.AssistantContent[]) =>
  SessionMessage.Assistant.make({
    id: id(value),
    type: "assistant",
    agent: Agent.defaultID,
    model,
    content,
    time: { created },
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

const database = (setup?: (db: Db) => Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* DatabaseMigration.apply(db)
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    if (setup) yield* setup(db)
    return db
  })

const addSession = (db: Db, sessionID: SessionID, title: string | null) =>
  db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: Project.ID.global, slug: "s", directory: "/project", title, version: "test" })
    .run()

const addMessage = (db: Db, sessionID: SessionID, seq: number, message: SessionMessage.Info) => {
  const { id: _, type, ...data } = encode(message)
  return db
    .insert(SessionMessageTable)
    .values({ id: message.id, session_id: sessionID, type, seq, time_created: DateTime.toEpochMillis(created), data })
    .run()
}

const rewrite = (db: Db, message: SessionMessage.Info) => {
  const { id: _, type, ...data } = encode(message)
  return db.update(SessionMessageTable).set({ type, data }).where(eq(SessionMessageTable.id, message.id)).run()
}

/** Changes whenever anything is written to the FTS table, including deletes. */
const ftsWrites = (db: Db) =>
  db.get<{ segments: number; bytes: number }>(
    sql`SELECT count(*) AS segments, coalesce(sum(length(block)), 0) AS bytes FROM session_search_data`,
  )

// How a binary that predates the index writes: plain SQL, no knowledge of the queue.
const oldWriter = (db: Db, sessionID: SessionID, seq: number, message: SessionMessage.Info) => {
  const { id, type, ...data } = encode(message)
  return db.run(sql`
    INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
    VALUES (${id}, ${sessionID}, ${type}, ${seq}, 1000, 1000, ${JSON.stringify(data)})
  `)
}

const drain = (db: Db) =>
  Effect.gen(function* () {
    let processed = 1
    while (processed > 0) processed = yield* SessionSearchIndex.processBatch(db, 2)
  })

const backfill = (db: Db) =>
  Effect.gen(function* () {
    let done = false
    while (!done) done = (yield* SessionSearchIndex.backfillBatch(db, 2)).done
  })

/** Ensures, backfills and drains, so the index matches the sources. */
const sync = (db: Db) =>
  Effect.gen(function* () {
    yield* SessionSearchIndex.ensure(db)
    yield* backfill(db)
    yield* drain(db)
  })

const find = (db: Db, query: string) =>
  SessionSearchIndex.search(db, { query }).pipe(Effect.map((hits) => hits.map((hit) => hit.messageID ?? hit.sessionID)))

const documentIDs = (db: Db) =>
  db
    .select({ id: SessionSearchDocumentTable.id, source: SessionSearchDocumentTable.source_id })
    .from(SessionSearchDocumentTable)
    .orderBy(SessionSearchDocumentTable.source_id)
    .all()

describe("SessionSearchIndex", () => {
  it.effect("reports support and builds the index once", () =>
    Effect.gen(function* () {
      const db = yield* database()
      expect(yield* SessionSearchIndex.ensure(db)).toEqual({ supported: true, rebuilt: true })
      // On a current index the check only reads: the schema, which every connection caches, stays as it was.
      const schemaVersion = db.get<{ schema_version: number }>(sql`PRAGMA schema_version`)
      const before = yield* schemaVersion
      expect(yield* SessionSearchIndex.ensure(db)).toEqual({ supported: true, rebuilt: false })
      expect(yield* schemaVersion).toEqual(before)
      expect(yield* SessionSearchIndex.status(db)).toEqual({
        version: SessionSearchIndex.Version,
        backfill: "titles",
        pending: 0,
        documents: 0,
      })
    }),
  )

  it.effect("indexes only the start of very long text", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* sync(db)
      yield* db.run(sql`
        INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES (${sessionA}, ${Project.ID.global}, 's', '/project', 'Pasted logs', 'old', 1, 1)
      `)
      const filler = "lorem ".repeat(SessionSearchText.MaxText / 6)
      yield* oldWriter(db, sessionA, 1, user("1", `pelican ${filler} albatross`))
      yield* oldWriter(db, sessionA, 2, assistant("2", [text(`heron ${filler}`), text("cormorant")]))
      yield* drain(db)
      expect(yield* find(db, "pelican")).toEqual([id("1")])
      expect(yield* find(db, "heron")).toEqual([id("2")])
      expect(yield* find(db, "albatross")).toEqual([])
      expect(yield* find(db, "cormorant")).toEqual([])
    }),
  )

  it.effect("splits a backfill of large messages by stored size", () =>
    Effect.gen(function* () {
      const large = "x".repeat(SessionSearchIndex.MaxBatchBytes * 0.6)
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, null)
          yield* oldWriter(db, sessionA, 1, user("1", `puffin ${large}`))
          yield* oldWriter(db, sessionA, 2, user("2", `gannet ${large}`))
          yield* oldWriter(db, sessionA, 3, user("3", "tern"))
        }),
      )
      yield* SessionSearchIndex.ensure(db)
      // Titles first: the session has none.
      expect(yield* SessionSearchIndex.backfillBatch(db)).toEqual({ indexed: 1, done: false })
      // Newest first: the small message and the next large one fit together, the last large one goes alone.
      expect(yield* SessionSearchIndex.backfillBatch(db)).toEqual({ indexed: 2, done: false })
      expect(yield* SessionSearchIndex.backfillBatch(db)).toEqual({ indexed: 1, done: true })
      expect((yield* find(db, "puffin gannet tern")).toSorted()).toEqual([id("1"), id("2"), id("3")])
    }),
  )

  it.effect("queues writes from a binary that does not know the index", () =>
    Effect.gen(function* () {
      const db = yield* database()
      yield* sync(db)
      yield* db.run(sql`
        INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES (${sessionA}, ${Project.ID.global}, 's', '/project', 'Flaky websocket reconnect', 'old', 1, 1)
      `)
      yield* oldWriter(db, sessionA, 1, user("1", "the reconnect loop spins forever"))
      yield* oldWriter(db, sessionA, 2, assistant("2", [text("backoff was never reset")]))

      expect((yield* SessionSearchIndex.status(db)).pending).toBe(3)
      expect(yield* find(db, "websocket")).toEqual([])
      yield* drain(db)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 0, documents: 3 })
      expect(yield* find(db, "websocket")).toEqual([sessionA])
      expect(yield* find(db, "spins")).toEqual([id("1")])
      expect(yield* find(db, "backoff")).toEqual([id("2")])
    }),
  )

  it.effect("indexes the title once, user text, assistant text and completed summaries only", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, "Titleword session")
          yield* addMessage(
            db,
            sessionA,
            1,
            SessionMessage.User.make({
              id: id("01"),
              type: "user",
              text: "userword",
              files: [{ data: "", mime: "text/plain", source: { type: "inline" }, name: "attachmentword.txt" }],
              time: { created },
            }),
          )
          yield* addMessage(
            db,
            sessionA,
            2,
            assistant("02", [
              SessionMessage.AssistantReasoning.make({ type: "reasoning", text: "reasoningword" }),
              tool("call_1", "toolword"),
              text("assistantword"),
            ]),
          )
          yield* addMessage(
            db,
            sessionA,
            3,
            SessionMessage.CompactionCompleted.make({
              id: id("03"),
              type: "compaction",
              status: "completed",
              reason: "auto",
              summary: "summaryword",
              time: { created },
            }),
          )
          yield* addMessage(
            db,
            sessionA,
            4,
            SessionMessage.CompactionRunning.make({
              id: id("04"),
              type: "compaction",
              status: "running",
              reason: "auto",
              summary: "draftword",
              time: { created },
            }),
          )
          yield* addMessage(
            db,
            sessionA,
            5,
            SessionMessage.Synthetic.make({
              id: id("05"),
              type: "synthetic",
              text: "syntheticword",
              time: { created },
            }),
          )
          yield* addMessage(
            db,
            sessionA,
            6,
            SessionMessage.System.make({ id: id("06"), type: "system", text: "systemword", time: { created } }),
          )
          yield* addMessage(
            db,
            sessionA,
            7,
            SessionMessage.Skill.make({
              id: id("07"),
              type: "skill",
              skill: Skill.ID.make("skillword"),
              name: Skill.Name.make("skillword"),
              text: "skillword",
              time: { created },
            }),
          )
        }),
      )
      yield* sync(db)

      expect(yield* find(db, "titleword")).toEqual([sessionA])
      expect(yield* find(db, "userword")).toEqual([id("01")])
      expect(yield* find(db, "assistantword")).toEqual([id("02")])
      expect(yield* find(db, "summaryword")).toEqual([id("03")])
      for (const word of ["attachmentword", "reasoningword", "toolword", "toolwordinput", "bash", "draftword"])
        expect(yield* find(db, word)).toEqual([])
      for (const word of ["syntheticword", "systemword", "skillword"]) expect(yield* find(db, word)).toEqual([])
      expect((yield* documentIDs(db)).map((row) => row.source)).toEqual([id("01"), id("02"), id("03"), sessionA])
    }),
  )

  it.effect("reads assistant text from part rows and from inline content", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, null)
          yield* addMessage(db, sessionA, 1, assistant("1", [text("inlineword"), tool("call_1", "inlinetool")]))
          // A newer release keeps the parts in session_part and leaves an empty envelope.
          yield* addMessage(db, sessionA, 2, assistant("2", [text("envelopeword")]))
          yield* db
            .update(SessionMessageTable)
            .set({ data: sql`json_set(${SessionMessageTable.data}, '$.content', json('[]'))` })
            .where(eq(SessionMessageTable.id, id("2")))
            .run()
          yield* db
            .insert(SessionPartTable)
            .values(
              [text("firstpart"), tool("call_2", "parttool"), text("secondpart")].map((part, ordinal) => ({
                message_id: id("2"),
                session_id: sessionA,
                ordinal,
                type: part.type,
                call_id: part.type === "tool" ? part.id : null,
                time_created: 1,
                time_updated: 1,
                data: Schema.encodeSync(SessionMessage.AssistantContent)(part),
              })),
            )
            .run()
        }),
      )
      yield* sync(db)

      expect(yield* find(db, "inlineword")).toEqual([id("1")])
      expect(yield* find(db, "firstpart")).toEqual([id("2")])
      expect(yield* find(db, "secondpart")).toEqual([id("2")])
      for (const word of ["envelopeword", "inlinetool", "parttool"]) expect(yield* find(db, word)).toEqual([])

      yield* db
        .update(SessionPartTable)
        .set({ data: Schema.encodeSync(SessionMessage.AssistantContent)(text("editedpart")) })
        .where(eq(SessionPartTable.ordinal, 2))
        .run()
      yield* drain(db)
      expect(yield* find(db, "secondpart")).toEqual([])
      expect(yield* find(db, "editedpart")).toEqual([id("2")])
    }),
  )

  it.effect("follows updates, renames, reverts and cascading deletes", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, "alpha title")
          yield* addSession(db, sessionB, "beta title")
          yield* addMessage(db, sessionA, 1, user("a1", "first alpha prompt"))
          yield* addMessage(db, sessionA, 2, user("a2", "second alpha prompt"))
          yield* addMessage(db, sessionA, 3, user("a3", "third alpha prompt"))
          yield* addMessage(db, sessionB, 1, user("b1", "beta prompt"))
        }),
      )
      yield* sync(db)

      yield* db
        .update(SessionMessageTable)
        .set({ data: { text: "rewritten alpha prompt", time: { created: 1_000 } } })
        .where(eq(SessionMessageTable.id, id("a1")))
        .run()
      yield* db.update(SessionTable).set({ title: "gamma title" }).where(eq(SessionTable.id, sessionA)).run()
      yield* drain(db)
      expect(yield* find(db, "first")).toEqual([])
      expect(yield* find(db, "rewritten")).toEqual([id("a1")])
      expect(yield* find(db, "alpha")).not.toContain(sessionA)
      expect(yield* find(db, "gamma")).toEqual([sessionA])

      // Revert deletes every message from the boundary on.
      yield* db
        .delete(SessionMessageTable)
        .where(sql`${SessionMessageTable.session_id} = ${sessionA} AND ${SessionMessageTable.seq} >= 2`)
        .run()
      yield* drain(db)
      expect(yield* find(db, "second third")).toEqual([])
      expect(yield* find(db, "rewritten")).toEqual([id("a1")])

      yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionA)).run()
      yield* drain(db)
      expect(yield* find(db, "rewritten gamma")).toEqual([])
      expect((yield* documentIDs(db)).map((row) => row.source)).toEqual([id("b1"), sessionB])

      // Deleting a project cascades through its sessions and their messages.
      yield* db.delete(ProjectTable).run()
      yield* drain(db)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 0, documents: 0 })
      expect(yield* find(db, "beta")).toEqual([])
    }),
  )

  it.effect("hides deleted sources before their queue entry is processed", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, null)
          yield* addMessage(db, sessionA, 1, user("1", "stale prompt"))
        }),
      )
      yield* sync(db)
      yield* db.delete(SessionMessageTable).run()
      expect(yield* find(db, "stale")).toEqual([])
      expect((yield* SessionSearchIndex.status(db)).documents).toBe(1)
    }),
  )

  it.effect("keeps queued sources when a batch rolls back", () =>
    Effect.gen(function* () {
      const db = yield* database((db) => addSession(db, sessionA, null))
      yield* sync(db)
      yield* addMessage(db, sessionA, 1, user("1", "durable prompt"))
      yield* addMessage(db, sessionA, 2, user("2", "another prompt"))

      // processBatch owns its transaction, so fail its last statement (the dequeue), after both entries were written.
      // Durable Object SQLite rejects nested transactions, so the test cannot wrap the batch in its own.
      const before = yield* ftsWrites(db)
      yield* db.run(
        "CREATE TRIGGER fail_dequeue BEFORE DELETE ON session_search_dirty BEGIN SELECT RAISE(ABORT, 'induced'); END",
      )
      const failed = yield* SessionSearchIndex.processBatch(db).pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 2, documents: 0 })
      expect(yield* ftsWrites(db)).toEqual(before)
      expect(yield* find(db, "durable another")).toEqual([])
      expect(yield* db.select({ id: SessionMessageTable.id }).from(SessionMessageTable).all()).toHaveLength(2)
      yield* db.run("DROP TRIGGER fail_dequeue")

      expect(yield* SessionSearchIndex.processBatch(db, 1)).toBe(1)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 1, documents: 1 })
      yield* drain(db)
      expect(yield* find(db, "durable another")).toHaveLength(2)
    }),
  )

  it.effect("keeps document identity across VACUUM", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, null)
          yield* Effect.forEach([1, 2, 3, 4], (seq) =>
            addMessage(db, sessionA, seq, user(`${seq}`, `word${seq} shared`)),
          )
        }),
      )
      yield* sync(db)
      // Leave rowid gaps in the source table so VACUUM has rows to renumber.
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.id, id("1")))
        .run()
      yield* drain(db)
      const before = yield* documentIDs(db)
      yield* db.run("VACUUM")
      expect(yield* documentIDs(db)).toEqual(before)

      yield* db
        .update(SessionMessageTable)
        .set({ data: { text: "replaced shared", time: { created: 1_000 } } })
        .where(eq(SessionMessageTable.id, id("3")))
        .run()
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.id, id("2")))
        .run()
      yield* drain(db)
      expect(yield* find(db, "word2 word3")).toEqual([])
      expect(yield* find(db, "word4")).toEqual([id("4")])
      expect(yield* find(db, "replaced")).toEqual([id("3")])
      expect((yield* find(db, "shared")).toSorted()).toEqual([id("3"), id("4")])
    }),
  )

  it.effect("indexes writes made while the backfill is running", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, "existing title")
          yield* Effect.forEach([1, 2, 3, 4, 5], (seq) => addMessage(db, sessionA, seq, user(`0${seq}`, `old${seq}`)))
        }),
      )
      yield* SessionSearchIndex.ensure(db)
      yield* SessionSearchIndex.backfillBatch(db, 2)
      yield* SessionSearchIndex.backfillBatch(db, 2)
      // Newest first: msg_05 and msg_04 are indexed, the rest are not yet.
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ backfill: "messages", documents: 3 })

      yield* addMessage(db, sessionA, 6, user("06", "fresh"))
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.id, id("05")))
        .run()
      yield* db
        .update(SessionMessageTable)
        .set({ data: { text: "edited", time: { created: 1_000 } } })
        .where(eq(SessionMessageTable.id, id("01")))
        .run()
      yield* drain(db)
      yield* backfill(db)
      yield* drain(db)

      expect(yield* find(db, "old5 old1")).toEqual([])
      expect(yield* find(db, "fresh")).toEqual([id("06")])
      expect(yield* find(db, "edited")).toEqual([id("01")])
      expect((yield* documentIDs(db)).map((row) => row.source)).toEqual([
        id("01"),
        id("02"),
        id("03"),
        id("04"),
        id("06"),
        sessionA,
      ])
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ backfill: "done", pending: 0 })
    }),
  )

  it.effect("rebuilds when a trigger is missing or the version changed", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, null)
          yield* addMessage(db, sessionA, 1, user("1", "kept prompt"))
        }),
      )
      yield* sync(db)

      // A migration that rebuilds a source table drops its triggers; writes meanwhile were never queued.
      yield* db.run("DROP TRIGGER session_search_message_insert")
      yield* addMessage(db, sessionA, 2, user("2", "unqueued prompt"))
      expect((yield* SessionSearchIndex.status(db)).pending).toBe(0)
      expect(yield* SessionSearchIndex.ensure(db)).toEqual({ supported: true, rebuilt: true })
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ backfill: "titles", documents: 0 })
      yield* backfill(db)
      expect((yield* find(db, "kept unqueued")).toSorted()).toEqual([id("1"), id("2")])

      yield* db
        .update(KVTable)
        .set({ value: { version: SessionSearchIndex.Version + 1, backfill: "done" } })
        .where(eq(KVTable.key, "session.search"))
        .run()
      expect(yield* SessionSearchIndex.ensure(db)).toEqual({ supported: true, rebuilt: true })
      expect((yield* SessionSearchIndex.status(db)).version).toBe(SessionSearchIndex.Version)
    }),
  )

  it.effect("matches any word, identifier subwords and punctuation-heavy queries", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, null)
          yield* addMessage(db, sessionA, 1, user("1", "decodeMessageRow throws on legacy rows"))
          yield* addMessage(db, sessionA, 2, user("2", "unrelated quokka"))
        }),
      )
      yield* sync(db)

      expect(yield* find(db, "message")).toEqual([id("1")])
      expect(yield* find(db, "zebra quokka")).toEqual([id("2")])
      expect(yield* find(db, 'GLM-5.3 OR "rows" NEAR(')).toEqual([id("1")])
      expect(yield* find(db, "  -- ")).toEqual([])
    }),
  )

  it.effect("writes nothing to the index while an assistant streams, then indexes it once", () =>
    Effect.gen(function* () {
      const db = yield* database((db) => addSession(db, sessionA, null))
      yield* sync(db)
      const before = yield* ftsWrites(db)
      const parts: SessionMessage.AssistantContent[] = []
      yield* addMessage(db, sessionA, 1, streaming("1", parts))
      for (let event = 0; event < 20; event++) {
        parts.push(event % 2 === 0 ? text(`partial${event}`) : tool(`call_${event}`, `output${event}`))
        yield* rewrite(db, streaming("1", parts))
        // Each poll dequeues the streaming assistant without indexing it, and the next finds nothing to do.
        expect(yield* SessionSearchIndex.processBatch(db)).toBe(1)
        expect(yield* SessionSearchIndex.processBatch(db)).toBe(0)
      }
      expect(yield* ftsWrites(db)).toEqual(before)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 0, documents: 0 })

      yield* rewrite(db, assistant("1", parts))
      expect(yield* SessionSearchIndex.processBatch(db)).toBe(1)
      expect((yield* ftsWrites(db))?.segments).toBe((before?.segments ?? 0) + 1)
      expect(yield* find(db, "partial0 partial18")).toEqual([id("1")])
      expect(yield* find(db, "output1")).toEqual([])
    }),
  )

  it.effect("keeps the last finished entry while an assistant is reopened", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, null)
          yield* addMessage(db, sessionA, 1, assistant("1", [text("firstanswer")]))
        }),
      )
      yield* sync(db)
      // A retried step reopens its assistant; until it finishes again, search keeps the finished text.
      yield* rewrite(db, streaming("1", [text("firstanswer"), text("retrydraft")]))
      yield* drain(db)
      expect(yield* find(db, "firstanswer")).toEqual([id("1")])
      expect(yield* find(db, "retrydraft")).toEqual([])

      yield* rewrite(db, assistant("1", [text("secondanswer")]))
      yield* drain(db)
      expect(yield* find(db, "firstanswer retrydraft")).toEqual([])
      expect(yield* find(db, "secondanswer")).toEqual([id("1")])
    }),
  )

  it.effect("does not let streaming assistants hold back other queued sources", () =>
    Effect.gen(function* () {
      const db = yield* database((db) => addSession(db, sessionA, "starting title"))
      yield* sync(db)
      yield* Effect.forEach(
        Array.from({ length: 100 }, (_, index) => index),
        (index) => addMessage(db, sessionA, index + 1, streaming(`s${String(index).padStart(3, "0")}`, [text("busy")])),
      )
      yield* addMessage(db, sessionA, 101, user("u", "waiting prompt"))
      yield* db.update(SessionTable).set({ title: "renamed title" }).where(eq(SessionTable.id, sessionA)).run()

      let calls = 0
      while ((yield* SessionSearchIndex.processBatch(db, 10)) > 0) calls++
      expect(calls).toBe(11)
      expect(yield* SessionSearchIndex.processBatch(db, 10)).toBe(0)
      expect(yield* find(db, "waiting")).toEqual([id("u")])
      expect(yield* find(db, "renamed")).toEqual([sessionA])
      expect(yield* find(db, "busy")).toEqual([])
    }),
  )

  it.effect("passes streaming assistants in the backfill and indexes them when they finish", () =>
    Effect.gen(function* () {
      const db = yield* database((db) =>
        Effect.gen(function* () {
          yield* addSession(db, sessionA, null)
          yield* addMessage(db, sessionA, 1, assistant("1", [text("settled")]))
          yield* addMessage(db, sessionA, 2, streaming("2", [text("inflight")]))
          yield* addMessage(db, sessionA, 3, user("3", "latest prompt"))
        }),
      )
      yield* SessionSearchIndex.ensure(db)
      let batches = 0
      let done = false
      while (!done) {
        done = (yield* SessionSearchIndex.backfillBatch(db, 1)).done
        batches++
      }
      // Two title batches (the second is empty), one per message, then an empty one: the streaming row did not stop it.
      expect(batches).toBe(6)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ backfill: "done", pending: 0, documents: 2 })
      expect(yield* find(db, "inflight")).toEqual([])

      yield* rewrite(db, assistant("2", [text("inflight")]))
      yield* drain(db)
      expect(yield* find(db, "settled inflight latest")).toHaveLength(3)
    }),
  )

  projected.effect("indexes assistants when the projector ends, fails or supersedes their step", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const bus = yield* Bus.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
      yield* addSession(db, sessionA, null)
      yield* sync(db)
      // Streams one step, polling the queue after every event: none of the polls may write to the index.
      const step = Effect.fnUntraced(function* (assistantMessageID: SessionMessage.ID, words: string) {
        const before = yield* ftsWrites(db)
        const poll = Effect.gen(function* () {
          yield* drain(db)
          expect(yield* ftsWrites(db)).toEqual(before)
        })
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID: sessionA,
          assistantMessageID,
          agent: Agent.defaultID,
          model,
          started: 0,
        })
        yield* poll
        yield* bus.publish(SessionEvent.Text.Started, { sessionID: sessionA, assistantMessageID, ordinal: 0 })
        yield* poll
        yield* bus.publish(SessionEvent.Text.Ended, {
          sessionID: sessionA,
          assistantMessageID,
          ordinal: 0,
          text: words,
        })
        yield* poll
        yield* bus.publish(SessionEvent.Tool.Input.Started, {
          sessionID: sessionA,
          assistantMessageID,
          id: "c",
          name: "bash",
        })
        yield* poll
        yield* bus.publish(SessionEvent.Tool.Called, {
          sessionID: sessionA,
          assistantMessageID,
          id: "c",
          input: { command: "ls" },
          executed: true,
        })
        yield* poll
      })

      // A failed or interrupted step keeps the text it streamed, as the transcript does.
      yield* step(id("failed"), "partialreply")
      yield* bus.publish(SessionEvent.Step.Failed, {
        sessionID: sessionA,
        assistantMessageID: id("failed"),
        error: { type: "provider.transport", message: "Disconnected" },
      })
      yield* drain(db)
      expect(yield* find(db, "partialreply")).toEqual([id("failed")])

      yield* step(id("ended"), "finalreply")
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID: sessionA,
        assistantMessageID: id("ended"),
        finish: "stop",
        cost: Money.USD.make(0),
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      yield* drain(db)
      expect(yield* find(db, "finalreply")).toEqual([id("ended")])

      // A step left open is completed when the next one starts.
      yield* step(id("abandoned"), "abandonedreply")
      expect(yield* find(db, "abandonedreply")).toEqual([])
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: sessionA,
        assistantMessageID: id("next"),
        agent: Agent.defaultID,
        model,
        started: 0,
      })
      yield* drain(db)
      expect(yield* find(db, "abandonedreply")).toEqual([id("abandoned")])
    }),
  )

  it.effect("skips malformed rows and parts without blocking the batch", () =>
    Effect.gen(function* () {
      const db = yield* database((db) => addSession(db, sessionA, null))
      yield* sync(db)
      yield* db.run(sql`
        INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
        VALUES (${id("1")}, ${sessionA}, 'user', 1, 1000, 1000, 'not json'),
          (${id("2")}, ${sessionA}, 'user', 2, 1000, 1000, '["an array"]')
      `)
      // Inline content mixing a text part with elements that are not part objects.
      yield* db.run(sql`
        INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
        VALUES (${id("3")}, ${sessionA}, 'assistant', 3, 1000, 1000, ${JSON.stringify({
          agent: Agent.defaultID,
          model,
          content: ["bare string", 7, null, { type: "text", text: "inlinesurvivor" }],
          time: { created: 1_000, completed: 1_000 },
        })})
      `)
      // Part rows, one of which is not JSON.
      yield* addMessage(db, sessionA, 4, assistant("4", []))
      yield* db.run(sql`
        INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data)
        VALUES (${id("4")}, ${sessionA}, 0, 'text', NULL, 1, 1, 'not json'),
          (${id("4")}, ${sessionA}, 1, 'text', NULL, 1, 1, ${JSON.stringify({ type: "text", text: "partsurvivor" })})
      `)
      yield* addMessage(db, sessionA, 5, user("5", "healthy prompt"))

      yield* drain(db)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 0, documents: 3 })
      expect(yield* find(db, "inlinesurvivor")).toEqual([id("3")])
      expect(yield* find(db, "partsurvivor")).toEqual([id("4")])
      expect(yield* find(db, "healthy")).toEqual([id("5")])
      expect(yield* find(db, "bare string array json")).toEqual([])

      // The backfill passes the same rows.
      yield* db
        .update(KVTable)
        .set({ value: { version: SessionSearchIndex.Version + 1, backfill: "done" } })
        .where(eq(KVTable.key, "session.search"))
        .run()
      yield* sync(db)
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({ backfill: "done", pending: 0, documents: 3 })
    }),
  )

  it.effect("upgrades a database created before the index", () =>
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* db.run("PRAGMA foreign_keys = ON")
      yield* DatabaseMigration.applyOnly(
        db,
        migrations.filter((migration) => migration.id !== "20261029215249_session_search"),
      )
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
      yield* addSession(db, sessionA, "Upgraded title")
      yield* oldWriter(db, sessionA, 1, user("1", "written long before"))

      yield* DatabaseMigration.apply(db)
      expect(yield* db.select().from(SessionSearchDirtyTable).all()).toEqual([])
      yield* sync(db)
      expect(yield* find(db, "upgraded")).toEqual([sessionA])
      expect(yield* find(db, "before")).toEqual([id("1")])
    }),
  )
})
