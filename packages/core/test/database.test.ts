import { describe, expect, test } from "bun:test"
import { chmod, stat, writeFile } from "node:fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Database, restrictToOwner } from "@opencode/core/database/database"
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

  // A database left behind by an earlier `sudo opencode` is still readable and writable, so a refused
  // chmod must not stop startup: it used to abort the whole service (#57032).
  test("opens a database it is not allowed to tighten", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")
    await writeFile(filename, "")
    const denied = () => Promise.reject(Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }))

    // The refusal is reported so the caller can warn that the files stay readable by other users.
    await expect(restrictToOwner(filename, denied)).resolves.toEqual([filename, `${filename}-wal`, `${filename}-shm`])
  })

  test("surfaces restriction failures that are not about ownership", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")
    await writeFile(filename, "")
    const failed = () => Promise.reject(Object.assign(new Error("EIO: i/o error"), { code: "EIO" }))

    await expect(restrictToOwner(filename, failed)).rejects.toThrow("EIO")
  })
})
