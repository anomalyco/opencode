import type { DatabaseSync } from "node:sqlite"
import { migrations } from "./migration.gen"

/** The desktop journal, usable by the early preload read without loading Drizzle or Effect. */
export function migrateDatabase(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)")

  const applied = new Set(db.prepare("SELECT id FROM migration").all().map((row) => row.id))

  // drafts.sqlite predates the journal: adopt its existing draft tables instead of creating them again.
  const legacy =
    applied.size === 0 &&
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'document'").get() !== undefined

  const pending = migrations.filter((migration) => !applied.has(migration.id))

  if (pending.length === 0) return []
  db.exec("BEGIN")

  try {
    const record = db.prepare("INSERT INTO migration (id, time_completed) VALUES (?, ?)")
    pending.forEach((migration, index) => {
      if (!(legacy && index === 0)) migration.statements.forEach((statement) => db.exec(statement))
      record.run(migration.id, Date.now())
    })
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }

  return pending.map((migration) => migration.id)
}
