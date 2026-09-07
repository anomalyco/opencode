export * as Timeline from "./timeline.js"

import { and, asc, desc, eq, lt, sql, type SQL } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { statics } from "@opencode-ai/schema/schema"
import type { Database } from "../database/database.js"
import { SessionMessageTable, SessionTable, TimelineTable } from "./sql.js"

export const ID = Schema.String.check(Schema.isStartsWith("tml_")).pipe(
  Schema.brand("Timeline.ID"),
  statics((schema) => ({ create: () => schema.make(`tml_${crypto.randomUUID()}`) })),
)
export type ID = typeof ID.Type

type DB = Omit<Database.Interface["db"], "$client">

export type Position = { readonly id: ID; readonly seq: number }
export type Range = { readonly id: ID; readonly end: number | null }

export const create = Effect.fn("Timeline.create")(function* (db: DB, base?: Position) {
  const id = ID.create()
  yield* db.insert(TimelineTable).values({ id, base_id: base?.id, base_seq: base?.seq }).run().pipe(Effect.orDie)
  return id
})

export const current = (sessionID: Session.ID) => sql`(SELECT timeline_id FROM ${SessionTable} WHERE id = ${sessionID})`

/** Resolve ancestry once, then read each physical range using (timeline_id, seq). */
export const ranges = Effect.fn("Timeline.ranges")(function* (db: DB, id: ID) {
  return yield* db
    .all<Range>(
      sql`
    WITH RECURSIVE lineage(id, base_id, base_seq, end, depth) AS (
      SELECT id, base_id, base_seq, NULL, 0 FROM timeline WHERE id = ${id}
      UNION ALL
      SELECT base.id, base.base_id, base.base_seq,
             CASE WHEN lineage.end IS NULL THEN lineage.base_seq
                  ELSE min(lineage.end, lineage.base_seq) END,
             lineage.depth + 1
      FROM timeline AS base JOIN lineage ON base.id = lineage.base_id
    )
    SELECT id, end FROM lineage ORDER BY depth ASC
  `,
    )
    .pipe(Effect.orDie)
})

export const forSession = Effect.fn("Timeline.forSession")(function* (db: DB, sessionID: Session.ID) {
  const session = yield* db
    .select({ id: SessionTable.timeline_id })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  return session ? yield* ranges(db, session.id) : []
})

export const includes = (ranges: readonly Range[], row: { timeline_id: ID; seq: number }) =>
  ranges.some((range) => range.id === row.timeline_id && (range.end === null || row.seq < range.end))

export const find = Effect.fn("Timeline.find")(function* (db: DB, sessionID: Session.ID, messageID: SessionMessage.ID) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, messageID))
    .get()
    .pipe(Effect.orDie)
  if (!row) return undefined
  return includes(yield* forSession(db, sessionID), row) ? row : undefined
})

export const rows = Effect.fn("Timeline.rows")(function* (
  db: DB,
  ranges: readonly Range[],
  input: { readonly where?: SQL; readonly order?: "asc" | "desc"; readonly limit?: number } = {},
) {
  const result: (typeof SessionMessageTable.$inferSelect)[] = []
  for (const range of input.order === "asc" ? ranges.toReversed() : ranges) {
    if (input.limit !== undefined && result.length >= input.limit) break
    const query = db
      .select()
      .from(SessionMessageTable)
      .where(
        and(
          eq(SessionMessageTable.timeline_id, range.id),
          range.end === null ? undefined : lt(SessionMessageTable.seq, range.end),
          input.where,
        ),
      )
      .orderBy(input.order === "asc" ? asc(SessionMessageTable.seq) : desc(SessionMessageTable.seq))
    result.push(
      ...(yield* (input.limit === undefined ? query.all() : query.limit(input.limit - result.length).all()).pipe(
        Effect.orDie,
      )),
    )
  }
  return result
})

/** Root at the physical owner of the last retained message, skipping empty intermediate timelines. */
export const prefix = Effect.fn("Timeline.prefix")(function* (db: DB, ranges: readonly Range[], end: number) {
  const [last] = yield* rows(db, ranges, { where: lt(SessionMessageTable.seq, end), limit: 1 })
  return last ? { id: last.timeline_id, seq: last.seq + 1 } : undefined
})

/** Session deletion releases a head; references from surviving histories keep their storage alive. */
export const collect = Effect.fn("Timeline.collect")(function* (db: DB) {
  yield* db
    .run(
      sql`
    WITH RECURSIVE retained(id) AS (
      SELECT timeline_id FROM session_v2
      UNION
      SELECT timeline.base_id FROM timeline JOIN retained ON timeline.id = retained.id
      WHERE timeline.base_id IS NOT NULL
    )
    DELETE FROM timeline WHERE id NOT IN (SELECT id FROM retained)
  `,
    )
    .pipe(Effect.orDie)
})
