import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { HeartbeatTable, type HeartbeatStatus } from "@opencode-ai/core/heartbeat/sql"
import { and, eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

type Row = typeof HeartbeatTable.$inferSelect

export type Info = {
  jobID: string
  sessionID: string
  task: string
  directory: string
  agent: string
  status: HeartbeatStatus
  revision: number
  checkNumber: number
  maxChecks: number
  delaySeconds: number
  initialDelaySeconds: number
  intervalSeconds: number
  backoff: "fixed" | "linear" | "exponential"
  maxIntervalSeconds: number
  nextDelaySeconds: number
  scheduledAt: number
  firesAt: number
  error?: string
  timeCreated: number
  timeUpdated: number
}

export type ScheduleInput = Omit<Info, "status" | "revision" | "error" | "timeCreated" | "timeUpdated">

export interface Interface {
  readonly get: (jobID: string) => Effect.Effect<Info | undefined>
  readonly recoverable: () => Effect.Effect<Info[]>
  readonly schedule: (input: ScheduleInput) => Effect.Effect<Info>
  readonly claim: (jobID: string, revision: number) => Effect.Effect<Info | undefined>
  readonly complete: (jobID: string, revision: number) => Effect.Effect<Info | undefined>
  readonly fail: (jobID: string, revision: number, error: string) => Effect.Effect<Info | undefined>
  readonly cancel: (jobID: string) => Effect.Effect<Info | undefined>
  readonly requeue: (jobID: string, revision: number) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/HeartbeatStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const get: Interface["get"] = Effect.fn("HeartbeatStore.get")(function* (jobID) {
      const row = yield* db
        .select()
        .from(HeartbeatTable)
        .where(eq(HeartbeatTable.job_id, jobID))
        .get()
        .pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    const recoverable: Interface["recoverable"] = Effect.fn("HeartbeatStore.recoverable")(function* () {
      const rows = yield* db
        .select()
        .from(HeartbeatTable)
        .where(inArray(HeartbeatTable.status, ["scheduled", "firing"]))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const schedule: Interface["schedule"] = Effect.fn("HeartbeatStore.schedule")(function* (input) {
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const previous = yield* tx.select().from(HeartbeatTable).where(eq(HeartbeatTable.job_id, input.jobID)).get()
            const now = input.scheduledAt
            const value: typeof HeartbeatTable.$inferInsert = {
              job_id: input.jobID,
              session_id: input.sessionID,
              task: input.task,
              directory: input.directory,
              agent: input.agent,
              status: "scheduled",
              revision: (previous?.revision ?? 0) + 1,
              check_number: input.checkNumber,
              max_checks: input.maxChecks,
              delay_seconds: input.delaySeconds,
              initial_delay_seconds: input.initialDelaySeconds,
              interval_seconds: input.intervalSeconds,
              backoff: input.backoff,
              max_interval_seconds: input.maxIntervalSeconds,
              next_delay_seconds: input.nextDelaySeconds,
              scheduled_at: input.scheduledAt,
              fires_at: input.firesAt,
              error: null,
              time_created: previous?.time_created ?? now,
              time_updated: now,
            }
            yield* tx
              .insert(HeartbeatTable)
              .values(value)
              .onConflictDoUpdate({
                target: HeartbeatTable.job_id,
                set: {
                  session_id: value.session_id,
                  task: value.task,
                  directory: value.directory,
                  agent: value.agent,
                  status: value.status,
                  revision: value.revision,
                  check_number: value.check_number,
                  max_checks: value.max_checks,
                  delay_seconds: value.delay_seconds,
                  initial_delay_seconds: value.initial_delay_seconds,
                  interval_seconds: value.interval_seconds,
                  backoff: value.backoff,
                  max_interval_seconds: value.max_interval_seconds,
                  next_delay_seconds: value.next_delay_seconds,
                  scheduled_at: value.scheduled_at,
                  fires_at: value.fires_at,
                  error: null,
                  time_updated: now,
                },
              })
              .run()
            return fromRow(value as Row)
          }),
        )
        .pipe(Effect.orDie)
    })

    const claim: Interface["claim"] = Effect.fn("HeartbeatStore.claim")(function* (jobID, revision) {
      const row = yield* db
        .update(HeartbeatTable)
        .set({ status: "firing", error: null, time_updated: Date.now() })
        .where(
          and(
            eq(HeartbeatTable.job_id, jobID),
            eq(HeartbeatTable.revision, revision),
            eq(HeartbeatTable.status, "scheduled"),
          ),
        )
        .returning()
        .get()
        .pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    const complete: Interface["complete"] = Effect.fn("HeartbeatStore.complete")(function* (jobID, revision) {
      const row = yield* db
        .update(HeartbeatTable)
        .set({ status: "fired", time_updated: Date.now() })
        .where(
          and(
            eq(HeartbeatTable.job_id, jobID),
            eq(HeartbeatTable.revision, revision),
            eq(HeartbeatTable.status, "firing"),
          ),
        )
        .returning()
        .get()
        .pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    const fail: Interface["fail"] = Effect.fn("HeartbeatStore.fail")(function* (jobID, revision, error) {
      const row = yield* db
        .update(HeartbeatTable)
        .set({ status: "error", error, time_updated: Date.now() })
        .where(
          and(
            eq(HeartbeatTable.job_id, jobID),
            eq(HeartbeatTable.revision, revision),
            eq(HeartbeatTable.status, "firing"),
          ),
        )
        .returning()
        .get()
        .pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    const cancel: Interface["cancel"] = Effect.fn("HeartbeatStore.cancel")(function* (jobID) {
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const previous = yield* tx.select().from(HeartbeatTable).where(eq(HeartbeatTable.job_id, jobID)).get()
            if (!previous) return
            if (previous.status === "cancelled") return fromRow(previous)
            const row = yield* tx
              .update(HeartbeatTable)
              .set({
                status: "cancelled",
                revision: previous.revision + 1,
                error: null,
                time_updated: Date.now(),
              })
              .where(and(eq(HeartbeatTable.job_id, jobID), eq(HeartbeatTable.revision, previous.revision)))
              .returning()
              .get()
            return row ? fromRow(row) : undefined
          }),
        )
        .pipe(Effect.orDie)
    })

    const requeue: Interface["requeue"] = Effect.fn("HeartbeatStore.requeue")(function* (jobID, revision) {
      const now = Date.now()
      const row = yield* db
        .update(HeartbeatTable)
        .set({
          status: "scheduled",
          revision: revision + 1,
          scheduled_at: now,
          fires_at: now,
          error: null,
          time_updated: now,
        })
        .where(
          and(
            eq(HeartbeatTable.job_id, jobID),
            eq(HeartbeatTable.revision, revision),
            eq(HeartbeatTable.status, "firing"),
          ),
        )
        .returning()
        .get()
        .pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    return Service.of({ get, recoverable, schedule, claim, complete, fail, cancel, requeue })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node] })

function fromRow(row: Row): Info {
  return {
    jobID: row.job_id,
    sessionID: row.session_id,
    task: row.task,
    directory: row.directory,
    agent: row.agent,
    status: row.status,
    revision: row.revision,
    checkNumber: row.check_number,
    maxChecks: row.max_checks,
    delaySeconds: row.delay_seconds,
    initialDelaySeconds: row.initial_delay_seconds,
    intervalSeconds: row.interval_seconds,
    backoff: row.backoff,
    maxIntervalSeconds: row.max_interval_seconds,
    nextDelaySeconds: row.next_delay_seconds,
    scheduledAt: row.scheduled_at,
    firesAt: row.fires_at,
    error: row.error ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export * as HeartbeatStore from "./store"
