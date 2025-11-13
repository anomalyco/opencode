import path from "path"
import fs from "fs/promises"
import { constants } from "fs"
import { Log } from "@/util/log"

const log = Log.create({ service: "config.lock" })
const fileLocks = new Map<string, Promise<void>>()
const LOCKFILE_SUFFIX = ".lock"
const LOCKFILE_STALE_AFTER_MS = 60000
const LOCKFILE_RETRY_DELAY_MS = 25

interface LockOptions {
  timeout?: number
  staleAfter?: number
}

function buildLockfilePath(target: string) {
  return `${target}${LOCKFILE_SUFFIX}`
}

async function removeLockfile(lockfile: string): Promise<void> {
  await fs.unlink(lockfile).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === "ENOENT") return
    log.warn("failed to remove lockfile", { filepath: lockfile, error: String(error) })
  })
}

async function acquireFilesystemLock(params: {
  filepath: string
  timeout: number
  staleAfter: number
  startTime: number
}): Promise<() => Promise<void>> {
  const lockfile = buildLockfilePath(params.filepath)
  await fs.mkdir(path.dirname(lockfile), { recursive: true })
  let warned = false

  while (true) {
    const handle = await fs
      .open(lockfile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      .catch((error: NodeJS.ErrnoException) => {
        if (error?.code === "EEXIST") return null
        throw error
      })

    if (handle) {
      const payload = JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
      })
      await handle.write(payload)
      await handle.close()
      return async () => removeLockfile(lockfile)
    }

    const waited = Date.now() - params.startTime

    if (!warned && waited > 5000) {
      warned = true
      log.warn("waiting for filesystem lock", {
        filepath: params.filepath,
        waited,
      })
    }

    if (waited > params.timeout) {
      throw new Error(`Lock timeout: could not acquire filesystem lock for ${params.filepath} after ${waited}ms`)
    }

    const stat = await fs.stat(lockfile).catch((error: NodeJS.ErrnoException) => {
      if (error?.code === "ENOENT") return
      throw error
    })

    if (stat) {
      const age = Date.now() - stat.mtimeMs
      if (age > params.staleAfter) {
        log.warn("removing stale lockfile", {
          filepath: params.filepath,
          age,
        })
        await removeLockfile(lockfile)
      }
    }

    await Bun.sleep(LOCKFILE_RETRY_DELAY_MS)
  }
}

export async function acquireLock(filepath: string, options?: LockOptions): Promise<() => Promise<void>> {
  const normalized = path.normalize(filepath)
  const timeout = options?.timeout ?? 30000
  const staleAfter = options?.staleAfter ?? LOCKFILE_STALE_AFTER_MS
  const startTime = Date.now()

  while (fileLocks.has(normalized)) {
    const waited = Date.now() - startTime

    if (waited > 5000 && waited < 5100) {
      log.warn("lock acquisition taking longer than expected", {
        filepath: normalized,
        waited,
      })
    }

    if (waited > timeout) {
      throw new Error(`Lock timeout: could not acquire lock for ${normalized} after ${waited}ms`)
    }

    await fileLocks.get(normalized)
    await Bun.sleep(10)
  }

  let releaseFn: () => void
  const lockPromise = new Promise<void>((resolve) => {
    releaseFn = resolve
  })

  fileLocks.set(normalized, lockPromise)

  const releaseFilesystem = await acquireFilesystemLock({
    filepath: normalized,
    timeout,
    staleAfter,
    startTime,
  })

  return async () => {
    fileLocks.delete(normalized)
    releaseFn!()
    await releaseFilesystem()
  }
}
