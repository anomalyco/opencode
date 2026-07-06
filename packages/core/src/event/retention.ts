export * as EventRetention from "./retention"

import { Clock, Context, Duration, Effect, Layer, Option, Schedule } from "effect"
import { and, asc, eq, inArray, isNotNull, like, lt, sql } from "drizzle-orm"
import { Config } from "../config"
import { Database } from "../database/database"
import { SessionTable } from "../session/sql"
import { EventSequenceTable, EventTable } from "./sql"

export const RETENTION_HOURS = 48
export const COMPACT_IDLE_MINUTES = 60
export const SWEEP_INTERVAL = Duration.hours(1)

const SESSION_BATCH = 100
/** Streaming part.updated events, any sync version. Each one carries the full accumulated part payload. */
const PART_UPDATED_PATTERN = "message.part.updated.%"
const PART_ID = sql`json_extract(${EventTable.data}, '$.part.id')`
/**
 * Temporary shift applied while renumbering so intermediate states never
 * collide on the (aggregate_id, seq) unique index.
 */
const RESEQUENCE_OFFSET = 1_000_000_000
/** Upper bound of pages returned to the filesystem per sweep (~200MB at 4KB pages). */
const INCREMENTAL_VACUUM_PAGES = 50_000

export interface SweepResult {
  readonly prunedSessions: number
  readonly prunedEvents: number
  readonly compactedSessions: number
  readonly compactedEvents: number
}

export interface Interface {
  readonly sweep: () => Effect.Effect<SweepResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/EventRetention") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const config = yield* Effect.serviceOption(Config.Service)

