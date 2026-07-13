export * as SessionEventLogCompaction from "./event-log-compaction"

import { isDeepStrictEqual } from "node:util"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { Database } from "../database/database"

const DEFAULT_LIMIT = 1000
const MAX_LIMIT = 10_000
const checkpointType = Event.versionedType(Event.Compacted.type, Event.Compacted.durable!.version)

type Policy = (typeof policies)[number]
type Candidate = {
  id: string
  aggregateID: string
  type: string
  bytes: number
  supersededBy: string
  latestData: string
  projectionData: string
  workspaceID: string | null
  ownerID: string | null
}

export type Options = {
  readonly aggregateID?: string
  readonly all?: boolean
  readonly apply?: boolean
  readonly limit?: number
}

export type Report = {
  readonly dryRun: boolean
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
  return limit
}

function continuation(options: Options, limit: number) {
  const scope = options.all ? "--all" : `--session ${options.aggregateID}`
  return `opencode db compact-events ${scope} --apply --limit ${limit}`
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
    return isDeepStrictEqual(projectedData(candidate, policy), JSON.parse(candidate.projectionData))
  } catch {
    return false
  }
}

const candidates = Effect.fn("SessionEventLogCompaction.candidates")(function* (
  db: Database.Interface["db"],
  options: Options,
  limit: number,
) {
  const rows = new Array<Candidate & { policy: Policy }>()
  for (const policy of policies) {
    if (rows.length >= limit + 1) break
    const selected = yield* db
      .all<Candidate>(
        sql`
        WITH latest AS (
          SELECT aggregate_id, json_extract(data, ${policy.path}) AS entity_id, MAX(seq) AS seq
          FROM event
          WHERE type = ${policy.type}
            AND json_valid(data)
            ${options.all ? sql`` : sql`AND aggregate_id = ${options.aggregateID!}`}
          GROUP BY aggregate_id, json_extract(data, ${policy.path})
        )
        SELECT event.id, event.aggregate_id AS aggregateID, event.type, length(event.data) AS bytes,
               replacement.id AS supersededBy, replacement.data AS latestData,
               projection.data AS projectionData, session.workspace_id AS workspaceID,
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
        WHERE event.type = ${policy.type} AND json_valid(event.data) AND event.seq < latest.seq
        ORDER BY event.aggregate_id, event.seq
        LIMIT ${limit + 1 - rows.length}
      `,
      )
      .pipe(Effect.orDie)
    rows.push(...selected.map((candidate) => ({ ...candidate, policy })))
  }
  return rows
})

const malformed = Effect.fn("SessionEventLogCompaction.malformed")(function* (
  db: Database.Interface["db"],
  options: Options,
) {
  const row = yield* db
    .get<{ count: number }>(
      sql`
      SELECT count(*) AS count FROM event
      WHERE type IN (${policies[0].type}, ${policies[1].type}) AND NOT json_valid(data)
      ${options.all ? sql`` : sql`AND aggregate_id = ${options.aggregateID!}`}
    `,
    )
    .pipe(Effect.orDie)
  return row?.count ?? 0
})

function report(
  rows: ReadonlyArray<Candidate & { policy: Policy }>,
  malformedCount: number,
  options: Options,
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
    dryRun: !options.apply,
    candidates: eligible.length,
    rewritten: options.apply ? eligible.length : 0,
    projectionMismatches: inspected.filter((candidate) => !safe(candidate, candidate.policy)).length,
    compatibilityRejected: safeRows.length - eligible.length,
    malformed: malformedCount,
    payloadBytesReclaimed: eligible.reduce((total, candidate) => total + reclaimedBytes(candidate), 0),
    hasMore: rows.length > limit,
    continuation: continuation(options, limit),
    byType,
  } satisfies Report
}

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
  if (!options.apply)
    return report(yield* candidates(db, options, limit), yield* malformed(db, options), options, limit)
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const selected = yield* candidates(db, options, limit)
          const result = report(selected, yield* malformed(db, options), options, limit)
          const eligible = selected
            .slice(0, limit)
            .filter(
              (candidate) =>
                safe(candidate, candidate.policy) && candidate.workspaceID === null && candidate.ownerID === null,
            )
          yield* Effect.forEach(eligible, (candidate) =>
            db.run(sql`
              UPDATE event SET type = ${checkpointType}, data = ${JSON.stringify(checkpoint(candidate))}
              WHERE id = ${candidate.id} AND type = ${candidate.type}
            `),
          )
          return result
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
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
