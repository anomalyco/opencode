import { describe, expect, test } from "bun:test"
import { chmod, stat, writeFile } from "node:fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Database } from "@opencode/core/database/database"
import { Global } from "@opencode/util/global"
import { tmpdir } from "./fixture/tmpdir"

// Read while the connection is open: SQLite may remove the sidecars on close.
const openModes = (filename: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Layer.build(Database.layer({ path: filename }))
      return yield* Effect.promise(() =>
        Promise.all(["", "-wal", "-shm"].map(async (suffix) => (await stat(filename + suffix)).mode & 0o777)),
      )
    }).pipe(Effect.scoped, Effect.provideService(Global.Service, Global.make({ data: path.dirname(filename) }))),
  )

describe.skipIf(process.platform === "win32")("Database file permissions", () => {
  test("creates the database and sidecars readable only by the owner", async () => {
    await using tmp = await tmpdir()

    expect(await openModes(path.join(tmp.path, "opencode.db"))).toEqual([0o600, 0o600, 0o600])
  })

  test("tightens an existing database and sidecars", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")
    await Promise.all(
      ["", "-wal", "-shm"].map(async (suffix) => {
        await writeFile(filename + suffix, "")
        await chmod(filename + suffix, 0o644)
      }),
    )

    expect(await openModes(filename)).toEqual([0o600, 0o600, 0o600])
  })
})

describe.skipIf(process.platform === "win32")("Database WAL switch", () => {
  // Switching a new file to WAL takes an exclusive lock, and SQLite does not run the busy handler
  // for a journal-mode change, so a connection that finds the lock held fails with SQLITE_BUSY
  // instead of waiting. Two processes starting on one new database at the same time hit exactly
  // this, and the loser used to exit. Hold the lock the way that other process would and require
  // the connection to wait for it.
  test("waits for a held write lock instead of failing when switching a new file to WAL", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")
    const { Database: SqliteDatabase } = await import("bun:sqlite")

    const holder = new SqliteDatabase(filename, { create: true, readwrite: true })
    holder.run("BEGIN IMMEDIATE;")

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          Effect.sleep("50 millis").pipe(Effect.andThen(Effect.sync(() => holder.run("COMMIT;")))),
        )
        yield* Layer.build(Database.layer({ path: filename }))
      }).pipe(Effect.scoped, Effect.provideService(Global.Service, Global.make({ data: path.dirname(filename) }))),
    )

    expect(holder.query("PRAGMA journal_mode;").get()).toEqual({ journal_mode: "wal" })
    holder.close()
  })
})
