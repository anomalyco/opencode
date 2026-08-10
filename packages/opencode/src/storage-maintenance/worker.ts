import { Database } from "bun:sqlite"
import { isDeepStrictEqual } from "node:util"

type PrepareInput = {
  readonly type: "prepare"
  readonly source: string
  readonly snapshot: string
}

type AnalyzeInput = {
  readonly type: "analyze"
  readonly snapshot: string
  readonly afterScanID: number
  readonly throughScanID: number
}

type Input = PrepareInput | AnalyzeInput

type Candidate = {
  readonly scanID: number
  readonly aggregateID: string
  readonly entityID: string
  readonly type: string
  readonly bytes: number
  readonly supersededBy: string
  readonly latestData: string
  readonly projectionData: string
  readonly projectionParentID: string | null
  readonly workspaceID: string | null
  readonly ownerID: string | null
}

type Analysis = {
  readonly inspected: number
  readonly candidates: number
  readonly projectionMismatches: number
  readonly compatibilityRejected: number
  readonly payloadBytesReclaimable: number
  readonly byType: Record<string, { events: number; payloadBytesReclaimable: number }>
}

const batchSize = 10_000
const indexBatchSize = 100_000

function send(message: unknown) {
  postMessage(message)
}

function verify(database: Database) {
  const rows = database.query("PRAGMA quick_check").all() as Array<Record<string, string>>
  if (rows.length === 1 && Object.values(rows[0])[0] === "ok") return
  throw new Error(`SQLite integrity check failed: ${JSON.stringify(rows)}`)
}

function prepare(input: PrepareInput) {
  send({ type: "progress", phase: "snapshot", completed: 0, total: 0 })
  const source = new Database(input.source, { readonly: true, create: false })
  verify(source)
  source.run("VACUUM INTO ?", [input.snapshot])
  source.close()

  send({ type: "progress", phase: "verify", completed: 0, total: 0 })
  const snapshot = new Database(input.snapshot)
  verify(snapshot)
  snapshot.exec("DROP TABLE IF EXISTS event_compaction_snapshot")
  snapshot.exec(`
    CREATE TABLE event_compaction_snapshot (
      scan_id INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      aggregate_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      entity_id TEXT NOT NULL
    )
  `)
  snapshot.exec(`
    CREATE INDEX event_compaction_snapshot_entity_idx
    ON event_compaction_snapshot (aggregate_id, type, entity_id, seq DESC, event_id)
  `)

  const maximum = Number(
    (snapshot.query("SELECT coalesce(max(rowid), 0) AS value FROM event").get() as { value: number }).value,
  )
  const insert = snapshot.query(`
    INSERT OR IGNORE INTO event_compaction_snapshot
      (scan_id, event_id, aggregate_id, seq, type, entity_id)
    SELECT rowid, id, aggregate_id, seq, type,
           CASE type
             WHEN 'message.updated.1' THEN json_extract(data, '$.info.id')
             ELSE json_extract(data, '$.part.id')
           END
    FROM event
    WHERE rowid > ?1 AND rowid <= ?2
      AND type IN ('message.updated.1', 'message.part.updated.1')
      AND CASE
        WHEN NOT json_valid(data) THEN 0
        WHEN type = 'message.updated.1' THEN json_type(data, '$.info.id') = 'text'
        ELSE json_type(data, '$.part.id') = 'text'
      END
  `)
  const malformed = snapshot.query(`
    SELECT count(*) AS value FROM event
    WHERE rowid > ?1 AND rowid <= ?2
      AND type IN ('message.updated.1', 'message.part.updated.1')
      AND CASE
        WHEN NOT json_valid(data) THEN 1
        WHEN type = 'message.updated.1' THEN coalesce(json_type(data, '$.info.id'), '') <> 'text'
        ELSE coalesce(json_type(data, '$.part.id'), '') <> 'text'
      END
  `)
  const index = snapshot.transaction((after: number, through: number) => {
    insert.run(after, through)
    return Number((malformed.get(after, through) as { value: number }).value)
  })

  let malformedCount = 0
  for (let indexed = 0; indexed < maximum; indexed += indexBatchSize) {
    const through = Math.min(maximum, indexed + indexBatchSize)
    malformedCount += index(indexed, through)
    send({ type: "progress", phase: "index", completed: through, total: maximum })
  }

  const result = snapshot
    .query("SELECT count(*) AS snapshots, coalesce(max(scan_id), 0) AS maximum FROM event_compaction_snapshot")
    .get() as { snapshots: number; maximum: number }
  snapshot.close()
  return { snapshots: Number(result.snapshots), maximum: Number(result.maximum), malformed: malformedCount }
}

function checkpoint(candidate: Candidate) {
  return {
    aggregateID: candidate.aggregateID,
    supersededType: candidate.type,
    supersededBy: candidate.supersededBy,
  }
}

function projectedData(candidate: Candidate) {
  const latest = JSON.parse(candidate.latestData) as {
    info?: Record<string, unknown>
    part?: Record<string, unknown>
  }
  const value = candidate.type === "message.updated.1" ? latest.info : latest.part
  if (!value) return undefined
  const result = { ...value }
  delete result.id
  delete result.sessionID
  if (candidate.type === "message.part.updated.1") delete result.messageID
  return result
}

