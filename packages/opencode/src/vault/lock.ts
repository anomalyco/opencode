import fs from "fs/promises"

type LockContents = {
  pid: number
  expiresAt: number
}

export namespace VaultLock {
  const DEFAULT_TTL_MS = 30_000
  const DEFAULT_WAIT_MS = 5_000
  const SPIN_MS = 50

  async function sleep(ms: number) {
    await new Promise((r) => setTimeout(r, ms))
  }

  async function tryAcquire(lockPath: string, ttlMs: number): Promise<boolean> {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600)
      try {
        const contents: LockContents = { pid: process.pid, expiresAt: Date.now() + ttlMs }
        await handle.writeFile(JSON.stringify(contents), "utf8")
      } finally {
        await handle.close()
      }
      return true
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e
      return false
    }
  }

  async function breakIfExpired(lockPath: string): Promise<void> {
    try {
      const raw = await fs.readFile(lockPath, "utf8")
      const parsed = JSON.parse(raw) as Partial<LockContents>
      if (!parsed.expiresAt || typeof parsed.expiresAt !== "number") return
      if (Date.now() > parsed.expiresAt) {
        await fs.rm(lockPath, { force: true })
      }
    } catch {
      // ignore
    }
  }

  export async function withLock<T>(
    lockPath: string,
    fn: () => Promise<T>,
    opts?: { ttlMs?: number; waitMs?: number },
  ): Promise<T> {
    const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS
    const waitMs = opts?.waitMs ?? DEFAULT_WAIT_MS
    const deadline = Date.now() + waitMs

    while (Date.now() < deadline) {
      await breakIfExpired(lockPath)
      if (await tryAcquire(lockPath, ttlMs)) {
        try {
          return await fn()
        } finally {
          await fs.rm(lockPath, { force: true }).catch(() => {})
        }
      }
      await sleep(SPIN_MS)
    }

    throw new Error(`Timed out waiting for lock: ${lockPath}`)
  }
}

