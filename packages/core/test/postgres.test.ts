import { afterAll, beforeAll, describe, expect } from "bun:test"
import { DateTime, Effect, Layer, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { PgApply } from "@opencode/core/database/pg/apply"
import { Postgres } from "@opencode/core/database/postgres.bun"
import { KVTable } from "@opencode/core/kv/sql"
import { Model } from "@opencode/core/model"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSearch } from "@opencode/core/session/search"
import { SessionSearchIndex } from "@opencode/core/session/search-index"
import { SessionMessageTable, SessionPartTable, SessionTable } from "@opencode/core/session/sql"
import { Global } from "@opencode/util/global"
import { testEffect } from "./lib/effect"

// The PostgreSQL half of the driver seam. OPENCODE_PG_TEST_DSN must point at a
// disposable server: the suite creates a scratch schema, bootstraps the whole
// baseline into it and drops it afterwards, so it never touches public or any
// other schema. Without the variable it skips, which keeps the default SQLite
// run and CI green. `bun run test:postgres` runs only this file.
const base = process.env.OPENCODE_PG_TEST_DSN
const schema = "opencode_test_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12)

// Select the scratch schema for every connection of the run through the
// search_path startup parameter, the same seam a tenant or scratch schema uses.
const scoped = (dsn: string) => {
  const url = new URL(dsn)
  const options = url.searchParams.get("options")
  url.searchParams.set("options", `${options ? options + " " : ""}-c search_path=${schema},public`)
  return url.toString()
}
const url = base ? scoped(base) : ""

const admin = <A>(run: (db: Postgres.Database) => Effect.Effect<A, unknown>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Postgres.makeWithDefaults()
      return yield* run(db)
    }).pipe(Effect.provide(Postgres.clientLayer({ url: base, maxConnections: 1 }))),
  )

const quoted = sql.raw('"' + schema + '"')

const it = testEffect(
  SessionSearch.layer.pipe(
    Layer.provideMerge(Database.layer({ url })),
    Layer.provide(Layer.succeed(Global.Service, Global.make({ data: "/nonexistent/opencode-postgres-test" }))),
  ),
)

const created = DateTime.makeUnsafe(1_000)
const encodeMessage = Schema.encodeSync(SessionMessage.Info)
const encodePart = Schema.encodeSync(SessionMessage.AssistantContent)
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }
const sessionID = Session.ID.make("ses_postgres_suite")
const userID = SessionMessage.ID.make("msg_postgres_suite_user")
const assistantID = SessionMessage.ID.make("msg_postgres_suite_assistant")
const lifecycleID = SessionMessage.ID.make("msg_postgres_suite_lifecycle")

type Db = Postgres.Database

const addSession = (db: Db) =>
  Effect.gen(function* () {
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "postgres-suite",
        directory: "/project",
        version: "test",
        title: "Hóa đơn test",
        time_created: DateTime.toEpochMillis(created),
        time_updated: DateTime.toEpochMillis(created),
      })
      .onConflictDoNothing()
      .run()
  })

const addMessage = (db: Db, message: SessionMessage.Info, seq: number) => {
  const { id: _, type, ...data } = encodeMessage(message)
  const time = DateTime.toEpochMillis(message.time.created)
  return db
    .insert(SessionMessageTable)
    .values({ id: message.id, session_id: sessionID, type, seq, time_created: time, time_updated: time, data })
    .run()
}

const addParts = (db: Db, messageID: SessionMessage.ID, parts: SessionMessage.AssistantContent[]) =>
  db
    .insert(SessionPartTable)
    .values(
      parts.map((part, ordinal) => ({
        message_id: messageID,
        session_id: sessionID,
        ordinal,
        type: part.type,
        call_id: part.type === "tool" ? part.id : null,
        time_created: DateTime.toEpochMillis(created),
        time_updated: DateTime.toEpochMillis(created),
        data: encodePart(part),
      })),
    )
    .run()

const assistant = (id: SessionMessage.ID, content: SessionMessage.AssistantContent[], completed = true) =>
  SessionMessage.Assistant.make({
    id,
    type: "assistant",
    agent: Agent.defaultID,
    model,
    content,
    time: completed ? { created, completed: created } : { created },
  })

const textPart = (value: string) => SessionMessage.AssistantText.make({ type: "text", text: value })

const buildIndex = (db: Db) =>
  Effect.gen(function* () {
    yield* SessionSearchIndex.ensure(db)
    while (!(yield* SessionSearchIndex.buildChunk(db)).done) {}
  })

const document = (db: Db, id: SessionMessage.ID) =>
  db
    .get<{ document: string }>(
      sql`select document::text as document from session_search where source_id = ${id}`,
    )
    .pipe(Effect.map((row) => row?.document ?? ""))

beforeAll(async () => {
  if (!base) return
  await admin((db) => db.run(sql`create schema ${quoted}`))
})

