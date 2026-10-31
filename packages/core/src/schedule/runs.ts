export * as ScheduleRuns from "./runs.js"

import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import { RunID, type Attention, type Delivery, type ID, type Run } from "@opencode/schema/schedule"
import type { Database } from "../database/database.js"
import type { SessionSchema } from "../session/schema.js"
import { ScheduleAction } from "./action.js"
import { ScheduleRunTable } from "./sql.js"

type DB = Database.Interface["db"]
type Row = typeof ScheduleRunTable.$inferSelect

const MAX_RUN_HISTORY = 100
const DEFAULT_LIMIT = 50

const optionalTime = (value: number | null) => (value === null ? undefined : DateTime.makeUnsafe(value))

export const toRun = (row: Row): Run => ({
  id: row.id,
  scheduleID: row.schedule_id,
  scheduleName: row.schedule_name ?? undefined,
  ownerSessionID: row.owner_session_id ?? undefined,
  sessionID: row.session_id ?? undefined,
  run: row.run,
  status: row.status,
  attention: row.attention,
  summary: row.summary ?? undefined,
  error: row.error ?? undefined,
  startedAt: DateTime.makeUnsafe(row.started_at),
  completedAt: optionalTime(row.completed_at),
  readAt: optionalTime(row.read_at),
})

export const startRun = Effect.fnUntraced(function* (
  db: DB,
  input: {
    readonly scheduleID: ID
    readonly scheduleName: string | null
    readonly ownerSessionID: SessionSchema.ID
    readonly sessionID?: SessionSchema.ID
    readonly run: number
    readonly now: number
  },
) {
  const row = yield* db
    .insert(ScheduleRunTable)
    .values({
      id: RunID.create(),
      schedule_id: input.scheduleID,
      schedule_name: input.scheduleName,
      owner_session_id: input.ownerSessionID,
      session_id: input.sessionID ?? null,
      run: input.run,
      status: "running",
      attention: "quiet",
      started_at: input.now,
      time_created: input.now,
      time_updated: input.now,
    })
    .returning()
    .get()
    .pipe(Effect.orDie)
  return row
})

export const recordCompleted = Effect.fnUntraced(function* (
  db: DB,
  input: {
    readonly scheduleID: ID
    readonly scheduleName: string | null
    readonly ownerSessionID: SessionSchema.ID
    readonly sessionID?: SessionSchema.ID
    readonly run: number
    readonly status: "completed" | "failed"
    readonly attention: Attention
    readonly summary?: string
    readonly error?: string
    readonly read?: boolean
    readonly now: number
  },
) {
  const row = yield* db
    .insert(ScheduleRunTable)
    .values({
      id: RunID.create(),
      schedule_id: input.scheduleID,
      schedule_name: input.scheduleName,
      owner_session_id: input.ownerSessionID,
      session_id: input.sessionID ?? null,
      run: input.run,
      status: input.status,
      attention: input.attention,
      summary: input.summary ?? null,
      error: input.error ?? null,
      started_at: input.now,
      completed_at: input.now,
      read_at: input.read ? input.now : null,
      time_created: input.now,
      time_updated: input.now,
    })
    .returning()
    .get()
    .pipe(Effect.orDie)
  yield* prune(db, input.scheduleID)
  return toRun(row)
})

export const reportResult = Effect.fnUntraced(function* (
  db: DB,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly attention: Attention
    readonly summary?: string
    readonly nextInMs?: number
    readonly now: number
  },
) {
  const active = yield* db
    .select()
    .from(ScheduleRunTable)
    .where(and(eq(ScheduleRunTable.session_id, input.sessionID), eq(ScheduleRunTable.status, "running")))
    .orderBy(desc(ScheduleRunTable.started_at), desc(ScheduleRunTable.id))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (active === undefined) return undefined
  const summary = input.summary?.trim() ? input.summary.trim() : null
  const updated = yield* db
    .update(ScheduleRunTable)
    .set({
      reported_attention: input.attention,
      reported_summary: summary,
      ...(input.nextInMs === undefined ? {} : { next_in_ms: input.nextInMs }),
      time_updated: input.now,
    })
    .where(eq(ScheduleRunTable.id, active.id))
    .returning()
    .get()
    .pipe(Effect.orDie)
  return updated
    ? toRun({
        ...updated,
        attention: input.attention,
        summary: summary ?? updated.summary,
      })
    : undefined
})

