import { DatabaseSync } from "node:sqlite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import { migrateDatabase } from "./migration"

export type Database = ReturnType<typeof drizzle>

export function openDatabase(filename: string) {
  const native = new DatabaseSync(filename)
  // Before anything else: switching the journal writes page 1, and auto_vacuum only takes effect
  // while the file has no schema yet. INCREMENTAL keeps freed pages out of the file's high-water
  // mark; `reclaim` is the other half.
  native.exec("PRAGMA auto_vacuum=INCREMENTAL")
  // WAL keeps readers off the writer. NORMAL fsyncs at checkpoints only, which survives an app
  // crash but not power loss; the right trade for UI state and far cheaper on Windows.
  native.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY")

  // A file written before the pragma above is still in the default mode and only VACUUM switches
  // it, so adopt it once here. The rewrite copies the live rows, which in a store of drafts is
  // nothing beside the pages it gives back.
  if (native.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum === 0) native.exec("VACUUM")
  const db = drizzle({ client: native })
  migrate(db)

  return { db, close: () => native.close() }
}

// Ask for the pages a delete freed. auto_vacuum=INCREMENTAL records them across writes but moves
// and truncates only when asked, so without this the file stays at the high-water mark of the
// largest draft it ever held. Free when there is nothing to give back, so callers ask freely.
export function reclaim(db: Database) {
  db.run(sql`PRAGMA incremental_vacuum`)
}

export function migrate(db: Database) {
  return migrateDatabase(db.$client)
}
