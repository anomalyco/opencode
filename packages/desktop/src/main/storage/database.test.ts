import { afterEach, describe, expect, test } from "bun:test"
import { DatabaseSync } from "node:sqlite"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import { migrate, openDatabase } from "./database"
import { migrations } from "./migration.gen"

const tables = (db: ReturnType<typeof drizzle>) =>
  db
    .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .map((row) => row.name)

const expected = ["blob", "document", "extension", "extension_file", "migration", "state"]

const roots: string[] = []

// Bun's node:sqlite shim pins the WAL files on Windows after close(); tolerate the leftover here only.
afterEach(() =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }).catch(() => undefined))),
)

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

  test("a failed migration rolls back the journal without losing existing data", () => {
    const native = new DatabaseSync(":memory:")
    native.exec("CREATE TABLE state (value TEXT); INSERT INTO state VALUES ('kept')")
    const db = drizzle({ client: native })

    expect(() => migrate(db)).toThrow()
    expect(db.all(sql`SELECT id FROM migration`)).toEqual([])
    expect(db.all(sql`SELECT value FROM state`)).toEqual([{ value: "kept" }])
    native.close()
  })

  test("adopts a file written before auto_vacuum and returns the pages it had stranded", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opencode-storage-reclaim-"))
    roots.push(root)
    const file = path.join(root, "drafts.sqlite")

    // A file as the release before this one left it: the default mode, with a large row already
    // deleted and a small one still live.
    const legacy = new DatabaseSync(file)
    legacy.exec("PRAGMA journal_mode=WAL; CREATE TABLE retired (kind TEXT NOT NULL, data BLOB NOT NULL)")
    const insert = legacy.prepare("INSERT INTO retired VALUES (?, ?)")
    insert.run("large", Buffer.alloc(8 * 1024 * 1024))
    insert.run("kept", Buffer.from("kept"))
    legacy.exec("DELETE FROM retired WHERE kind = 'large'")
    legacy.close()

    const database = openDatabase(file)
    expect(database.db.all(sql`SELECT kind FROM retired`)).toEqual([{ kind: "kept" }])
    expect(database.db.all(sql`PRAGMA auto_vacuum`)).toEqual([{ auto_vacuum: 2 }])
    database.db.$client.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    expect((await stat(file)).size).toBeLessThan(1024 * 1024)
    database.close()
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
