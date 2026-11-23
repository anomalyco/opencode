import { renameSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import { isCliDatabase, migrateDatabase } from "./migration"

export type Database = ReturnType<typeof drizzle>

export function openDatabase(filename: string) {
  const opened = openOwnDatabase(filename)
  // WAL keeps readers off the writer. NORMAL fsyncs at checkpoints only, which survives an app
  // crash but not power loss; the right trade for UI state and far cheaper on Windows.
  opened.native.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY")
  const db = drizzle({ client: opened.native })
  migrate(db)

  return { db, moved: opened.moved, close: () => opened.native.close() }
}

export function migrate(db: Database) {
  return migrateDatabase(db.$client)
}

// A drafts.sqlite symlinked or copied from the CLI's opencode.db can't hold desktop tables. Renaming it moves
// only this directory entry, so a symlink's target and the CLI data in it stay untouched.
function openOwnDatabase(filename: string) {
  const native = new DatabaseSync(filename)

  if (!isCliDatabase(native)) return { native }
  native.close()
  const moved = `${filename}.cli-${Date.now()}`
  renameSync(filename, moved)

  return { native: new DatabaseSync(filename), moved }
}
