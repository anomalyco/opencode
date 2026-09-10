import { DatabaseSync } from "node:sqlite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { migrations } from "./migration.gen"

export type Database = ReturnType<typeof drizzle>

// Owned by the runner rather than schema.ts so drizzle-kit never tries to migrate the journal itself.
const journal = sqliteTable("migration", {
  id: text().primaryKey(),
  time_completed: integer().notNull(),
})

export function openDatabase(filename: string) {
  const native = new DatabaseSync(filename)
  // WAL keeps readers off the writer. NORMAL fsyncs at checkpoints only, which survives an app
  // crash but not power loss; the right trade for UI state and far cheaper on Windows.
  native.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY")
  const db = drizzle({ client: native })
  migrate(db)
  return { db, close: () => native.close() }
}

export function migrate(db: Database) {
  db.run(sql`CREATE TABLE IF NOT EXISTS ${journal} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
  const applied = new Set(
    db
      .select({ id: journal.id })
      .from(journal)
      .all()
      .map((row) => row.id),
  )
  // drafts.sqlite predates the journal: its tables were created by hand, so the migration that
  // would create them is recorded as applied instead of run.
  const legacy =
    applied.size === 0 &&
    db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'document'`) !== undefined
  const pending = migrations.filter((migration) => !applied.has(migration.id))
  if (pending.length === 0) return []
  db.transaction((tx) => {
    pending.forEach((migration, index) => {
      if (!(legacy && index === 0)) migration.statements.forEach((statement) => tx.run(sql.raw(statement)))
      tx.insert(journal).values({ id: migration.id, time_completed: Date.now() }).run()
    })
  })
  return pending.map((migration) => migration.id)
}
