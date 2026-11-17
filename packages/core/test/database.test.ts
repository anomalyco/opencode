import { describe, expect, test } from "bun:test"
import { Database as SQLite } from "bun:sqlite"
import { existsSync } from "node:fs"
import { chmod, stat, statfs, writeFile } from "node:fs/promises"
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
      const suffixes = ["", ...["-wal", "-shm"].filter((suffix) => existsSync(filename + suffix))]
      return yield* Effect.promise(() =>
        Promise.all(suffixes.map(async (suffix) => (await stat(filename + suffix)).mode & 0o777)),
      )
    }).pipe(Effect.scoped, Effect.provideService(Global.Service, Global.make({ data: path.dirname(filename) }))),
  )

describe.skipIf(process.platform === "win32")("Database file permissions", () => {
  test("creates the database and sidecars readable only by the owner", async () => {
    await using tmp = await tmpdir()

    expect(new Set(await openModes(path.join(tmp.path, "opencode.db")))).toEqual(new Set([0o600]))
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

    expect(new Set(await openModes(filename))).toEqual(new Set([0o600]))
  })
})

test.each([false, true])("selects the journal and preserves data (prior WAL = %s)", async (existing) => {
  await using tmp = await tmpdir()
  const filename = path.join(tmp.path, "journal.db")
  const nfs = process.platform === "linux" && (await statfs(tmp.path)).type === 0x6969
  for (let i = 0; i < 2; i++) {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        expect(yield* db.get("PRAGMA journal_mode")).toEqual({ journal_mode: nfs ? "delete" : "wal" })
        expect(existsSync(filename + "-wal")).toBe(!nfs)
        expect(existsSync(filename + "-shm")).toBe(!nfs)
        if (i === 0) {
          yield* db.run("CREATE TABLE journal_probe (value TEXT)")
          yield* db.run("INSERT INTO journal_probe VALUES ('saved')")
        }
        expect(yield* db.all("SELECT value FROM journal_probe")).toEqual([{ value: "saved" }])
        expect(yield* db.get("PRAGMA integrity_check")).toEqual({ integrity_check: "ok" })
      }).pipe(
        Effect.provide(Database.layer({ path: filename })),
        Effect.provideService(Global.Service, Global.make({ data: tmp.path })),
        Effect.scoped,
      ),
    )
    if (existing && i === 0) {
      using db = new SQLite(filename)
      db.exec("PRAGMA journal_mode = WAL")
    }
  }
})
