import { randomUUID } from "node:crypto"
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { fallback } from "./service-probe.js"
import type { EnsureTiming } from "./service-timing.js"

type Lock = {
  token: string
  pid: number
  startedAt: number
  completedAt?: number
}

/** Shared cross-process reboot state lives next to the registration file. */
export function restartLockPath(file?: string) {
  return `${file ?? fallback()}.restart`
}

/**
 * Claim a reboot, or return undefined when another client's reboot should be reused. Any client
 * process may call this; the lock file, not in-memory state, decides who owns the current window.
 */
export async function tryBeginRestart(
  file: string | undefined,
  timing: EnsureTiming,
): Promise<{ readonly token: string } | undefined> {
  const path = restartLockPath(file)
  try {
    const claimed = await claim(path, timing)
    if (claimed !== undefined) return claimed
    const existing = await readLock(path)
    if (existing === undefined) return undefined
    const now = nowOf(timing)
    if (existing.completedAt !== undefined) {
      // A finished reboot is not in progress. Its completion starts the cooldown for everyone.
      if (now < existing.completedAt + timing.restartCooldown) return undefined
    } else if (alive(existing.pid) && now - existing.startedAt < timing.restartLockStale) {
      // The owner is still working; reuse its reboot rather than killing the server a second time.
      return undefined
    }
    await unlink(path).catch(() => undefined)
    return await claim(path, timing)
  } catch {
    // The lock is best-effort; it must never break ensure().
    return undefined
  }
}

/** Mark the reboot held by `token` finished so other clients start their cooldown from now. */
export async function completeRestart(file: string | undefined, token: string, timing?: EnsureTiming) {
  const path = restartLockPath(file)
  try {
    const existing = await readLock(path)
    if (existing?.token !== token) return
    const completed = { ...existing, completedAt: nowOf(timing) } satisfies Lock
    const temporary = `${path}.${token}.tmp`
    await writeFile(temporary, JSON.stringify(completed))
    await rename(temporary, path)
  } catch {
    // Best-effort.
  }
}

/** Drop a claim that never reached a ready service so a later client may reboot immediately. */
export async function releaseRestart(file: string | undefined, token: string) {
  const path = restartLockPath(file)
  try {
    const existing = await readLock(path)
    if (existing?.token === token) await unlink(path)
  } catch {
    // Best-effort.
  }
}

async function claim(path: string, timing: EnsureTiming) {
  const token = randomUUID()
  try {
    const handle = await open(path, "wx")
    try {
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, startedAt: nowOf(timing) } satisfies Lock))
    } finally {
      await handle.close()
    }
    return { token }
  } catch (error) {
    if (isCode(error, "EEXIST")) return undefined
    throw error
  }
}

async function readLock(path: string): Promise<Lock | undefined> {
  try {
    const lock = JSON.parse(await readFile(path, "utf8")) as Lock
    if (typeof lock.token !== "string" || !Number.isInteger(lock.pid) || !Number.isFinite(lock.startedAt))
      return undefined
    return lock
  } catch {
    return undefined
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM still means the process exists, just owned by another user.
    return isCode(error, "EPERM")
  }
}

function nowOf(timing: EnsureTiming | undefined) {
  return timing?.now?.() ?? Date.now()
}

function isCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code
}
