import path from "path"
import { Effect, Layer, Record, Result, Schema, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import { AppFileSystem } from "../filesystem"
import fs from "fs/promises"
import { ulid } from "ulid"
import { Log } from "../util/log"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")
const lockpath = `${file}.lock`
const STORE_LOCK_TIMEOUT_MS = 5_000
const STORE_LOCK_STALE_MS = 30_000
const STORE_LOCK_RETRY_MS = 25

const log = Log.create({ service: "auth.store" })

class StoreLockTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for auth store lock")
    this.name = "StoreLockTimeoutError"
  }
}

export namespace Auth {
  export class Oauth extends Schema.Class<Oauth>("OAuth")({
    type: Schema.Literal("oauth"),
    refresh: Schema.String,
    access: Schema.String,
    expires: Schema.Number,
    accountId: Schema.optional(Schema.String),
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
  export const Info = Object.assign(_Info, { zod: zod(_Info) })
  export type Info = Schema.Schema.Type<typeof _Info>

  // Multi-account OAuth types
  export class OAuthRecordHealth extends Schema.Class<OAuthRecordHealth>("OAuthRecordHealth")({
    cooldownUntil: Schema.optional(Schema.Number),
    lastStatusCode: Schema.optional(Schema.Number),
    lastErrorAt: Schema.optional(Schema.Number),
    successCount: Schema.Number,
    failureCount: Schema.Number,
  }) {}

  export class OAuthRecord extends Schema.Class<OAuthRecord>("OAuthRecord")({
    id: Schema.String,
    namespace: Schema.String,
    label: Schema.optional(Schema.String),
    accountId: Schema.optional(Schema.String),
    enterpriseUrl: Schema.optional(Schema.String),
    refresh: Schema.String,
    access: Schema.String,
    expires: Schema.Number,
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
    health: OAuthRecordHealth,
  }) {}

  export type OAuthRecordMeta = Omit<Schema.Schema.Type<typeof OAuthRecord>, "refresh" | "access" | "expires">

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

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fsys = yield* AppFileSystem.Service
      const decode = Schema.decodeUnknownOption(Info)

      const all = Effect.fn("Auth.all")(function* () {
        const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
        return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
      })

      const get = Effect.fn("Auth.get")(function* (providerID: string) {
        return (yield* all())[providerID]
      })

      const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        if (norm !== key) delete data[key]
        delete data[norm + "/"]
        yield* fsys
          .writeJson(file, { ...data, [norm]: info }, 0o600)
          .pipe(Effect.mapError(fail("Failed to write auth data")))
      })

