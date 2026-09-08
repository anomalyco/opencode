import { describe, expect, test } from "bun:test"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import { migrate, openDatabase } from "./database"
import { migrations } from "./migration.gen"

const tables = (db: ReturnType<typeof drizzle>) =>
  db
    .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .map((row) => row.name)

describe("database", () => {
  test("bootstraps every table on a fresh database and is idempotent", () => {
    const database = openDatabase(":memory:")
    expect(tables(database.db)).toEqual([
      "blob",
      "desktop_extension",
      "desktop_extension_file",
      "document",
      "migration",
      "state",
    ])
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
    expect(tables(db)).toEqual([
      "blob",
      "desktop_extension",
      "desktop_extension_file",
      "document",
      "migration",
      "state",
    ])
    expect(db.all<{ value: string }>(sql`SELECT value FROM document`)).toEqual([{ value: "v" }])
    expect(migrate(db)).toEqual([])
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