export const settleCompleted = Effect.fnUntraced(function* (
  db: DB,
  input: {
    readonly runID: RunID
    readonly fallbackOutput: string
    readonly deliver: Delivery
    readonly now: number
  },
) {
  const row = yield* db.select().from(ScheduleRunTable).where(eq(ScheduleRunTable.id, input.runID)).get().pipe(Effect.orDie)
  if (row === undefined) return undefined
  const trimmed = input.fallbackOutput.trim()
  const resolved = (() => {
    if (row.reported_attention !== null) {
      const attention = row.reported_attention
      const summary =
        attention === "quiet"
          ? (row.reported_summary ?? null)
          : (row.reported_summary ?? (trimmed || "Scheduled run completed"))
      const markRead = input.deliver === "silent" && attention !== "needs_you"
      return { attention, summary, readAt: markRead ? input.now : null }
    }
    if (ScheduleAction.isQuietOutput(trimmed)) {
      return { attention: "quiet" as const, summary: null, readAt: null }
    }
    if (input.deliver === "silent") {
      return { attention: "quiet" as const, summary: trimmed, readAt: input.now }
    }
    return { attention: "ready" as const, summary: trimmed, readAt: null }
  })()

  const updated = yield* db
    .update(ScheduleRunTable)
    .set({
      status: "completed",
      attention: resolved.attention,
      summary: resolved.summary,
      completed_at: input.now,
      read_at: resolved.readAt,
      time_updated: input.now,
    })
    .where(eq(ScheduleRunTable.id, input.runID))
    .returning()
    .get()
    .pipe(Effect.orDie)
  yield* prune(db, row.schedule_id)
  return updated ? { run: toRun(updated), nextInMs: updated.next_in_ms } : undefined
})

export const settleFailed = Effect.fnUntraced(function* (
  db: DB,
  input: {
    readonly runID: RunID
    readonly error: string
    readonly deliver: Delivery
    readonly autoPause: boolean
    readonly now: number
  },
) {
  const row = yield* db.select().from(ScheduleRunTable).where(eq(ScheduleRunTable.id, input.runID)).get().pipe(Effect.orDie)
  if (row === undefined) return undefined
  const attention: Attention = input.autoPause || input.deliver !== "silent" ? "needs_you" : "quiet"
  const summary = input.autoPause ? `[Paused after repeated failures] ${input.error}` : input.error
  const updated = yield* db
    .update(ScheduleRunTable)
    .set({
      status: "failed",
      attention,
      summary,
      error: input.error,
      completed_at: input.now,
      time_updated: input.now,
    })
    .where(eq(ScheduleRunTable.id, input.runID))
    .returning()
    .get()
    .pipe(Effect.orDie)
  yield* prune(db, row.schedule_id)
  return updated ? toRun(updated) : undefined
})

export const cancelRun = (db: DB, runID: RunID, now: number) =>
  db
    .update(ScheduleRunTable)
    .set({ status: "cancelled", completed_at: now, time_updated: now })
    .where(and(eq(ScheduleRunTable.id, runID), eq(ScheduleRunTable.status, "running")))
    .run()
    .pipe(Effect.orDie)

export const clearOrphanedRunning = (db: DB, now: number, liveScheduleIDs: readonly ID[] = []) =>
  db
    .update(ScheduleRunTable)
    .set({ status: "cancelled", completed_at: now, time_updated: now })
    .where(
      liveScheduleIDs.length === 0
        ? eq(ScheduleRunTable.status, "running")
        : and(eq(ScheduleRunTable.status, "running"), notInArray(ScheduleRunTable.schedule_id, [...liveScheduleIDs])),
    )
    .run()
    .pipe(Effect.orDie)

