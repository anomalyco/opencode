import path from "path"
import fs from "fs/promises"
import { ulid } from "ulid"
import { Global } from "@/global"
import { VaultKey } from "@/vault/key"
import { VaultCrypto } from "@/vault/crypto"
import { VaultFS } from "@/vault/fs"
import { VaultLock } from "@/vault/lock"
import { Credentials } from "./types"
import { Log } from "@/util/log"
import z from "zod"

type PutInput = {
  id?: string
  providerId: string
  namespace?: string
  label?: string
  kind: Credentials.Kind
  secret: Credentials.Secret
}

type UpsertSingletonInput = {
  providerId: string
  namespace: string
  label: string
  kind: Credentials.Kind
  secret: Credentials.Secret
}

export namespace CredentialStore {
  const log = Log.create({ service: "credentials.store" })

  const ROOT = path.join(Global.Path.data, "credentials")
  const RECORDS_DIR = path.join(ROOT, "records")
  const LOCK_PATH = path.join(ROOT, ".lock")
  const INDEX_PATH = path.join(ROOT, "index.json")

  const IndexFile = z
    .object({
      version: z.literal(1),
      byProvider: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
    })
    .strict()
  type IndexFile = z.infer<typeof IndexFile>

  const DEFAULT_INDEX: IndexFile = { version: 1, byProvider: {} }
  const INDEX_CACHE_TTL_MS = 2_000
  let indexCache: { loadedAt: number; value: IndexFile } | undefined

  async function ensureDirs() {
    await VaultFS.ensureDir(RECORDS_DIR)
  }

  function recordPath(id: string) {
    return path.join(RECORDS_DIR, `${id}.json`)
  }

  export async function hasAnyRecords(): Promise<boolean> {
    await ensureDirs()
    const entries = await fs.readdir(RECORDS_DIR).catch(() => [])
    return entries.some((x) => x.endsWith(".json"))
  }

  function cacheIndex(next: IndexFile): IndexFile {
    indexCache = { loadedAt: Date.now(), value: next }
    return next
  }

  async function readIndexFromDisk(): Promise<IndexFile | undefined> {
    const json = await VaultFS.readJson<unknown>(INDEX_PATH)
    const parsed = IndexFile.safeParse(json)
    return parsed.success ? parsed.data : undefined
  }

  async function rebuildIndex(): Promise<IndexFile> {
    const { records } = await listAll()
    const byProvider: IndexFile["byProvider"] = {}
    for (const record of records) {
      const provider = record.meta.providerId
      const ns = record.meta.namespace
      byProvider[provider] ??= {}
      byProvider[provider][ns] ??= []
      byProvider[provider][ns].push(record.meta.id)
    }

    const index: IndexFile = { version: 1, byProvider }
    await VaultLock.withLock(LOCK_PATH, async () => {
      await VaultFS.atomicWriteJson(INDEX_PATH, index, 0o600)
    })
    return cacheIndex(index)
  }

  async function rebuildIndexLocked(): Promise<IndexFile> {
    const { records } = await listAll()
    const byProvider: IndexFile["byProvider"] = {}
    for (const record of records) {
      const provider = record.meta.providerId
      const ns = record.meta.namespace
      byProvider[provider] ??= {}
      byProvider[provider][ns] ??= []
      byProvider[provider][ns].push(record.meta.id)
    }
    const index: IndexFile = { version: 1, byProvider }
    await VaultFS.atomicWriteJson(INDEX_PATH, index, 0o600)
    return cacheIndex(index)
  }

  async function loadIndex(opts?: { force?: boolean }): Promise<IndexFile> {
    const now = Date.now()
    if (!opts?.force && indexCache && now - indexCache.loadedAt < INDEX_CACHE_TTL_MS) {
      return indexCache.value
    }

    const onDisk = await readIndexFromDisk()
    if (onDisk) return cacheIndex(onDisk)
    return rebuildIndex()
  }

  async function loadIndexLocked(): Promise<IndexFile> {
    const onDisk = await readIndexFromDisk()
    if (onDisk) return cacheIndex(onDisk)
    return rebuildIndexLocked()
  }