    const settings = Effect.fn("EventRetention.settings")(function* () {
      const defaults = { retentionHours: RETENTION_HOURS, compactIdleMinutes: COMPACT_IDLE_MINUTES, disabled: false }
      if (Option.isNone(config)) return defaults
      const entries = yield* config.value.entries().pipe(Effect.catch(() => Effect.succeed([] as Config.Entry[])))
      const configured = Object.assign(
        {},
        ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info.event_journal ?? {}] : [])),
      )
      return {
        retentionHours: configured.retention_hours ?? defaults.retentionHours,
        compactIdleMinutes: configured.compact_idle_minutes ?? defaults.compactIdleMinutes,
        disabled: configured.disabled ?? defaults.disabled,
      }
    })

    const staleAggregates = (cutoff: number, limit: number) =>
      db
        .select({ id: EventSequenceTable.aggregate_id })
        .from(EventSequenceTable)
        .innerJoin(SessionTable, eq(SessionTable.id, EventSequenceTable.aggregate_id))
        .where(lt(SessionTable.time_updated, cutoff))
        .limit(limit)
        .all()
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map((row) => row.id)),
        )

    // Deletes the whole journal for sessions idle past the retention window,
    // event_sequence row included, so a later resume restarts the aggregate at
    // seq 0 and replays to a fresh peer stay contiguous.
    const prune = Effect.fn("EventRetention.prune")(function* (cutoff: number) {
      let sessions = 0
      let events = 0
      while (true) {
        const ids = yield* staleAggregates(cutoff, SESSION_BATCH)
        if (ids.length === 0) break
        events += yield* db
          .transaction(
            () =>
              Effect.gen(function* () {
                const counted = yield* db
                  .select({ count: sql<number>`count(*)` })
                  .from(EventTable)
                  .where(inArray(EventTable.aggregate_id, ids))
                  .get()
                yield* db.delete(EventTable).where(inArray(EventTable.aggregate_id, ids)).run()
                yield* db.delete(EventSequenceTable).where(inArray(EventSequenceTable.aggregate_id, ids)).run()
                return counted?.count ?? 0
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie)
        sessions += ids.length
      }
      return { sessions, events }
    })

    const redundantPartEvents = (aggregateID: string) =>
      db
        .select({
          total: sql<number>`count(*)`,
          parts: sql<number>`count(distinct ${PART_ID})`,
        })
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, aggregateID),
            like(EventTable.type, PART_UPDATED_PATTERN),
            isNotNull(PART_ID),
          ),
        )
        .get()
        .pipe(
          Effect.orDie,
          Effect.map((row) => Math.max(0, (row?.total ?? 0) - (row?.parts ?? 0))),
        )

    // Every part.updated event carries the entire accumulated part payload, so
    // for replay purposes all but the newest event per part are redundant.
    // Survivors are renumbered from 0 to keep the aggregate contiguous for
    // replayAll and the sequence counter is realigned for future appends.
    const compactAggregate = Effect.fn("EventRetention.compactAggregate")(function* (aggregateID: string) {
      const redundant = yield* redundantPartEvents(aggregateID)
      if (redundant === 0) return 0
      yield* db
        .transaction(
          () =>
            Effect.gen(function* () {
              yield* db.run(sql`
                DELETE FROM event WHERE id IN (
                  SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (
                      PARTITION BY json_extract(data, '$.part.id')
                      ORDER BY seq DESC
                    ) AS newest
                    FROM event
                    WHERE aggregate_id = ${aggregateID}
                      AND type LIKE ${PART_UPDATED_PATTERN}
                      AND json_extract(data, '$.part.id') IS NOT NULL
                  ) WHERE newest > 1
                )
              `)
              const survivors = yield* db
                .select({ id: EventTable.id })
                .from(EventTable)
                .where(eq(EventTable.aggregate_id, aggregateID))
                .orderBy(asc(EventTable.seq))
                .all()
              yield* db
                .update(EventTable)
                .set({ seq: sql`${EventTable.seq} + ${RESEQUENCE_OFFSET}` })
                .where(eq(EventTable.aggregate_id, aggregateID))
                .run()
              for (const [index, survivor] of survivors.entries()) {
                yield* db.update(EventTable).set({ seq: index }).where(eq(EventTable.id, survivor.id)).run()
              }
              yield* db
                .update(EventSequenceTable)
                .set({ seq: survivors.length - 1 })
                .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                .run()
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      return redundant
    })

    const compact = Effect.fn("EventRetention.compact")(function* (cutoff: number) {
      let sessions = 0
      let events = 0
      const candidates = yield* staleAggregates(cutoff, Number.MAX_SAFE_INTEGER)
      for (const aggregateID of candidates) {
        const compacted = yield* compactAggregate(aggregateID)
        if (compacted === 0) continue
        sessions += 1
        events += compacted
      }
      return { sessions, events }
    })

    // Returns freed pages to the filesystem when auto_vacuum is incremental
    // (a no-op otherwise; freed pages are still reused by future writes) and
    // keeps the WAL from carrying the deleted pages forward.
    const reclaim = Effect.fn("EventRetention.reclaim")(function* () {
      yield* db.run(`PRAGMA incremental_vacuum(${INCREMENTAL_VACUUM_PAGES})`).pipe(Effect.orDie)
      yield* db.run("PRAGMA wal_checkpoint(PASSIVE)").pipe(Effect.orDie)
    })

    const sweep = Effect.fn("EventRetention.sweep")(function* () {
      const options = yield* settings()
      if (options.disabled) return { prunedSessions: 0, prunedEvents: 0, compactedSessions: 0, compactedEvents: 0 }
      const now = yield* Clock.currentTimeMillis
      const pruned = yield* prune(now - Duration.toMillis(Duration.hours(options.retentionHours)))
      const compacted = yield* compact(now - Duration.toMillis(Duration.minutes(options.compactIdleMinutes)))
      if (pruned.events > 0 || compacted.events > 0) {
        yield* reclaim()
        yield* Effect.logInfo("event journal sweep", {
          prunedSessions: pruned.sessions,
          prunedEvents: pruned.events,
          compactedSessions: compacted.sessions,
          compactedEvents: compacted.events,
        })
      }
      return {
        prunedSessions: pruned.sessions,
        prunedEvents: pruned.events,
        compactedSessions: compacted.sessions,
        compactedEvents: compacted.events,
      }
    })

    return Service.of({ sweep })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

/** Runs the journal sweep once at startup and hourly after, once globally rather than once per active Location. */
export const sweepLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const retention = yield* Service
    yield* retention.sweep().pipe(
      Effect.catchCause((cause) => Effect.logError("event journal sweep failed", { cause })),
      Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
      Effect.forkScoped,
    )
  }),
)

export const defaultSweepLayer = Layer.merge(defaultLayer, sweepLayer.pipe(Layer.provide(defaultLayer)))