      const remove = Effect.fn("Auth.remove")(function* (key: string) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        delete data[key]
        delete data[norm]
        yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
      })

      return Service.of({ get, all, set, remove })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function get(providerID: string) {
    return runPromise((service) => service.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((service) => service.all())
  }

  export async function set(key: string, info: Info) {
    return runPromise((service) => service.set(key, info))
  }

  export async function remove(key: string) {
    return runPromise((service) => service.remove(key))
  }

  // Multi-account OAuth store functions

  const oauthFilepath = path.join(Global.Path.data, "oauth.json")

  type OAuthProviderRecord = {
    id: string
    namespace: string
    label?: string
    accountId?: string
    enterpriseUrl?: string
    refresh: string
    access: string
    expires: number
    createdAt: number
    updatedAt: number
    health: {
      cooldownUntil?: number
      lastStatusCode?: number
      lastErrorAt?: number
      successCount: number
      failureCount: number
    }
  }

  type OAuthProviderStore = {
    type: "oauth"
    active: Record<string, string>
    order: Record<string, string[]>
    records: OAuthProviderRecord[]
  }

  type OAuthStoreFile = {
    version: 2
    providers: Record<string, OAuthProviderStore>
  }

  async function ensureDataDir(): Promise<void> {
    await fs.mkdir(path.dirname(oauthFilepath), { recursive: true })
  }

  async function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
    await ensureDataDir()
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
        if (stat && Date.now() - stat.mtimeMs > STORE_LOCK_STALE_MS) {
          await fs.rm(lockpath).catch(() => {})
          continue
        }
        if (Date.now() - start > STORE_LOCK_TIMEOUT_MS) {
          throw new StoreLockTimeoutError()
        }
        await Bun.sleep(STORE_LOCK_RETRY_MS + Math.random() * STORE_LOCK_RETRY_MS)
      }
    }

    try {
      return await fn()
    } finally {
      await fs.rm(lockpath).catch(() => {})
    }
  }

  async function writeOAuthStore(store: OAuthStoreFile): Promise<void> {
    await ensureDataDir()
    const tempPath = `${oauthFilepath}.tmp`
    const tempFile = Bun.file(tempPath)
    await Bun.write(tempFile, JSON.stringify(store, null, 2))
    await fs.rename(tempPath, oauthFilepath)
    await fs.chmod(oauthFilepath, 0o600).catch(() => {})
  }

  async function readOAuthStore(): Promise<OAuthStoreFile> {
    const f = Bun.file(oauthFilepath)
    const exists = await f.exists()
    if (!exists) {
      return { version: 2, providers: {} }
    }
    const raw = await f.json().catch(() => undefined)
    if (!raw || typeof raw !== "object") {
      return { version: 2, providers: {} }
    }
    if ("version" in raw && "providers" in raw && raw.version === 2) {
      return raw as OAuthStoreFile
    }
    return { version: 2, providers: {} }
  }

  function toMeta(record: OAuthProviderRecord): OAuthRecordMeta {
    return {
      id: record.id,
      namespace: record.namespace,
      label: record.label,
      accountId: record.accountId,
      enterpriseUrl: record.enterpriseUrl,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      health: record.health,
    }
  }

  export async function getOAuthRecords(providerID: string): Promise<OAuthProviderRecord[]> {
    const store = await readOAuthStore()
    const provider = store.providers[providerID]
    if (!provider || provider.type !== "oauth") return []
    return provider.records
  }

  export async function getOAuthRecord(providerID: string, recordID: string): Promise<OAuthProviderRecord | undefined> {
    const records = await getOAuthRecords(providerID)
    return records.find((r) => r.id === recordID)
  }

  export async function getActiveOAuthRecord(providerID: string): Promise<string | undefined> {
    const store = await readOAuthStore()
    const provider = store.providers[providerID]
    if (!provider || provider.type !== "oauth") return undefined
    const activeForNamespace = provider.active["default"]
    if (!activeForNamespace) {
      return provider.records[0]?.id
    }
    const exists = provider.records.some((r) => r.id === activeForNamespace)
    return exists ? activeForNamespace : provider.records[0]?.id
  }

  export async function setActiveOAuthRecord(providerID: string, recordID: string): Promise<void> {
    await withStoreLock(async () => {
      const store = await readOAuthStore()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return
      provider.active["default"] = recordID
      await writeOAuthStore(store)
    })
  }

  type HealthUpdate = {
    lastStatusCode?: number
    lastErrorAt?: number
    cooldownUntil?: number
    successCount?: number
    failureCount?: number
  }

  export async function updateOAuthRecordHealth(
    providerID: string,
    recordID: string,
    update: HealthUpdate,
  ): Promise<void> {
    await withStoreLock(async () => {
      const store = await readOAuthStore()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return
      const record = provider.records.find((r) => r.id === recordID)
      if (!record) return
      if (update.lastStatusCode !== undefined) record.health.lastStatusCode = update.lastStatusCode
      if (update.lastErrorAt !== undefined) record.health.lastErrorAt = update.lastErrorAt
      if (update.cooldownUntil !== undefined) record.health.cooldownUntil = update.cooldownUntil
      if (update.successCount !== undefined) record.health.successCount = update.successCount
      if (update.failureCount !== undefined) record.health.failureCount = update.failureCount
      record.updatedAt = Date.now()
      await writeOAuthStore(store)
    })
  }

  export async function addOAuthRecord(
    providerID: string,
    info: { refresh: string; access: string; expires: number; accountId?: string; enterpriseUrl?: string },
    label?: string,
  ): Promise<OAuthProviderRecord> {
    const record: OAuthProviderRecord = {
      id: ulid(),
      namespace: "default",
      label: label ?? info.accountId ?? info.enterpriseUrl,
      accountId: info.accountId,
      enterpriseUrl: info.enterpriseUrl,
      refresh: info.refresh,
      access: info.access,
      expires: info.expires,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      health: { successCount: 0, failureCount: 0 },
    }

    await withStoreLock(async () => {
      const store = await readOAuthStore()
      let provider = store.providers[providerID]
      if (!provider) {
        provider = {
          type: "oauth",
          active: { default: record.id },
          order: { default: [] },
          records: [],
        }
        store.providers[providerID] = provider
      } else if (provider.type !== "oauth") {
        throw new AuthError({ message: `Provider ${providerID} is not an OAuth provider` })
      }

      provider.records.push(record)
      if (!provider.active["default"]) {
        provider.active["default"] = record.id
      }
      await writeOAuthStore(store)
    })

    return record
  }

  export async function removeOAuthRecord(providerID: string, recordID: string): Promise<void> {
    await withStoreLock(async () => {
      const store = await readOAuthStore()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return
      const index = provider.records.findIndex((r) => r.id === recordID)
      if (index === -1) return
      provider.records.splice(index, 1)
      if (provider.active["default"] === recordID) {
        provider.active["default"] = provider.records[0]?.id
      }
      await writeOAuthStore(store)
    })
  }

  export async function getProviderAccounts(providerID: string): Promise<OAuthRecordMeta[]> {
    const records = await getOAuthRecords(providerID)
    return records.map(toMeta)
  }

  export async function setOAuthRecordLabel(providerID: string, recordID: string, label: string): Promise<void> {
    await withStoreLock(async () => {
      const store = await readOAuthStore()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return
      const record = provider.records.find((r) => r.id === recordID)
      if (!record) return
      record.label = label
      record.updatedAt = Date.now()
      await writeOAuthStore(store)
    })
  }

  export async function refreshOAuthRecord(
    providerID: string,
    recordID: string,
    tokens: { refresh: string; access: string; expires: number },
  ): Promise<void> {
    await withStoreLock(async () => {
      const store = await readOAuthStore()
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return
      const record = provider.records.find((r) => r.id === recordID)
      if (!record) return
      record.refresh = tokens.refresh
      record.access = tokens.access
      record.expires = tokens.expires
      record.updatedAt = Date.now()
      record.health = { successCount: 0, failureCount: 0 }
      await writeOAuthStore(store)
    })
  }
}

const fail = (message: string) => (cause: unknown) => new Auth.AuthError({ message, cause })
