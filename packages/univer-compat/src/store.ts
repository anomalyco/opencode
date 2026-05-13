import { BlobMissing, type ExchangeFileBackend } from "./exchange-files"
import { applyMutationsToSnapshotJson } from "./apply-mutations"
import { bumpSnapshotRevOnly, defaultWorkbook, migrateWorkbookInSnapshotRoot } from "./workbook"
import { isSnapshotSave, mutationsFromChangeset } from "./changeset"
import { xlsxToWorkbookJson } from "./xlsx-import"

function plain(o: unknown): o is Record<string, unknown> {
  return o !== null && typeof o === "object" && !Array.isArray(o)
}

/** Durable unit bundle in S3 — distinct from exchange upload keys (`FileId` UUID blobs). */
export function unitStateKey(unitID: string) {
  return `veritly/unit/${unitID}.json`
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
 * plus changeset rows. Hydrate loads the entire `veritly/unit/<unitID>.json` bundle from S3. Persist cadence
 * (`maybePersistUnit`) does not trim RAM — only how often the bundle is written to object storage.
 */
export class Store {
  units = new Map<string, Unit>()
  snapshots = new Map<string, SnapshotRow[]>()
  changesets = new Map<string, ChangesetRow[]>()
  tasks = new Map<string, TaskRow>()

  private readonly hydrateLocks = new Map<string, Promise<void>>()

  constructor(
    private readonly blob: ExchangeFileBackend,
    readonly persistEveryRev: number,
  ) {
    if (!Number.isFinite(persistEveryRev) || persistEveryRev < 1) {
      throw new Error("persistEveryRev must be a finite integer >= 1")
    }
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
    await this.blob.put(id, b)
  }

  async fileExists(id: string) {
    return this.blob.exists(id)
  }

  async fileBytes(fileID: string) {
    try {
      return await this.blob.get(fileID)
    } catch (e: unknown) {
      if (e instanceof BlobMissing) throw new Missing()
      throw e
    }
  }

  /** Load unit + snapshots + changesets from object storage when RAM was cleared (compat restart). */
  async hydrateUnit(unitID: string) {
    if (this.units.has(unitID)) return
    let p = this.hydrateLocks.get(unitID)
    if (!p) {
      p = this.hydrateUnitOnce(unitID).finally(() => this.hydrateLocks.delete(unitID))
      this.hydrateLocks.set(unitID, p)
    }
    await p
  }

  private async hydrateUnitOnce(unitID: string) {
    if (this.units.has(unitID)) return
    let raw: Uint8Array
    try {
      raw = await this.blob.get(unitStateKey(unitID))
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
    await this.blob.put(unitStateKey(unitID), new TextEncoder().encode(JSON.stringify(bundle)))
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
