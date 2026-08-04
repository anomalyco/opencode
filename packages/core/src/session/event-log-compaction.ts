export * as SessionEventLogCompaction from "./event-log-compaction"

import { isDeepStrictEqual } from "node:util"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { Database } from "../database/database"

const DEFAULT_LIMIT = 1000
const MAX_LIMIT = 10_000
const AGGREGATE_SCAN_LIMIT = 25
const checkpointType = Event.versionedType(Event.Compacted.type, Event.Compacted.durable!.version)

type Policy = (typeof policies)[number]
type Candidate = {
  id: string
  aggregateID: string
  seq: number
  entityID: string
  type: string
  bytes: number
  supersededBy: string
  latestData: string
  projectionData: string
  projectionParentID: string | null
  workspaceID: string | null
  ownerID: string | null
}

export type Options = {
  readonly aggregateID?: string
  readonly all?: boolean
  readonly apply?: boolean
  readonly limit?: number
  readonly cursor?: string
  readonly afterSeq?: number
}

export type Report = {
  readonly dryRun: boolean
  readonly aggregateID?: string
  readonly inspected: number
  readonly candidates: number
  readonly rewritten: number
  readonly projectionMismatches: number
  readonly compatibilityRejected: number
  readonly malformed: number
  readonly payloadBytesReclaimed: number
  readonly hasMore: boolean
  readonly continuation: string
  readonly byType: Readonly<Record<string, { readonly events: number; readonly payloadBytesReclaimed: number }>>
}

export type Status = {
  readonly events: number
  readonly payloadBytes: number
  readonly compactableEvents: number
  readonly recommended: boolean
}

const policies = [
  { type: "message.updated.1", path: "$.info.id", table: "message", fields: ["id", "sessionID"] },
  { type: "message.part.updated.1", path: "$.part.id", table: "part", fields: ["id", "messageID", "sessionID"] },
] as const

function validate(options: Options) {
  if (Boolean(options.aggregateID) === Boolean(options.all)) {
    throw new Error("Specify exactly one compaction scope: aggregateID or all")
  }
  const limit = options.limit ?? DEFAULT_LIMIT
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw new Error(`limit must be a positive integer no greater than ${MAX_LIMIT}`)
  }
  if (options.cursor && !options.all) throw new Error("cursor requires all scope")
  if (options.afterSeq !== undefined && (!Number.isSafeInteger(options.afterSeq) || options.afterSeq < 0)) {
    throw new Error("afterSeq must be a non-negative integer")
  }
  if (options.all && options.afterSeq !== undefined && !options.cursor) {
    throw new Error("afterSeq requires a cursor for all scope")
  }
  return limit
}

function checkpoint(candidate: Candidate) {
  return { aggregateID: candidate.aggregateID, supersededType: candidate.type, supersededBy: candidate.supersededBy }
}

function reclaimedBytes(candidate: Candidate) {
  return Math.max(0, candidate.bytes - Buffer.byteLength(JSON.stringify(checkpoint(candidate))))
}

function projectedData(candidate: Candidate, policy: Policy) {
  const latest = JSON.parse(candidate.latestData) as { info?: Record<string, unknown>; part?: Record<string, unknown> }
  const value = policy.type === "message.updated.1" ? latest.info : latest.part
  if (!value) return undefined
  const result = { ...value }
  for (const field of policy.fields) delete result[field]
  return result
}

function safe(candidate: Candidate, policy: Policy) {
  try {
    const latest = JSON.parse(candidate.latestData) as {
      info?: { id?: string; sessionID?: string }
      part?: { id?: string; sessionID?: string; messageID?: string }
    }
    const value = policy.type === "message.updated.1" ? latest.info : latest.part
    if (value?.id !== candidate.entityID || value.sessionID !== candidate.aggregateID) return false
    if (policy.type === "message.part.updated.1" && latest.part?.messageID !== candidate.projectionParentID)
      return false
    return isDeepStrictEqual(projectedData(candidate, policy), JSON.parse(candidate.projectionData))
  } catch {
    return false
  }
}

