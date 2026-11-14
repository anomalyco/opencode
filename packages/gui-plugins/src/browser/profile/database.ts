import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

/**
 * Reads another browser's SQLite database from a private copy, with its write-ahead log, so the running browser keeps
 * its lock and its file is never written. The copy is removed after `read` returns.
 */
export async function snapshotDatabase<T>(file: string, read: (db: DatabaseSync) => T) {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-browser-import-"))
  const copy = path.join(directory, path.basename(file))

  try {
    await copyFile(file, copy)
    // A sidecar that does not exist is normal: the browser checkpointed or uses another journal mode.
    await Promise.all(
      ["-wal", "-shm", "-journal"].map((suffix) =>
        copyFile(`${file}${suffix}`, `${copy}${suffix}`).catch(() => undefined),
      ),
    )
    const db = new DatabaseSync(copy)

    try {
      return read(db)
    } finally {
      db.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}
