import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

// Replacing a file is not as safe as it looks on Windows. `rename` over an existing file fails with
// EPERM/EBUSY while *any* other handle holds that file open, even one that granted every share bit
// in `dwShareMode`. Antivirus, search indexers and backup agents open files under AppData\Roaming
// routinely while they scan, so the failure is transient, real, and reported against this code
// path: https://github.com/anomalyco/opencode/issues/51470
//
// The lock clears on its own, so retry before concluding the write cannot land.
const attempts = 4

const retryDelayMs = 15

// A sharing violation is the one failure a later attempt can survive; nothing else clears by
// waiting. The three codes are what Node reports for it, depending on how the holder opened the
// file: EPERM for a denied replacement, EBUSY for a denied open.
function isLockedError(cause: unknown): cause is NodeJS.ErrnoException {
  if (!(cause instanceof Error) || !("code" in cause)) return false

  return cause.code === "EPERM" || cause.code === "EACCES" || cause.code === "EBUSY"
}

// The settings store is read before the storage layer exists and window state is written as the
// window closes, so both callers are synchronous by design. Atomics.wait blocks without spinning,
// and the buffer is per call, so nothing is shared between calls.
function waitForLockToClear(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Runs an operation, retrying while the failure keeps looking like a transient Windows lock.
 * Returns the lock error once the retries run out, and throws anything that waiting cannot fix.
 */
function retryWhileLocked(operation: () => void): Error | undefined {
  let attempt = 0

  while (true) {
    try {
      operation()

      return undefined
    } catch (cause) {
      if (!isLockedError(cause)) throw cause

      attempt += 1

      if (attempt >= attempts) return cause

      waitForLockToClear(retryDelayMs * attempt)
    }
  }
}

/**
 * Replaces a file without ever exposing a half-written one. The contents are written beside the
 * target and renamed over it, retrying the rename while another process holds the target open.
 */
export function writeFileAtomic(file: string, contents: string) {
  const tmp = `${file}.tmp`

  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(tmp, contents)

  let locked: Error | undefined

  try {
    locked = retryWhileLocked(() => renameSync(tmp, file))
  } catch (cause) {
    rmSync(tmp, { force: true })

    throw cause
  }

  if (locked === undefined) return

  // The target stayed locked past the retries. A replacement needs the file closed, but writing
  // through the open handle only needs FILE_SHARE_WRITE, which the scanners that cause this grant.
  // Keeping the update beats dropping it silently, and a write interrupted by a crash is set aside
  // by the reader instead of blocking startup.
  try {
    writeFileSync(file, contents)
  } catch {
    rmSync(tmp, { force: true })

    throw locked
  }

  rmSync(tmp, { force: true })
}
