import path from "path"
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "fs/promises"

export function readText(filePath: string) {
  return readFile(filePath, "utf8")
}

export async function readJson<T>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T
}

export async function writeText(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

export async function appendText(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, content)
}

// Replacing a file is not safe on Windows: while any other handle holds the destination open, the
// rename fails with EPERM, or EBUSY. Antivirus, the search indexer, backup agents and a second TUI
// writing the same state all do that, so the failure is transient and clears on its own. The shape
// follows the desktop settings write (#51470, PR #54530): the first attempt, then one retry per
// delay below, then the last error is rethrown. Waiting cannot fix anything else, so any other code
// fails on the first attempt. Only a rename that succeeded replaces the destination, so a write that
// never landed leaves the previous file whole.
const renameRetries = [50, 150, 450]

/** Seam for tests: node:fs cannot hold a destination open on POSIX, so the lock is injected there. */
export type LockRetry = {
  readonly rename?: (from: string, to: string) => Promise<void>
  readonly wait?: (ms: number) => Promise<void>
}

/**
 * Renames `temporary` over `filePath`, retrying while the failure is a transient Windows lock.
 * Rethrows the last error once the retries run out, leaving the staging file for the caller to
 * clean up.
 */
export async function renameWithRetry(temporary: string, filePath: string, lock: LockRetry = {}) {
  const move = lock.rename ?? rename
  const wait = lock.wait ?? waiting
  for (let attempt = 0; ; attempt++) {
    const failure = await move(temporary, filePath).then(
      () => undefined,
      (error: unknown) => error,
    )
    if (failure === undefined) return
    if (!isLockedError(failure) || attempt >= renameRetries.length) throw failure
    await wait(renameRetries[attempt])
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown, lock: LockRetry = {}) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value)).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
  await renameWithRetry(temporary, filePath, lock).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
}

/**
 * Writes JSON without making the caller wait for it. State saves run from event handlers that cannot
 * await, so a write that is still locked after the retries is handed to `report` rather than left as
 * an unhandled rejection.
 */
export function writeJsonAtomicDetached(
  filePath: string,
  value: unknown,
  report: (error: unknown) => void,
  lock: LockRetry = {},
): Promise<void> {
  return writeJsonAtomic(filePath, value, lock).then(() => undefined, report)
}

function isLockedError(cause: unknown) {
  if (!(cause instanceof Error)) return false
  const code = (cause as { code?: unknown }).code
  return code === "EPERM" || code === "EBUSY"
}

function waiting(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
