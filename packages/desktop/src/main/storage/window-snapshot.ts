import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { WindowSnapshot } from "../../shared/ipc-transport"
import { migrateDatabase } from "./migration"
import { readEnableState } from "../extension/enable-state"

// Before the storage layer exists, nothing has been written in this process and every namespace is at revision 0.
// Legacy electron-store files can make storage stale, but explicit extension settings still come from SQLite.
export function readWindowSnapshot(userData: string, names: readonly string[]): WindowSnapshot {
  const file = path.join(userData, "drafts.sqlite")

  if (!existsSync(file)) return { storage: {}, extensions: [] }

  try {
    const legacy = readdirSync(userData).some((name) => name === "default.dat" || /^opencode\..+\.dat$/.test(name))
    const db = new DatabaseSync(file)

    try {
      migrateDatabase(db)

      const rows = db.prepare("SELECT key, value FROM state WHERE name = ?")

      return {
        storage: legacy
          ? {}
          : Object.fromEntries(
              names.map((name) => [
                name,
                {
                  // SAFETY: the journaled state table declares both selected columns TEXT NOT NULL.
                  items: Object.fromEntries(
                    (rows.all(name) as { key: string; value: string }[]).map((row) => [row.key, row.value]),
                  ),
                  revision: 0,
                },
              ]),
            ),
        extensions: readEnableState(db),
      }
    } finally {
      db.close()
    }
  } catch {
    return { storage: {} }
  }
}
