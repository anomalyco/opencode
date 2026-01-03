import { Instance } from "../project/instance"
import { Log } from "../util/log"

export namespace FileTime {
  const log = Log.create({ service: "file.time" })

  // Tolerance in milliseconds to account for filesystem timestamp granularity
  // and async metadata updates (especially on Windows NTFS, WSL2 9p)
  const TOLERANCE_MS = 10

  // Per-session read times plus per-file write locks.
  // All tools that overwrite existing files should run their
  // assert/read/write/update sequence inside withLock(filepath, ...)
  // so concurrent writes to the same file are serialized.
  export const state = Instance.state(() => {
    const read: {
      [sessionID: string]: {
        [path: string]: Date | undefined
      }
    } = {}
    const locks = new Map<string, Promise<void>>()
    return {
      read,
      locks,
    }
  })

  /**
   * Record when a file was last read or written.
   * @param sessionID - The session ID
   * @param file - The file path
   * @param mtime - Optional: Use the file's actual mtime instead of current time.
   *                This should be passed after writes to avoid race conditions.
   */
  export function read(sessionID: string, file: string, mtime?: Date) {
    log.info("read", { sessionID, file })
    const { read } = state()
    read[sessionID] = read[sessionID] || {}
    read[sessionID][file] = mtime ?? new Date()
  }

  export function get(sessionID: string, file: string) {
    return state().read[sessionID]?.[file]
  }

  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    const current = state()
    const currentLock = current.locks.get(filepath) ?? Promise.resolve()
    let release: () => void = () => {}
    const nextLock = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = currentLock.then(() => nextLock)
    current.locks.set(filepath, chained)
    await currentLock
    try {
      return await fn()
    } finally {
      release()
      if (current.locks.get(filepath) === chained) {
        current.locks.delete(filepath)
      }
    }
  }

  /**
   * Assert that a file has not been modified since it was last read.
   * Includes a small tolerance to handle filesystem timestamp granularity.
   */
  export async function assert(sessionID: string, filepath: string) {
    const time = get(sessionID, filepath)
    if (!time) throw new Error(`You must read the file ${filepath} before overwriting it. Use the Read tool first`)
    const stats = await Bun.file(filepath).stat()
    // Add tolerance to handle filesystem timestamp race conditions
    // The mtime can be slightly ahead of our recorded time due to:
    // - Filesystem timestamp granularity (varies by FS)
    // - Async metadata updates (Windows NTFS, WSL2 9p)
    // - System clock variations
    if (stats.mtime.getTime() > time.getTime() + TOLERANCE_MS) {
      throw new Error(
        `File ${filepath} has been modified since it was last read.\nLast modification: ${stats.mtime.toISOString()}\nLast read: ${time.toISOString()}\n\nPlease read the file again before modifying it.`,
      )
    }
  }
}
