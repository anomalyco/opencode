import { describe, expect, test } from "bun:test"
import { Database as SQLite } from "bun:sqlite"
import path from "node:path"
import { Effect, Schema } from "effect"
import { sql } from "drizzle-orm"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { DatabaseStorage } from "@opencode/core/database/storage"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Event } from "@opencode/schema/event"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tmpdir } from "./fixture/tmpdir"

const LargeEvent = Bus.durable({
  type: "test.database-storage",
  durable: { version: 1, aggregate: "id" },
  schema: { id: Schema.String, text: Schema.String },
})

const open = <A, E>(filename: string, effect: Effect.Effect<A, E, Database.Service>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Database.layer({ path: filename })),
      Effect.provideService(Global.Service, Global.make({ data: path.dirname(filename) })),
      Effect.scoped,
    ),
  )

const initialize = (filename: string) => open(filename, Effect.void)

// OpenCode creates the schema first so later opens are treated as existing
// installations instead of a non-empty database that is missing session tables.
async function fixture(filename: string, autoVacuum: "NONE" | "FULL") {
  await initialize(filename)
  const db = new SQLite(filename)
  db.run("PRAGMA journal_mode = DELETE")
  db.run(`PRAGMA auto_vacuum = ${autoVacuum}`)
  db.run("VACUUM")
  db.run("CREATE TABLE storage_fixture (id TEXT PRIMARY KEY, data BLOB)")
  db.run("INSERT INTO storage_fixture VALUES ('keep', 'retained')")
  db.run("INSERT INTO storage_fixture VALUES ('remove', zeroblob(4194304))")
  db.run("DELETE FROM storage_fixture WHERE id = 'remove'")
  const free = db.query<{ freelist_count: number }, []>("PRAGMA freelist_count").get()!.freelist_count
  const pages = db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count
  db.close()
  return { free, pages }
}

async function incremental(filename: string) {
  await initialize(filename)
  const db = new SQLite(filename)
  db.run("CREATE TABLE storage_fixture (id TEXT PRIMARY KEY, data BLOB)")
  db.run("INSERT INTO storage_fixture VALUES ('keep', 'retained')")
  db.run("INSERT INTO storage_fixture VALUES ('remove', zeroblob(4194304))")
  db.run("DELETE FROM storage_fixture WHERE id = 'remove'")
  db.run("PRAGMA wal_checkpoint(TRUNCATE)")
  const free = db.query<{ freelist_count: number }, []>("PRAGMA freelist_count").get()!.freelist_count
  const pages = db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count
  db.close()
  return { free, pages }
}

describe("DatabaseStorage", () => {
  test("new databases enable incremental auto-vacuum before WAL", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "new.db")

    await open(
      filename,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        expect(yield* db.get(sql`PRAGMA auto_vacuum`)).toEqual({ auto_vacuum: 2 })
        expect(yield* db.get(sql`PRAGMA journal_mode`)).toEqual({ journal_mode: "wal" })
      }),
    )
  })

  test.each(["NONE", "FULL"] as const)("preserves an existing %s database", async (autoVacuum) => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "existing.db")
    const before = await fixture(filename, autoVacuum)
    const size = Bun.file(filename).size

    await open(
      filename,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        expect(yield* db.get(sql`PRAGMA auto_vacuum`)).toEqual({ auto_vacuum: autoVacuum === "NONE" ? 0 : 1 })
        expect(yield* db.get(sql`PRAGMA freelist_count`)).toEqual({ freelist_count: before.free })
        expect(yield* db.get(sql`PRAGMA page_count`)).toEqual({ page_count: before.pages })
        expect(yield* db.all(sql`SELECT id, data FROM storage_fixture`)).toEqual([{ id: "keep", data: "retained" }])
      }),
    )

    expect(Bun.file(filename).size).toBe(size)
  })

  test("reclaims a bounded number of free pages on open", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "incremental.db")
    const before = await incremental(filename)
    const size = Bun.file(filename).size

    await open(
      filename,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const after = yield* db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`)
        const pages = yield* db.get<{ page_count: number }>(sql`PRAGMA page_count`)
        const reclaimed = before.free - after!.freelist_count

        expect(reclaimed).toBeGreaterThan(0)
        expect(reclaimed).toBeLessThanOrEqual(256)
        expect(pages!.page_count).toBeLessThan(before.pages)
        expect(yield* db.get(sql`PRAGMA integrity_check`)).toEqual({ integrity_check: "ok" })
        expect(yield* db.all(sql`SELECT id, data FROM storage_fixture`)).toEqual([{ id: "keep", data: "retained" }])
      }),
    )

    expect(Bun.file(filename).size).toBeLessThan(size)
  })

  test("removing an aggregate reclaims a bounded number of free pages", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "events.db")
    await initialize(filename)
    const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
      Database.node.replace(Database.configured({ path: filename })),
      Bus.node.replace(Bus.configured({ persist: true })),
    ])

    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const { db } = yield* Database.Service
        const aggregateID = Event.ID.create()

        yield* bus.publish(LargeEvent, { id: aggregateID, text: "x".repeat(4 * 1024 * 1024) })
        const before = yield* db.get<{ page_count: number }>(sql`PRAGMA page_count`)
        yield* bus.remove(aggregateID)
        const after = yield* db.get<{ page_count: number }>(sql`PRAGMA page_count`)

        expect(before!.page_count - after!.page_count).toBeGreaterThan(0)
        expect(before!.page_count - after!.page_count).toBeLessThanOrEqual(256)
        expect(yield* db.get(sql`PRAGMA integrity_check`)).toEqual({ integrity_check: "ok" })
      }).pipe(Effect.provide(layer), Effect.scoped),
    )
  })

  test("a competing writer defers reclamation without failing the caller", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "busy.db")
    await incremental(filename)

    await open(
      filename,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db.run("CREATE TABLE storage_busy (id TEXT PRIMARY KEY, data BLOB)")
        yield* db.run("INSERT INTO storage_busy VALUES ('remove', zeroblob(4194304))")
        yield* db.run("DELETE FROM storage_busy")
        yield* db.run("PRAGMA wal_checkpoint(TRUNCATE)")
        yield* db.run("PRAGMA busy_timeout = 0")
        const before = yield* db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`)

        const writer = new SQLite(filename)
        writer.run("BEGIN IMMEDIATE")
        yield* DatabaseStorage.reclaim(db)
        const after = yield* db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`)
        writer.run("ROLLBACK")
        writer.close()

        expect(after).toEqual(before)
      }),
    )
  })
})
