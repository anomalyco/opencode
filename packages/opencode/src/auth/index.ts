import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { ulid } from "ulid"
import { getOAuthRecordID } from "./context"
import { Log } from "../util/log"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")
  const lockpath = `${filepath}.lock`
  const STORE_LOCK_TIMEOUT_MS = 5_000
  const STORE_LOCK_STALE_MS = 30_000
  const STORE_LOCK_RETRY_MS = 25
  const STORE_LOCK_BEST_EFFORT_TIMEOUT_MS = 250
  const STORE_LOCK_BEST_EFFORT_RETRY_MS = 10

  const log = Log.create({ service: "auth.store" })

  class StoreLockTimeoutError extends Error {
    constructor() {
      super("Timed out waiting for auth store lock")
      this.name = "StoreLockTimeoutError"
    }
  }

  const Health = z
    .object({
      cooldownUntil: z.number().optional(),
      lastStatusCode: z.number().optional(),
      lastErrorAt: z.number().optional(),
      successCount: z.number().default(0),
      failureCount: z.number().default(0),
    })
    .strict()
    .default(() => ({ successCount: 0, failureCount: 0 }))
  type Health = z.infer<typeof Health>

  const OAuthRecord = z
    .object({
      id: z.string(),
      namespace: z.string().default("default"),
      label: z.string().optional(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      createdAt: z.number(),
      updatedAt: z.number(),
      health: Health,
    })
    .strict()
  type OAuthRecord = z.infer<typeof OAuthRecord>

  export type OAuthRecordMeta = Omit<OAuthRecord, "refresh" | "access" | "expires">

  const OAuthProvider = z
    .object({
      type: z.literal("oauth"),
      active: z.record(z.string(), z.string()).default({}),
      order: z.record(z.string(), z.array(z.string())).default({}),
      records: z.array(OAuthRecord).default([]),
    })
    .strict()
  type OAuthProvider = z.infer<typeof OAuthProvider>

  const ApiProvider = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .strict()

  const WellKnownProvider = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .strict()

  const ProviderEntry = z.union([OAuthProvider, ApiProvider, WellKnownProvider])
  type ProviderEntry = z.infer<typeof ProviderEntry>

  const StoreFile = z
    .object({
      version: z.literal(2),
      providers: z.record(z.string(), ProviderEntry).default({}),
    })
    .strict()
  type StoreFile = z.infer<typeof StoreFile>

  function toMeta(record: OAuthRecord): OAuthRecordMeta {
    const { refresh: _refresh, access: _access, expires: _expires, ...meta } = record
    return meta
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
        if (Date.now() - start > timeoutMs) {
          throw new StoreLockTimeoutError()
        }
        await Bun.sleep(retryMs + Math.random() * retryMs)
      }
    }

    try {
      return await fn()
    } finally {
      await fs.rm(lockpath).catch(() => {})
    }
  }

  async function writeStoreFile(store: StoreFile): Promise<void> {
    await ensureDataDir()
    const tempPath = `${filepath}.tmp`
    const tempFile = Bun.file(tempPath)
    await Bun.write(tempFile, JSON.stringify(store, null, 2))
    await fs.rename(tempPath, filepath)
    await fs.chmod(filepath, 0o600).catch(() => {})
  }

  async function readStoreFile(): Promise<{ store: StoreFile; needsWrite: boolean }> {
    const file = Bun.file(filepath)
    const exists = await file.exists()
    const raw = await file.json().catch(() => undefined)

    const parsed = StoreFile.safeParse(raw)
    if (parsed.success) return { store: parsed.data, needsWrite: false }

    const legacyParsed = z.record(z.string(), Info).safeParse(raw)
    if (legacyParsed.success) {
      const now = Date.now()
      const next: StoreFile = { version: 2, providers: {} }

      for (const [providerID, info] of Object.entries(legacyParsed.data)) {
        if (info.type === "api") {
          next.providers[providerID] = { type: "api", key: info.key }
          continue
        }

        if (info.type === "wellknown") {
          next.providers[providerID] = { type: "wellknown", key: info.key, token: info.token }
          continue
        }

        const recordID = ulid()
        next.providers[providerID] = {
          type: "oauth",
          active: { default: recordID },
          order: { default: [recordID] },
          records: [
            {
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
            },
          ],
        }
      }

      return { store: next, needsWrite: true }
    }

    return { store: { version: 2, providers: {} }, needsWrite: exists }
  }

  async function loadStoreFile(): Promise<StoreFile> {
    const result = await readStoreFile()
    return result.store
  }

  type StoreUpdateResult<T> = {
    value: T
    changed: boolean
  }

  async function updateStoreWithLock<T>(
    fn: (store: StoreFile) => Promise<StoreUpdateResult<T>> | StoreUpdateResult<T>,
    lockOptions?: { timeoutMs?: number; staleMs?: number; retryMs?: number },
  ) {
    return withStoreLock(async () => {
      const { store, needsWrite } = await readStoreFile()
      const result = await fn(store)
      if (result.changed || needsWrite) {
        await writeStoreFile(store)
      }
      return result.value
    }, lockOptions)
  }

  async function updateStore<T>(fn: (store: StoreFile) => Promise<StoreUpdateResult<T>> | StoreUpdateResult<T>) {
    return updateStoreWithLock(fn)
  }

  async function updateStoreBestEffort(
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

  function ensureOAuthProvider(store: StoreFile, providerID: string): OAuthProvider {
    const existing = store.providers[providerID]
    if (existing && existing.type === "oauth") return existing

    const next: OAuthProvider = {
      type: "oauth",
      active: {},
      order: {},
      records: [],
    }
    store.providers[providerID] = next
    return next
  }

  function findOAuthRecord(provider: OAuthProvider, recordID: string): OAuthRecord | undefined {
    return provider.records.find((record) => record.id === recordID)
  }

  function normalizeOrder(ids: string[], order: string[]): string[] {
    const ordered: string[] = []
    for (const id of order) {
      if (ids.includes(id) && !ordered.includes(id)) ordered.push(id)
    }
    for (const id of ids) {
      if (!ordered.includes(id)) ordered.push(id)
    }
    return ordered
  }

  function recordIDsForNamespace(provider: OAuthProvider, namespace: string): string[] {
    const ids = provider.records.filter((record) => record.namespace === namespace).map((record) => record.id)
    const order = provider.order[namespace] ?? []
    return normalizeOrder(ids, order)
  }

  async function findOAuthRecordIDByRefreshToken(input: {
    providerID: string
    namespace: string
    refresh: string
    provider: OAuthProvider
  }): Promise<string | undefined> {
    for (const record of input.provider.records) {
      if (record.namespace !== input.namespace) continue
      if (record.refresh === input.refresh) return record.id
    }
    return undefined
  }

  export async function get(providerID: string): Promise<Info | undefined> {
    const store = await loadStoreFile()
    const entry = store.providers[providerID]
    if (!entry) return undefined

    if (entry.type === "api") {
      return { type: "api", key: entry.key }
    }

    if (entry.type === "wellknown") {
      return { type: "wellknown", key: entry.key, token: entry.token }
    }

    const namespace = "default"
    const contextID = getOAuthRecordID(providerID)
    const active = contextID ?? entry.active[namespace]
    const ordered = recordIDsForNamespace(entry, namespace)
    const recordID = active && ordered.includes(active) ? active : ordered[0]
    if (!recordID) return undefined

    const record = findOAuthRecord(entry, recordID)
    if (!record) return undefined
    return {
      type: "oauth",
      refresh: record.refresh,
      access: record.access,
      expires: record.expires,
      accountId: record.accountId,
      enterpriseUrl: record.enterpriseUrl,
    }
  }

  export async function all(): Promise<Record<string, Info>> {
    const store = await loadStoreFile()
    const out: Record<string, Info> = {}

    for (const providerID of Object.keys(store.providers)) {
      const info = await get(providerID)
      if (!info) continue
      out[providerID] = info
    }

    return out
  }

  export async function set(key: string, info: Info) {
    return updateStore(async (store) => {
      if (info.type === "api") {
        store.providers[key] = { type: "api", key: info.key }
        return { value: undefined, changed: true }
      }

      if (info.type === "wellknown") {
        store.providers[key] = { type: "wellknown", key: info.key, token: info.token }
        return { value: undefined, changed: true }
      }

      const namespace = "default"
      const provider = ensureOAuthProvider(store, key)

      // First check if we have a context-specific recordID (e.g. from browser refresh)
      const contextRecordID = getOAuthRecordID(key)
      // Then check if this refresh token already exists (update existing account)
      const existingRecordID = await findOAuthRecordIDByRefreshToken({
        providerID: key,
        namespace,
        refresh: info.refresh,
        provider,
      })

      // Only use active/first record if we found a matching refresh token or have explicit context
      // Otherwise, this is a NEW account and we should create a new record
      const recordID = contextRecordID ?? existingRecordID ?? ulid()

      const now = Date.now()
      const existing = findOAuthRecord(provider, recordID)
      if (!existing) {
        // Generate a label based on existing account count
        const existingCount = provider.records.filter((r) => r.namespace === namespace).length
        const label = existingCount === 0 ? "default" : `Account ${existingCount + 1}`

        provider.records.push({
          id: recordID,
          namespace,
          label,
          accountId: info.accountId,
          enterpriseUrl: info.enterpriseUrl,
          refresh: info.refresh,
          access: info.access,
          expires: info.expires,
          createdAt: now,
          updatedAt: now,
          health: { successCount: 0, failureCount: 0 },
        })
        provider.order[namespace] = [...(provider.order[namespace] ?? []), recordID]
      } else {
        existing.refresh = info.refresh
        existing.access = info.access
        existing.expires = info.expires
        existing.updatedAt = now
        if (info.accountId !== undefined) existing.accountId = info.accountId
        if (info.enterpriseUrl !== undefined) existing.enterpriseUrl = info.enterpriseUrl
        const order = provider.order[namespace] ?? []
        if (!order.includes(recordID)) {
          provider.order[namespace] = [...order, recordID]
        }
      }
      provider.active[namespace] = recordID

      return { value: undefined, changed: true }
    })
  }

  export async function remove(key: string) {
    return updateStore((store) => {
      const existing = store.providers[key]
      if (!existing) return { value: undefined, changed: false }

      delete store.providers[key]
      return { value: undefined, changed: true }
    })
  }

  export async function addOAuth(
    providerID: string,
    input: Omit<z.infer<typeof Oauth>, "type"> & { namespace?: string; label?: string },
  ) {
    const namespace = (input.namespace ?? "default").trim() || "default"
    return updateStore(async (store) => {
      const provider = ensureOAuthProvider(store, providerID)
      const now = Date.now()
      const existingRecordID = await findOAuthRecordIDByRefreshToken({
        providerID,
        namespace,
        refresh: input.refresh,
        provider,
      })

      if (existingRecordID) {
        const existing = findOAuthRecord(provider, existingRecordID)
        if (existing) {
          existing.refresh = input.refresh
          existing.access = input.access
          existing.expires = input.expires
          existing.updatedAt = now
          if (input.accountId !== undefined) existing.accountId = input.accountId
          if (input.enterpriseUrl !== undefined) existing.enterpriseUrl = input.enterpriseUrl
          if (input.label) existing.label = input.label
        }
        const order = provider.order[namespace] ?? []
        if (!order.includes(existingRecordID)) {
          provider.order[namespace] = [...order, existingRecordID]
        }
        provider.active[namespace] = existingRecordID

        return { value: { providerID, namespace, recordID: existingRecordID }, changed: true }
      }

      const recordID = ulid()

      provider.records.push({
        id: recordID,
        namespace,
        label: input.label ?? "default",
        accountId: input.accountId,
        enterpriseUrl: input.enterpriseUrl,
        refresh: input.refresh,
        access: input.access,
        expires: input.expires,
        createdAt: now,
        updatedAt: now,
        health: { successCount: 0, failureCount: 0 },
      })

      provider.order[namespace] = [...(provider.order[namespace] ?? []), recordID]
      provider.active[namespace] = recordID

      return { value: { providerID, namespace, recordID }, changed: true }
    })
  }

  export namespace OAuthPool {
    export async function snapshot(
      providerID: string,
      namespace = "default",
    ): Promise<{ records: OAuthRecordMeta[]; orderedIDs: string[]; activeID?: string }> {
      const store = await loadStoreFile()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return { records: [], orderedIDs: [] }

      const normalized = namespace.trim() || "default"
      const records = provider.records.filter((record) => record.namespace === normalized).map(toMeta)
      const orderedIDs = recordIDsForNamespace(provider, normalized)
      const activeID = provider.active[normalized]

      return { records, orderedIDs, activeID }
    }

    export async function list(providerID: string, namespace = "default"): Promise<OAuthRecordMeta[]> {
      return snapshot(providerID, namespace).then((result) => result.records)
    }

    export async function orderedIDs(providerID: string, namespace = "default"): Promise<string[]> {
      return snapshot(providerID, namespace).then((result) => result.orderedIDs)
    }

    export async function moveToBack(providerID: string, namespace: string, recordID: string): Promise<void> {
      await updateStoreBestEffort((store) => {
        const provider = store.providers[providerID]
        if (!provider || provider.type !== "oauth") return { value: undefined, changed: false }
        const order = recordIDsForNamespace(provider, namespace)
        provider.order[namespace] = order.filter((id) => id !== recordID).concat(recordID)
        provider.active[namespace] = provider.order[namespace][0] ?? provider.active[namespace]
        return { value: undefined, changed: true }
      })
    }

    export async function recordOutcome(input: {
      providerID: string
      recordID: string
      statusCode: number
      ok: boolean
      cooldownUntil?: number
    }): Promise<void> {
      await updateStoreBestEffort((store) => {
        const provider = store.providers[input.providerID]
        if (!provider || provider.type !== "oauth") return { value: undefined, changed: false }

        const record = findOAuthRecord(provider, input.recordID)
        if (!record) return { value: undefined, changed: false }

        const now = Date.now()
        const prevCooldown =
          record.health.cooldownUntil && record.health.cooldownUntil > now ? record.health.cooldownUntil : undefined
        const cooldownUntil = input.ok ? undefined : (input.cooldownUntil ?? prevCooldown)

        record.health = {
          ...record.health,
          cooldownUntil,
          lastStatusCode: input.statusCode,
          lastErrorAt: input.ok ? undefined : now,
          successCount: record.health.successCount + (input.ok ? 1 : 0),
          failureCount: record.health.failureCount + (input.ok ? 0 : 1),
        }
        record.updatedAt = now
        return { value: undefined, changed: true }
      })
    }

    export async function markAccessExpired(providerID: string, namespace: string, recordID: string): Promise<void> {
      await updateStoreBestEffort((store) => {
        const provider = store.providers[providerID]
        if (!provider || provider.type !== "oauth") return { value: undefined, changed: false }
        const record = findOAuthRecord(provider, recordID)
        if (!record || record.namespace !== namespace) return { value: undefined, changed: false }
        record.access = ""
        record.expires = 0
        record.updatedAt = Date.now()
        return { value: undefined, changed: true }
      })
    }

    export async function getUsage(
      providerID: string,
      namespace = "default",
    ): Promise<
      Array<{
        id: string
        label?: string
        isActive: boolean
        health: {
          successCount: number
          failureCount: number
          lastStatusCode?: number
          cooldownUntil?: number
        }
      }>
    > {
      const store = await loadStoreFile()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return []

      const orderedIDs = recordIDsForNamespace(provider, namespace)
      const now = Date.now()
      // Use explicitly set active account if it exists, otherwise fall back to first non-cooldown
      const activeID =
        provider.active[namespace] ??
        orderedIDs.find((id) => {
          const record = provider.records.find((r) => r.id === id)
          const cooldownUntil = record?.health.cooldownUntil
          return !cooldownUntil || cooldownUntil <= now
        }) ??
        orderedIDs[0]

      return provider.records
        .filter((record) => record.namespace === namespace)
        .map((record) => ({
          id: record.id,
          label: record.label,
          isActive: record.id === activeID,
          health: {
            successCount: record.health.successCount,
            failureCount: record.health.failureCount,
            lastStatusCode: record.health.lastStatusCode,
            cooldownUntil: record.health.cooldownUntil,
          },
        }))
    }

    export async function setActive(providerID: string, namespace: string, recordID: string): Promise<boolean> {
      return updateStore((store) => {
        const provider = store.providers[providerID]
        if (!provider || provider.type !== "oauth") return { value: false, changed: false }

        const record = findOAuthRecord(provider, recordID)
        if (!record || record.namespace !== namespace) return { value: false, changed: false }

        const order = recordIDsForNamespace(provider, namespace)
        provider.order[namespace] = [recordID, ...order.filter((id) => id !== recordID)]
        provider.active[namespace] = recordID

        return { value: true, changed: true }
      })
    }

    export async function updateRecord(
      providerID: string,
      recordID: string,
      namespace: string,
      update: { access?: string; refresh?: string; expires?: number; label?: string },
    ): Promise<boolean> {
      return updateStore((store) => {
        const provider = store.providers[providerID]
        if (!provider || provider.type !== "oauth") return { value: false, changed: false }

        const record = provider.records.find((r) => r.id === recordID && r.namespace === namespace)
        if (!record) return { value: false, changed: false }

        if (update.access !== undefined) record.access = update.access
        if (update.refresh !== undefined) record.refresh = update.refresh
        if (update.expires !== undefined) record.expires = update.expires
        if (update.label !== undefined) record.label = update.label
        record.updatedAt = Date.now()

        return { value: true, changed: true }
      })
    }

    export async function removeRecord(
      providerID: string,
      recordID: string,
      namespace = "default",
    ): Promise<{ removed: boolean; remaining: number }> {
      return updateStore<{ removed: boolean; remaining: number }>((store) => {
        const provider = store.providers[providerID]
        if (!provider || provider.type !== "oauth") return { value: { removed: false, remaining: 0 }, changed: false }

        const index = provider.records.findIndex((r) => r.id === recordID && r.namespace === namespace)
        if (index === -1) return { value: { removed: false, remaining: provider.records.length }, changed: false }

        // Remove the record
        provider.records.splice(index, 1)

        // Update order array
        const order = provider.order[namespace] ?? []
        provider.order[namespace] = order.filter((id) => id !== recordID)

        // If the removed record was active, set a new active
        if (provider.active[namespace] === recordID) {
          const remaining = recordIDsForNamespace(provider, namespace)
          provider.active[namespace] = remaining[0]
        }

        // If no records left for this namespace, clean up
        const remaining = provider.records.filter((r) => r.namespace === namespace).length
        if (remaining === 0) {
          delete provider.order[namespace]
          delete provider.active[namespace]
        }

        // If no records left at all, remove the provider entry
        if (provider.records.length === 0) {
          delete store.providers[providerID]
        }

        return { value: { removed: true, remaining }, changed: true }
      })
    }

    export async function fetchAnthropicUsage(
      providerID: string,
      namespace = "default",
      recordID?: string,
    ): Promise<{
      fiveHour?: { utilization: number; resetsAt?: string }
      sevenDay?: { utilization: number; resetsAt?: string }
      sevenDaySonnet?: { utilization: number; resetsAt?: string }
    } | null> {
      if (providerID !== "anthropic") return null

      const store = await loadStoreFile()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return null

      const orderedIDs = recordIDsForNamespace(provider, namespace)
      const now = Date.now()
      // Use explicit recordID if provided, otherwise use active account
      const activeID =
        recordID ??
        provider.active[namespace] ??
        orderedIDs.find((id) => {
          const rec = provider.records.find((r) => r.id === id)
          const cooldownUntil = rec?.health.cooldownUntil
          return !cooldownUntil || cooldownUntil <= now
        }) ??
        orderedIDs[0]
      const record = provider.records.find((r) => r.id === activeID && r.namespace === namespace)
      if (!record?.access) return null

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      try {
        const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${record.access}`,
            "anthropic-beta": "oauth-2025-04-20",
          },
          signal: controller.signal,
        })

        if (!response.ok) return null

        const data = (await response.json()) as {
          five_hour?: { utilization: number; resets_at?: string }
          seven_day?: { utilization: number; resets_at?: string }
          seven_day_sonnet?: { utilization: number; resets_at?: string }
        }

        return {
          fiveHour: data.five_hour
            ? { utilization: Math.round(data.five_hour.utilization), resetsAt: data.five_hour.resets_at }
            : undefined,
          sevenDay: data.seven_day
            ? { utilization: Math.round(data.seven_day.utilization), resetsAt: data.seven_day.resets_at }
            : undefined,
          sevenDaySonnet: data.seven_day_sonnet
            ? { utilization: Math.round(data.seven_day_sonnet.utilization), resetsAt: data.seven_day_sonnet.resets_at }
            : undefined,
        }
      } catch {
        return null
      } finally {
        clearTimeout(timeout)
      }
    }
  }
}
