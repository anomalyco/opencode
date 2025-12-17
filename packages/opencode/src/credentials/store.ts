import path from "path"
import fs from "fs/promises"
import { ulid } from "ulid"
import { Global } from "@/global"
import { VaultKey } from "@/vault/key"
import { VaultCrypto } from "@/vault/crypto"
import { VaultFS } from "@/vault/fs"
import { VaultLock } from "@/vault/lock"
import { Credentials } from "./types"

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
  const ROOT = path.join(Global.Path.data, "credentials")
  const RECORDS_DIR = path.join(ROOT, "records")
  const LOCK_PATH = path.join(ROOT, ".lock")

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

  export async function listAll(): Promise<{
    records: Credentials.RecordFile[]
    errors: Array<{ file: string; error: unknown }>
  }> {
    await ensureDirs()
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
      await fs.rm(recordPath(id), { force: true })
    })
  }

  export async function findByProvider(providerId: string, namespace?: string): Promise<Credentials.RecordFile[]> {
    const { records } = await listAll()
    return records.filter((r) => r.meta.providerId === providerId && (!namespace || r.meta.namespace === namespace))
  }

  export async function upsertSingleton(input: UpsertSingletonInput): Promise<Credentials.RecordFile> {
    await ensureDirs()
    const now = Date.now()
    const key = await VaultKey.load()

    return VaultLock.withLock(LOCK_PATH, async () => {
      const glob = new Bun.Glob("*.json")
      let existing: Credentials.RecordFile | undefined

      for await (const rel of glob.scan({ cwd: RECORDS_DIR, dot: false, onlyFiles: true })) {
        const file = path.join(RECORDS_DIR, rel)
        const json = await VaultFS.readJson<unknown>(file)
        const parsed = Credentials.RecordFile.safeParse(json)
        if (!parsed.success) continue
        const record = parsed.data
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
