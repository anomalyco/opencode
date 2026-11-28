import { describe, expect, test } from "bun:test"
import { chmod, mkdir, stat, writeFile } from "node:fs/promises"
import path from "path"
import { Effect, Layer, Logger } from "effect"
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

describe("Database startup failure logging", () => {
  test("an open failure records the operation, database file and sqlite result codes", async () => {
    await using tmp = await tmpdir()
    // A directory cannot be opened as a database file; SQLite reports CANTOPEN.
    const filename = path.join(tmp.path, "opencode.db")
    await mkdir(filename)

    const output = new Array<ReturnType<typeof Logger.formatStructured.log>>()
    const logger = Logger.map(Logger.formatStructured, (entry) => {
      output.push(entry)
    })

    await Effect.scoped(
      Layer.build(Database.layer({ path: filename })).pipe(
        Effect.provideService(Global.Service, Global.make({ data: tmp.path })),
        Effect.provide(Logger.layer([logger])),
        // sqliteLayer dies on an open failure; sandboxing the build surfaces it instead of crashing the test.
        Effect.sandbox,
        Effect.ignore,
      ),
    ).pipe(Effect.runPromise)

    const fields = output.flatMap((entry) =>
      Array.isArray(entry.message) && entry.message[0] === "Failed to configure database" ? [entry.message[1]] : [],
    )[0]
    expect(fields).toEqual(
      expect.objectContaining({ operation: "open", file: "main", code: "SQLITE_CANTOPEN", errno: 14 }),
    )
  })
})
