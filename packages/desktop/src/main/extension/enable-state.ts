import type { DatabaseSync } from "node:sqlite"
import type { EnableState } from "@opencode/gui-extensions/sdk/bridge"

/** Explicit settings only: both startup readers and the manager resolve absent rows through the same SDK rule. */
export function readEnableState(db: DatabaseSync): readonly EnableState[] {
  return db.prepare("SELECT id, enabled FROM extension").all().map((row) => {
    // SAFETY: extension.id is TEXT PRIMARY KEY; extension.enabled is INTEGER NOT NULL in every journaled schema.
    const id = row.id as string

    return { id, enabled: row.enabled === 1 }
  })
}