function safe(candidate: Candidate) {
  try {
    const latest = JSON.parse(candidate.latestData) as {
      info?: { id?: string; sessionID?: string }
      part?: { id?: string; sessionID?: string; messageID?: string }
    }
    const value = candidate.type === "message.updated.1" ? latest.info : latest.part
    if (value?.id !== candidate.entityID || value.sessionID !== candidate.aggregateID) return false
    if (candidate.type === "message.part.updated.1" && latest.part?.messageID !== candidate.projectionParentID)
      return false
    return isDeepStrictEqual(projectedData(candidate), JSON.parse(candidate.projectionData))
  } catch {
    return false
  }
}

function empty(): Analysis {
  return {
    inspected: 0,
    candidates: 0,
    projectionMismatches: 0,
    compatibilityRejected: 0,
    payloadBytesReclaimable: 0,
    byType: {},
  }
}

function add(target: Analysis, rows: ReadonlyArray<Candidate>) {
  const evaluated = rows.map((candidate) => ({ candidate, safe: safe(candidate) }))
  const compatible = evaluated.filter(
    (entry) => entry.safe && entry.candidate.workspaceID === null && entry.candidate.ownerID === null,
  )
  const byType = { ...target.byType }
  const payloadBytesReclaimable = compatible.reduce((total, entry) => {
    const reclaimed = Math.max(
      0,
      entry.candidate.bytes - Buffer.byteLength(JSON.stringify(checkpoint(entry.candidate))),
    )
    const current = byType[entry.candidate.type] ?? { events: 0, payloadBytesReclaimable: 0 }
    byType[entry.candidate.type] = {
      events: current.events + 1,
      payloadBytesReclaimable: current.payloadBytesReclaimable + reclaimed,
    }
    return total + reclaimed
  }, target.payloadBytesReclaimable)
  return {
    inspected: target.inspected + rows.length,
    candidates: target.candidates + compatible.length,
    projectionMismatches: target.projectionMismatches + evaluated.filter((entry) => !entry.safe).length,
    compatibilityRejected:
      target.compatibilityRejected + evaluated.filter((entry) => entry.safe).length - compatible.length,
    payloadBytesReclaimable,
    byType,
  } satisfies Analysis
}

function analyze(input: AnalyzeInput) {
  const database = new Database(input.snapshot, { readonly: true, create: false })
  const query = database.query(`
    SELECT snapshot.scan_id AS scanID, event.aggregate_id AS aggregateID,
           snapshot.entity_id AS entityID, event.type, length(event.data) AS bytes,
           replacement.id AS supersededBy, replacement.data AS latestData,
           coalesce(message.data, part.data) AS projectionData,
           part.message_id AS projectionParentID, session.workspace_id AS workspaceID,
           event_sequence.owner_id AS ownerID
    FROM event_compaction_snapshot AS snapshot
    JOIN event ON event.id = snapshot.event_id AND event.type = snapshot.type
    JOIN event_compaction_snapshot AS head ON head.event_id = (
      SELECT candidate.event_id
      FROM event_compaction_snapshot AS candidate
      WHERE candidate.aggregate_id = snapshot.aggregate_id
        AND candidate.type = snapshot.type
        AND candidate.entity_id = snapshot.entity_id
      ORDER BY candidate.seq DESC
      LIMIT 1
    )
    JOIN event AS replacement ON replacement.id = head.event_id
    LEFT JOIN message ON snapshot.type = 'message.updated.1'
      AND message.id = snapshot.entity_id AND message.session_id = snapshot.aggregate_id
    LEFT JOIN part ON snapshot.type = 'message.part.updated.1'
      AND part.id = snapshot.entity_id AND part.session_id = snapshot.aggregate_id
    JOIN session ON session.id = snapshot.aggregate_id
    JOIN event_sequence ON event_sequence.aggregate_id = snapshot.aggregate_id
    WHERE snapshot.scan_id > ?1 AND snapshot.scan_id <= ?2 AND snapshot.seq < head.seq
      AND coalesce(message.data, part.data) IS NOT NULL
    ORDER BY snapshot.scan_id
    LIMIT ?3
  `)

  let cursor = input.afterScanID
  let result = empty()
  while (cursor < input.throughScanID) {
    const rows = query.all(cursor, input.throughScanID, batchSize) as Candidate[]
    if (rows.length === 0) break
    result = add(result, rows)
    cursor = rows.at(-1)?.scanID ?? input.throughScanID
    send({
      type: "progress",
      phase: "analyze",
      completed: cursor - input.afterScanID,
      total: input.throughScanID - input.afterScanID,
    })
    if (rows.length < batchSize) break
  }
  database.close()
  send({
    type: "progress",
    phase: "analyze",
    completed: input.throughScanID - input.afterScanID,
    total: input.throughScanID - input.afterScanID,
  })
  return result
}

onmessage = (event: MessageEvent<Input>) => {
  Promise.resolve(event.data.type === "prepare" ? prepare(event.data) : analyze(event.data)).then(
    (result) => send({ type: "result", result }),
    (error) =>
      send({
        type: "error",
        error: error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) },
      }),
  )
}
