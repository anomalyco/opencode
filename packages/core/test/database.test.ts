import { describe, expect, test } from "bun:test"
import { chmod, stat, writeFile } from "node:fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import SQLite from "bun:sqlite"
import { App } from "@opencode/core/app"
import { Database } from "@opencode/core/database/database"
import { Flag } from "@opencode/core/flag"
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

// Another connection keeps committed frames in the WAL; a checkpoint copies them into the main file and grows it.
const mainFileGrowsOnOpen = async (channel: string) => {
  await using tmp = await tmpdir()
  const filename = path.join(tmp.path, "opencode.db")
  const open = Layer.build(Database.layer({ path: filename })).pipe(
    Effect.provideService(Global.Service, Global.make({ data: tmp.path })),
    Effect.provideService(App.Service, App.make({ channel })),
    Effect.provideService(Flag.Overrides, undefined),
  )
  await Effect.runPromise(Effect.scoped(open))
  using writer = new SQLite(filename)
  writer.run("PRAGMA wal_autocheckpoint = 0")
  writer.run("CREATE TABLE filler (data BLOB)")
  writer.run("INSERT INTO filler VALUES (randomblob(100000))")
  const before = (await stat(filename)).size
  return await Effect.runPromise(
    Effect.gen(function* () {
      yield* open
      return (yield* Effect.promise(() => stat(filename))).size > before
    }).pipe(Effect.scoped),
  )
}

describe("Database startup checkpoint", () => {
  test("checkpoints the WAL on open in releases", async () => {
    expect(await mainFileGrowsOnOpen("latest")).toBe(true)
  })

  test("leaves the WAL to SQLite's automatic checkpoint in dev builds", async () => {
    expect(await mainFileGrowsOnOpen("dev")).toBe(false)
  })
})

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
