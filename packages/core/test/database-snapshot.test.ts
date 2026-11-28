import Sqlite from "bun:sqlite"
import { describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Database } from "@opencode/core/database/database"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { migrations } from "@opencode/core/database/migration.gen"
import { sqliteLayer } from "@opencode/core/database/sqlite.bun"
import { Global } from "@opencode/util/global"
import { TestDatabase } from "./lib/database"
import { it } from "./lib/effect"

const migrated = Database.layer().pipe(Layer.provide(Layer.succeed(Global.Service, Global.make())))

const database = Database.Service.use((service) => Effect.succeed(service.db))
const machines = (db: Database.Interface["db"]) => db.all<{ id: string }>(sql`SELECT id FROM machine ORDER BY id`)
const addMachine = (db: Database.Interface["db"], id: string) =>
  db.run(sql`INSERT INTO machine (id, time_created) VALUES (${id}, 0)`)

describe("TestDatabase", () => {
  it.live("a raw deserialized copy starts with foreign keys and the busy timeout off", () =>
    Effect.sync(() => {
      const source = new Sqlite(":memory:")
      source.run("PRAGMA foreign_keys = ON")
      const copy = Sqlite.deserialize(source.serialize())
      const pragmas = {
        foreign_keys: copy.query("PRAGMA foreign_keys").values()[0]?.[0],
        busy_timeout: copy.query("PRAGMA busy_timeout").values()[0]?.[0],
      }
      copy.close()
      source.close()
      expect(pragmas).toEqual({ foreign_keys: 0, busy_timeout: 0 })
    }),
  )

  it.live("applies the production pragmas to every copy", () =>
    Effect.gen(function* () {
      const read = Effect.gen(function* () {
        const db = yield* database
        return {
          foreign_keys: (yield* db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`))?.foreign_keys,
          busy_timeout: (yield* db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`))?.timeout,
          journal_mode: (yield* db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`))?.journal_mode,
          synchronous: (yield* db.get<{ synchronous: number }>(sql`PRAGMA synchronous`))?.synchronous,
          cache_size: (yield* db.get<{ cache_size: number }>(sql`PRAGMA cache_size`))?.cache_size,
        }
      })
      const expected = yield* read.pipe(Effect.provide(migrated))
      expect(expected).toEqual({
        foreign_keys: 1,
        busy_timeout: 5000,
        journal_mode: "memory",
        synchronous: 1,
        cache_size: -64000,
      })
      expect(yield* read.pipe(Effect.provide(TestDatabase.layer))).toEqual(expected)
      expect(yield* read.pipe(Effect.provide(TestDatabase.layer))).toEqual(expected)
    }),
  )

  it.live("rejects an orphan row", () =>
    Effect.gen(function* () {
      const db = yield* database
      const exit = yield* db
        .run(
          sql`INSERT INTO permission (id, project_id, action, resource, time_created, time_updated)
            VALUES ('per_orphan', 'prj_missing', 'allow', '*', 0, 0)`,
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "inserted").toContain("FOREIGN KEY constraint failed")
    }).pipe(Effect.provide(TestDatabase.layer)),
  )

  it.live("matches the schema and migration journal of a migrated database", () =>
    Effect.gen(function* () {
      const read = Effect.gen(function* () {
        const db = yield* database
        return {
          schema: yield* db.all(sql`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`),
          journal: yield* db.all<{ id: string }>(sql`SELECT id FROM migration ORDER BY id`),
        }
      })
      const expected = yield* read.pipe(Effect.provide(migrated))
      expect(expected.journal.map((row) => row.id)).toEqual(migrations.map((migration) => migration.id).toSorted())
      expect(yield* read.pipe(Effect.provide(TestDatabase.layer))).toEqual(expected)
    }),
  )

  it.live("gives each copy its own data and never changes the template", () =>
    Effect.gen(function* () {
      // Each copy writes, yields so the others interleave, then reads only its own row.
      const seen = yield* Effect.forEach(
        ["mac_a", "mac_b", "mac_c", "mac_d"],
        (id) =>
          Effect.gen(function* () {
            const db = yield* database
            yield* addMachine(db, id)
            yield* Effect.yieldNow
            return yield* machines(db)
          }).pipe(Effect.provide(TestDatabase.layer)),
        { concurrency: "unbounded" },
      )
      expect(seen).toEqual([[{ id: "mac_a" }], [{ id: "mac_b" }], [{ id: "mac_c" }], [{ id: "mac_d" }]])
      expect(yield* database.pipe(Effect.flatMap(machines), Effect.provide(TestDatabase.layer))).toEqual([])
    }),
  )
})

// The same transaction behavior over the production Bun client and the template copy's client.
const clients = [
  ["bun client", () => sqliteLayer({ filename: ":memory:" })],
  ["template client", () => TestDatabase.client],
] as const

describe.each(clients)("%s transactions", (_, client) => {
  const drizzle = EffectDrizzleSqlite.makeWithDefaults()
  const probe = (db: Effect.Success<typeof drizzle>) =>
    db.all<{ value: string }>(sql`SELECT value FROM probe ORDER BY value`)

  it.live("roll back a failed transaction", () =>
    Effect.gen(function* () {
      const db = yield* drizzle
      yield* db.run(sql`CREATE TABLE probe (value TEXT)`)
      const exit = yield* db
        .transaction((tx) => tx.run(sql`INSERT INTO probe VALUES ('lost')`).pipe(Effect.andThen(Effect.fail("boom"))))
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* probe(db)).toEqual([])
    }).pipe(Effect.provide(client())),
  )

  it.live("roll back only the failed savepoint of concurrent nested transactions", () =>
    Effect.gen(function* () {
      const db = yield* drizzle
      yield* db.run(sql`CREATE TABLE probe (value TEXT)`)
      yield* db.transaction((tx) =>
        Effect.all(
          [
            tx
              .transaction((inner) =>
                inner
                  .run(sql`INSERT INTO probe VALUES ('failed')`)
                  .pipe(
                    Effect.andThen(Effect.yieldNow),
                    Effect.andThen(Effect.yieldNow),
                    Effect.andThen(Effect.fail("boom")),
                  ),
              )
              .pipe(Effect.ignore),
            tx.transaction((inner) =>
              Effect.yieldNow.pipe(
                Effect.andThen(inner.run(sql`INSERT INTO probe VALUES ('kept')`)),
                Effect.andThen(Effect.yieldNow),
                Effect.andThen(inner.transaction((deeper) => deeper.run(sql`INSERT INTO probe VALUES ('deeper')`))),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        ),
      )
      expect(yield* probe(db)).toEqual([{ value: "deeper" }, { value: "kept" }])
    }).pipe(Effect.provide(client())),
  )

  it.live("roll back an interrupted transaction and release the connection", () =>
    Effect.gen(function* () {
      const db = yield* drizzle
      yield* db.run(sql`CREATE TABLE probe (value TEXT)`)
      const started = yield* Deferred.make<void>()
      const running = yield* db
        .transaction((tx) =>
          tx
            .run(sql`INSERT INTO probe VALUES ('interrupted')`)
            .pipe(Effect.andThen(Deferred.succeed(started, undefined)), Effect.andThen(Effect.never)),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(running)
      yield* db.transaction((tx) => tx.run(sql`INSERT INTO probe VALUES ('next')`))
      expect(yield* probe(db)).toEqual([{ value: "next" }])
    }).pipe(Effect.provide(client())),
  )
})
