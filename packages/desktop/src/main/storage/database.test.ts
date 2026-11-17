import { describe, expect, test } from "bun:test"
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import { migrate, openDatabase } from "./database"
import { migrations } from "./migration.gen"
import { readWindowSnapshot } from "./window-snapshot"

const tables = (db: ReturnType<typeof drizzle>) =>
  db
    .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .map((row) => row.name)

const expected = ["blob", "document", "migration", "plugin", "state"]

describe("database", () => {
  test("bootstraps every table on a fresh database and is idempotent", () => {
    const database = openDatabase(":memory:")
    expect(tables(database.db)).toEqual(expected)
    expect(migrate(database.db)).toEqual([])
    database.close()
  })

  test("adopts a drafts.sqlite created before the journal existed", () => {
    const native = new DatabaseSync(":memory:")
    native.exec(
      "CREATE TABLE document (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE blob (id TEXT PRIMARY KEY, data BLOB NOT NULL); INSERT INTO document VALUES ('k', 'v')",
    )
    const db = drizzle({ client: native })
    expect(migrate(db)).toEqual(migrations.map((migration) => migration.id))
    expect(tables(db)).toEqual(expected)
    expect(db.all<{ value: string }>(sql`SELECT value FROM document`)).toEqual([{ value: "v" }])
    expect(migrate(db)).toEqual([])
  })

  test("dropping archive files keeps every saved enable state and the columns older versions read", () => {
    const native = new DatabaseSync(":memory:")
    native.exec("CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)")
    const archived = migrations.findIndex((migration) => migration.id === "20260930041551_extension") + 1
    migrations.slice(0, archived).forEach((migration) => {
      migration.statements.forEach((statement) => native.exec(statement))
      native.prepare("INSERT INTO migration (id, time_completed) VALUES (?, 0)").run(migration.id)
    })
    native.exec(
      "INSERT INTO extension VALUES ('browser', 0, NULL, NULL), ('acme', 1, '{}', 'r1'); INSERT INTO extension_file VALUES ('acme', 'index.js', x'00')",
    )
    const db = drizzle({ client: native })

    expect(migrate(db)).toEqual(migrations.slice(archived).map((migration) => migration.id))
    expect(tables(db)).toEqual(expected)

    const saved = [
      { id: "acme", enabled: 1, manifest: "{}", revision: "r1" },
      { id: "browser", enabled: 0, manifest: null, revision: null },
    ]

    expect(db.all(sql`SELECT id, enabled, manifest, revision FROM plugin ORDER BY id`)).toEqual(saved)
    // Releases from 2.0.24 until the rename read the table by its old name; a downgraded app still finds the same rows there.
    expect(db.all(sql`SELECT id, enabled, manifest, revision FROM extension ORDER BY id`)).toEqual(saved)
    native.close()
  })

  // Symlinks need elevated privileges on Windows.
  test.each(["symlink", "copy"].filter((link) => link === "copy" || process.platform !== "win32"))(
    "moves aside a drafts.sqlite that is the CLI database (%s) without writing to it",
    (link) => {
      const root = mkdtempSync(path.join(tmpdir(), "opencode-drafts-cli-"))
      const cli = path.join(root, "opencode.db")
      const drafts = path.join(root, "drafts.sqlite")
      const seeded = new DatabaseSync(cli)
      seeded.exec(
        "CREATE TABLE session_v2 (id TEXT PRIMARY KEY); CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL); INSERT INTO migration VALUES ('20261010180456_project_time_archived', 0)",
      )
      seeded.close()

      if (link === "symlink") symlinkSync(cli, drafts)

      if (link === "copy") copyFileSync(cli, drafts)

      readWindowSnapshot(root, ["settings"])
      const database = openDatabase(drafts)

      expect(tables(database.db)).toEqual(expected)
      expect(database.moved).toStartWith(`${drafts}.cli-`)
      database.close()
      const moved = drizzle({ client: new DatabaseSync(database.moved ?? "") })
      const original = drizzle({ client: new DatabaseSync(cli) })

      for (const db of [moved, original]) {
        expect(tables(db)).toEqual(["migration", "session_v2"])
        expect(db.all(sql`SELECT id FROM migration`)).toEqual([{ id: "20261010180456_project_time_archived" }])
        db.$client.close()
      }

      rmSync(root, { recursive: true, force: true })
    },
  )

  test("a failed migration rolls back the journal without losing existing data", () => {
    const native = new DatabaseSync(":memory:")
    native.exec("CREATE TABLE state (value TEXT); INSERT INTO state VALUES ('kept')")
    const db = drizzle({ client: native })

    expect(() => migrate(db)).toThrow()
    expect(db.all(sql`SELECT id FROM migration`)).toEqual([])
    expect(db.all(sql`SELECT value FROM state`)).toEqual([{ value: "kept" }])
    native.close()
  })

  test("rendered registry matches the drizzle-kit output on disk", async () => {
    const directory = path.join(import.meta.dirname, "migration")

    const ids = (await Array.fromAsync(new Bun.Glob("*/migration.sql").scan({ cwd: directory })))
      .map((file) => path.dirname(file))
      .sort()

    expect(migrations.map((migration) => migration.id)).toEqual(ids)

    for (const migration of migrations) {
      const source = (await Bun.file(path.join(directory, migration.id, "migration.sql")).text()).replaceAll(
        "\r\n",
        "\n",
      )

      for (const statement of migration.statements) expect(source).toContain(statement)
    }
  })
})
