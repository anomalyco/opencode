import { randomUUID } from "node:crypto"
import { copyFile, lstat, mkdir, readdir, rm, rmdir, unlink } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

const PREFIX = "opencode-browser-import-"

/**
 * Where copies of another browser's databases, its cookies and its history, live while they are read: a directory of
 * the app's own data, which only the user can read, and the copies being read now. `log` hears a copy that could not
 * be deleted.
 */
export type SnapshotScratch = {
  readonly directory: string
  readonly live: Set<string>
  readonly log: (message: string, detail: Record<string, string>) => void
}

/**
 * Reads another browser's SQLite database from a private copy, with its write-ahead log, so the running browser keeps
 * its lock and its file is never written. A copy is needed: Chromium on Windows holds its database open without sharing
 * while it runs, and SQLite reads a live write-ahead log only through its shared-memory file, which it would write; an
 * immutable open skips the log and so the newest cookies. The copy holds every value, so it is deleted after `read`
 * returns, and copies a crash left behind go before the next one is made.
 */
export async function snapshotDatabase<T>(file: string, scratch: SnapshotScratch, read: (db: DatabaseSync) => T) {
  await mkdir(scratch.directory, { recursive: true, mode: 0o700 })
  await sweepSnapshots(scratch)
  // Named and marked in use before it exists, so a sweep running meanwhile never takes it.
  const directory = path.join(scratch.directory, `${PREFIX}${randomUUID()}`)
  scratch.live.add(directory)
  const copy = path.join(directory, path.basename(file))

  try {
    await mkdir(directory, { mode: 0o700 })
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
    await remove(directory, scratch)
    scratch.live.delete(directory)
  }
}

/**
 * Deletes the copies no read uses: in the scratch directory, and in `legacy`, where earlier versions made them, those
 * older than a minute, so another app instance's read in progress is left alone. A legacy directory, such as `/tmp`,
 * is shared with other users, who can name an entry so: only a real directory of this user's goes, and only the
 * entries directly in it, as earlier versions left them, so no link is ever followed.
 */
export async function sweepSnapshots(scratch: SnapshotScratch, legacy: readonly string[] = []) {
  const stale = async (directory: string, settled: (entry: string) => Promise<boolean>) => {
    const entries = await readdir(directory).catch(() => [])
    const found = entries.filter((entry) => entry.startsWith(PREFIX)).map((entry) => path.join(directory, entry))
    const old = await Promise.all(found.map(async (entry) => ((await settled(entry)) ? [entry] : [])))

    return old.flat()
  }

  const minute = Date.now() - 60_000
  // Windows has no user ids; its temporary directory is the user's own.
  const user = process.getuid?.()
  const own = await stale(scratch.directory, async (entry) => !scratch.live.has(entry))

  const earlier = await Promise.all(
    legacy.map((directory) =>
      stale(directory, async (entry) => {
        const info = await lstat(entry).catch(() => undefined)

        return !!info && info.isDirectory() && (user === undefined || info.uid === user) && info.mtimeMs < minute
      }),
    ),
  )

  await Promise.all([...own.map((entry) => remove(entry, scratch)), ...earlier.flat().map((entry) => removeFlat(entry, scratch))])
}

// Windows refuses to delete a file an indexer or a virus scanner holds open for a moment, so it tries once more.
async function remove(directory: string, scratch: SnapshotScratch) {
  const removed = await rm(directory, { recursive: true, force: true, maxRetries: 1, retryDelay: 200 }).then(
    () => true,
    () => false,
  )

  if (!removed) scratch.log("a copy of another browser's database could not be deleted", { directory })
}

// A link among the entries is deleted itself, never what it points to, and a directory among them is left, so the
// directory stays and is logged.
async function removeFlat(directory: string, scratch: SnapshotScratch) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])

  await Promise.all(
    entries
      .filter((entry) => !entry.isDirectory())
      .map((entry) => unlink(path.join(directory, entry.name)).catch(() => undefined)),
  )

  const removed = await rmdir(directory).then(
    () => true,
    () => false,
  )

  if (!removed) scratch.log("a copy of another browser's database could not be deleted", { directory })
}