const candidates = Effect.fn("SessionEventLogCompaction.candidates")(function* (
  db: Database.Interface["db"],
  aggregateID: string,
  afterSeq: number,
  limit: number,
) {
  const rows = new Array<Candidate & { policy: Policy }>()
  for (const policy of policies) {
    const projectionParent = policy.type === "message.part.updated.1" ? sql`projection.message_id` : sql`NULL`
    const selected = yield* db
      .all<Candidate>(
        sql`
        WITH latest AS (
          SELECT aggregate_id, json_extract(data, ${policy.path}) AS entity_id, MAX(seq) AS seq
          FROM event
          WHERE type = ${policy.type}
            AND json_valid(data)
            AND aggregate_id = ${aggregateID}
          GROUP BY aggregate_id, json_extract(data, ${policy.path})
        )
        SELECT event.id, event.aggregate_id AS aggregateID, event.seq,
               latest.entity_id AS entityID, event.type, length(event.data) AS bytes,
               replacement.id AS supersededBy, replacement.data AS latestData,
               projection.data AS projectionData, ${projectionParent} AS projectionParentID,
               session.workspace_id AS workspaceID,
               event_sequence.owner_id AS ownerID
        FROM event
        JOIN latest ON latest.aggregate_id = event.aggregate_id
          AND latest.entity_id = json_extract(CASE WHEN json_valid(event.data) THEN event.data END, ${policy.path})
        JOIN event AS replacement ON replacement.aggregate_id = latest.aggregate_id
          AND replacement.type = ${policy.type} AND replacement.seq = latest.seq
        JOIN ${sql.identifier(policy.table)} AS projection ON projection.id = latest.entity_id
          AND projection.session_id = latest.aggregate_id
        JOIN session ON session.id = event.aggregate_id
        JOIN event_sequence ON event_sequence.aggregate_id = event.aggregate_id
        WHERE event.type = ${policy.type} AND json_valid(event.data)
          AND event.seq > ${afterSeq} AND event.seq < latest.seq
        ORDER BY event.seq
        LIMIT ${limit + 1}
      `,
      )
      .pipe(Effect.orDie)
    rows.push(...selected.map((candidate) => ({ ...candidate, policy })))
  }
  return rows.sort((a, b) => a.seq - b.seq).slice(0, limit + 1)
})

const malformed = Effect.fn("SessionEventLogCompaction.malformed")(function* (
  db: Database.Interface["db"],
  aggregateID: string,
  afterSeq: number,
) {
  const row = yield* db
    .get<{ count: number }>(
      sql`
      SELECT count(*) AS count FROM event
      WHERE type IN (${policies[0].type}, ${policies[1].type}) AND NOT json_valid(data)
        AND aggregate_id = ${aggregateID} AND seq > ${afterSeq}
    `,
    )
    .pipe(Effect.orDie)
  return row?.count ?? 0
})

function report(
  rows: ReadonlyArray<Candidate & { policy: Policy }>,
  malformedCount: number,
  aggregateID: string,
  apply: boolean,
  limit: number,
) {
  const inspected = rows.slice(0, limit)
  const safeRows = inspected.filter((candidate) => safe(candidate, candidate.policy))
  const eligible = safeRows.filter((candidate) => candidate.workspaceID === null && candidate.ownerID === null)
  const byType: Record<string, { events: number; payloadBytesReclaimed: number }> = {}
  for (const candidate of eligible) {
    const summary = byType[candidate.type] ?? { events: 0, payloadBytesReclaimed: 0 }
    summary.events++
    summary.payloadBytesReclaimed += reclaimedBytes(candidate)
    byType[candidate.type] = summary
  }
  return {
    dryRun: !apply,
    aggregateID,
    inspected: inspected.length,
    candidates: eligible.length,
    rewritten: apply ? eligible.length : 0,
    projectionMismatches: inspected.filter((candidate) => !safe(candidate, candidate.policy)).length,
    compatibilityRejected: safeRows.length - eligible.length,
    malformed: malformedCount,
    payloadBytesReclaimed: eligible.reduce((total, candidate) => total + reclaimedBytes(candidate), 0),
    hasMore: rows.length > limit,
    continuation: "",
    byType,
  } satisfies Report
}

function command(options: {
  aggregateID?: string
  all?: boolean
  cursor?: string
  afterSeq?: number
  apply?: boolean
  limit: number
}) {
  const scope = options.all
    ? `--all${options.cursor ? ` --cursor ${options.cursor}` : ""}`
    : `--session ${options.aggregateID}`
  const after = options.afterSeq === undefined ? "" : ` --after-seq ${options.afterSeq}`
  return `opencode db compact-events ${scope}${options.apply ? " --apply" : ""} --limit ${options.limit}${after}`
}

const compactAggregate = Effect.fn("SessionEventLogCompaction.compactAggregate")(function* (
  db: Database.Interface["db"],
  aggregateID: string,
  afterSeq: number,
  apply: boolean,
  limit: number,
) {
  const run = Effect.gen(function* () {
    const selected = yield* candidates(db, aggregateID, afterSeq, limit)
    const result = report(selected, yield* malformed(db, aggregateID, afterSeq), aggregateID, apply, limit)
    const inspected = selected.slice(0, limit)
    if (apply) {
      const eligible = inspected.filter(
        (candidate) =>
          safe(candidate, candidate.policy) && candidate.workspaceID === null && candidate.ownerID === null,
      )
      yield* Effect.forEach(eligible, (candidate) =>
        db.run(sql`
          UPDATE event SET type = ${checkpointType}, data = ${JSON.stringify(checkpoint(candidate))}
          WHERE id = ${candidate.id} AND type = ${candidate.type}
        `),
      )
    }
    return { result, lastSeq: inspected.at(-1)?.seq }
  })
  if (!apply) return yield* run
  return yield* db.transaction(() => run, { behavior: "immediate" }).pipe(Effect.orDie)
})

