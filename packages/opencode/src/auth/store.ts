import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import {
  StoreFile,
  LegacyInfo,
  generateRecordID,
  type StoreUpdateResult,
} from "./auth-store-schema"

export * from "./auth-store-schema"

const log = Log.create({ service: "auth.store" })

export const filepath = path.join(Global.Path.data, "auth.json")
const lockpath = `${filepath}.lock`
const STORE_LOCK_TIMEOUT_MS = 5_000
const STORE_LOCK_STALE_MS = 30_000
const STORE_LOCK_RETRY_MS = 25
const STORE_LOCK_BEST_EFFORT_TIMEOUT_MS = 250
const STORE_LOCK_BEST_EFFORT_RETRY_MS = 10

class StoreLockTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for auth store lock")
    this.name = "StoreLockTimeoutError"
  }
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true })
}

async function withStoreLock<T>(
  fn: () => Promise<T>,
  options: { timeoutMs?: number; staleMs?: number; retryMs?: number } = {},
): Promise<T> {
  await ensureDataDir()
  const timeoutMs = options.timeoutMs ?? STORE_LOCK_TIMEOUT_MS
  const staleMs = options.staleMs ?? STORE_LOCK_STALE_MS
  const retryMs = options.retryMs ?? STORE_LOCK_RETRY_MS
  const start = Date.now()
  while (true) {
    try {
      const handle = await fs.open(lockpath, "wx")
      await handle.close()
      break
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== "EEXIST") throw error
      const stat = await fs.stat(lockpath).catch(() => undefined)
      if (stat && Date.now() - stat.mtimeMs > staleMs) {
        await fs.rm(lockpath).catch(() => {})
        continue
      }
      if (Date.now() - start > timeoutMs) throw new StoreLockTimeoutError()
      await Bun.sleep(retryMs + Math.random() * retryMs)
    }
  }
  try {
    return await fn()
  } finally {
    await fs.rm(lockpath).catch(() => {})
  }
}

export async function writeStoreFile(store: StoreFile): Promise<void> {
  await ensureDataDir()
  const tempPath = `${filepath}.tmp`
  // Write with restricted permissions before rename so the file is never world-readable
  const fd = await fs.open(tempPath, "w", 0o600)
  try {
    await fd.writeFile(JSON.stringify(store, null, 2), "utf-8")
  } finally {
    await fd.close()
  }
  await fs.rename(tempPath, filepath)
}

export async function readStoreFile(): Promise<{ store: StoreFile; needsWrite: boolean }> {
  const file = Bun.file(filepath)
  const exists = await file.exists()
  const raw = await file.json().catch(() => undefined)

  const parsed = StoreFile.safeParse(raw)
  if (parsed.success) return { store: parsed.data, needsWrite: false }

  const legacyParsed = z.record(z.string(), LegacyInfo).safeParse(raw)
  if (legacyParsed.success) {
    const now = Date.now()
    const next: StoreFile = { version: 2, providers: {} }
    for (const [providerID, info] of Object.entries(legacyParsed.data)) {
      if (info.type === "api") {
        next.providers[providerID] = { type: "api", key: info.key, metadata: info.metadata }
        continue
      }
      if (info.type === "wellknown") {
        next.providers[providerID] = { type: "wellknown", key: info.key, token: info.token }
        continue
      }
      const recordID = generateRecordID()
      next.providers[providerID] = {
        type: "oauth",
        active: { default: recordID },
        order: { default: [recordID] },
        records: [{
          id: recordID,
          namespace: "default",
          label: "default",
          accountId: info.accountId,
          enterpriseUrl: info.enterpriseUrl,
          refresh: info.refresh,
          access: info.access,
          expires: info.expires,
          createdAt: now,
          updatedAt: now,
          health: { successCount: 0, failureCount: 0 },
        }],
      }
    }
    return { store: next, needsWrite: true }
  }

  return { store: { version: 2, providers: {} }, needsWrite: exists }
}

export async function loadStoreFile(): Promise<StoreFile> {
  return (await readStoreFile()).store
}

export async function updateStoreWithLock<T>(
  fn: (store: StoreFile) => Promise<StoreUpdateResult<T>> | StoreUpdateResult<T>,
  lockOptions?: { timeoutMs?: number; staleMs?: number; retryMs?: number },
): Promise<T> {
  return withStoreLock(async () => {
    const { store, needsWrite } = await readStoreFile()
    const result = await fn(store)
    if (result.changed || needsWrite) await writeStoreFile(store)
    return result.value
  }, lockOptions)
}

export async function updateStore<T>(
  fn: (store: StoreFile) => Promise<StoreUpdateResult<T>> | StoreUpdateResult<T>,
): Promise<T> {
  return updateStoreWithLock(fn)
}

export async function updateStoreBestEffort(
  fn: (store: StoreFile) => Promise<StoreUpdateResult<void>> | StoreUpdateResult<void>,
): Promise<void> {
  try {
    await updateStoreWithLock(fn, {
      timeoutMs: STORE_LOCK_BEST_EFFORT_TIMEOUT_MS,
      retryMs: STORE_LOCK_BEST_EFFORT_RETRY_MS,
    })
  } catch (error) {
    if (error instanceof StoreLockTimeoutError) {
      log.warn("auth store lock busy, skipping update", { timeoutMs: STORE_LOCK_BEST_EFFORT_TIMEOUT_MS })
      return
    }
    throw error
  }
}
