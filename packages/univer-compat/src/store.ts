import { BlobMissing, type ExchangeFileBackend } from "./exchange-files"
import { MemoryExchangeFiles } from "./memory-exchange-files"
import { applyMutationsToSnapshotJson } from "./apply-mutations"
import { bumpSnapshotRevOnly, defaultWorkbook, migrateWorkbookInSnapshotRoot } from "./workbook"
import { isSnapshotSave, mutationsFromChangeset } from "./changeset"
import { xlsxToWorkbookJson } from "./xlsx-import"
import { exchangeUploadKey, unitBundleKey, unitBundlesPrefix } from "./object-keys"
import { exchangePresignActor } from "./presign-actor"
import { requireRequestUserId } from "./request-user"
import { requireRequestProjectId } from "./request-project"

function plain(o: unknown): o is Record<string, unknown> {
  return o !== null && typeof o === "object" && !Array.isArray(o)
}

/** @deprecated use `unitBundleKey` from `./object-keys` */
export function unitStateKey(userId: string, projectId: string, unitID: string) {
  return unitBundleKey(userId, projectId, unitID)
}

export type Unit = {
  id: string
  name: string
  type: number
  creator: string
  revision: number
}

export type SnapshotRow = {
  unitID: string
  revision: number
  type: number
  snapshot: string
  createdAt: number
}

export type ChangesetRow = {
  unitID: string
  type: number
  baseRev: number
  newRev: number
  memberID: string
  changeset: string
  recordedAt: number
}

export type TaskRow = {
  id: string
  status: string
  outputType: number
  importUnit: string
}

type PersistedUnitBundle = {
  unit: Unit
  snapshots: SnapshotRow[]
  changesets: ChangesetRow[]
}

export class Conflict extends Error {
  readonly tag = "conflict"
}

export class MergeFailed extends Error {
  readonly tag = "merge"
}

export class Missing extends Error {
  readonly tag = "missing"
}

function snapshotRowAtOrBefore(rs: SnapshotRow[], rev: number) {
  let best: SnapshotRow | undefined
  for (const r of rs) {
    if (r.revision <= rev && (!best || r.revision > best.revision)) best = r
  }
  return best
}

/**
 * Holds unit state in RAM for the process lifetime: every revision appends a full `snapshot` JSON string
 * plus changeset rows. Hydrate loads the per-project unit bundle from S3 (`unitBundleKey`). Persist cadence
 * (`maybePersistUnit`) does not trim RAM — only how often the bundle is written to object storage.
 */
export class Store {
  units = new Map<string, Unit>()
  snapshots = new Map<string, SnapshotRow[]>()
  changesets = new Map<string, ChangesetRow[]>()
  tasks = new Map<string, TaskRow>()

  private readonly hydrateLocks = new Map<string, Promise<void>>()

  private hydrateLockKey(unitID: string) {
    return `${requireRequestUserId()}:${requireRequestProjectId()}:${unitID}`
  }

  constructor(
    private readonly blob: ExchangeFileBackend,
    readonly persistEveryRev: number,
  ) {
    if (!Number.isFinite(persistEveryRev) || persistEveryRev < 1) {
      throw new Error("persistEveryRev must be a finite integer >= 1")
    }
  }

  memoryExchange(): MemoryExchangeFiles | undefined {
    const b = this.blob
    return b instanceof MemoryExchangeFiles ? b : undefined
  }

  async beginPresignedExchangeUpload(contentType: string, size: number) {
    const max = 32 << 20
    if (!Number.isFinite(size) || size < 0 || size > max) throw new Error("invalid size")
    const id = crypto.randomUUID()
    const k = exchangeUploadKey(requireRequestUserId(), requireRequestProjectId(), id)
    const ttl = 300
    const owner = exchangePresignActor()
    const signed = await this.blob.presignedPut(k, contentType, ttl, owner)
    return { FileId: id, url: signed.url, headers: signed.headers }
  }

  async presignedGetExchangeFile(fileID: string, ttlSec: number) {
    const k = exchangeUploadKey(requireRequestUserId(), requireRequestProjectId(), fileID)
    const owner = exchangePresignActor()
    return this.blob.presignedGet(k, ttlSec, owner)
  }

  /** Write unit bundle to S3 when `always`, else on rev 1 or every `persistEveryRev` (crash window between writes). */
  async maybePersistUnit(unitID: string, rev: number, always: boolean) {
    if (always) {
      await this.persistUnit(unitID)
      return
    }
    if (rev === 1 || rev % this.persistEveryRev === 0) await this.persistUnit(unitID)
  }

  async saveFile(id: string, b: Uint8Array) {
    await this.blob.put(exchangeUploadKey(requireRequestUserId(), requireRequestProjectId(), id), b)
  }

  async fileExists(id: string) {
    return this.blob.exists(exchangeUploadKey(requireRequestUserId(), requireRequestProjectId(), id))
  }