const aggregateIDs = Effect.fn("SessionEventLogCompaction.aggregateIDs")(function* (
  db: Database.Interface["db"],
  cursor?: string,
) {
  return yield* db
    .all<{ id: string }>(
      sql`
      SELECT id FROM session
      ${cursor ? sql`WHERE id >= ${cursor}` : sql``}
      ORDER BY id
      LIMIT ${AGGREGATE_SCAN_LIMIT + 1}
    `,
    )
    .pipe(Effect.orDie)
})

/**
 * Replaces only locally-owned, projection-verified snapshots. Sync has no
 * version negotiation for checkpoint markers, so aggregates with a workspace
 * or sync owner are always dry-run-only until that protocol exists.
 */
export const compact = Effect.fn("SessionEventLogCompaction.compact")(function* (
  db: Database.Interface["db"],
  options: Options,
) {
  const limit = validate(options)
  const apply = options.apply === true
  const startSeq = options.afterSeq ?? -1

  if (options.aggregateID) {
    const batch = yield* compactAggregate(db, options.aggregateID, startSeq, apply, limit)
    const nextSeq = batch.result.hasMore ? batch.lastSeq : undefined
    return {
      ...batch.result,
      continuation:
        !apply || nextSeq !== undefined
          ? command({
              aggregateID: options.aggregateID,
              apply: true,
              limit,
              afterSeq: apply ? nextSeq : options.afterSeq,
            })
          : "",
    } satisfies Report
  }

  const aggregates = yield* aggregateIDs(db, options.cursor)
  let remaining = limit
  let aggregateID: string | undefined
  let inspected = 0
  let candidatesCount = 0
  let rewritten = 0
  let projectionMismatches = 0
  let compatibilityRejected = 0
  let malformedCount = 0
  let payloadBytesReclaimed = 0
  const byType: Record<string, { events: number; payloadBytesReclaimed: number }> = {}

  const combined = (hasMore: boolean, continuation: string): Report => ({
    dryRun: !apply,
    aggregateID,
    inspected,
    candidates: candidatesCount,
    rewritten,
    projectionMismatches,
    compatibilityRejected,
    malformed: malformedCount,
    payloadBytesReclaimed,
    hasMore,
    continuation,
    byType,
  })

  for (const [index, aggregate] of aggregates.slice(0, AGGREGATE_SCAN_LIMIT).entries()) {
    const afterSeq = index === 0 && aggregate.id === options.cursor ? startSeq : -1
    const batch = yield* compactAggregate(db, aggregate.id, afterSeq, apply, apply ? remaining : limit)
    if (batch.result.inspected === 0 && batch.result.malformed === 0) continue

    if (!apply) {
      const next = aggregates[index + 1]
      return {
        ...batch.result,
        hasMore: batch.result.hasMore || Boolean(next),
        continuation: command({
          all: true,
          cursor: aggregate.id,
          afterSeq: afterSeq < 0 ? undefined : afterSeq,
          apply: true,
          limit,
        }),
      } satisfies Report
    }

    aggregateID = aggregate.id
    inspected += batch.result.inspected
    candidatesCount += batch.result.candidates
    rewritten += batch.result.rewritten
    projectionMismatches += batch.result.projectionMismatches
    compatibilityRejected += batch.result.compatibilityRejected
    malformedCount += batch.result.malformed
    payloadBytesReclaimed += batch.result.payloadBytesReclaimed
    remaining -= batch.result.inspected
    for (const [type, summary] of Object.entries(batch.result.byType)) {
      const current = byType[type] ?? { events: 0, payloadBytesReclaimed: 0 }
      current.events += summary.events
      current.payloadBytesReclaimed += summary.payloadBytesReclaimed
      byType[type] = current
    }

    if (batch.result.hasMore) {
      return combined(true, command({ all: true, cursor: aggregate.id, afterSeq: batch.lastSeq, apply: true, limit }))
    }

    const next = aggregates[index + 1]
    if (remaining === 0) {
      return combined(Boolean(next), next ? command({ all: true, cursor: next.id, apply: true, limit }) : "")
    }
  }

  const next = aggregates[AGGREGATE_SCAN_LIMIT]
  return combined(Boolean(next), next ? command({ all: true, cursor: next.id, apply, limit }) : "")
})

export const status = Effect.fn("SessionEventLogCompaction.status")(function* (db: Database.Interface["db"]) {
  const row = yield* db
    .get<{ events: number; payloadBytes: number; compactableEvents: number }>(
      sql`
      SELECT count(*) AS events,
             coalesce(sum(length(data)), 0) AS payloadBytes,
             coalesce(sum(type IN (${policies[0].type}, ${policies[1].type})), 0) AS compactableEvents
      FROM event
    `,
    )
    .pipe(Effect.orDie)
  const result = row ?? { events: 0, payloadBytes: 0, compactableEvents: 0 }
  return { ...result, recommended: result.compactableEvents > DEFAULT_LIMIT } satisfies Status
})
