import { describe, expect } from "bun:test"
import path from "path"
import { DateTime, Effect, Layer, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { sqliteLayer } from "@opencode/core/database/sqlite.workerd"
import { Model } from "@opencode/core/model"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSearchIndex } from "@opencode/core/session/search-index"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { SessionID } from "@opencode/schema/session-id"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"
import { tempGlobalLayer } from "./fixture/global"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// The other search tests run on @effect/sql-sqlite-bun. These boot the production Database layer, with its
// pragmas and migrations, over the runtime adapters: a reopened file on this runtime, and the workerd adapter.

type Db = Database.Interface["db"]

const sessionID = SessionID.make("ses_runtime")
const encode = Schema.encodeSync(SessionMessage.Info)
const created = DateTime.makeUnsafe(1_000)
const id = (seq: number) => SessionMessage.ID.make(`msg_runtime_${seq}`)

const user = (seq: number, text: string) =>
  SessionMessage.User.make({ id: id(seq), type: "user", text, time: { created } })
/** Assistant text is indexed only once `time.completed` is set. */
const assistant = (seq: number, text: string, completed: boolean) =>
  SessionMessage.Assistant.make({
    id: id(seq),
    type: "assistant",
    agent: Agent.defaultID,
    model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
    content: [SessionMessage.AssistantText.make({ type: "text", text })],
    time: completed ? { created, completed: created } : { created },
  })

const addMessage = (db: Db, seq: number, message: SessionMessage.Info) => {
  const { id: _, type, ...data } = encode(message)
  return db
    .insert(SessionMessageTable)
    .values({ id: message.id, session_id: sessionID, type, seq, time_created: 1_000, data })
    .run()
}

const find = (db: Db, query: string) =>
  SessionSearchIndex.search(db, { query }).pipe(
    Effect.map((hits) => hits.map((hit) => String(hit.messageID ?? hit.sessionID)).toSorted()),
  )

const drain = (db: Db) =>
  Effect.gen(function* () {
    while ((yield* SessionSearchIndex.processBatch(db, 2)) > 0) {}
  })

/** Data written before the index exists, then ensure, backfill and a live write. */
const build = (db: Db) =>
  Effect.gen(function* () {
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "s",
        directory: "/project",
        title: "Café decodeMessageRow",
        version: "test",
      })
      .run()
    yield* addMessage(db, 1, user(1, "migrations keep running"))
    yield* addMessage(db, 4, assistant(4, "giraffe answer", true))
    expect(yield* SessionSearchIndex.ensure(db)).toEqual({ supported: true, rebuilt: true, layout: "compact" })
    while (!(yield* SessionSearchIndex.backfillBatch(db, 1)).done) {}
    yield* addMessage(db, 2, user(2, "zebra crossing"))
    yield* db.update(SessionTable).set({ title: "Kangaroo" }).where(eq(SessionTable.id, sessionID)).run()
    yield* drain(db)

    expect(yield* find(db, "run")).toEqual(["msg_runtime_1"])
    expect(yield* find(db, "giraffe")).toEqual(["msg_runtime_4"])
    expect(yield* find(db, "zebra kangaroo")).toEqual(["msg_runtime_2", sessionID])
    expect(yield* find(db, "cafe message")).toEqual([])
  })

/** A later boot over the same storage keeps the index and its triggers. */
const reopen = (db: Db) =>
  Effect.gen(function* () {
    expect(yield* SessionSearchIndex.ensure(db)).toEqual({ supported: true, rebuilt: false, layout: "compact" })
    expect(yield* SessionSearchIndex.status(db)).toMatchObject({ backfill: "done", pending: 0, documents: 4 })
    yield* db
      .delete(SessionMessageTable)
      .where(eq(SessionMessageTable.id, id(1)))
      .run()
    yield* addMessage(db, 3, user(3, "after reopen"))
    yield* drain(db)
    expect(yield* find(db, "run reopen zebra")).toEqual(["msg_runtime_2", "msg_runtime_3"])

    // A streaming assistant is dequeued without a document; the row rewrite that completes it queues it again.
    yield* addMessage(db, 5, assistant(5, "streaming walrus", false))
    yield* drain(db)
    expect(yield* SessionSearchIndex.status(db)).toMatchObject({ pending: 0, documents: 4 })
    expect(yield* find(db, "walrus")).toEqual([])
    yield* db
      .update(SessionMessageTable)
      .set({ data: sql`json_set(${SessionMessageTable.data}, '$.time.completed', 2000)` })
      .where(eq(SessionMessageTable.id, id(5)))
      .run()
    yield* drain(db)
    expect(yield* find(db, "walrus")).toEqual(["msg_runtime_5"])
  })

const withDatabase = <A, E>(layer: Layer.Layer<Database.Service>, body: (db: Db) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    return yield* body(database.db)
  }).pipe(Effect.provide(layer), Effect.scoped)

describe("SessionSearchIndex runtime adapters", () => {
  it.live("survives reopening a file database", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const layer = Database.layer({ path: path.join(tmp.path, "search.db") }).pipe(Layer.provide(tempGlobalLayer))
      yield* withDatabase(layer, build)
      yield* withDatabase(layer, reopen)
    }),
  )

  it.live("runs over the workerd adapter's storage transactions", () =>
    Effect.gen(function* () {
      const storage = makeDurableObjectStorage()
      const layer = Database.layerFromClient.pipe(
        Layer.provide(sqliteLayer({ storage })),
        Layer.provide(tempGlobalLayer),
      )
      yield* withDatabase(layer, build)
      yield* withDatabase(layer, reopen)
    }),
  )
})
