import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { DateTime, Effect, Exit, Layer, Schema } from "effect"
import { sql } from "drizzle-orm"
import { DatabaseMigration } from "@opencode/core/database/migration"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSearchIndex } from "@opencode/core/session/search-index"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { SessionID } from "@opencode/schema/session-id"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.mergeAll(
    SqliteClient.layer({ filename: ":memory:", disableWAL: true }),
    Layer.succeed(Global.Service, Global.make({ data: "/nonexistent/opencode-session-search" })),
  ),
)

type Db = Effect.Success<ReturnType<typeof EffectDrizzleSqlite.makeWithDefaults>>

const sessionID = SessionID.make("ses_adversarial")
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)

const migrate = (db: Db) =>
  Effect.gen(function* () {
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* DatabaseMigration.apply(db)
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db
      .insert(SessionTable)
      .values({ id: sessionID, project_id: Project.ID.global, slug: "s", directory: "/project", version: "test" })
      .run()
    return db
  })

/** A connection of its own to a database file, as another process over the same file would have. */
const connect = (options: SqliteClient.SqliteClientConfig) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(SqliteClient.layer(options))
    return yield* EffectDrizzleSqlite.makeWithDefaults().pipe(Effect.provide(context))
  })

const addUser = (db: Db, seq: number, value: string, text: string) => {
  const { id: _, type, ...data } = Schema.encodeSync(SessionMessage.Info)(
    SessionMessage.User.make({ id: id(value), type: "user", text, time: { created: DateTime.makeUnsafe(1_000) } }),
  )
  return db
    .insert(SessionMessageTable)
    .values({ id: id(value), session_id: sessionID, type, seq, time_created: 1_000, data })
    .run()
}

const backfill = (db: Db) =>
  Effect.gen(function* () {
    while (!(yield* SessionSearchIndex.backfillBatch(db, 10)).done) {}
  })

const drain = (db: Db) =>
  Effect.gen(function* () {
    while ((yield* SessionSearchIndex.processBatch(db, 10)) > 0) {}
  })

const find = (db: Db, query: string) =>
  SessionSearchIndex.search(db, { query }).pipe(Effect.map((hits) => hits.map((hit) => hit.messageID ?? hit.sessionID)))

/**
 * Runs `effect` while another process holds the write lock and has queued an ID of its own. Bun's SQLite waits for
 * locks synchronously, so this process cannot release the child while `effect` waits: the child commits on its own, a
 * moment after it is told to. Before starting `effect`, the lock is checked to be held by a probe connection that
 * does not wait.
 */
const whileAnotherProcessWrites = <A, E, R>(filename: string, probe: Db, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    // Unique per child: a repeated ID would fail the child's insert, and the effect would run uncontended.
    const sourceID = `msg_other_${crypto.randomUUID()}`
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `const { Database } = require("bun:sqlite")
        const db = new Database(${JSON.stringify(filename)})
        db.run("BEGIN IMMEDIATE")
        db.run("INSERT INTO session_search_dirty (source_id) VALUES (?)", [${JSON.stringify(sourceID)}])
        console.log("locked")
        process.stdin.once("data", () => setTimeout(() => { db.run("COMMIT"); db.close(); process.exit(0) }, 200))`,
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    const ready = yield* Effect.promise(() => child.stdout.getReader().read())
    if (ready.done) expect(yield* Effect.promise(() => new Response(child.stderr).text())).toBe("")
    expect(new TextDecoder().decode(ready.value)).toContain("locked")
    expect(Exit.isFailure(yield* Effect.exit(probe.run("BEGIN IMMEDIATE")))).toBe(true)

    child.stdin.write("release\n")
    child.stdin.flush()
    const exit = yield* Effect.exit(effect)
    expect(yield* Effect.promise(() => child.exited)).toBe(0)
    return exit
  })