export const listRuns = Effect.fnUntraced(function* (
  db: DB,
  input?: {
    readonly scheduleID?: ID
    readonly sessionID?: SessionSchema.ID
    readonly limit?: number
  },
) {
  const conditions = [
    ...(input?.scheduleID === undefined ? [] : [eq(ScheduleRunTable.schedule_id, input.scheduleID)]),
    ...(input?.sessionID === undefined ? [] : [eq(ScheduleRunTable.owner_session_id, input.sessionID)]),
  ]
  const rows = yield* db
    .select()
    .from(ScheduleRunTable)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(ScheduleRunTable.started_at), desc(ScheduleRunTable.id))
    .limit(input?.limit ?? DEFAULT_LIMIT)
    .all()
    .pipe(Effect.orDie)
  return rows.map(toRun)
})

export const listInbox = Effect.fnUntraced(function* (
  db: DB,
  input?: {
    readonly sessionID?: SessionSchema.ID
    readonly includeRead?: boolean
    readonly limit?: number
  },
) {
  const conditions = [
    sql`${ScheduleRunTable.status} != 'running'`,
    inArray(ScheduleRunTable.attention, ["needs_you", "ready"]),
    ...(input?.includeRead === true ? [] : [isNull(ScheduleRunTable.read_at)]),
    ...(input?.sessionID === undefined ? [] : [eq(ScheduleRunTable.owner_session_id, input.sessionID)]),
  ]
  const rows = yield* db
    .select()
    .from(ScheduleRunTable)
    .where(and(...conditions))
    .orderBy(
      sql`case when ${ScheduleRunTable.attention} = 'needs_you' then 0 else 1 end`,
      desc(ScheduleRunTable.started_at),
      desc(ScheduleRunTable.id),
    )
    .limit(input?.limit ?? DEFAULT_LIMIT)
    .all()
    .pipe(Effect.orDie)
  return rows.map(toRun)
})

export const getRun = (db: DB, runID: RunID) =>
  db
    .select()
    .from(ScheduleRunTable)
    .where(eq(ScheduleRunTable.id, runID))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => (row ? toRun(row) : undefined)),
    )

export const markRead = Effect.fnUntraced(function* (db: DB, runID: RunID, now: number) {
  const existing = yield* db.select().from(ScheduleRunTable).where(eq(ScheduleRunTable.id, runID)).get().pipe(Effect.orDie)
  if (existing === undefined) return undefined
  if (existing.read_at !== null) return toRun(existing)
  const updated = yield* db
    .update(ScheduleRunTable)
    .set({ read_at: now, time_updated: now })
    .where(eq(ScheduleRunTable.id, runID))
    .returning()
    .get()
    .pipe(Effect.orDie)
  return updated ? toRun(updated) : toRun(existing)
})

const prune = Effect.fnUntraced(function* (db: DB, scheduleID: ID) {
  const keep = yield* db
    .select({ id: ScheduleRunTable.id })
    .from(ScheduleRunTable)
    .where(eq(ScheduleRunTable.schedule_id, scheduleID))
    .orderBy(desc(ScheduleRunTable.started_at), desc(ScheduleRunTable.id))
    .limit(MAX_RUN_HISTORY)
    .all()
    .pipe(Effect.orDie)
  if (keep.length < MAX_RUN_HISTORY) return
  yield* db
    .delete(ScheduleRunTable)
    .where(
      and(
        eq(ScheduleRunTable.schedule_id, scheduleID),
        notInArray(
          ScheduleRunTable.id,
          keep.map((item) => item.id),
        ),
        sql`(${ScheduleRunTable.status} != 'running') and (${ScheduleRunTable.attention} = 'quiet' or ${ScheduleRunTable.read_at} is not null)`,
      ),
    )
    .run()
    .pipe(Effect.orDie)
})
