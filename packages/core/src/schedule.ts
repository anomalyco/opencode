export * as Schedule from "./schedule.js"

import { and, asc, eq, gt, isNull, lte, min, or } from "drizzle-orm"
import { Cause, Clock, Context, Cron, DateTime, Effect, Latch, Layer, Option, Result, Schema } from "effect"
import { Node, makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Schedule as ScheduleSchema } from "@opencode/schema/schedule"
import { Config } from "./config.js"
import { Database } from "./database/database.js"
import { Instance } from "./instance/service.js"
import { Session } from "./session.js"
import { SessionExecution } from "./session/execution.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { SessionInboxTable } from "./session/sql.js"
import { ScheduleTable } from "./schedule/sql.js"

export const ID = ScheduleSchema.ID
export type ID = ScheduleSchema.ID
export const Info = ScheduleSchema.Info
export type Info = ScheduleSchema.Info
export const CreateInput = ScheduleSchema.CreateInput
export type CreateInput = ScheduleSchema.CreateInput
export const Request = ScheduleSchema.Request
export type Request = ScheduleSchema.Request
export const When = ScheduleSchema.When
export const Status = ScheduleSchema.Status
export const Outcome = ScheduleSchema.Outcome
export const toCreateInput = ScheduleSchema.toCreateInput

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Schedule.NotFoundError", {
  scheduleID: ID,
}) {
  override get message() {
    return `Schedule not found: ${this.scheduleID}`
  }
}