  async fileBytes(fileID: string) {
    try {
      return await this.blob.get(exchangeUploadKey(requireRequestUserId(), requireRequestProjectId(), fileID))
    } catch (e: unknown) {
      if (e instanceof BlobMissing) throw new Missing()
      throw e
    }
  }

  /** List persisted sheet units for the current user and project (S3 list + one GET per unit for display name). */
  async listPersistedSheetUnits(): Promise<{ id: string; name: string }[]> {
    const uid = requireRequestUserId()
    const pj = requireRequestProjectId()
    const prefix = unitBundlesPrefix(uid, pj)
    const keys = await this.blob.listKeysWithPrefix(prefix)
    const ids: string[] = []
    for (const k of keys) {
      if (!k.startsWith(prefix)) continue
      if (!k.endsWith(".json")) continue
      const tail = k.slice(prefix.length)
      const id = tail.replace(/\.json$/u, "")
      if (!id || id.includes("/")) continue
      ids.push(id)
    }
    const pairs = await Promise.all(
      ids.map(async (id): Promise<{ id: string; name: string } | undefined> => {
        let raw: Uint8Array
        try {
          raw = await this.blob.get(unitBundleKey(uid, pj, id))
        } catch (e: unknown) {
          if (e instanceof BlobMissing) return undefined
          throw e
        }
        const bundle = JSON.parse(new TextDecoder().decode(raw)) as PersistedUnitBundle
        const u = bundle.unit
        if (!u || u.id !== id) return undefined
        const n = u.name
        return { id, name: typeof n === "string" && n.trim() ? n.trim() : id }
      }),
    )
    const rows = pairs.filter((x): x is { id: string; name: string } => Boolean(x))
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Load unit + snapshots + changesets from object storage when RAM was cleared (compat restart). */
  async hydrateUnit(unitID: string) {
    if (this.units.has(unitID)) return
    const lk = this.hydrateLockKey(unitID)
    let p = this.hydrateLocks.get(lk)
    if (!p) {
      p = this.hydrateUnitOnce(unitID).finally(() => this.hydrateLocks.delete(lk))
      this.hydrateLocks.set(lk, p)
    }
    await p
  }

  private async hydrateUnitOnce(unitID: string) {
    if (this.units.has(unitID)) return
    let raw: Uint8Array
    try {
      raw = await this.blob.get(unitBundleKey(requireRequestUserId(), requireRequestProjectId(), unitID))
    } catch (e: unknown) {
      if (e instanceof BlobMissing) return
      throw e
    }
    const t = new TextDecoder().decode(raw)
    const bundle = JSON.parse(t) as PersistedUnitBundle
    const u = bundle.unit
    if (!u || u.id !== unitID) throw new Error("invalid persisted unit bundle")
    this.units.set(unitID, u)
    this.snapshots.set(unitID, bundle.snapshots ?? [])
    this.changesets.set(unitID, bundle.changesets ?? [])
  }

  async persistUnit(unitID: string) {
    const u = this.units.get(unitID)
    const snaps = this.snapshots.get(unitID)
    if (!u || !snaps?.length) return
    const bundle: PersistedUnitBundle = {
      unit: u,
      snapshots: snaps,
      changesets: this.changesets.get(unitID) ?? [],
    }
    await this.blob.put(
      unitBundleKey(requireRequestUserId(), requireRequestProjectId(), unitID),
      new TextEncoder().encode(JSON.stringify(bundle)),
    )
  }

  createUnit(name: string, creator: string, typ: number) {
    const id = crypto.randomUUID()
    const now = Date.now()
    const u: Unit = {
      id,
      name,
      type: typ,
      creator,
      revision: 0,
    }
    const blank = JSON.stringify(defaultWorkbook(id, name))
    const row: SnapshotRow = {
      unitID: id,
      revision: 0,
      type: typ,
      snapshot: blank,
      createdAt: now,
    }
    this.units.set(id, u)
    this.snapshots.set(id, [row])
    return u
  }

  ensureSnapshot(unitID: string, rev: number) {
    const rs = this.snapshots.get(unitID)
    if (!rs?.length) throw new Missing()
    if (!rs.some((r) => r.revision === rev)) throw new Missing()
  }

  saveSnapshot(unitID: string, typ: number, baseRev: number, member: string, snap: unknown) {
    const u = this.units.get(unitID)
    if (!u || u.type !== typ) throw new Missing()
    if (u.revision !== baseRev) throw new Conflict()
    const now = Date.now()
    const next = u.revision + 1
    if (plain(snap)) migrateWorkbookInSnapshotRoot(snap as Record<string, unknown>)
    const raw = JSON.stringify(snap)
    const cs: ChangesetRow = {
      unitID,
      type: typ,
      baseRev,
      newRev: next,
      memberID: member,
      changeset: JSON.stringify({ event: "snapshot_save" }),
      recordedAt: now,
    }
    const list = this.changesets.get(unitID) ?? []
    list.push(cs)
    this.changesets.set(unitID, list)
    const rs = this.snapshots.get(unitID) ?? []
    rs.push({
      unitID,
      revision: next,
      type: typ,
      snapshot: raw,
      createdAt: now,
    })
    this.snapshots.set(unitID, rs)
    u.revision = next
    this.units.set(unitID, u)
    return next
  }

  saveChangeset(unitID: string, typ: number, baseRev: number, member: string, cs: string) {
    const u = this.units.get(unitID)
    if (!u || u.type !== typ) throw new Missing()
    if (u.revision !== baseRev) throw new Conflict()
    const rs = this.snapshots.get(unitID) ?? []
    const baseRow = snapshotRowAtOrBefore(rs, baseRev)
    if (!baseRow || !baseRow.snapshot.length) throw new MergeFailed()
    const now = Date.now()
    const next = u.revision + 1
    const muts = mutationsFromChangeset(cs)
    let merged: string
    if (!muts.length) {
      merged = bumpSnapshotRevOnly(baseRow.snapshot, next)
      if (!merged) throw new MergeFailed()
    } else {
      try {
        merged = applyMutationsToSnapshotJson(baseRow.snapshot, muts, next)
      } catch {
        throw new MergeFailed()
      }
    }
    const row: ChangesetRow = {
      unitID,
      type: typ,
      baseRev,
      newRev: next,
      memberID: member,
      changeset: cs,
      recordedAt: now,
    }
    const clist = this.changesets.get(unitID) ?? []
    clist.push(row)
    this.changesets.set(unitID, clist)
    rs.push({
      unitID,
      revision: next,
      type: typ,
      snapshot: merged,
      createdAt: now,
    })
    this.snapshots.set(unitID, rs)
    u.revision = next
    this.units.set(unitID, u)
    return next
  }

  unit(unitID: string, typ: number) {
    const u = this.units.get(unitID)
    if (!u || u.type !== typ) throw new Missing()
    return u
  }

  getUnitOnRev(unitID: string, typ: number, rev: number) {
    const u = this.units.get(unitID)
    if (!u || u.type !== typ) throw new Missing()
    const rs = this.snapshots.get(unitID)
    if (!rs?.length) throw new Missing()
    let effective = rev
    if (rev === 0 && u.revision > 0) effective = u.revision
    let best = rs[0]
    for (const r of rs) {
      if (r.revision <= effective && r.revision >= best.revision) best = r
    }
    const trail: ChangesetRow[] = []
    for (const c of this.changesets.get(unitID) ?? []) {
      if (c.newRev <= effective && !isSnapshotSave(c.changeset)) trail.push(c)
    }
    return { snap: best.snapshot, trail, head: u.revision }
  }

  missingChangesets(unitID: string, typ: number, from: number, to: number) {
    const u = this.units.get(unitID)
    if (!u || u.type !== typ) throw new Missing()
    let end = to
    if (end === 0 || end > u.revision) end = u.revision
    const out: ChangesetRow[] = []
    for (const c of this.changesets.get(unitID) ?? []) {
      if (c.newRev > from && c.newRev <= end) out.push(c)
    }
    return { list: out, latest: u.revision }
  }

  latestSnapshot(unitID: string, typ: number) {
    const u = this.units.get(unitID)
    if (!u || u.type !== typ) throw new Missing()
    const rs = this.snapshots.get(unitID)
    if (!rs?.length) throw new Missing()
    let best = rs[0]
    for (const r of rs.slice(1)) {
      if (r.revision > best.revision) best = r
    }
    return { snap: best.snapshot, rev: u.revision }
  }

  async createImportTask(typ: number, fileID: string) {
    if (!fileID.trim()) throw new Missing()
    const raw = await this.fileBytes(fileID)
    if (typ !== 2) throw new Error(`exchange import for type ${typ} not implemented (only sheets type=2)`)
    const unitID = crypto.randomUUID()
    const wb = await xlsxToWorkbookJson(unitID, raw)
    const snap = JSON.stringify(wb)
    const now = Date.now()
    const u: Unit = {
      id: unitID,
      name: "Imported Workbook",
      type: typ,
      creator: "veritly-mock-user",
      revision: 0,
    }
    this.units.set(unitID, u)
    this.snapshots.set(unitID, [
      {
        unitID,
        revision: 0,
        type: typ,
        snapshot: snap,
        createdAt: now,
      },
    ])
    const taskID = crypto.randomUUID()
    this.tasks.set(taskID, {
      id: taskID,
      status: "done",
      outputType: 1,
      importUnit: unitID,
    })
    await this.maybePersistUnit(unitID, 0, true)
    return taskID
  }

  task(id: string) {
    const t = this.tasks.get(id)
    if (!t) throw new Missing()
    return t
  }

  /** Structural validation helper — empty workbook JSON string for tests / bootstrap checks. */
  static emptySnapshotJson(name = "x") {
    const id = crypto.randomUUID()
    return JSON.stringify(defaultWorkbook(id, name))
  }
}
