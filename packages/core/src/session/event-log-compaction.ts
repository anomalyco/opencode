export * as SessionEventLogCompaction from "./event-log-compaction"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { Database } from "../database/database"

const checkpointType = Event.versionedType(Event.Compacted.type, Event.Compacted.durable!.version)

type Candidate = {
  id: string
  aggregateID: string
  type: string
  bytes: number
  supersededBy: string
}

const checkpoint = (candidate: Candidate) => ({
  aggregateID: candidate.aggregateID,
  supersededType: candidate.type,
  supersededBy: candidate.supersededBy,
})

const reclaimedBytes = (candidate: Candidate) =>
  Math.max(0, candidate.bytes - Buffer.byteLength(JSON.stringify(checkpoint(candidate))))

export type Report = {
  readonly dryRun: boolean
  readonly candidates: number
  readonly rewritten: number
  readonly payloadBytesReclaimed: number
  readonly aggregates: number
  readonly byType: Readonly<Record<string, { readonly events: number; readonly payloadBytesReclaimed: number }>>
}

export interface Options {
  readonly aggregateID?: string
  readonly dryRun?: boolean
  readonly limit?: number
}

const policies = [
  { type: "message.updated.1", path: "$.info.id", table: "message" },
  { type: "message.part.updated.1", path: "$.part.id", table: "part" },
] as const

/**
 * Reclaims full snapshots only after a later snapshot for the same projected
 * entity exists. The replacement marker is durable and sequence-preserving,
 * so peers can replay the compacted aggregate with the normal strict protocol.
 */
export const compact = Effect.fn("SessionEventLogCompaction.compact")(function* (
  db: Database.Interface["db"],
  options: Options = {},
) {
  const limit = options.limit ?? Number.MAX_SAFE_INTEGER
  const candidates = new Array<Candidate>()

  for (const policy of policies) {
    if (candidates.length >= limit) break
    const rows = yield* db
      .all<Candidate>(
        sql`
      WITH latest AS (
        SELECT aggregate_id, json_extract(data, ${policy.path}) AS entity_id, MAX(seq) AS seq
        FROM event
        WHERE type = ${policy.type}
          AND json_valid(data)
          ${options.aggregateID === undefined ? sql`` : sql`AND aggregate_id = ${options.aggregateID}`}
        GROUP BY aggregate_id, json_extract(data, ${policy.path})
      )
      SELECT event.id,
             event.aggregate_id AS aggregateID,
             event.type,
             length(event.data) AS bytes,
             replacement.id AS supersededBy
      FROM event
      JOIN latest
        ON latest.aggregate_id = event.aggregate_id
       AND latest.entity_id = json_extract(event.data, ${policy.path})
      JOIN event AS replacement
        ON replacement.aggregate_id = latest.aggregate_id
       AND replacement.type = ${policy.type}
       AND replacement.seq = latest.seq
      JOIN ${sql.identifier(policy.table)} AS projection
        ON projection.id = latest.entity_id
       AND projection.session_id = latest.aggregate_id
      WHERE event.type = ${policy.type}
        AND event.seq < latest.seq
      ORDER BY event.aggregate_id, event.seq
      LIMIT ${limit - candidates.length}
    `,
      )
      .pipe(Effect.orDie)
    candidates.push(...rows)
  }

  const byType: Record<string, { events: number; payloadBytesReclaimed: number }> = {}
  for (const candidate of candidates) {
    const summary = byType[candidate.type] ?? { events: 0, payloadBytesReclaimed: 0 }
    summary.events++
    summary.payloadBytesReclaimed += reclaimedBytes(candidate)
    byType[candidate.type] = summary
  }
  const report = (): Report => ({
    dryRun: options.dryRun ?? false,
    candidates: candidates.length,
    rewritten: options.dryRun ? 0 : candidates.length,
    payloadBytesReclaimed: candidates.reduce((total, candidate) => total + reclaimedBytes(candidate), 0),
    aggregates: new Set(candidates.map((candidate) => candidate.aggregateID)).size,
    byType,
  })
  if (options.dryRun || candidates.length === 0) return report()

  yield* db
    .transaction(
      () =>
        Effect.forEach(candidates, (candidate) =>
          db.run(sql`
            UPDATE event
            SET type = ${checkpointType},
                data = ${JSON.stringify(checkpoint(candidate))}
            WHERE id = ${candidate.id} AND type = ${candidate.type}
          `),
        ),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
  return report()
})