  function indexAdd(index: IndexFile, input: { providerId: string; namespace: string; id: string }) {
    index.byProvider[input.providerId] ??= {}
    index.byProvider[input.providerId][input.namespace] ??= []
    const ids = index.byProvider[input.providerId][input.namespace]
    if (!ids.includes(input.id)) ids.push(input.id)
  }

  function indexRemove(index: IndexFile, input: { providerId: string; namespace: string; id: string }) {
    const ns = index.byProvider[input.providerId]?.[input.namespace]
    if (!ns) return
    index.byProvider[input.providerId][input.namespace] = ns.filter((x) => x !== input.id)
  }

  export async function listAll(): Promise<{
    records: Credentials.RecordFile[]
    errors: Array<{ file: string; error: unknown }>
  }> {
    await ensureDirs()
    // NOTE: Bun.Glob is Bun-specific. If Node.js compatibility is needed,
    // consider using a cross-runtime glob library like 'fast-glob' or 'glob'.
    const glob = new Bun.Glob("*.json")
    const records: Credentials.RecordFile[] = []
    const errors: Array<{ file: string; error: unknown }> = []

    for await (const rel of glob.scan({ cwd: RECORDS_DIR, dot: false, onlyFiles: true })) {
      const file = path.join(RECORDS_DIR, rel)
      const json = await VaultFS.readJson<unknown>(file)
      const parsed = Credentials.RecordFile.safeParse(json)
      if (!parsed.success) {
        errors.push({ file, error: parsed.error })
        continue
      }
      records.push(parsed.data)
    }

    if (errors.length > 0) {
      log.error("credential record parse errors", { count: errors.length })
    }

    return { records, errors }
  }

  export async function getRecordFile(id: string): Promise<Credentials.RecordFile | undefined> {
    await ensureDirs()
    const json = await VaultFS.readJson<unknown>(recordPath(id))
    const parsed = Credentials.RecordFile.safeParse(json)
    if (!parsed.success) return undefined
    return parsed.data
  }

  export async function decryptSecret(record: Credentials.RecordFile): Promise<Credentials.Secret> {
    const key = await VaultKey.load()
    return VaultCrypto.decryptJson(key, record.secret) as Credentials.Secret
  }

  export async function put(input: PutInput): Promise<Credentials.RecordFile> {
    await ensureDirs()
    const now = Date.now()
    const id = input.id ?? ulid()
    const namespace = input.namespace ?? "default"
    const key = await VaultKey.load()

    const record: Credentials.RecordFile = {
      meta: {
        id,
        providerId: input.providerId,
        namespace,
        label: input.label,
        kind: input.kind,
        createdAt: now,
        updatedAt: now,
        health: {
          successCount: 0,
          failureCount: 0,
        },
      },
      secret: VaultCrypto.encryptJson(key, input.secret),
    }

    await VaultLock.withLock(LOCK_PATH, async () => {
      await VaultFS.atomicWriteJson(recordPath(id), record, 0o600)
      const index = await loadIndexLocked()
      indexAdd(index, { providerId: input.providerId, namespace, id })
      await VaultFS.atomicWriteJson(INDEX_PATH, index, 0o600)
      cacheIndex(index)
    })

    return record
  }

  export async function update(
    id: string,
    patch: Partial<Omit<Credentials.RecordFile, "meta">> & { meta?: Partial<Credentials.RecordFile["meta"]> },
  ) {
    return updateWith(id, (existing) => ({
      ...existing,
      ...patch,
      meta: {
        ...existing.meta,
        ...(patch.meta ?? {}),
      },
    }))
  }

  export async function remove(id: string): Promise<void> {
    await ensureDirs()
    await VaultLock.withLock(LOCK_PATH, async () => {
      const before = await getRecordFile(id)
      await fs.rm(recordPath(id), { force: true })
      if (!before) {
        await rebuildIndexLocked()
        return
      }

      const index = await loadIndexLocked()
      indexRemove(index, { providerId: before.meta.providerId, namespace: before.meta.namespace, id })
      await VaultFS.atomicWriteJson(INDEX_PATH, index, 0o600)
      cacheIndex(index)
    })
  }

  export async function findByProvider(providerId: string, namespace?: string): Promise<Credentials.RecordFile[]> {
    const index = await loadIndex()
    const namespaces = index.byProvider[providerId] ?? {}
    const ids = namespace ? namespaces[namespace] ?? [] : Object.values(namespaces).flat()
    if (ids.length === 0) return []

    const out: Credentials.RecordFile[] = []
    for (const id of ids) {
      const record = await getRecordFile(id)
      if (record) out.push(record)
    }
    return out
  }

