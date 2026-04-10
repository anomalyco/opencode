import path from "path"
import fs from "fs/promises"
import z from "zod"
import { ulid } from "ulid"
import { Effect, Layer, Schema, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { zod as zodSchema } from "@/util/effect-zod"
import { Filesystem } from "@/util/filesystem"
import { getOAuthRecordID } from "./context"
import { Global } from "../global"
import { Log } from "../util/log"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

export namespace Auth {
  export class Oauth extends Schema.Class<Oauth>("OAuth")({
    type: Schema.Literal("oauth"),
    refresh: Schema.String,
    access: Schema.String,
    expires: Schema.Number,
    accountId: Schema.optional(Schema.String),
    email: Schema.optional(Schema.String),
    enterpriseUrl: Schema.optional(Schema.String),
  }) {}

  export class Api extends Schema.Class<Api>("ApiAuth")({
    type: Schema.Literal("api"),
    key: Schema.String,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }) {}

  export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
    type: Schema.Literal("wellknown"),
    key: Schema.String,
    token: Schema.String,
  }) {}

  const _Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
  export const Info = Object.assign(_Info, { zod: zodSchema(_Info) })
  export type Info = Schema.Schema.Type<typeof _Info>

  export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {}

  export interface Interface {
    readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
    readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
    readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
    readonly remove: (key: string) => Effect.Effect<void, AuthError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Auth") {}

  const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

  function lift<A extends readonly unknown[], R>(name: string, fn: (...args: A) => Promise<R>, message: string) {
    return Effect.fn(name)((...args: A) => Effect.promise(() => fn(...args)).pipe(Effect.mapError(fail(message))))
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const all = lift("Auth.all", readAllInfo, "Failed to load auth data")
      const get = lift("Auth.get", readInfo, "Failed to load auth data")
      const set = lift("Auth.set", writeInfo, "Failed to write auth data")
      const remove = lift("Auth.remove", removeInfo, "Failed to write auth data")
      return Service.of({ get, all, set, remove })
    }),
  )

  export const defaultLayer = layer

  const { runPromise } = makeRuntime(Service, defaultLayer)

  const filepath = path.join(Global.Path.data, "auth.json")
  const lockpath = `${filepath}.lock`
  const STORE_LOCK_TIMEOUT_MS = 5_000
  const STORE_LOCK_STALE_MS = 30_000
  const STORE_LOCK_RETRY_MS = 25
  const STORE_LOCK_BEST_EFFORT_TIMEOUT_MS = 250
  const STORE_LOCK_BEST_EFFORT_RETRY_MS = 10
  const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
  const OPENAI_OAUTH_ISSUER = "https://auth.openai.com"

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
      email: z.string().optional(),
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

  const ApiProvider = z.object({ type: z.literal("api"), key: z.string() }).strict()
  const WellKnownProvider = z.object({ type: z.literal("wellknown"), key: z.string(), token: z.string() }).strict()

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

  function claims(token: string) {
    const parts = token.split(".")
    if (parts.length !== 3) return
    try {
      return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
        email?: string
      }
    } catch {
      return
    }
  }

  async function refreshOpenAIToken(refresh: string) {
    const response = await fetch(`${OPENAI_OAUTH_ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: OPENAI_OAUTH_CLIENT_ID,
      }).toString(),
    })
    if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`)
    return (await response.json()) as {
      refresh_token: string
      access_token: string
      expires_in?: number
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

  async function writeStoreFile(store: StoreFile): Promise<void> {
    await ensureDataDir()
    const tempPath = `${filepath}.tmp`
    await Bun.write(Bun.file(tempPath), JSON.stringify(store, null, 2))
    await fs.rename(tempPath, filepath)
    await fs.chmod(filepath, 0o600).catch(() => {})
  }

  async function readStoreFile(): Promise<{ store: StoreFile; needsWrite: boolean }> {
    const file = Bun.file(filepath)
    const exists = await file.exists()
    if (!exists) return { store: { version: 2, providers: {} }, needsWrite: false }

    const raw = await file.json().catch(() => undefined)
    const parsed = StoreFile.safeParse(raw)
    if (parsed.success) return { store: parsed.data, needsWrite: false }

    const legacy = z.record(z.string(), Info.zod).safeParse(raw)
    if (legacy.success) {
      const now = Date.now()
      const next: StoreFile = { version: 2, providers: {} }
      for (const [providerID, info] of Object.entries(legacy.data)) {
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
              email: info.email,
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

    return { store: { version: 2, providers: {} }, needsWrite: true }
  }

  async function loadStoreFile(): Promise<StoreFile> {
    return (await readStoreFile()).store
  }

  type StoreUpdateResult<T> = { value: T; changed: boolean }

  async function updateStoreWithLock<T>(
    fn: (store: StoreFile) => Promise<StoreUpdateResult<T>> | StoreUpdateResult<T>,
    lockOptions?: { timeoutMs?: number; staleMs?: number; retryMs?: number },
  ) {
    return withStoreLock(async () => {
      const { store, needsWrite } = await readStoreFile()
      const result = await fn(store)
      if (result.changed || needsWrite) await writeStoreFile(store)
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
    const next: OAuthProvider = { type: "oauth", active: {}, order: {}, records: [] }
    store.providers[providerID] = next
    return next
  }

  function findOAuthRecord(provider: OAuthProvider, recordID: string) {
    return provider.records.find((record) => record.id === recordID)
  }

  function normalizeOrder(ids: string[], order: string[]) {
    const result: string[] = []
    for (const id of order) if (ids.includes(id) && !result.includes(id)) result.push(id)
    for (const id of ids) if (!result.includes(id)) result.push(id)
    return result
  }

  function recordIDsForNamespace(provider: OAuthProvider, namespace: string) {
    const ids = provider.records.filter((record) => record.namespace === namespace).map((record) => record.id)
    return normalizeOrder(ids, provider.order[namespace] ?? [])
  }

  function availableRecordID(provider: OAuthProvider, namespace: string, preferred?: string) {
    const ordered = recordIDsForNamespace(provider, namespace)
    const now = Date.now()
    const ready = (id?: string) => {
      if (!id) return false
      const record = provider.records.find((item) => item.id === id && item.namespace === namespace)
      if (!record) return false
      const cooldown = record.health.cooldownUntil
      return !cooldown || cooldown <= now
    }
    if (ready(preferred)) return preferred
    return ordered.find((id) => ready(id)) ?? preferred ?? ordered[0]
  }

  function pickRecord(providerID: string, provider: OAuthProvider, namespace: string, preferred?: string) {
    const recordID = availableRecordID(
      provider,
      namespace,
      preferred ?? getOAuthRecordID(providerID) ?? provider.active[namespace],
    )
    if (!recordID) return
    const record = provider.records.find((item) => item.id === recordID && item.namespace === namespace)
    if (!record) return
    return { recordID, record }
  }

  async function findOAuthRecordIDByRefreshToken(input: {
    namespace: string
    refresh: string
    provider: OAuthProvider
  }) {
    for (const record of input.provider.records) {
      if (record.namespace !== input.namespace) continue
      if (record.refresh === input.refresh) return record.id
    }
    return undefined
  }

  function toInfo(providerID: string, entry: ProviderEntry): Info | undefined {
    if (entry.type === "api") return { type: "api", key: entry.key }
    if (entry.type === "wellknown") return { type: "wellknown", key: entry.key, token: entry.token }
    const choice = pickRecord(providerID, entry, "default")
    if (!choice) return
    return {
      type: "oauth",
      refresh: choice.record.refresh,
      access: choice.record.access,
      expires: choice.record.expires,
      accountId: choice.record.accountId,
      email: choice.record.email,
      enterpriseUrl: choice.record.enterpriseUrl,
    }
  }

  async function readAllInfo(): Promise<Record<string, Info>> {
    const store = await loadStoreFile()
    const result: Record<string, Info> = {}
    for (const [providerID, entry] of Object.entries(store.providers)) {
      const info = toInfo(providerID, entry)
      if (info) result[providerID] = info
    }
    return result
  }

  async function readInfo(providerID: string) {
    return (await readAllInfo())[providerID]
  }

  async function writeInfo(key: string, info: Info) {
    const norm = key.replace(/\/+$/, "")
    if (info.type === "oauth") {
      await addOAuth(norm, info)
      return
    }
    await updateStore((store) => {
      if (norm !== key) delete store.providers[key]
      delete store.providers[norm + "/"]
      store.providers[norm] =
        info.type === "api"
          ? { type: "api", key: info.key }
          : { type: "wellknown", key: info.key, token: info.token }
      return { value: undefined, changed: true }
    })
  }

  async function removeInfo(key: string) {
    const norm = key.replace(/\/+$/, "")
    return updateStore((store) => {
      const existing = store.providers[key] ?? store.providers[norm]
      if (!existing) return { value: undefined, changed: false }
      delete store.providers[key]
      delete store.providers[norm]
      delete store.providers[norm + "/"]
      return { value: undefined, changed: true }
    })
  }

  export async function all(): Promise<Record<string, Info>> {
    return readAllInfo()
  }

  export async function get(providerID: string): Promise<Info | undefined> {
    return readInfo(providerID)
  }

  export async function set(key: string, info: Info) {
    return writeInfo(key, info)
  }

  export async function remove(key: string) {
    return removeInfo(key)
  }

  export async function addOAuth(providerID: string, input: Omit<Info & { type: "oauth" }, "type"> & { namespace?: string; label?: string }) {
    const normProviderID = providerID.replace(/\/+$/, "")
    const namespace = (input.namespace ?? "default").trim() || "default"
    return updateStore(async (store) => {
      const provider = ensureOAuthProvider(store, normProviderID)
      const now = Date.now()
      const existingRecordID = await findOAuthRecordIDByRefreshToken({ namespace, refresh: input.refresh, provider })
      if (existingRecordID) {
        const existing = findOAuthRecord(provider, existingRecordID)
        if (existing) {
          existing.refresh = input.refresh
          existing.access = input.access
          existing.expires = input.expires
          existing.updatedAt = now
          if (input.accountId !== undefined) existing.accountId = input.accountId
          if (input.email !== undefined) existing.email = input.email
          if (input.enterpriseUrl !== undefined) existing.enterpriseUrl = input.enterpriseUrl
          if (input.label !== undefined) existing.label = input.label
        }
        const order = provider.order[namespace] ?? []
        if (!order.includes(existingRecordID)) provider.order[namespace] = [...order, existingRecordID]
        provider.active[namespace] = existingRecordID
        return { value: { providerID: normProviderID, namespace, recordID: existingRecordID }, changed: true }
      }

      const recordID = ulid()
      provider.records.push({
        id: recordID,
        namespace,
        label: input.label ?? input.email ?? input.accountId ?? input.enterpriseUrl ?? "default",
        accountId: input.accountId,
        email: input.email,
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
      return { value: { providerID: normProviderID, namespace, recordID }, changed: true }
    })
  }

  let minimaxCache:
    | {
        data: {
          fiveHour?: { utilization: number; resetsAt?: string; remainingCredits: number; totalCredits: number }
          _error?: string
          _cached?: boolean
        } | null
        timestamp: number
      }
    | null = null
  const MINIMAX_CACHE_TTL = 30 * 60 * 1000

  export namespace OAuthPool {
    export async function snapshot(providerID: string, namespace = "default") {
      const store = await loadStoreFile()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return { records: [] as OAuthRecordMeta[], orderedIDs: [] as string[], activeID: undefined as string | undefined }
      const records = provider.records.filter((record) => record.namespace === namespace).map(toMeta)
      return {
        records,
        orderedIDs: recordIDsForNamespace(provider, namespace),
        activeID: provider.active[namespace],
      }
    }

    export async function list(providerID: string, namespace = "default") {
      return snapshot(providerID, namespace).then((x) => x.records)
    }

    export async function orderedIDs(providerID: string, namespace = "default") {
      return snapshot(providerID, namespace).then((x) => x.orderedIDs)
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
        const prevCooldown = record.health.cooldownUntil && record.health.cooldownUntil > now ? record.health.cooldownUntil : undefined
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
        if (!input.ok) {
          const order = recordIDsForNamespace(provider, record.namespace)
          provider.order[record.namespace] = order.filter((id) => id !== input.recordID).concat(input.recordID)
          const next = availableRecordID(
            provider,
            record.namespace,
            provider.order[record.namespace].find((id) => id !== input.recordID),
          )
          provider.active[record.namespace] = next ?? input.recordID
        }
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

    export async function getUsage(providerID: string, namespace = "default") {
      const store = await loadStoreFile()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return [] as Array<{
        id: string
        label?: string
        email?: string
        isActive: boolean
        health: { successCount: number; failureCount: number; lastStatusCode?: number; cooldownUntil?: number }
      }>
      const activeID = pickRecord(providerID, provider, namespace)?.recordID
      return provider.records
        .filter((record) => record.namespace === namespace)
        .map((record) => ({
          id: record.id,
          label: record.label,
          email: record.email,
          isActive: record.id === activeID,
          health: {
            successCount: record.health.successCount,
            failureCount: record.health.failureCount,
            lastStatusCode: record.health.lastStatusCode,
            cooldownUntil: record.health.cooldownUntil,
          },
        }))
    }

    export async function pick(providerID: string, namespace = "default", preferred?: string) {
      const store = await loadStoreFile()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return
      const choice = pickRecord(providerID, provider, namespace, preferred)
      if (!choice) return
      return {
        id: choice.record.id,
        namespace: choice.record.namespace,
        label: choice.record.label,
        accountId: choice.record.accountId,
        email: choice.record.email,
        refresh: choice.record.refresh,
        access: choice.record.access,
        expires: choice.record.expires,
      }
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
        const record = provider.records.find((item) => item.id === recordID && item.namespace === namespace)
        if (!record) return { value: false, changed: false }
        if (update.access !== undefined) record.access = update.access
        if (update.refresh !== undefined) record.refresh = update.refresh
        if (update.expires !== undefined) record.expires = update.expires
        if (update.label !== undefined) record.label = update.label
        record.updatedAt = Date.now()
        return { value: true, changed: true }
      })
    }

    export async function removeRecord(providerID: string, recordID: string, namespace = "default") {
      return updateStore<{ removed: boolean; remaining: number }>((store) => {
        const provider = store.providers[providerID]
        if (!provider || provider.type !== "oauth") return { value: { removed: false, remaining: 0 }, changed: false }
        const index = provider.records.findIndex((item) => item.id === recordID && item.namespace === namespace)
        if (index === -1) return { value: { removed: false, remaining: provider.records.length }, changed: false }
        provider.records.splice(index, 1)
        provider.order[namespace] = (provider.order[namespace] ?? []).filter((id) => id !== recordID)
        if (provider.active[namespace] === recordID) provider.active[namespace] = recordIDsForNamespace(provider, namespace)[0]
        const remaining = provider.records.filter((item) => item.namespace === namespace).length
        if (remaining === 0) {
          delete provider.order[namespace]
          delete provider.active[namespace]
        }
        if (provider.records.length === 0) delete store.providers[providerID]
        return { value: { removed: true, remaining }, changed: true }
      })
    }

    export async function fetchAnthropicUsage(providerID: string, namespace = "default", recordID?: string) {
      if (providerID !== "anthropic") return null
      const store = await loadStoreFile()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return null
      const choice = pickRecord(providerID, provider, namespace, recordID)
      if (!choice?.record.access) return null
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      try {
        const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${choice.record.access}`,
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
          fiveHour: data.five_hour ? { utilization: Math.round(data.five_hour.utilization), resetsAt: data.five_hour.resets_at } : undefined,
          sevenDay: data.seven_day ? { utilization: Math.round(data.seven_day.utilization), resetsAt: data.seven_day.resets_at } : undefined,
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

    export async function fetchCodexUsage(recordID?: string) {
      let accessToken: string | undefined
      let accountId: string | undefined
      let tokenSource: string | undefined
      let chosen: Awaited<ReturnType<typeof pick>> | undefined
      let refresh: string | undefined
      let account: { id?: string; label?: string; email?: string } | undefined

      try {
        const store = await loadStoreFile()
        const provider = store.providers.openai
        if (provider?.type === "oauth") {
          const choice = pickRecord("openai", provider, "default", recordID)
          if (choice?.record.access) {
            chosen = {
              id: choice.record.id,
              namespace: choice.record.namespace,
              label: choice.record.label,
              accountId: choice.record.accountId,
              email: choice.record.email,
              refresh: choice.record.refresh,
              access: choice.record.access,
              expires: choice.record.expires,
            }
            refresh = choice.record.refresh
            accessToken = choice.record.access
            accountId = choice.record.accountId
            tokenSource = "opencode-oauth-pool"
            account = {
              id: choice.record.accountId,
              label: choice.record.label,
              email: claims(choice.record.access)?.email ?? choice.record.email,
            }
          }
        }
      } catch {}

      if (!accessToken) {
        const codexAuthPath = path.join(process.env.HOME || "", ".codex", "auth.json")
        try {
          const raw = await fs.readFile(codexAuthPath, "utf-8")
          const data = JSON.parse(raw)
          if (data.OPENAI_API_KEY) {
            return { fiveHour: { utilization: 0, resetsAt: undefined }, sevenDay: { utilization: 0, resetsAt: undefined } }
          }
          if (!data.tokens?.access_token) return null
          accessToken = data.tokens.access_token
          accountId = data.tokens.account_id
          tokenSource = "codex-cli"
          account = {
            id: data.tokens.account_id,
            email: claims(data.tokens.access_token)?.email,
          }
        } catch {
          return null
        }
      }

      if (chosen && refresh && (!accessToken || chosen.expires < Date.now())) {
        try {
          const tokens = await refreshOpenAIToken(refresh)
          await updateRecord("openai", chosen.id, "default", {
            refresh: tokens.refresh_token,
            access: tokens.access_token,
            expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          })
          refresh = tokens.refresh_token
          accessToken = tokens.access_token
          account = {
            id: chosen.accountId,
            label: chosen.label,
            email: claims(tokens.access_token)?.email ?? chosen.email,
          }
        } catch (error) {
          return { source: tokenSource, account, _error: error instanceof Error ? error.message : "Token refresh failed" }
        }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      try {
        let response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            "ChatGPT-Account-Id": accountId || "",
            "User-Agent": "opencode/1.0",
          },
          signal: controller.signal,
        })
        if (response.status === 401 && chosen && refresh) {
          try {
            const tokens = await refreshOpenAIToken(refresh)
            await updateRecord("openai", chosen.id, "default", {
              refresh: tokens.refresh_token,
              access: tokens.access_token,
              expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
            })
            account = {
              id: chosen.accountId,
              label: chosen.label,
              email: claims(tokens.access_token)?.email ?? chosen.email,
            }
            response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${tokens.access_token}`,
                "ChatGPT-Account-Id": accountId || "",
                "User-Agent": "opencode/1.0",
              },
              signal: controller.signal,
            })
          } catch (error) {
            return { source: tokenSource, account, _error: error instanceof Error ? error.message : "Token refresh failed" }
          }
        }
        if (!response.ok) return { source: tokenSource, account, _error: `Codex quota request failed (${response.status})` }
        const data = (await response.json()) as {
          rate_limit?: {
            primary_window?: { used_percent: number; reset_at: number }
            secondary_window?: { used_percent: number; reset_at: number }
          }
          plan_type?: string
        }
        return {
          fiveHour: data.rate_limit?.primary_window
            ? { utilization: Math.round(data.rate_limit.primary_window.used_percent), resetsAt: new Date(data.rate_limit.primary_window.reset_at * 1000).toISOString() }
            : undefined,
          sevenDay: data.rate_limit?.secondary_window
            ? { utilization: Math.round(data.rate_limit.secondary_window.used_percent), resetsAt: new Date(data.rate_limit.secondary_window.reset_at * 1000).toISOString() }
            : undefined,
          planType: data.plan_type,
          source: tokenSource,
          account,
          raw: data,
        }
      } catch {
        return null
      } finally {
        clearTimeout(timeout)
      }
    }

    export async function fetchMiniMaxUsage() {
      const now = Date.now()
      if (minimaxCache && now - minimaxCache.timestamp < MINIMAX_CACHE_TTL) return { ...minimaxCache.data, _cached: true }
      let apiKey = process.env.MINIMAX_API_KEY
      if (!apiKey) {
        const auth = await get("minimax")
        if (auth?.type === "api") apiKey = auth.key
      }
      if (!apiKey) return { _error: "No MiniMax API key configured" }
      for (const domain of ["platform.minimax.io", "platform.minimaxi.com"]) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5_000)
        try {
          const response = await fetch(`https://${domain}/v1/api/openplatform/coding_plan/remains`, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Referer: "https://platform.minimax.io/user-center/payment/coding-plan",
            },
            signal: controller.signal,
          })
          if (!response.ok) {
            const text = await response.text().catch(() => "")
            if ((response.status === 403 || response.status === 429) && minimaxCache) {
              return { ...minimaxCache.data, _error: "Rate limited - returning cached data", _cached: true }
            }
            if (response.status === 403 || response.status === 429) return { _error: `MiniMax API rate limited (${response.status})` }
            return { _error: `MiniMax API error (${response.status}): ${text.slice(0, 100)}` }
          }
          const data = (await response.json()) as {
            model_remains?: Array<{ current_interval_total_count: number; current_interval_usage_count: number; end_time: number }>
            base_resp?: { status_msg?: string }
          }
          if (data.base_resp?.status_msg && data.base_resp.status_msg !== "success") {
            return { _error: `MiniMax API error: ${data.base_resp.status_msg}` }
          }
          const item = data.model_remains?.[0]
          if (!item) return { _error: "No quota data returned from MiniMax API" }
          const totalCredits = item.current_interval_total_count
          const remainingCredits = item.current_interval_usage_count
          const utilization = Math.round(((totalCredits - remainingCredits) / totalCredits) * 100)
          const result = {
            fiveHour: {
              utilization,
              resetsAt: new Date(item.end_time).toISOString(),
              remainingCredits,
              totalCredits,
            },
          }
          minimaxCache = { data: result, timestamp: Date.now() }
          return result
        } catch (error) {
          if (domain === "platform.minimaxi.com") return { _error: `MiniMax API failed: ${error instanceof Error ? error.message : String(error)}` }
        } finally {
          clearTimeout(timeout)
        }
      }
      return { _error: "Failed to reach MiniMax API" }
    }

    export async function fetchOpenRouterUsage() {
      let apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        const auth = await get("openrouter")
        if (auth?.type === "api") apiKey = auth.key
      }
      if (!apiKey) return null
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      try {
        const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
            "User-Agent": "opencode/1.0",
          },
          signal: controller.signal,
        })
        if (!response.ok) return null
        const data = (await response.json()) as {
          data: {
            usage: number
            usage_daily: number
            usage_weekly: number
            usage_monthly: number
            limit: number | null
            limit_remaining: number | null
            is_free_tier: boolean
          }
        }
        return {
          isFree: data.data.is_free_tier,
          usage: data.data.usage,
          usageDaily: data.data.usage_daily,
          usageWeekly: data.data.usage_weekly,
          usageMonthly: data.data.usage_monthly,
          limit: data.data.limit,
          limitRemaining: data.data.limit_remaining,
        }
      } catch {
        return null
      } finally {
        clearTimeout(timeout)
      }
    }

    export async function fetchGitHubCopilotUsage() {
      const store = await loadStoreFile()
      const provider = store.providers["github-copilot"]
      if (!provider || provider.type !== "oauth") return null
      const activeID = availableRecordID(provider, "default", provider.active.default)
      const record = provider.records.find((item) => item.id === activeID && item.namespace === "default")
      if (!record?.access) return null
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      try {
        const userResponse = await fetch("https://api.github.com/user", {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${record.access}`,
            "User-Agent": "opencode/1.0",
          },
          signal: controller.signal,
        })
        if (!userResponse.ok) return null
        const userData = (await userResponse.json()) as { login: string }
        const username = userData.login
        const result: {
          hasAccess?: boolean
          login?: string
          assignedDate?: string
          lastActivityDate?: string
          orgBillingBreakdown?: {
            planType: string
            totalSeats: number
            activeSeats: number
            inactiveSeats: number
            pendingInvitation: number
            pendingCancellation: number
          }
          organizations?: Array<{ name: string; role: string }>
          statusMessage?: string
        } = { login: username }
        const orgsResponse = await fetch("https://api.github.com/user/orgs", {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${record.access}`,
            "User-Agent": "opencode/1.0",
          },
          signal: controller.signal,
        }).catch(() => null)
        if (orgsResponse?.ok) {
          const orgsData = (await orgsResponse.json()) as Array<{ login: string }>
          for (const org of orgsData) {
            const billing = await fetch(`https://api.github.com/orgs/${org.login}/copilot/billing`, {
              method: "GET",
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${record.access}`,
                "User-Agent": "opencode/1.0",
              },
              signal: controller.signal,
            }).catch(() => null)
            if (billing?.ok) {
              const data = (await billing.json()) as {
                seat_breakdown: {
                  total: number
                  active_this_cycle: number
                  inactive_this_cycle: number
                  pending_invitation: number
                  pending_cancellation: number
                }
                plan_type: string
              }
              result.orgBillingBreakdown = {
                planType: data.plan_type,
                totalSeats: data.seat_breakdown.total,
                activeSeats: data.seat_breakdown.active_this_cycle,
                inactiveSeats: data.seat_breakdown.inactive_this_cycle,
                pendingInvitation: data.seat_breakdown.pending_invitation,
                pendingCancellation: data.seat_breakdown.pending_cancellation,
              }
              break
            }
          }
          if (!result.hasAccess) {
            for (const org of orgsData) {
              const seat = await fetch(`https://api.github.com/orgs/${org.login}/members/${username}/copilot`, {
                method: "GET",
                headers: {
                  Accept: "application/vnd.github+json",
                  Authorization: `Bearer ${record.access}`,
                  "User-Agent": "opencode/1.0",
                },
                signal: controller.signal,
              }).catch(() => null)
              if (seat?.ok) {
                const data = (await seat.json()) as { created_at: string; last_activity_at?: string | null }
                result.hasAccess = true
                result.assignedDate = data.created_at
                result.lastActivityDate = data.last_activity_at ?? undefined
                break
              }
            }
          }
          result.organizations = orgsData.map((org) => ({ name: org.login, role: "member" }))
        }
        if (!result.hasAccess && !result.orgBillingBreakdown) result.hasAccess = true
        return result
      } catch {
        return null
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  export async function getOAuthRecords(providerID: string) {
    const store = await loadStoreFile()
    const provider = store.providers[providerID]
    if (!provider || provider.type !== "oauth") return [] as OAuthRecord[]
    return provider.records
  }

  export async function getOAuthRecord(providerID: string, recordID: string) {
    return (await getOAuthRecords(providerID)).find((record) => record.id === recordID)
  }

  export async function getActiveOAuthRecord(providerID: string) {
    const store = await loadStoreFile()
    const provider = store.providers[providerID]
    if (!provider || provider.type !== "oauth") return undefined
    return availableRecordID(provider, "default", provider.active.default)
  }

  export async function setActiveOAuthRecord(providerID: string, recordID: string): Promise<void> {
    await OAuthPool.setActive(providerID, "default", recordID)
  }

  export async function updateOAuthRecordHealth(
    providerID: string,
    recordID: string,
    update: {
      lastStatusCode?: number
      lastErrorAt?: number
      cooldownUntil?: number
      successCount?: number
      failureCount?: number
    },
  ): Promise<void> {
    await updateStoreBestEffort((store) => {
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return { value: undefined, changed: false }
      const record = provider.records.find((item) => item.id === recordID)
      if (!record) return { value: undefined, changed: false }
      if (update.lastStatusCode !== undefined) record.health.lastStatusCode = update.lastStatusCode
      if (update.lastErrorAt !== undefined) record.health.lastErrorAt = update.lastErrorAt
      if (Object.hasOwn(update, "cooldownUntil")) record.health.cooldownUntil = update.cooldownUntil
      if (update.successCount !== undefined) record.health.successCount = update.successCount
      if (update.failureCount !== undefined) record.health.failureCount = update.failureCount
      record.updatedAt = Date.now()
      return { value: undefined, changed: true }
    })
  }

  export async function addOAuthRecord(
    providerID: string,
    info: { refresh: string; access: string; expires: number; accountId?: string; email?: string; enterpriseUrl?: string },
    label?: string,
  ) {
    const result = await addOAuth(providerID, { ...info, label })
    return getOAuthRecord(result.providerID, result.recordID)
  }

  export async function removeOAuthRecord(providerID: string, recordID: string): Promise<void> {
    await OAuthPool.removeRecord(providerID, recordID)
  }

  export async function getProviderAccounts(providerID: string) {
    return OAuthPool.list(providerID)
  }

  export async function setOAuthRecordLabel(providerID: string, recordID: string, label: string): Promise<void> {
    await OAuthPool.updateRecord(providerID, recordID, "default", { label })
  }

  export async function refreshOAuthRecord(
    providerID: string,
    recordID: string,
    tokens: { refresh: string; access: string; expires: number },
  ): Promise<void> {
    await OAuthPool.updateRecord(providerID, recordID, "default", tokens)
  }

  export async function usage() {
    const all = await Auth.all()
    const result: Record<string, any> = {}
    for (const [providerID, info] of Object.entries(all)) {
      if (info.type !== "oauth") continue
      const accounts = await OAuthPool.getUsage(providerID)
      const anthropicUsage = await OAuthPool.fetchAnthropicUsage(providerID)
      result[providerID] = { accounts, anthropicUsage: anthropicUsage ?? undefined }
    }

    const codexUsage = await OAuthPool.fetchCodexUsage()
    if (codexUsage) {
      const accounts = await OAuthPool.getUsage("openai")
      result.codex = {
        accounts: await Promise.all(accounts.map(async (account) => ({ ...account, codexUsage: (await OAuthPool.fetchCodexUsage(account.id)) ?? undefined }))),
        codexUsage,
      }
    }

    const minimaxUsage = await OAuthPool.fetchMiniMaxUsage()
    if (minimaxUsage) result.minimax = { accounts: [], minimaxUsage }

    const openrouterUsage = await OAuthPool.fetchOpenRouterUsage()
    if (openrouterUsage) result.openrouter = { accounts: [], openrouterUsage }

    const githubCopilotUsage = await OAuthPool.fetchGitHubCopilotUsage()
    if (githubCopilotUsage) {
      result["github-copilot"] = {
        accounts: await OAuthPool.getUsage("github-copilot"),
        githubCopilotUsage,
      }
    }

    return result
  }
}
