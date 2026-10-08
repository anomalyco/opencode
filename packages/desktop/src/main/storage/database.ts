import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import { migrateDatabase } from "./migration"

export type Database = ReturnType<typeof drizzle>

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
  return migrateDatabase(db.$client)
}