describe("SessionSearchIndex adversarial", () => {
  // Deferred transactions read before writing. Once a transaction has read, SQLite does not call the busy handler
  // when it then needs the write lock, so busy_timeout is skipped and the batch dies with SQLITE_BUSY at once.
  it.live("waits for a writer on another connection instead of dying", () =>
    Effect.gen(function* () {
      const filename = path.join((yield* tmpdirScoped()).path, "opencode.db")
      const db = yield* migrate(yield* connect({ filename }))
      const probe = yield* connect({ filename })
      yield* probe.run("PRAGMA busy_timeout = 0")
      yield* addUser(db, 1, "1", "backfilled prompt")
      yield* SessionSearchIndex.ensure(db)

      const backfilled = yield* whileAnotherProcessWrites(filename, probe, backfill(db))
      expect(Exit.isSuccess(backfilled)).toBe(true)
      yield* drain(db)

      yield* addUser(db, 2, "2", "queued prompt")
      const processed = yield* whileAnotherProcessWrites(filename, probe, SessionSearchIndex.processBatch(db))
      // The other process's queued ID is seen only when the batch starts after it commits.
      expect(processed).toEqual(Exit.succeed(2))
      expect((yield* find(db, "backfilled queued")).toSorted()).toEqual([id("1"), id("2")])
    }),
  )

  // The capability probe used to catch every SqlError, so a lock, a read-only file or corruption read as "no FTS5".
  it.live("does not report a locked database as lacking FTS5", () =>
    Effect.gen(function* () {
      const filename = path.join((yield* tmpdirScoped()).path, "opencode.db")
      const db = yield* migrate(yield* connect({ filename }))
      const other = yield* connect({ filename })
      yield* db.run("PRAGMA busy_timeout = 50")
      yield* other.run("BEGIN IMMEDIATE")
      yield* other.run("INSERT INTO session_search_dirty (source_id) VALUES ('msg_other_connection')")
      const exit = yield* Effect.exit(SessionSearchIndex.ensure(db))
      yield* other.run("ROLLBACK")
      expect(Exit.isSuccess(exit) ? exit.value : { supported: "failed" }).not.toMatchObject({ supported: false })
    }),
  )

  it.live("does not report a read-only database as lacking FTS5", () =>
    Effect.gen(function* () {
      const filename = path.join((yield* tmpdirScoped()).path, "opencode.db")
      yield* Effect.scoped(Effect.flatMap(connect({ filename, disableWAL: true }), migrate))
      const exit = yield* Effect.exit(SessionSearchIndex.ensure(yield* connect({ filename, readonly: true })))
      expect(Exit.isSuccess(exit) ? exit.value : { supported: "failed" }).not.toMatchObject({ supported: false })
    }),
  )

  it.live("does not report a corrupt database as lacking FTS5", () =>
    Effect.gen(function* () {
      const filename = path.join((yield* tmpdirScoped()).path, "opencode.db")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const db = yield* migrate(yield* connect({ filename, disableWAL: true }))
          yield* db.run("CREATE TABLE junk (x)")
          yield* db.run(
            "INSERT INTO junk SELECT randomblob(3000) FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20) SELECT i FROM n)",
          )
          yield* db.run("DROP TABLE junk")
        }),
      )
      // Corrupt only the freed pages: the schema still reads, and the first write that allocates a page fails.
      const bytes = yield* Effect.promise(() => fs.readFile(filename))
      const trunk = (bytes.readUInt32BE(32) - 1) * bytes.readUInt16BE(16)
      expect(trunk).toBeGreaterThan(0)
      bytes.writeUInt32BE(0xffffff, trunk + 4)
      yield* Effect.promise(() => fs.writeFile(filename, bytes))
      const exit = yield* Effect.exit(SessionSearchIndex.ensure(yield* connect({ filename, disableWAL: true })))
      expect(Exit.isSuccess(exit) ? exit.value : { supported: "failed" }).not.toMatchObject({ supported: false })
    }),
  )

  // `messageSources` documents that a row too malformed to decode has nothing searchable, but JSON operators on a
  // content element that is a bare string raise "malformed JSON" in SQL. The whole batch rolls back, the cursor and
  // queue never advance, and every later row stays unindexed.
  it.effect("skips a malformed message instead of blocking the backfill and the queue", () =>
    Effect.gen(function* () {
      const db = yield* migrate(yield* EffectDrizzleSqlite.makeWithDefaults())
      const malformed = (messageID: string, seq: number) =>
        db.run(sql`
          INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
          VALUES (${id(messageID)}, ${sessionID}, 'assistant', ${seq}, 1000, 1000, ${JSON.stringify({
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: ["not a part"],
            time: { created: 1_000, completed: 1_000 },
          })})
        `)
      yield* addUser(db, 1, "1", "older prompt")
      yield* malformed("2", 2)
      yield* SessionSearchIndex.ensure(db)
      expect(Exit.isSuccess(yield* Effect.exit(backfill(db)))).toBe(true)
      expect(yield* find(db, "older")).toEqual([id("1")])

      yield* addUser(db, 3, "3", "newer prompt")
      yield* malformed("4", 4)
      expect(Exit.isSuccess(yield* Effect.exit(drain(db)))).toBe(true)
      expect(yield* find(db, "newer")).toEqual([id("3")])
    }),
  )
})
