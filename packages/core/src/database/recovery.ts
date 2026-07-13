export * as DatabaseRecovery from "./recovery"

import { existsSync, renameSync } from "node:fs"

// A malformed SQLite database bricks every future launch until the file is
// removed by hand. Instead of deleting it, move the database and its WAL/SHM
// sidecars aside so a fresh database can be created while the corrupt bytes are
// preserved for later salvage. Renaming (rather than unlinking) is atomic, can
// never lose data, and tolerates stale .nfs* handles from crashed processes.
export function renameAside(filename: string) {
  const stamp = Date.now()
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = filename + suffix
    if (!existsSync(source)) continue
    try {
      renameSync(source, `${filename}.corrupt-${stamp}${suffix}`)
    } catch {}
  }
}
