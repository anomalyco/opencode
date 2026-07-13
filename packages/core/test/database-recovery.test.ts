import { describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { Effect, Layer } from "effect"
import { existsSync, writeFileSync } from "fs"
import path from "path"
import { Database } from "@opencode-ai/core/database/database"
import { tmpdir } from "./fixture/tmpdir"

const build = (filename: string) =>
  Effect.runPromise(Effect.scoped(Layer.build(Database.layerFromPath(filename))))

describe("Database recovery", () => {
  test("moves a malformed database aside and reopens a fresh one", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")

    // Write bytes that are not a valid SQLite database.
    writeFileSync(filename, "this is not a sqlite database".repeat(64))

    await build(filename)

    // The corrupt file is preserved (not deleted) under a *.corrupt-* name, and a
    // usable database now exists at the original path with the migration table.
    const preserved = (await Array.fromAsync(new Bun.Glob("opencode.db.corrupt-*").scan({ cwd: tmp.path }))).length
    expect(preserved).toBeGreaterThan(0)

    const check = new BunDatabase(filename).query("PRAGMA quick_check").get() as { quick_check: string }
    expect(check.quick_check).toBe("ok")
  })

  test("uses WAL journal mode on an ordinary filesystem", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")

    await Effect.runPromise(
      Layer.build(Database.layerFromPath(filename)).pipe(
        Effect.scoped,
        Effect.flatMap(() =>
          Effect.sync(() => {
            const mode = new BunDatabase(filename).query("PRAGMA journal_mode").get() as { journal_mode: string }
            expect(mode.journal_mode).toBe("wal")
          }),
        ),
      ),
    )
  })

  test("leaves an existing healthy database untouched", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")

    await build(filename)
    await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(Layer.build(Database.layerFromPath(filename)), () =>
          Effect.sync(() =>
            expect(existsSync(path.join(tmp.path, "opencode.db"))).toBe(true),
          ),
        ),
      ),
    )

    // No corrupt copy should have been created for a healthy database.
    const preserved = (await Array.fromAsync(new Bun.Glob("opencode.db.corrupt-*").scan({ cwd: tmp.path }))).length
    expect(preserved).toBe(0)
  })
})