export class InvalidError extends Schema.TaggedError<InvalidError>()("Schedule.InvalidError", {
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export class DisabledError extends Schema.TaggedError<DisabledError>()("Schedule.DisabledError", {}) {
  override get message() {
    return "Scheduled tasks are disabled; set experimental.schedules in config"
  }
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, InvalidError | DisabledError | Session.NotFoundError>
  readonly list: (input?: { readonly sessionID?: SessionSchema.ID }) => Effect.Effect<Info[]>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly pause: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly resume: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError>
  /** Whether experimental.schedules is on in the config where the Session lives. */
  readonly enabled: (sessionID: SessionSchema.ID) => Effect.Effect<boolean, Session.NotFoundError>
  /** Fires every schedule that is due now, at most once each. */
  readonly tick: Effect.Effect<void>
  /**
   * Runs `tick` whenever a schedule falls due, until interrupted. All state lives in the table, so exactly one
   * process may run this: the managed server.
   */
  readonly run: Effect.Effect<never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Schedule") {}

type Row = typeof ScheduleTable.$inferSelect

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const MIN_INTERVAL = MINUTE
/** A firing this far past its due time is marked late. */
const LATE_AFTER = 60_000
/** The loop re-reads the table at least this often, so clock jumps and missed doorbells are caught. */
const MAX_SLEEP = 30_000
/** How long a due schedule waits before its location's flag is read again, while schedules are off there. */
const DISABLED_RETRY = HOUR
/** How long a schedule whose prompt failed waits before trying again. */
const FAILED_RETRY = 5 * MINUTE

const duration = (value: string) =>
  Option.match(ScheduleSchema.durationMillis(value), {
    onNone: () => Effect.fail(new InvalidError({ reason: `Invalid duration: ${value}` })),
    onSome: (millis) =>
      millis > 0
        ? Effect.succeed(millis)
        : Effect.fail(new InvalidError({ reason: `Duration must be positive: ${value}` })),
  })

/** Stored durations were validated on create. */
const millis = (value: string) =>
  Option.getOrThrowWith(ScheduleSchema.durationMillis(value), () => new Error(`Invalid duration: ${value}`))

const OFFSET = /\d(?:z|[+-]\d{2}:?\d{2})$/i

/** Parses an instant with an offset, or a wall-clock time in `zone`. */
const parseAt = (input: string, zone: DateTime.TimeZone) =>
  Option.map(
    OFFSET.test(input) ? DateTime.make(input) : DateTime.makeZoned(input, { timeZone: zone, adjustForTimeZone: true }),
    DateTime.toEpochMillis,
  )

const cronNext = Option.liftThrowable(Cron.next)

/**
 * The first slot strictly after `now`, or undefined if the expression never matches a date. When clocks fall back,
 * Cron.next maps a repeated wall-clock time to its first occurrence, which is already past during the repeated hour,
 * so no slot fires twice: step past each such slot until one lands after `now`.
 */
const nextCron = (cron: Cron.Cron, now: number, from = now): number | undefined => {
  const next = cronNext(cron, new Date(from))
  if (Option.isNone(next)) return undefined
  const at = next.value.getTime()
  return at > now ? at : nextCron(cron, now, at + HOUR)
}

/** The first slot strictly after `now`, or undefined for one-shots. */
const following = (row: Pick<Row, "when" | "tz" | "next_due_at">, now: number) => {
  switch (row.when.type) {
    case "in":
    case "at":
      return undefined
    case "every": {
      // Keep the phase: skip every missed slot rather than firing them in a burst.
      const every = millis(row.when.every)
      const due = row.next_due_at ?? now
      return due + (Math.floor((now - due) / every) + 1) * every
    }
    case "cron":
      return nextCron(Cron.parseUnsafe(row.when.cron, row.tz), now)
  }
}

const finished = (row: Pick<Row, "ends_at">, next: number | undefined, remaining: number | null) =>
  next === undefined || (remaining !== null && remaining <= 0) || (row.ends_at !== null && next > row.ends_at)

const optionalTime = (value: number | null) => (value === null ? undefined : DateTime.makeUnsafe(value))

const toInfo = (row: Row): Info => ({
  id: row.id,
  sessionID: row.session_id ?? undefined,
  name: row.name ?? undefined,
  when: row.when,
  tz: row.tz,
  action: row.action,
  status: row.status,
  nextDueAt: optionalTime(row.next_due_at),
  endsAt: optionalTime(row.ends_at),
  remainingRuns: row.remaining_runs ?? undefined,
  runCount: row.run_count,
  lastFiredAt: optionalTime(row.last_fired_at),
  lastOutcome: row.last_outcome ?? undefined,
  time: { created: DateTime.makeUnsafe(row.time_created), updated: DateTime.makeUnsafe(row.time_updated) },
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const sessions = yield* Session.Service
    const instances = yield* Instance.Service
    const execution = yield* SessionExecution.Service
    const doorbell = yield* Latch.make()

    // Config is per location, so a schedule follows the config where its Session lives.
    const settings = (session: SessionSchema.Info) =>
      Effect.gen(function* () {
        const config = yield* Effect.serviceOption(Config.Service)
        if (Option.isNone(config)) return { enabled: false, timezone: undefined }
        const entries = yield* config.value.entries()
        return {
          enabled: Config.latest(entries, "experimental")?.schedules === true,
          timezone: Config.latest(entries, "timezone"),
        }
      }).pipe(instances.provide(session))

    const find = (id: ID) =>
      db
        .select()
        .from(ScheduleTable)
        .where(eq(ScheduleTable.id, id))
        .get()
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) => (row ? Effect.succeed(row) : Effect.fail(new NotFoundError({ scheduleID: id })))),
        )

    const update = (row: Row, values: Partial<Row>) =>
      db
        .update(ScheduleTable)
        .set(values)
        .where(and(eq(ScheduleTable.id, row.id), eq(ScheduleTable.status, "active")))
        .run()
        .pipe(Effect.orDie)

    const pending = (id: SessionMessage.ID) =>
      db
        .select({ id: SessionInboxTable.id })
        .from(SessionInboxTable)
        .where(eq(SessionInboxTable.id, id))
        .get()
        .pipe(
          Effect.orDie,
          Effect.map((row) => row !== undefined),
        )

    const fire = Effect.fnUntraced(function* (row: Row, sessionID: SessionSchema.ID, due: number, now: number) {
      const run = row.run_count + 1
      // The id is derived from the run, so retrying after a crash reconciles with the earlier admission.
      const id = SessionMessage.ID.make(`msg_${row.id}_${run}`)
      const late = now - due >= LATE_AFTER
      yield* sessions.prompt({
        sessionID,
        id,
        text: row.action.prompt,
        delivery: "steer",
        metadata: { schedule: { id: row.id, name: row.name ?? undefined, run, dueAt: due, late } },
      })
      const next = following(row, now)
      const remaining = row.remaining_runs === null ? null : row.remaining_runs - 1
      const done = finished(row, next, remaining)
      // Record the run even if a pause landed during the prompt, or the next firing would reuse this message id.
      yield* db
        .update(ScheduleTable)
        .set({
          run_count: run,
          last_message_id: id,
          last_fired_at: now,
          last_outcome: late ? "late" : "fired",
          retry_at: null,
          remaining_runs: remaining,
          ...(done ? { status: "done" as const } : {}),
          next_due_at: done ? null : next,
          time_updated: now,
        })
        .where(eq(ScheduleTable.id, row.id))
        .run()
        .pipe(Effect.orDie)
    })

    const step = Effect.fnUntraced(function* (row: Row, now: number) {
      const due = row.next_due_at
      if (due === null || row.session_id === null) return
      const session = yield* sessions.get(row.session_id)
      if (!(yield* settings(session)).enabled) {
        // Reading the flag boots the Session's location, so check again in an hour rather than every tick. The row
        // keeps its due time, so once the flag is back on it catches up like any missed slot.
        yield* update(row, { last_outcome: "disabled", retry_at: now + DISABLED_RETRY, time_updated: now })
        return
      }
      if (row.last_message_id !== null && (yield* pending(row.last_message_id))) {
        // The wake that followed admission may have been lost; waking again is harmless.
        yield* execution.wake(session.id)
        const next = following(row, now)
        const done = finished(row, next, row.remaining_runs)
        yield* update(row, {
          last_outcome: "skipped",
          retry_at: null,
          status: done ? "done" : "active",
          next_due_at: done ? null : next,
          time_updated: now,
        })
        return
      }
      yield* fire(row, session.id, due, now)
    })

    const tickAt = Effect.fnUntraced(function* (now: number) {
      const due = yield* db
        .select()
        .from(ScheduleTable)
        .where(
          and(
            eq(ScheduleTable.status, "active"),
            lte(ScheduleTable.next_due_at, now),
            or(isNull(ScheduleTable.retry_at), lte(ScheduleTable.retry_at, now)),
          ),
        )
        .orderBy(asc(ScheduleTable.next_due_at))
        .all()
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        due,
        (row) =>
          step(row, now).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.interrupt
                : // Back off rather than retrying a failing prompt on every tick.
                  Effect.logWarning("schedule failed to fire", { scheduleID: row.id, cause }).pipe(
                    Effect.andThen(
                      update(row, { last_outcome: "failed", retry_at: now + FAILED_RETRY, time_updated: now }),
                    ),
                  ),
            ),
          ),
        { discard: true },
      )
    }, Effect.withSpan("Schedule.tick"))

    const tick = Effect.flatMap(Clock.currentTimeMillis, tickAt)

    // Rows due by `from` that could not fire (a failed prompt, a retry_at not yet reached) are rechecked after at most
    // MAX_SLEEP, not in a spin.
    const nextWake = Effect.fnUntraced(function* (from: number) {
      const row = yield* db
        .select({ at: min(ScheduleTable.next_due_at) })
        .from(ScheduleTable)
        .where(and(eq(ScheduleTable.status, "active"), gt(ScheduleTable.next_due_at, from)))
        .get()
        .pipe(Effect.orDie)
      if (row?.at == null) return MAX_SLEEP
      return Math.max(0, Math.min(MAX_SLEEP, row.at - (yield* Clock.currentTimeMillis)))
    })

    // A crash between admitting a prompt and its Session claiming the work leaves the prompt unclaimed and the
    // Session asleep, so wake every Session whose last scheduled prompt is still pending.
    const rewake = db
      .selectDistinct({ sessionID: ScheduleTable.session_id })
      .from(ScheduleTable)
      .innerJoin(SessionInboxTable, eq(SessionInboxTable.id, ScheduleTable.last_message_id))
      .all()
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) => (row.sessionID === null ? Effect.void : execution.wake(row.sessionID)), {
            discard: true,
          }),
        ),
      )

    const loop = Effect.gen(function* () {
      yield* doorbell.close
      const now = yield* Clock.currentTimeMillis
      yield* tickAt(now).pipe(Effect.catchCause((cause) => Effect.logError("schedule tick failed", { cause })))
      const wait = yield* nextWake(now)
      if (wait > 0) yield* doorbell.await.pipe(Effect.timeoutOption(wait))
    })

    const run = rewake.pipe(
      Effect.catchCause((cause) => Effect.logError("schedule rewake failed", { cause })),
      Effect.andThen(Effect.forever(loop)),
    )

    const resolveZone = (tz: string | undefined) => {
      if (tz === undefined) return Effect.succeed(DateTime.zoneMakeLocal())
      return Option.match(DateTime.zoneMakeNamed(tz), {
        onNone: () => Effect.fail(new InvalidError({ reason: `Unknown time zone: ${tz}` })),
        onSome: Effect.succeed,
      })
    }

    const firstDue = Effect.fnUntraced(function* (when: ScheduleSchema.When, zone: DateTime.TimeZone, now: number) {
      switch (when.type) {
        case "in":
          return now + (yield* duration(when.in))
        case "at": {
          const at = parseAt(when.at, zone)
          if (Option.isNone(at)) return yield* new InvalidError({ reason: `Invalid time: ${when.at}` })
          if (at.value <= now) return yield* new InvalidError({ reason: `Time is in the past: ${when.at}` })
          return at.value
        }
        case "every": {
          const every = yield* duration(when.every)
          if (every < MIN_INTERVAL) return yield* new InvalidError({ reason: "every must be at least 1 minute" })
          return now + every
        }
        case "cron": {
          const cron = Cron.parse(when.cron, zone)
          if (Result.isFailure(cron)) return yield* new InvalidError({ reason: cron.failure.message })
          if (cron.success.seconds.size !== 1)
            return yield* new InvalidError({ reason: "cron must fire at most once a minute" })
          const next = nextCron(cron.success, now)
          if (next === undefined) return yield* new InvalidError({ reason: `cron never fires: ${when.cron}` })
          return next
        }
      }
    })

    const endsAt = Effect.fnUntraced(function* (
      ends: ScheduleSchema.Ends | undefined,
      zone: DateTime.TimeZone,
      now: number,
    ) {
      const after = ends?.after === undefined ? undefined : now + (yield* duration(ends.after))
      if (ends?.at === undefined) return after ?? null
      const at = parseAt(ends.at, zone)
      if (Option.isNone(at)) return yield* new InvalidError({ reason: `Invalid time: ${ends.at}` })
      return Math.min(at.value, after ?? at.value)
    })

    return Service.of({
      create: Effect.fn("Schedule.create")(function* (input) {
        const session = yield* sessions.get(input.sessionID)
        const config = yield* settings(session).pipe(Effect.orDie)
        if (!config.enabled) return yield* new DisabledError()
        const zone = yield* resolveZone(input.when.tz ?? config.timezone)
        const now = yield* Clock.currentTimeMillis
        const due = yield* firstDue(input.when, zone, now)
        if (input.ends?.times !== undefined && input.ends.times < 1)
          return yield* new InvalidError({ reason: "ends.times must be at least 1" })
        const ends = yield* endsAt(input.ends, zone, now)
        if (ends !== null && due > ends)
          return yield* new InvalidError({ reason: "The schedule ends before it first fires" })
        const row = yield* db
          .insert(ScheduleTable)
          .values({
            id: ID.create(),
            session_id: session.id,
            name: input.name ?? null,
            action: input.action,
            when: input.when,
            tz: DateTime.zoneToString(zone),
            next_due_at: due,
            ends_at: ends,
            remaining_runs: input.ends?.times ?? null,
            time_created: now,
            time_updated: now,
          })
          .returning()
          .get()
          .pipe(Effect.orDie)
        yield* doorbell.open
        return toInfo(row)
      }),
      list: Effect.fn("Schedule.list")(function* (input) {
        const rows = yield* db
          .select()
          .from(ScheduleTable)
          .where(input?.sessionID === undefined ? undefined : eq(ScheduleTable.session_id, input.sessionID))
          .orderBy(asc(ScheduleTable.time_created), asc(ScheduleTable.id))
          .all()
          .pipe(Effect.orDie)
        return rows.map(toInfo)
      }),
      get: Effect.fn("Schedule.get")(function* (id) {
        return toInfo(yield* find(id))
      }),
      pause: Effect.fn("Schedule.pause")(function* (id) {
        const row = yield* find(id)
        if (row.status !== "active") return toInfo(row)
        const now = yield* Clock.currentTimeMillis
        yield* update(row, { status: "paused", time_updated: now })
        return toInfo(yield* find(id))
      }),
      resume: Effect.fn("Schedule.resume")(function* (id) {
        const row = yield* find(id)
        if (row.status !== "paused") return toInfo(row)
        const now = yield* Clock.currentTimeMillis
        // A one-shot that fell due while paused fires once, late; a repeating schedule resumes at its next slot.
        const next =
          row.next_due_at === null || row.next_due_at > now ? row.next_due_at : (following(row, now) ?? row.next_due_at)
        const done = next === null || finished(row, next, row.remaining_runs)
        yield* db
          .update(ScheduleTable)
          .set({ status: done ? "done" : "active", next_due_at: done ? null : next, retry_at: null, time_updated: now })
          .where(and(eq(ScheduleTable.id, id), eq(ScheduleTable.status, "paused")))
          .run()
          .pipe(Effect.orDie)
        yield* doorbell.open
        return toInfo(yield* find(id))
      }),
      remove: Effect.fn("Schedule.remove")(function* (id) {
        yield* find(id)
        yield* db.delete(ScheduleTable).where(eq(ScheduleTable.id, id)).run().pipe(Effect.orDie)
      }),
      enabled: Effect.fn("Schedule.enabled")(function* (sessionID) {
        return (yield* settings(yield* sessions.get(sessionID)).pipe(Effect.orDie)).enabled
      }),
      tick,
      run,
    })
  }),
)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Session.node, SessionExecution.node, Instance.node],
})
