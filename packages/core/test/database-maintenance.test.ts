import { describe, expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMaintenance } from "@opencode-ai/core/database/maintenance"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import path from "node:path"
import { tmpdir } from "./fixture/tmpdir"

describe("DatabaseMaintenance", () => {
  test("analyzes, backs up, checkpoints, and vacuums an isolated database", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "maintenance.sqlite")
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const initial = yield* DatabaseMaintenance.overview(database)
        const analysis = yield* DatabaseMaintenance.analyze(database)
        const index = yield* database.db.get<{ name: string }>(sql`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name IN ('event_compaction_snapshot', 'event_compaction_state')
        `)
        const backup = yield* DatabaseMaintenance.backup(database)

        yield* database.db.run(sql`CREATE TABLE maintenance_payload (data BLOB NOT NULL)`).pipe(Effect.orDie)
        yield* database.db
          .run(
            sql`INSERT INTO maintenance_payload (data) VALUES (zeroblob(1048576)), (zeroblob(1048576)),
                    (zeroblob(1048576)), (zeroblob(1048576))`,
          )
          .pipe(Effect.orDie)
        yield* database.db.run(sql`DELETE FROM maintenance_payload`).pipe(Effect.orDie)
        const checkpoint = yield* DatabaseMaintenance.checkpoint(database)
        const beforeVacuum = yield* DatabaseMaintenance.overview(database)
        const vacuum = yield* DatabaseMaintenance.vacuum(database)

        return { initial, analysis, index, backup, checkpoint, beforeVacuum, vacuum }
      }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped),
    )

    expect(result.initial.path).toBe(filename)
    expect(result.initial.databaseBytes).toBeGreaterThan(0)
    expect(result.analysis).toMatchObject({ candidates: 0, payloadBytesReclaimable: 0 })
    expect(result.index).toBeUndefined()
    expect(result.backup.integrity).toBe("ok")
    expect(await Bun.file(result.backup.path).exists()).toBe(true)
    expect(result.checkpoint.busy).toBe(0)
    expect(result.beforeVacuum.reusableBytes).toBeGreaterThan(0)
    expect(result.vacuum.backup.integrity).toBe("ok")
    expect(result.vacuum.bytesReclaimed).toBeGreaterThan(0)
    expect(result.vacuum.checkpointBusy).toBe(0)
    expect(result.vacuum.after.allocatedBytes).toBeLessThan(result.vacuum.before.allocatedBytes)
    expect(result.vacuum.after.walBytes).toBe(0)
    expect(result.vacuum.after.totalBytes).toBeLessThan(result.vacuum.before.totalBytes)
  }, 30_000)
})