afterAll(async () => {
  if (!base) return
  await admin((db) => db.run(sql`drop schema if exists ${quoted} cascade`))
})

describe.skipIf(!base)("postgresql driver", () => {
  it.effect("bootstraps the baseline into the scoped schema once", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      expect((yield* db.get<{ name: string }>(sql`select current_schema() as name`))?.name).toBe(schema)

      const tables = yield* db.all<{ name: string }>(
        sql`select tablename as name from pg_tables where schemaname = current_schema()`,
      )
      expect(tables.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          "kv",
          "project",
          "session_v2",
          "session_message",
          "session_part",
          "event",
          "migration",
        ]),
      )

      expect(yield* PgApply.apply(db)).toEqual({ applied: false, statements: 0 })

      // Every millisecond in the schema is bigint; the int8 codec must hand the
      // code a JS number or Date.now() comparisons are silently wrong.
      const clock = yield* db.get<{ n: number }>(sql`select 1795694918445::bigint as n`)
      expect(typeof clock?.n).toBe("number")
      expect(clock?.n).toBe(1795694918445)
    }),
  )

  it.effect("stores JSON and rolls back a failed transaction", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const key = "postgres-suite:" + Date.now()
      yield* db.insert(KVTable).values({ key, value: { hello: "world", n: 42 } }).run()
      expect((yield* db.select().from(KVTable).where(eq(KVTable.key, key)).get())?.value).toEqual({
        hello: "world",
        n: 42,
      })

      const rolled = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(KVTable).values({ key: key + ":tx", value: { tx: true } }).run()
            return yield* Effect.fail("rollback")
          }),
        )
        .pipe(Effect.flip)
      expect(rolled).toBe("rollback")
      expect(yield* db.select().from(KVTable).where(eq(KVTable.key, key + ":tx")).get()).toBeUndefined()
    }),
  )

  it.effect("indexes the title, user text and finished assistant parts, and searches them", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* addSession(db)
      yield* addMessage(
        db,
        SessionMessage.User.make({
          id: userID,
          type: "user",
          text: "Please find the invoice for Đơn hàng",
          time: { created: DateTime.makeUnsafe(2_000) },
        }),
        1,
      )
      yield* addMessage(db, assistant(assistantID, [], true), 2)
      yield* addParts(db, assistantID, [textPart("Streamed answer about the invoice")])
      yield* buildIndex(db)

      const state = yield* SessionSearchIndex.state(db)
      expect(SessionSearchIndex.current(state) ? state.status : undefined).toBe("done")
      const indexed = yield* db.all<{ source_id: string }>(
        sql`select source_id from session_search where session_id = ${sessionID} order by source_id`,
      )
      expect(indexed.map((row) => row.source_id)).toEqual([assistantID, userID, sessionID].sort())

      const search = yield* SessionSearch.Service

      // Accents fold identically on both sides of the index: the stored title
      // "Hóa đơn test" is found by "Đơn" and by the fold "don".
      for (const query of ["Đơn", "don"]) {
        const result = yield* search.search({ query })
        const hit = result.results?.find((entry) => entry.sessionID === sessionID)
        expect(hit?.matches.some((match) => match.type === "title")).toBe(true)
      }

      const streamed = yield* search.search({ query: "streamed" })
      const hit = streamed.results?.find((entry) => entry.sessionID === sessionID)
      expect(
        hit?.matches.some(
          (match) => match.type === "assistant" && match.snippet.toLowerCase().includes("streamed"),
        ),
      ).toBe(true)
    }),
  )

  it.effect("indexes a part only once its message completes, and follows updates and deletes", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* addSession(db)
      yield* addMessage(db, assistant(lifecycleID, [], false), 10)
      yield* addParts(db, lifecycleID, [textPart("pending quokka")])
      yield* buildIndex(db)
      expect(yield* document(db, lifecycleID)).toBe("")

      // Completing the message is the trigger that admits its parts.
      const { id: _, type: __, ...completedData } = encodeMessage(
        SessionMessage.Assistant.make({
          id: lifecycleID,
          type: "assistant",
          agent: Agent.defaultID,
          model,
          content: [],
          time: { created, completed: DateTime.makeUnsafe(2_000) },
        }),
      )
      yield* db.run(
        sql`update session_message set data = ${JSON.stringify(completedData)} where id = ${lifecycleID}`,
      )
      expect(yield* document(db, lifecycleID)).toContain("quokka")

      yield* db.run(
        sql`update session_part set data = ${JSON.stringify(encodePart(textPart("updated wallaby")))} where message_id = ${lifecycleID} and ordinal = 0`,
      )
      const updated = yield* document(db, lifecycleID)
      expect(updated).toContain("wallaby")
      expect(updated).not.toContain("quokka")

      yield* db.run(sql`delete from session_message where id = ${lifecycleID}`)
      expect(yield* document(db, lifecycleID)).toBe("")
    }),
  )
})
