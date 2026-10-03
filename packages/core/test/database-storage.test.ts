import { describe, expect, test } from "bun:test"
import path from "node:path"
import { sql } from "drizzle-orm"
import { Effect, Schema, type Scope } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseStorage } from "@opencode-ai/core/database/storage"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { tmpdir } from "./fixture/tmpdir"

const sqlite = await import("bun:sqlite")

const run = <A, E>(filename: string, effect: Effect.Effect<A, E, Database.Service | EventV2.Service | Scope.Scope>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]), [
          [Database.node, Database.layerFromPath(filename)],
        ]),
      ),
      Effect.scoped,
    ),
  )

async function fixture(filename: string, mode: "NONE" | "FULL" | "INCREMENTAL") {
  await run(filename, Effect.void)
  const db = new sqlite.Database(filename)
  db.run(`PRAGMA auto_vacuum = ${mode}`)
  db.run("VACUUM")
  db.run("CREATE TABLE storage_fixture (id TEXT PRIMARY KEY, data BLOB)")
  db.run("INSERT INTO storage_fixture VALUES ('keep', 'retained')")
  db.run("INSERT INTO storage_fixture VALUES ('remove', zeroblob(4194304))")
  db.run("DELETE FROM storage_fixture WHERE id = 'remove'")
  db.run("PRAGMA wal_checkpoint(TRUNCATE)")
  db.close()
}

describe("database storage", () => {
  test("new databases can reclaim deleted pages incrementally", async () => {
    await using tmp = await tmpdir()
    await run(
      path.join(tmp.path, "new.db"),
      Effect.gen(function* () {
        const database = yield* Database.Service
        expect(yield* database.db.get(sql`PRAGMA auto_vacuum`)).toEqual({ auto_vacuum: 2 })
      }),
    )
  })

  test("reopening an incremental database reclaims a bounded number of free pages", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "incremental.db")
    await fixture(filename, "INCREMENTAL")
    const db = new sqlite.Database(filename)
    const before = db.query<{ freelist_count: number }, []>("PRAGMA freelist_count").get()!.freelist_count
    db.close()
    const size = Bun.file(filename).size
    expect(before).toBeGreaterThan(256)

    await run(
      filename,
      Effect.gen(function* () {
        const database = yield* Database.Service
        const after = yield* database.db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`)
        expect(before - after!.freelist_count).toBeGreaterThan(0)
        expect(before - after!.freelist_count).toBeLessThanOrEqual(256)
        expect(after!.freelist_count).toBeGreaterThan(0)
        expect(yield* database.db.all(sql`SELECT id, data FROM storage_fixture`)).toEqual([
          { id: "keep", data: "retained" },
        ])
        expect(yield* database.db.get(sql`PRAGMA integrity_check`)).toEqual({ integrity_check: "ok" })
      }),
    )
    expect(Bun.file(filename).size).toBeLessThan(size)
  })

  test.each(["NONE", "FULL"] as const)("preserves an existing %s database without rebuilding it", async (mode) => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "existing.db")
    await fixture(filename, mode)
    const db = new sqlite.Database(filename)
    const before = db.query("PRAGMA freelist_count").get()
    db.close()
    const size = Bun.file(filename).size

    await run(
      filename,
      Effect.gen(function* () {
        const database = yield* Database.Service
        expect(yield* database.db.get(sql`PRAGMA auto_vacuum`)).toEqual({ auto_vacuum: mode === "NONE" ? 0 : 1 })
        expect(yield* database.db.get(sql`PRAGMA freelist_count`)).toEqual(before)
        expect(yield* database.db.all(sql`SELECT id, data FROM storage_fixture`)).toEqual([
          { id: "keep", data: "retained" },
        ])
      }),
    )
    expect(Bun.file(filename).size).toBe(size)
  })

  test("removing an aggregate reclaims pages while preserving other durable events", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "events.db")
    await fixture(filename, "INCREMENTAL")
    const event = EventV2.define({
      type: "test.storage",
      durable: { version: 1, aggregate: "id" },
      schema: { id: Schema.String, text: Schema.String },
    })
    await run(
      filename,
      Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* EventV2.Service
        yield* events.publish(event, { id: "remove", text: "x".repeat(4 * 1024 * 1024) })
        yield* events.publish(event, { id: "keep", text: "retained" })
        const before = yield* database.db.get<{ page_count: number }>(sql`PRAGMA page_count`)
        yield* events.remove("remove")
        const after = yield* database.db.get<{ page_count: number }>(sql`PRAGMA page_count`)
        expect(after!.page_count).toBeLessThan(before!.page_count)
        const rows = yield* database.db.all<{ aggregate_id: string; data: string }>(
          sql`SELECT aggregate_id, data FROM event`,
        )
        expect(rows.map((row) => ({ id: row.aggregate_id, data: JSON.parse(row.data) }))).toEqual([
          { id: "keep", data: { id: "keep", text: "retained" } },
        ])
        expect(yield* database.db.all(sql`SELECT aggregate_id FROM event_sequence`)).toEqual([{ aggregate_id: "keep" }])
        expect(yield* database.db.get(sql`PRAGMA integrity_check`)).toEqual({ integrity_check: "ok" })
      }),
    )
  })

  test("a competing writer defers maintenance without failing the caller", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "busy.db")
    await fixture(filename, "INCREMENTAL")
    await run(
      filename,
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.db.run("PRAGMA busy_timeout = 0")
        const before = yield* database.db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`)
        expect(before!.freelist_count).toBeGreaterThan(0)
        const writer = new sqlite.Database(filename)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            writer.run("ROLLBACK")
            writer.close()
          }),
        )
        writer.run("BEGIN IMMEDIATE")
        yield* DatabaseStorage.reclaim(database.db)
        expect(yield* database.db.get(sql`PRAGMA freelist_count`)).toEqual(before)
        expect(yield* database.db.all(sql`SELECT id, data FROM storage_fixture`)).toEqual([
          { id: "keep", data: "retained" },
        ])
      }),
    )
  })

  test("a WAL reader keeps its snapshot while reclamation makes bounded progress", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "reader.db")
    await fixture(filename, "INCREMENTAL")
    const reader = new sqlite.Database(filename)
    reader.run("BEGIN")
    expect(reader.query("SELECT id, data FROM storage_fixture").all()).toEqual([{ id: "keep", data: "retained" }])
    try {
      await run(
        filename,
        Effect.gen(function* () {
          const database = yield* Database.Service
          const before = yield* database.db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`)
          yield* DatabaseStorage.reclaim(database.db)
          const after = yield* database.db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`)
          expect(before!.freelist_count - after!.freelist_count).toBe(256)
          expect(reader.query("SELECT id, data FROM storage_fixture").all()).toEqual([{ id: "keep", data: "retained" }])
        }),
      )
    } finally {
      reader.run("ROLLBACK")
      reader.close()
    }
    await run(
      filename,
      Effect.gen(function* () {
        const database = yield* Database.Service
        expect(yield* database.db.get(sql`PRAGMA integrity_check`)).toEqual({ integrity_check: "ok" })
        expect(yield* database.db.all(sql`SELECT id, data FROM storage_fixture`)).toEqual([
          { id: "keep", data: "retained" },
        ])
      }),
    )
  })
})