  export async function upsertSingleton(input: UpsertSingletonInput): Promise<Credentials.RecordFile> {
    await ensureDirs()
    const now = Date.now()
    const key = await VaultKey.load()

    return VaultLock.withLock(LOCK_PATH, async () => {
      let existing: Credentials.RecordFile | undefined

      const index = await loadIndexLocked()
      const ids = index.byProvider[input.providerId]?.[input.namespace] ?? []
      for (const id of ids) {
        const record = await getRecordFile(id)
        if (!record) continue
        if (
          record.meta.providerId === input.providerId &&
          record.meta.namespace === input.namespace &&
          record.meta.kind === input.kind &&
          (record.meta.label ?? "") === input.label
        ) {
          existing = record
          break
        }
      }

      const id = existing?.meta.id ?? ulid()
      const record: Credentials.RecordFile = {
        meta: {
          id,
          providerId: input.providerId,
          namespace: input.namespace,
          label: input.label,
          kind: input.kind,
          createdAt: existing?.meta.createdAt ?? now,
          updatedAt: now,
          health: existing?.meta.health ?? { successCount: 0, failureCount: 0 },
        },
        secret: VaultCrypto.encryptJson(key, input.secret),
      }

      await VaultFS.atomicWriteJson(recordPath(id), record, 0o600)
      indexAdd(index, { providerId: input.providerId, namespace: input.namespace, id })
      await VaultFS.atomicWriteJson(INDEX_PATH, index, 0o600)
      cacheIndex(index)
      return record
    })
  }

  export async function updateSecret(id: string, secret: Credentials.Secret) {
    const key = await VaultKey.load()
    return updateWith(id, (existing) => ({ ...existing, secret: VaultCrypto.encryptJson(key, secret) }))
  }

  export async function updateHealth(id: string, patch: Partial<Credentials.RecordFile["meta"]["health"]>) {
    return updateWith(id, (existing) => ({
      ...existing,
      meta: {
        ...existing.meta,
        health: { ...existing.meta.health, ...patch },
      },
    }))
  }

  export async function recordOutcome(input: {
    id: string
    statusCode: number
    ok: boolean
    cooldownUntil?: number
  }) {
    return updateWith(input.id, (existing) => {
      const now = Date.now()
      const prevCooldown =
        existing.meta.health.cooldownUntil && existing.meta.health.cooldownUntil > now
          ? existing.meta.health.cooldownUntil
          : undefined
      const cooldownUntil = input.ok ? undefined : input.cooldownUntil ?? prevCooldown

      return {
        ...existing,
        meta: {
          ...existing.meta,
          health: {
            ...existing.meta.health,
            cooldownUntil,
            lastStatusCode: input.statusCode,
            lastErrorAt: input.ok ? undefined : now,
            successCount: existing.meta.health.successCount + (input.ok ? 1 : 0),
            failureCount: existing.meta.health.failureCount + (input.ok ? 0 : 1),
          },
        },
      }
    })
  }

  export async function updateWith(
    id: string,
    updater: (existing: Credentials.RecordFile) => Credentials.RecordFile | Promise<Credentials.RecordFile>,
  ): Promise<Credentials.RecordFile | undefined> {
    await ensureDirs()
    return VaultLock.withLock(LOCK_PATH, async () => {
      const json = await VaultFS.readJson<unknown>(recordPath(id))
      const parsed = Credentials.RecordFile.safeParse(json)
      if (!parsed.success) {
        if (!json) return undefined
        throw new Error(`Invalid credential record: ${recordPath(id)}`)
      }

      const existing = parsed.data
      const nextRaw = await updater(existing)
      const next: Credentials.RecordFile = {
        ...nextRaw,
        meta: {
          ...nextRaw.meta,
          id: existing.meta.id,
          providerId: existing.meta.providerId,
          namespace: existing.meta.namespace,
          kind: existing.meta.kind,
          createdAt: existing.meta.createdAt,
          updatedAt: Date.now(),
        },
      }

      await VaultFS.atomicWriteJson(recordPath(id), next, 0o600)
      return next
    })
  }
}
