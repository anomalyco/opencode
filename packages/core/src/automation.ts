export * as Automation from "./automation.js"

import { randomUUID } from "node:crypto"
import { and, asc, eq, gt, isNull, lte, min, or, sql } from "drizzle-orm"
import { Cause, Clock, Context, Cron, DateTime, Effect, Latch, Layer, Option, Result, Schedule as EffectSchedule, Schema } from "effect"
import { Node, makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import {
  Condition,
  ConditionInput,
  CreateInput,
  durationMillis,
  type Ends,
  ID,
  Info,
  Outcome,
  Request,
  Status,
  type StoredCheck,
  toCreateInput,
  When,
} from "@opencode/schema/automation"
import { Config } from "./config.js"
import { Database } from "./database/database.js"
import { FileSystem } from "./filesystem.js"
import { Instance } from "./instance/service.js"
import { KVTable } from "./kv/sql.js"
import type { Permission } from "./permission.js"
import { Session } from "./session.js"
import { SessionExecution } from "./session/execution.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { SessionInboxTable } from "./session/sql.js"
import { AutomationCheck } from "./automation/check.js"
import { AutomationTable } from "./automation/sql.js"

export { ID, Info, CreateInput, Request, Condition, ConditionInput, When, Status, Outcome, toCreateInput }

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Automation.NotFoundError", {
  automationID: ID,
}) {
  override get message() {
    return `Automation not found: ${this.automationID}`
  }
}

