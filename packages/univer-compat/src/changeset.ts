type ChangesetRow = {
  unitID: string
  type: number
  baseRev: number
  newRev: number
  memberID: string
  changeset: string
  recordedAt: number
}

export function isSnapshotSave(cs: string) {
  const probe = JSON.parse(cs) as { event?: string }
  return probe.event === "snapshot_save"
}

function extractInner(cs: string) {
  const m = JSON.parse(cs) as Record<string, unknown>
  if (m.mutations !== undefined) return m
  const nested = m.changeset as Record<string, unknown> | undefined
  if (nested && nested.mutations !== undefined) return nested
  return m
}

/** Mutations array from a stored changeset JSON string (same envelope as `flattenChangesetRecords`). */
export function mutationsFromChangeset(cs: string): unknown[] {
  const inner = extractInner(cs)
  const list = inner.mutations
  if (!Array.isArray(list)) return []
  return list
}

export function flattenChangesetRecords(recs: ChangesetRow[]) {
  const out: Record<string, unknown>[] = []
  for (const rec of recs) {
    const inner = extractInner(rec.changeset)
    const mutations = inner.mutations as unknown[] | undefined
    if (!mutations || !mutations.length) continue
    const mutBytes = JSON.stringify(mutations)
    let memberID = rec.memberID
    if (!memberID && typeof inner.memberID === "string") memberID = inner.memberID
    const row: Record<string, unknown> = {
      unitID: rec.unitID,
      type: rec.type,
      baseRev: rec.baseRev,
      revision: rec.newRev,
      userID: typeof inner.userID === "string" ? inner.userID : "",
      mutations,
      memberID,
      mutationSize: String(mutBytes.length),
    }
    if (rec.recordedAt > 0) row.createTime = Math.floor(rec.recordedAt / 1000)
    const sid = inner.sid
    if (typeof sid === "string" && sid) row.sid = sid
    if (inner.reqId !== undefined) row.reqId = inner.reqId
    out.push(row)
  }
  return out
}

export function patchChangesetRevision(cs: string, revision: number) {
  const root = JSON.parse(cs) as Record<string, unknown>
  root.revision = revision
  return JSON.stringify(root)
}
