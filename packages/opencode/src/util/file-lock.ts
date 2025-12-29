import fs from "fs/promises"
import path from "path"
import { Log } from "./log"

export namespace FileLock {
  const log = Log.create({ service: "file-lock" })
  const STALE_THRESHOLD_MS = 30_000
  const RETRY_DELAY_MS = 50
  const MAX_RETRIES = 100

  interface LockInfo {
    pid: number
    timestamp: number
    hostname: string
  }

  function lockPath(filePath: string): string {
    return filePath + ".lock"
  }

  async function processAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  async function isStale(lock: string): Promise<boolean> {
    try {
      const content = await Bun.file(lock).text()
      const info: LockInfo = JSON.parse(content)

      if (Date.now() - info.timestamp > STALE_THRESHOLD_MS) return true

      const os = await import("os")
      if (info.hostname === os.hostname() && !(await processAlive(info.pid))) return true

      return false
    } catch {
      return true
    }
  }

  async function tryAcquire(lock: string): Promise<boolean> {
    const os = await import("os")
    const info: LockInfo = {
      pid: process.pid,
      timestamp: Date.now(),
      hostname: os.hostname(),
    }

    try {
      await fs.mkdir(path.dirname(lock), { recursive: true })

      const file = Bun.file(lock)
      if (await file.exists()) {
        if (await isStale(lock)) {
          await fs.unlink(lock).catch(() => {})
        } else {
          return false
        }
      }

      await Bun.write(lock, JSON.stringify(info))

      const content = await Bun.file(lock).text()
      const written: LockInfo = JSON.parse(content)
      return written.pid === process.pid && written.timestamp === info.timestamp
    } catch {
      return false
    }
  }

  async function release(lock: string): Promise<void> {
    try {
      const content = await Bun.file(lock).text()
      const info: LockInfo = JSON.parse(content)
      if (info.pid === process.pid) {
        await fs.unlink(lock).catch(() => {})
      }
    } catch {}
  }

  export async function acquire(filePath: string): Promise<Disposable> {
    const lock = lockPath(filePath)
    let retries = 0

    while (retries < MAX_RETRIES) {
      if (await tryAcquire(lock)) {
        return {
          [Symbol.dispose]: () => {
            release(lock)
          },
        }
      }
      retries++
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }

    if (await isStale(lock)) {
      await fs.unlink(lock).catch(() => {})
      if (await tryAcquire(lock)) {
        return {
          [Symbol.dispose]: () => {
            release(lock)
          },
        }
      }
    }

    log.warn("lock acquisition timeout", { filePath, retries })
    return { [Symbol.dispose]: () => {} }
  }

  export async function cleanupStale(dir: string): Promise<number> {
    let count = 0
    try {
      const glob = new Bun.Glob("**/*.lock")
      for await (const file of glob.scan({ cwd: dir, absolute: true })) {
        if (await isStale(file)) {
          await fs.unlink(file).catch(() => {})
          count++
        }
      }
    } catch {}
    return count
  }
}