export class InvalidError extends Schema.TaggedError<InvalidError>()("Automation.InvalidError", {
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export class DisabledError extends Schema.TaggedError<DisabledError>()("Automation.DisabledError", {}) {
  override get message() {
    return "Automations are disabled; set experimental.automations in config"
  }
}

export interface Interface {
  readonly create: (
    input: CreateInput,
  ) => Effect.Effect<Info, InvalidError | DisabledError | Session.NotFoundError | Permission.Error>
  readonly list: (input?: { readonly sessionID?: SessionSchema.ID }) => Effect.Effect<Info[]>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly pause: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly resume: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError>
  /** Whether experimental.automations is on in the config where the Session lives. */
  readonly enabled: (sessionID: SessionSchema.ID) => Effect.Effect<boolean, Session.NotFoundError>
  /** Fires every automation that is due now, at most once each. */
  readonly tick: Effect.Effect<void>
  /**
   * Runs `tick` whenever an automation falls due, until interrupted. Elects at most one active leader per SQLite
   * database via a lease row, so auxiliary processes (`opencode acp`, `--standalone`) sharing a data directory
   * never double-fire alongside a managed service.
   */
  readonly run: Effect.Effect<never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Automation") {}

type Row = typeof AutomationTable.$inferSelect

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const MIN_INTERVAL = MINUTE
const MIN_CHECK_INTERVAL = 15_000
const DEFAULT_UNTIL_EVERY: When = { type: "every", every: "30 seconds" }
const DEFAULT_UNTIL_AFTER = 24 * HOUR
/** A firing this far past its due time is marked late. */
const LATE_AFTER = 60_000
/** The loop re-reads the table at least this often, so clock jumps and missed doorbells are caught. */
const MAX_SLEEP = 30_000
const LEADER_KEY = "automation:leader"
const LEADER_TTL = 2 * MAX_SLEEP
/** How long a due schedule waits before its location's flag is read again, while schedules are off there. */
const DISABLED_RETRY = HOUR
/** How long a schedule whose prompt failed waits before trying again. */
const FAILED_RETRY = 5 * MINUTE
/** How long a schedule whose check failed waits before trying again, up to MAX_CHECK_FAILURES. */
const CHECK_FAILED_RETRY = MINUTE
const MAX_CHECK_FAILURES = 3
const TICK_CONCURRENCY = 4

const duration = (value: string) =>
  Option.match(durationMillis(value), {
    onNone: () => Effect.fail(new InvalidError({ reason: `Invalid duration: ${value}` })),
    onSome: (millis) =>
      millis > 0
        ? Effect.succeed(millis)
        : Effect.fail(new InvalidError({ reason: `Duration must be positive: ${value}` })),
  })

/** Stored durations were validated on create. */
const millis = (value: string) =>
  Option.getOrThrowWith(durationMillis(value), () => new Error(`Invalid duration: ${value}`))

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

const promptText = (prompt: string, message: string | undefined) => {
  if (!message?.trim()) return prompt
  return `${prompt}\n\n${message}`
}

const resolveStoredCheck = (input: CreateInput): Effect.Effect<StoredCheck | undefined, InvalidError> => {
  if (input.if !== undefined && input.until !== undefined)
    return Effect.fail(new InvalidError({ reason: "Choose either if or until, not both" }))
  const check: StoredCheck | undefined =
    input.if !== undefined
      ? { mode: "if", condition: input.if }
      : input.until !== undefined
        ? { mode: "until", condition: input.until }
        : undefined
  if (check === undefined) return Effect.succeed(undefined)
  const validated = AutomationCheck.validate(check.condition)
  if (Result.isFailure(validated)) return Effect.fail(new InvalidError({ reason: validated.failure }))
  return Effect.succeed(check)
}

const toInfo = (row: Row, lastOutput?: string): Info => ({
  id: row.id,
  sessionID: row.session_id ?? undefined,
  name: row.name ?? undefined,
  when: row.when,
  tz: row.tz,
  if: row.check?.mode === "if" ? row.check.condition : undefined,
  until: row.check?.mode === "until" ? row.check.condition : undefined,
  action: row.action,
  status: row.status,
  nextDueAt: optionalTime(row.next_due_at),
  endsAt: optionalTime(row.ends_at),
  remainingRuns: row.remaining_runs ?? undefined,
  runCount: row.run_count,
  lastFiredAt: optionalTime(row.last_fired_at),
  lastOutcome: row.last_outcome ?? undefined,
  ...(lastOutput === undefined ? {} : { lastOutput }),
  time: { created: DateTime.makeUnsafe(row.time_created), updated: DateTime.makeUnsafe(row.time_updated) },
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
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
          enabled: Config.latest(entries, "experimental")?.automations === true,
          timezone: Config.latest(entries, "timezone"),
        }
      }).pipe(instances.provide(session))

    const find = (id: ID) =>
      db
        .select()
        .from(AutomationTable)
        .where(eq(AutomationTable.id, id))
        .get()
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) => (row ? Effect.succeed(row) : Effect.fail(new NotFoundError({ automationID: id })))),
        )

    const update = (row: Row, values: Partial<Row>) =>
      db
        .update(AutomationTable)
        .set(values)
        .where(and(eq(AutomationTable.id, row.id), eq(AutomationTable.status, "active")))
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

    const admitWake = Effect.fnUntraced(function* (
      row: Row,
      sessionID: SessionSchema.ID,
      run: number,
      due: number,
      late: boolean,
      text: string,
      checkMeta?: Record<string, unknown>,
    ) {
      // The id is derived from `run_count`, so retrying after a crash reconciles with the earlier admission.
      const id = SessionMessage.ID.make(`msg_${row.id}_${run}`)
      yield* sessions.prompt({
        sessionID,
        id,
        text,
        delivery: "steer",
        metadata: {
          automation: {
            id: row.id,
            name: row.name ?? undefined,
            run,
            dueAt: due,
            late,
            ...(checkMeta === undefined ? {} : { check: checkMeta }),
          },
        },
      })
      return id
    })

    const fire = Effect.fnUntraced(function* (row: Row, session: SessionSchema.Info, due: number, now: number) {
      const late = now - due >= LATE_AFTER
      const next = following(row, now)

      if (row.check !== null) {
        const check = row.check
        const checkMessageID = SessionMessage.ID.make(`msg_${row.id}_check_${row.checks + 1}`)
        const outcome = yield* AutomationCheck.evaluate(session, check, row.state ?? null, {
          messageID: checkMessageID,
          now,
          checks: row.checks,
        }).pipe(instances.provide(session))

        if (!outcome.ok) {
          const strikes = row.failures + 1
          if (!outcome.invalid && strikes < MAX_CHECK_FAILURES) {
            yield* update(row, {
              failures: strikes,
              last_outcome: "failed",
              retry_at: now + CHECK_FAILED_RETRY,
              time_updated: now,
            })
            return
          }
          const run = row.run_count + 1
          const note = outcome.invalid
            ? `[Automation paused after invalid check: ${outcome.error}]`
            : `[Automation paused after ${strikes} failed checks: ${outcome.error}]`
          const id = yield* admitWake(
            row,
            session.id,
            run,
            due,
            late,
            `${row.action.prompt}\n\n${note}`,
            { error: outcome.error, failures: strikes },
          )
          yield* db
            .update(AutomationTable)
            .set({
              status: "paused",
              failures: strikes,
              run_count: run,
              last_message_id: id,
              last_fired_at: now,
              last_outcome: "failed",
              retry_at: null,
              time_updated: now,
            })
            .where(eq(AutomationTable.id, row.id))
            .run()
            .pipe(Effect.orDie)
          return
        }

        if (!outcome.wake) {
          const checks = row.checks + 1
          const ended = next === undefined || (row.ends_at !== null && next > row.ends_at)
          if (check.mode === "until" && ended) {
            const run = row.run_count + 1
            const id = yield* admitWake(
              row,
              session.id,
              run,
              due,
              late,
              `${row.action.prompt}\n\n[Automation timed out without matching: ${AutomationCheck.describe(check.condition)}]`,
              { expired: true },
            )
            yield* db
              .update(AutomationTable)
              .set({
                status: "done",
                checks,
                failures: 0,
                state: outcome.state,
                run_count: run,
                last_message_id: id,
                last_fired_at: now,
                last_outcome: "expired",
                next_due_at: null,
                remaining_runs: 0,
                retry_at: null,
                time_updated: now,
              })
              .where(eq(AutomationTable.id, row.id))
              .run()
              .pipe(Effect.orDie)
            return
          }
          yield* update(row, {
            checks,
            failures: 0,
            state: outcome.state,
            last_outcome: "checked",
            retry_at: null,
            ...(ended ? { status: "done" as const, next_due_at: null } : { next_due_at: next }),
            time_updated: now,
          })
          return
        }

        const run = row.run_count + 1
        const id = yield* admitWake(
          row,
          session.id,
          run,
          due,
          late,
          promptText(row.action.prompt, outcome.message),
          outcome.message === undefined ? {} : { message: outcome.message },
        )
        const remaining =
          check.mode === "until" ? 0 : row.remaining_runs === null ? null : row.remaining_runs - 1
        const done = check.mode === "until" || finished(row, next, remaining)
        // Record the run even if a pause landed during the prompt, or the next firing would reuse this message id.
        yield* db
          .update(AutomationTable)
          .set({
            run_count: run,
            checks: row.checks + 1,
            failures: 0,
            state: outcome.state,
            last_message_id: id,
            last_fired_at: now,
            last_outcome: late ? "late" : "fired",
            retry_at: null,
            remaining_runs: remaining,
            ...(done ? { status: "done" as const } : {}),
            next_due_at: done ? null : next,
            time_updated: now,
          })
          .where(eq(AutomationTable.id, row.id))
          .run()
          .pipe(Effect.orDie)
        return
      }

      const run = row.run_count + 1
      const id = yield* admitWake(row, session.id, run, due, late, row.action.prompt)
      const remaining = row.remaining_runs === null ? null : row.remaining_runs - 1
      const done = finished(row, next, remaining)
      yield* db
        .update(AutomationTable)
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
        .where(eq(AutomationTable.id, row.id))
        .run()
        .pipe(Effect.orDie)
    })

    const step = Effect.fnUntraced(function* (row: Row, now: number) {
      const due = row.next_due_at
      if (due === null || row.session_id === null) return
      if (!(yield* claimLeader(yield* Clock.currentTimeMillis))) return
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
      yield* fire(row, session, due, now)
    })

    const tickAt = Effect.fnUntraced(function* (now: number) {
      const due = yield* db
        .select()
        .from(AutomationTable)
        .where(
          and(
            eq(AutomationTable.status, "active"),
            lte(AutomationTable.next_due_at, now),
            or(isNull(AutomationTable.retry_at), lte(AutomationTable.retry_at, now)),
          ),
        )
        .orderBy(asc(AutomationTable.next_due_at))
        .all()
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        due,
        (row) =>
          step(row, now).pipe(
            Effect.catchCause((cause) => {
              if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
              if (Cause.squash(cause) instanceof FileSystem.DirectoryNotFoundError) {
                // The Session's folder (e.g. a removed worktree) is gone; pause rather than retrying every 5 minutes.
                return update(row, {
                  status: "paused",
                  last_outcome: "failed",
                  retry_at: null,
                  time_updated: now,
                })
              }
              // Back off rather than retrying a failing prompt on every tick.
              return Effect.logWarning("automation failed to fire", { automationID: row.id, cause }).pipe(
                Effect.andThen(
                  update(row, { last_outcome: "failed", retry_at: now + FAILED_RETRY, time_updated: now }),
                ),
              )
            }),
          ),
        { discard: true, concurrency: due.length > 1 ? TICK_CONCURRENCY : 1 },
      )
    }, Effect.withSpan("Automation.tick"))

    const tick = Effect.flatMap(Clock.currentTimeMillis, tickAt)

    // Rows due by `from` that could not fire (a failed prompt, a retry_at not yet reached) are rechecked after at most
    // MAX_SLEEP, not in a spin.
    const nextWake = Effect.fnUntraced(function* (from: number) {
      const row = yield* db
        .select({ at: min(AutomationTable.next_due_at) })
        .from(AutomationTable)
        .where(and(eq(AutomationTable.status, "active"), gt(AutomationTable.next_due_at, from)))
        .get()
        .pipe(Effect.orDie)
      if (row?.at == null) return MAX_SLEEP
      return Math.max(0, Math.min(MAX_SLEEP, row.at - (yield* Clock.currentTimeMillis)))
    })

    // A crash between admitting a prompt and its Session claiming the work leaves the prompt unclaimed and the
    // Session asleep, so wake every Session whose last scheduled prompt is still pending.
    const rewake = db
      .selectDistinct({ sessionID: AutomationTable.session_id })
      .from(AutomationTable)
      .innerJoin(SessionInboxTable, eq(SessionInboxTable.id, AutomationTable.last_message_id))
      .all()
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) => (row.sessionID === null ? Effect.void : execution.wake(row.sessionID)), {
            discard: true,
          }),
        ),
      )

    const hasActiveRows = db
      .select({ id: AutomationTable.id })
      .from(AutomationTable)
      .where(eq(AutomationTable.status, "active"))
      .limit(1)
      .get()
      .pipe(
        Effect.orDie,
        Effect.map((row) => row !== undefined),
      )

    const ownerID = randomUUID()
    let leading = false
    let bootChecked = false

    const claimLeader = Effect.fnUntraced(function* (now: number) {
      const value = { owner: ownerID, until: now + LEADER_TTL }
      const claimed = yield* db
        .insert(KVTable)
        .values({ key: LEADER_KEY, value, time_created: now, time_updated: now })
        .onConflictDoUpdate({
          target: KVTable.key,
          set: { value, time_updated: now },
          where: sql`json_extract(${KVTable.value}, '$.owner') = ${ownerID} or json_extract(${KVTable.value}, '$.until') <= ${now}`,
        })
        .returning({ key: KVTable.key })
        .get()
        .pipe(Effect.orDie)
      return claimed !== undefined
    })

    const releaseLeader = Effect.sync(() => {
      leading = false
    }).pipe(
      Effect.andThen(
        db
          .delete(KVTable)
          .where(and(eq(KVTable.key, LEADER_KEY), sql`json_extract(${KVTable.value}, '$.owner') = ${ownerID}`))
          .run()
          .pipe(Effect.ignore),
      ),
    )

    const heartbeat = Clock.currentTimeMillis.pipe(
      Effect.flatMap(claimLeader),
      Effect.ignore,
      Effect.schedule(EffectSchedule.spaced(LEADER_TTL / 3)),
    )

    const loop = Effect.gen(function* () {
      yield* doorbell.close
      const active = yield* hasActiveRows
      if (!active && bootChecked) {
        if (leading) yield* releaseLeader
        yield* doorbell.await.pipe(Effect.timeoutOption(MAX_SLEEP))
        return
      }
      const now = yield* Clock.currentTimeMillis
      const isLeader = yield* claimLeader(now)
      if (!isLeader) {
        leading = false
        bootChecked = true
        yield* doorbell.await.pipe(Effect.timeoutOption(MAX_SLEEP))
        return
      }
      if (!leading) {
        leading = true
        bootChecked = true
        yield* rewake.pipe(Effect.catchCause((cause) => Effect.logError("automation rewake failed", { cause })))
      }
      if (!active) {
        yield* releaseLeader
        yield* doorbell.await.pipe(Effect.timeoutOption(MAX_SLEEP))
        return
      }
      yield* Effect.scoped(
        Effect.forkScoped(heartbeat).pipe(
          Effect.andThen(
            tickAt(now).pipe(Effect.catchCause((cause) => Effect.logError("automation tick failed", { cause }))),
          ),
        ),
      )
      if (!(yield* hasActiveRows)) {
        yield* releaseLeader
        yield* doorbell.await.pipe(Effect.timeoutOption(MAX_SLEEP))
        return
      }
      const wait = yield* nextWake(now)
      if (wait > 0) yield* doorbell.await.pipe(Effect.timeoutOption(wait))
    })

    const run = Effect.forever(loop).pipe(Effect.ensuring(releaseLeader))

    const resolveZone = (tz: string | undefined) => {
      if (tz === undefined) return Effect.succeed(DateTime.zoneMakeLocal())
      return Option.match(DateTime.zoneMakeNamed(tz), {
        onNone: () => Effect.fail(new InvalidError({ reason: `Unknown time zone: ${tz}` })),
        onSome: Effect.succeed,
      })
    }

    const firstDue = Effect.fnUntraced(function* (
      when: When,
      hasCheck: boolean,
      zone: DateTime.TimeZone,
      now: number,
    ) {
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
          const minInterval = hasCheck ? MIN_CHECK_INTERVAL : MIN_INTERVAL
          if (every < minInterval) {
            return yield* new InvalidError({
              reason: hasCheck ? "every must be at least 15 seconds" : "every must be at least 1 minute",
            })
          }
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
      ends: Ends | undefined,
      isUntil: boolean,
      zone: DateTime.TimeZone,
      now: number,
    ) {
      const after = ends?.after === undefined ? undefined : now + (yield* duration(ends.after))
      if (ends?.at === undefined) {
        if (after !== undefined) return after
        return isUntil ? now + DEFAULT_UNTIL_AFTER : null
      }
      const at = parseAt(ends.at, zone)
      if (Option.isNone(at)) return yield* new InvalidError({ reason: `Invalid time: ${ends.at}` })
      return Math.min(at.value, after ?? at.value)
    })

    return Service.of({
      create: Effect.fn("Automation.create")(function* (input) {
        const session = yield* sessions.get(input.sessionID)
        const config = yield* settings(session).pipe(
          Effect.catchTag("FileSystem.DirectoryNotFoundError", () =>
            Effect.fail(new InvalidError({ reason: `Session directory does not exist: ${session.location.directory}` })),
          ),
        )
        if (!config.enabled) return yield* new DisabledError()
        const check = yield* resolveStoredCheck(input)
        const when = input.when ?? (check?.mode === "until" ? DEFAULT_UNTIL_EVERY : undefined)
        if (when === undefined)
          return yield* new InvalidError({ reason: "when is required unless until is set" })
        const zone = yield* resolveZone(when.tz ?? config.timezone)
        const now = yield* Clock.currentTimeMillis
        const due = yield* firstDue(when, check !== undefined, zone, now)
        if (input.ends?.times !== undefined && input.ends.times < 1)
          return yield* new InvalidError({ reason: "ends.times must be at least 1" })
        const ends = yield* endsAt(input.ends, check?.mode === "until", zone, now)
        if (ends !== null && due > ends)
          return yield* new InvalidError({ reason: "The automation ends before it first fires" })

        const automationID = ID.create()
        const seeded =
          check === undefined
            ? { matched: false as const, state: null as Schema.Json, checks: 0 }
            : yield* Effect.gen(function* () {
                yield* AutomationCheck.authorize(session, input.name, when, check).pipe(
                  instances.provide(session),
                  Effect.mapError((error) => (typeof error === "string" ? new InvalidError({ reason: error }) : error)),
                  Effect.catchTag("FileSystem.DirectoryNotFoundError", () =>
                    Effect.fail(
                      new InvalidError({ reason: `Session directory does not exist: ${session.location.directory}` }),
                    ),
                  ),
                )
                const shouldSeed =
                  check.mode === "until" ||
                  check.condition.type === "code" ||
                  (check.condition.type === "shell" && check.condition.changes === true)
                if (!shouldSeed) return { matched: false as const, state: null as Schema.Json, checks: 0 }
                const init = yield* AutomationCheck.evaluate(session, check, null, {
                  messageID: SessionMessage.ID.make(`msg_${automationID}_check_0`),
                  now,
                  checks: 0,
                }).pipe(
                  instances.provide(session),
                  Effect.catchTag("FileSystem.DirectoryNotFoundError", () =>
                    Effect.fail(
                      new InvalidError({ reason: `Session directory does not exist: ${session.location.directory}` }),
                    ),
                  ),
                )
                if (!init.ok) {
                  // A code check that throws or fails at creation is broken (e.g. wrong MCP response field); fail right away.
                  if (init.invalid || check.condition.type === "code") return yield* new InvalidError({ reason: init.error })
                  return { matched: false as const, state: null as Schema.Json, checks: 0 }
                }
                if (check.mode === "until" && init.wake)
                  return { matched: true as const, state: init.state, message: init.message }
                return { matched: false as const, state: init.state, checks: 1 }
              })

        if (seeded.matched) {
          const row = yield* db
            .insert(AutomationTable)
            .values({
              id: automationID,
              session_id: session.id,
              name: input.name ?? null,
              check: check ?? null,
              state: seeded.state,
              checks: 1,
              action: input.action,
              when,
              tz: DateTime.zoneToString(zone),
              status: "done",
              next_due_at: null,
              ends_at: ends,
              remaining_runs: 0,
              run_count: 1,
              last_fired_at: now,
              last_outcome: "fired",
              time_created: now,
              time_updated: now,
            })
            .returning()
            .get()
            .pipe(Effect.orDie)
          return toInfo(row, seeded.message)
        }

        const remaining = check?.mode === "until" ? 1 : (input.ends?.times ?? null)
        const row = yield* db
          .insert(AutomationTable)
          .values({
            id: automationID,
            session_id: session.id,
            name: input.name ?? null,
            check: check ?? null,
            state: seeded.state,
            checks: seeded.checks,
            action: input.action,
            when,
            tz: DateTime.zoneToString(zone),
            next_due_at: due,
            ends_at: ends,
            remaining_runs: remaining,
            time_created: now,
            time_updated: now,
          })
          .returning()
          .get()
          .pipe(Effect.orDie)
        yield* doorbell.open
        return toInfo(row)
      }),
      list: Effect.fn("Automation.list")(function* (input) {
        const rows = yield* db
          .select()
          .from(AutomationTable)
          .where(input?.sessionID === undefined ? undefined : eq(AutomationTable.session_id, input.sessionID))
          .orderBy(asc(AutomationTable.time_created), asc(AutomationTable.id))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => toInfo(row))
      }),
      get: Effect.fn("Automation.get")(function* (id) {
        return toInfo(yield* find(id))
      }),
      pause: Effect.fn("Automation.pause")(function* (id) {
        const row = yield* find(id)
        if (row.status !== "active") return toInfo(row)
        const now = yield* Clock.currentTimeMillis
        yield* update(row, { status: "paused", time_updated: now })
        return toInfo(yield* find(id))
      }),
      resume: Effect.fn("Automation.resume")(function* (id) {
        const row = yield* find(id)
        if (row.status !== "paused") return toInfo(row)
        const now = yield* Clock.currentTimeMillis
        // A one-shot that fell due while paused fires once, late; a repeating automation resumes at its next slot.
        const next =
          row.next_due_at === null || row.next_due_at > now ? row.next_due_at : (following(row, now) ?? row.next_due_at)
        const done = next === null || finished(row, next, row.remaining_runs)
        yield* db
          .update(AutomationTable)
          .set({
            status: done ? "done" : "active",
            next_due_at: done ? null : next,
            failures: 0,
            retry_at: null,
            time_updated: now,
          })
          .where(and(eq(AutomationTable.id, id), eq(AutomationTable.status, "paused")))
          .run()
          .pipe(Effect.orDie)
        yield* doorbell.open
        return toInfo(yield* find(id))
      }),
      remove: Effect.fn("Automation.remove")(function* (id) {
        yield* find(id)
        yield* db.delete(AutomationTable).where(eq(AutomationTable.id, id)).run().pipe(Effect.orDie)
      }),
      enabled: Effect.fn("Automation.enabled")(function* (sessionID) {
        const session = yield* sessions.get(sessionID)
        return yield* settings(session).pipe(
          Effect.map((value) => value.enabled),
          Effect.catchTag("FileSystem.DirectoryNotFoundError", () => Effect.succeed(false)),
        )
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
