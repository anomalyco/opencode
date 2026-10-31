export * as Schedule from "./schedule.js"

import { randomUUID } from "node:crypto"
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, min, or, sql } from "drizzle-orm"
import {
  Cause,
  Clock,
  Context,
  Cron,
  DateTime,
  Effect,
  Latch,
  Layer,
  Option,
  Result,
  Schedule as EffectSchedule,
  Schema,
  Scope,
} from "effect"
import { Node, makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import {
  Action,
  Attention,
  Condition,
  ConditionInput,
  CreateInput,
  Delivery,
  durationMillis,
  type Ends,
  ID,
  Info,
  Outcome,
  parseRequest,
  Request,
  ResultInput,
  Run,
  RunID,
  RunStatus,
  Status,
  type StoredCheck,
  Target,
  Thread,
  toCreateInput,
  When,
} from "@opencode/schema/schedule"
import { Config } from "./config.js"
import { Database } from "./database/database.js"
import { FileSystem } from "./filesystem.js"
import { Instance } from "./instance/service.js"
import { Job } from "./job.js"
import { KVTable } from "./kv/sql.js"
import type { Permission } from "./permission.js"
import { Session } from "./session.js"
import { SessionExecution } from "./session/execution.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { SessionInboxTable } from "./session/sql.js"
import { ScheduleAction } from "./schedule/action.js"
import { ScheduleCheck } from "./schedule/check.js"
import { ScheduleRuns } from "./schedule/runs.js"
import { ScheduleTable } from "./schedule/sql.js"

export {
  Action,
  Attention,
  Condition,
  ConditionInput,
  CreateInput,
  Delivery,
  ID,
  Info,
  Outcome,
  parseRequest,
  Request,
  ResultInput,
  Run,
  RunID,
  RunStatus,
  Status,
  Target,
  Thread,
  toCreateInput,
  When,
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Schedule.NotFoundError", {
  scheduleID: ID,
}) {
  override get message() {
    return `Schedule not found: ${this.scheduleID}`
  }
}

export class RunNotFoundError extends Schema.TaggedError<RunNotFoundError>()("Schedule.RunNotFoundError", {
  runID: RunID,
}) {
  override get message() {
    return `Schedule run not found: ${this.runID}`
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

export const fromRequest = (
  sessionID: SessionSchema.ID,
  request: Request,
): Effect.Effect<CreateInput, InvalidError> =>
  Result.match(parseRequest(sessionID, request), {
    onFailure: (reason) => Effect.fail(new InvalidError({ reason })),
    onSuccess: Effect.succeed,
  })

export interface Interface {
  readonly create: (
    input: CreateInput,
  ) => Effect.Effect<Info, InvalidError | DisabledError | Session.NotFoundError | Permission.Error>
  readonly list: (input?: { readonly sessionID?: SessionSchema.ID }) => Effect.Effect<Info[]>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly pause: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly resume: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError>
  readonly runs: (input?: {
    readonly scheduleID?: ID
    readonly sessionID?: SessionSchema.ID
    readonly limit?: number
  }) => Effect.Effect<Run[]>
  readonly inbox: (input?: {
    readonly sessionID?: SessionSchema.ID
    readonly includeRead?: boolean
    readonly limit?: number
  }) => Effect.Effect<Run[]>
  readonly getRun: (runID: RunID) => Effect.Effect<Run, RunNotFoundError>
  readonly markRead: (runID: RunID) => Effect.Effect<Run, RunNotFoundError>
  readonly reportResult: (sessionID: SessionSchema.ID, input: ResultInput) => Effect.Effect<Run, InvalidError>
  /** Whether experimental.schedules is on in the config where the Session lives. */
  readonly enabled: (sessionID: SessionSchema.ID) => Effect.Effect<boolean, Session.NotFoundError>
  /** Fires every schedule that is due now, at most once each. */
  readonly tick: Effect.Effect<void>
  /**
   * Runs `tick` whenever a schedule falls due, until interrupted. Elects at most one active leader per SQLite
   * database via a lease row, so auxiliary processes (`opencode acp`, `--standalone`) sharing a data directory
   * never double-fire alongside a managed service.
   */
  readonly run: Effect.Effect<never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Schedule") {}

type Row = typeof ScheduleTable.$inferSelect

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
const LEADER_KEY = "schedule:leader"
const LEADER_TTL = 2 * MAX_SLEEP
/** How long a due schedule waits before its location's flag is read again, while schedules are off there. */
const DISABLED_RETRY = HOUR
/** How long a schedule whose prompt failed waits before trying again. */
const FAILED_RETRY = 5 * MINUTE
/** How long a schedule whose check failed waits before trying again, up to MAX_FAILURES. */
const CHECK_FAILED_RETRY = MINUTE
const MAX_FAILURES = 3
const TICK_CONCURRENCY = 4
const TURN_TIMEOUT_MS = 30 * MINUTE

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
  if (!prompt.trim()) return message
  return `${prompt}\n\n${message}`
}

const wakeDescription = (row: Pick<Row, "name" | "when" | "check" | "action">, run: number, suffix?: string) => {
  const label = row.name ?? ScheduleAction.defaultLabel(row.action)
  if (suffix !== undefined) return `${label} · ${suffix}`
  const oneShot = row.when.type === "in" || row.when.type === "at" || row.check?.mode === "until"
  return oneShot ? label : `${label} · #${run}`
}

const formatCompletionNotice = (
  row: Pick<Row, "id" | "name" | "action">,
  run: number,
  state: "completed" | "needs_you" | "error",
  body: string,
  targetSessionID?: SessionSchema.ID,
  pausedStrikes?: number,
  runID?: RunID,
) => {
  const attrs = [
    `id="${row.id}"`,
    ...(runID ? [`runID="${runID}"`] : []),
    ...(row.name ? [`name=${JSON.stringify(row.name)}`] : []),
    `run="${run}"`,
    `action="${row.action.type}"`,
    `state="${state}"`,
    ...(targetSessionID ? [`sessionID="${targetSessionID}"`] : []),
  ].join(" ")
  const note = pausedStrikes !== undefined ? `\n\n[Schedule paused after ${pausedStrikes} failed runs]` : ""
  return `<schedule ${attrs}>\n${body}${note}\n</schedule>`
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
  const validated = ScheduleCheck.validate(check.condition)
  if (Result.isFailure(validated)) return Effect.fail(new InvalidError({ reason: validated.failure }))
  return Effect.succeed(check)
}

const validateAction = (action: Action): Effect.Effect<void, InvalidError> =>
  Result.match(ScheduleAction.validate(action), {
    onFailure: (reason) => Effect.fail(new InvalidError({ reason })),
    onSuccess: () => Effect.void,
  })

const toInfo = (row: Row, lastOutput?: string): Info => ({
  id: row.id,
  sessionID: row.session_id ?? undefined,
  dedicatedSessionID: row.dedicated_session_id ?? undefined,
  activeJobID: row.active_job_id ?? undefined,
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
    const jobs = yield* Job.Service
    const layerScope = yield* Scope.Scope
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
          schedule: {
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

    const admitNotice = Effect.fnUntraced(function* (
      row: Row,
      sessionID: SessionSchema.ID,
      run: number,
      due: number,
      late: boolean,
      text: string,
      options: {
        readonly id: SessionMessage.ID
        readonly suffix?: string
        readonly check?: Record<string, unknown>
        readonly extra?: Record<string, unknown>
      },
    ) {
      yield* sessions.synthetic({
        sessionID,
        id: options.id,
        text,
        description: wakeDescription(row, run, options.suffix),
        delivery: "queue",
        metadata: {
          source: "schedule",
          schedule: {
            id: row.id,
            name: row.name ?? undefined,
            run,
            dueAt: due,
            late,
            ...(options.check === undefined ? {} : { check: options.check }),
            ...(options.extra ?? {}),
          },
        },
      })
      return options.id
    })

    const ensureDedicatedSession = Effect.fnUntraced(function* (row: Row, owner: SessionSchema.Info) {
      if (row.dedicated_session_id !== null) {
        const existing = yield* sessions
          .get(row.dedicated_session_id)
          .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined)))
        if (existing !== undefined) return existing
      }
      return yield* sessions.create({
        location: owner.location,
        title: row.name ?? ScheduleAction.defaultLabel(row.action),
        agent: owner.agent,
        model: owner.model,
        permissions: owner.permissions,
        metadata: {
          schedule: { id: row.id, ownerSessionID: owner.id, unattended: true },
        },
      })
    })

    const runSessionTurn = Effect.fnUntraced(function* (
      targetSessionID: SessionSchema.ID,
      priorLatestID: SessionMessage.ID | undefined,
    ) {
      const settled = yield* sessions.resume(targetSessionID).pipe(
        Effect.onInterrupt(() => sessions.interrupt(targetSessionID).pipe(Effect.asVoid)),
        Effect.timeoutOption(TURN_TIMEOUT_MS),
      )
      if (Option.isNone(settled)) {
        yield* sessions.interrupt(targetSessionID).pipe(Effect.ignore)
        return yield* Effect.fail(new Error(`Scheduled turn timed out after ${TURN_TIMEOUT_MS / MINUTE}m`))
      }
      const messages = yield* sessions.messages({ sessionID: targetSessionID, order: "desc", limit: 20 })
      const extracted = ScheduleAction.extractTurnReply(messages, priorLatestID)
      if (Result.isFailure(extracted)) return yield* Effect.fail(new Error(extracted.failure))
      return extracted.success
    })

    const observeBackgroundRun = Effect.fnUntraced(function* (input: {
      readonly row: Row
      readonly ownerSessionID: SessionSchema.ID
      readonly runID: RunID
      readonly jobID: string
      readonly run: number
      readonly due: number
      readonly late: boolean
      readonly checkMessage?: string
      readonly targetSessionID?: SessionSchema.ID
    }) {
      const { info } = yield* jobs.wait({ id: input.jobID })
      const finishedAt = yield* Clock.currentTimeMillis
      const current = yield* db
        .select()
        .from(ScheduleTable)
        .where(eq(ScheduleTable.id, input.row.id))
        .get()
        .pipe(Effect.orDie)
      if (current === undefined) return
      const jobMatch = and(eq(ScheduleTable.id, input.row.id), eq(ScheduleTable.active_job_id, input.jobID))
      if (!info || info.status === "cancelled") {
        yield* ScheduleRuns.cancelRun(db, input.runID, finishedAt)
        yield* db
          .update(ScheduleTable)
          .set({ active_job_id: null, time_updated: finishedAt })
          .where(jobMatch)
          .run()
          .pipe(Effect.orDie)
        return
      }

      const deliver = ScheduleAction.deliverMode(input.row.action)
      const failed = info.status === "error"
      const strikes = failed ? current.failures + 1 : 0
      const autoPause = failed && strikes >= MAX_FAILURES

      const outcome = yield* Effect.gen(function* () {
        if (failed) {
          const errorMessage = info.error ?? "Scheduled action failed"
          yield* ScheduleRuns.settleFailed(db, {
            runID: input.runID,
            error: errorMessage,
            deliver,
            autoPause,
            now: finishedAt,
          })
          return {
            shouldNotify: deliver === "session" || autoPause,
            state: "error" as const,
            body: errorMessage,
            suffix: autoPause ? "paused" : "failed",
            pausedStrikes: autoPause ? strikes : undefined,
            adaptivePatch: {} as {
              readonly status?: ReturnType<typeof sql<Status>>
              readonly next_due_at?: ReturnType<typeof sql<number | null>>
              readonly wake?: true
            },
          }
        }

        const output = (info.output ?? "").trim()
        const settled = yield* ScheduleRuns.settleCompleted(db, {
          runID: input.runID,
          fallbackOutput: output,
          deliver,
          now: finishedAt,
        })
        const attention = settled?.run.attention ?? (ScheduleAction.isQuietOutput(output) ? "quiet" : "ready")
        const latest =
          settled?.nextInMs == null
            ? undefined
            : yield* db
                .select({ status: ScheduleTable.status, endsAt: ScheduleTable.ends_at })
                .from(ScheduleTable)
                .where(jobMatch)
                .get()
                .pipe(Effect.orDie)
        const adaptivePatch = (() => {
          if (settled?.nextInMs == null || latest?.status !== "active") return {}
          const adaptiveDue = finishedAt + settled.nextInMs
          if (latest.endsAt !== null && adaptiveDue > latest.endsAt) {
            return {
              status: sql<Status>`case when ${ScheduleTable.status} = 'active' then 'done' else ${ScheduleTable.status} end`,
              next_due_at: sql<number | null>`case when ${ScheduleTable.status} = 'active' then null else ${ScheduleTable.next_due_at} end`,
            }
          }
          return {
            next_due_at: sql<number | null>`case when ${ScheduleTable.status} = 'active' then ${adaptiveDue} else ${ScheduleTable.next_due_at} end`,
            wake: true as const,
          }
        })()
        return {
          shouldNotify: attention !== "quiet" && deliver === "session",
          state: (attention === "needs_you" ? "needs_you" : "completed") as "needs_you" | "completed",
          body: settled?.run.summary ?? output,
          suffix: attention === "needs_you" ? "needs you" : undefined,
          pausedStrikes: undefined,
          adaptivePatch,
        }
      })

      const noticeID = outcome.shouldNotify
        ? yield* admitNotice(
            input.row,
            input.ownerSessionID,
            input.run,
            input.due,
            input.late,
            formatCompletionNotice(
              input.row,
              input.run,
              outcome.state,
              outcome.body,
              input.targetSessionID,
              outcome.pausedStrikes,
              input.runID,
            ),
            {
              id: SessionMessage.ID.make(`msg_${input.row.id}_${input.run}_done`),
              ...(outcome.suffix === undefined ? {} : { suffix: outcome.suffix }),
              ...(input.checkMessage === undefined ? {} : { check: { message: input.checkMessage } }),
              extra: {
                state: outcome.state,
                runID: input.runID,
                ...(input.targetSessionID === undefined ? {} : { sessionID: input.targetSessionID }),
              },
            },
          ).pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined)))
        : undefined

      yield* db
        .update(ScheduleTable)
        .set({
          active_job_id: null,
          failures: strikes,
          ...(failed ? { last_outcome: "failed" as const } : {}),
          ...(outcome.adaptivePatch.status === undefined ? {} : { status: outcome.adaptivePatch.status }),
          ...(outcome.adaptivePatch.next_due_at === undefined ? {} : { next_due_at: outcome.adaptivePatch.next_due_at }),
          ...(noticeID === undefined ? {} : { last_message_id: noticeID }),
          ...(autoPause
            ? {
                status: sql<Status>`case when ${ScheduleTable.status} = 'active' then 'paused' else ${ScheduleTable.status} end`,
                retry_at: null,
              }
            : {}),
          time_updated: finishedAt,
        })
        .where(jobMatch)
        .run()
        .pipe(Effect.orDie)
      if (outcome.adaptivePatch.wake) {
        yield* doorbell.open
      }
    })

    const dispatchAction = Effect.fnUntraced(function* (
      row: Row,
      session: SessionSchema.Info,
      run: number,
      due: number,
      now: number,
      late: boolean,
      checkMessage: string | undefined,
      advance: {
        readonly checks?: number
        readonly state?: Schema.Json
        readonly forceDone?: boolean
      },
    ) {
      const next = following(row, now)
      const remaining =
        advance.forceDone || row.check?.mode === "until"
          ? 0
          : row.remaining_runs === null
            ? null
            : row.remaining_runs - 1
      const done = advance.forceDone || row.check?.mode === "until" || finished(row, next, remaining)
      const advanceFields = {
        run_count: run,
        ...(advance.checks === undefined ? {} : { checks: advance.checks }),
        ...(advance.state === undefined ? {} : { state: advance.state }),
        last_fired_at: now,
        last_outcome: (late ? "late" : "fired") as Outcome,
        retry_at: null,
        remaining_runs: remaining,
        ...(done ? { status: "done" as const } : {}),
        next_due_at: done ? null : next,
        time_updated: now,
      }

      if (!ScheduleAction.isBackground(row.action)) {
        const messageID =
          row.action.type === "prompt"
            ? yield* admitWake(
                row,
                session.id,
                run,
                due,
                late,
                promptText(row.action.prompt, checkMessage),
                checkMessage === undefined ? undefined : { message: checkMessage },
              )
            : yield* Effect.gen(function* () {
                if (row.action.type !== "command") return undefined
                const id = SessionMessage.ID.make(`msg_${row.id}_${run}`)
                yield* sessions.command({
                  sessionID: session.id,
                  id,
                  command: row.action.command,
                  text: promptText(row.action.arguments ?? "", checkMessage),
                  delivery: "queue",
                })
                return id
              })

        yield* db
          .update(ScheduleTable)
          .set({
            ...advanceFields,
            failures: 0,
            ...(messageID === undefined ? {} : { last_message_id: messageID }),
          })
          .where(eq(ScheduleTable.id, row.id))
          .run()
          .pipe(Effect.orDie)
        yield* ScheduleRuns.recordCompleted(db, {
          scheduleID: row.id,
          scheduleName: row.name,
          ownerSessionID: session.id,
          sessionID: session.id,
          run,
          status: "completed",
          attention: "quiet",
          summary: ScheduleAction.summaryText(row.action),
          read: true,
          now,
        })
        return
      }

      const createChildSession = (requestedAgent?: string, commandName?: string) =>
        Effect.gen(function* () {
          const selected = yield* ScheduleAction.selectSubagent(session, requestedAgent, commandName).pipe(
            instances.provide(session),
          )
          return yield* sessions.create({
            id: SessionSchema.ID.make(`ses_${row.id}_${run}`),
            parentID: session.id,
            title: wakeDescription(row, run),
            agent: selected.id,
            model: selected.model,
            permissions: session.permissions,
            metadata: {
              schedule: { id: row.id, run, ownerSessionID: session.id, unattended: true },
            },
          })
        })

      const prepared = yield* Effect.gen(function* () {
        const action = row.action
        switch (action.type) {
          case "subagent": {
            const target = yield* createChildSession(action.agent)
            return {
              targetSessionID: target.id,
              dedicatedID: undefined,
              runEffect: Effect.gen(function* () {
                yield* sessions.prompt({
                  sessionID: target.id,
                  id: SessionMessage.ID.make(`msg_${row.id}_${run}_sub`),
                  text: [
                    'You are a scheduled background subagent. Complete the task autonomously without asking interactive questions. Call schedule_result to report your outcome (attention: "quiet", "ready", or "needs_you"), or reply with NO_REPLY if there is nothing worth reporting.',
                    promptText(action.prompt, checkMessage),
                  ].join("\n\n"),
                  delivery: "queue",
                  resume: false,
                })
                return yield* runSessionTurn(target.id, undefined)
              }),
            }
          }
          case "prompt": {
            const target = yield* ensureDedicatedSession(row, session)
            return {
              targetSessionID: target.id,
              dedicatedID: target.id,
              runEffect: Effect.gen(function* () {
                const prior = (yield* sessions.messages({ sessionID: target.id, order: "desc", limit: 1 }))[0]?.id
                yield* sessions.synthetic({
                  sessionID: target.id,
                  id: SessionMessage.ID.make(`msg_${row.id}_${run}_ded`),
                  text: promptText(action.prompt, checkMessage),
                  description: wakeDescription(row, run),
                  delivery: "queue",
                  resume: false,
                  metadata: {
                    source: "schedule",
                    schedule: { id: row.id, name: row.name ?? undefined, run, dueAt: due, late },
                  },
                })
                return yield* runSessionTurn(target.id, prior)
              }),
            }
          }
          case "command": {
            const useDedicated = (action.target ?? "subagent") === "dedicated"
            const target = useDedicated
              ? yield* ensureDedicatedSession(row, session)
              : yield* createChildSession(undefined, action.command)
            return {
              targetSessionID: target.id,
              dedicatedID: useDedicated ? target.id : undefined,
              runEffect: Effect.gen(function* () {
                const prior = useDedicated
                  ? (yield* sessions.messages({ sessionID: target.id, order: "desc", limit: 1 }))[0]?.id
                  : undefined
                yield* sessions.command({
                  sessionID: target.id,
                  command: action.command,
                  text: promptText(action.arguments ?? "", checkMessage),
                  delivery: "queue",
                })
                return yield* runSessionTurn(target.id, prior)
              }),
            }
          }
          case "shell":
          case "code":
            return {
              targetSessionID: undefined,
              dedicatedID: undefined,
              runEffect: ScheduleAction.runDeterministic(session, action, {
                messageID: SessionMessage.ID.make(`msg_${row.id}_${run}_exec`),
                now,
                run,
                message: checkMessage,
              }).pipe(instances.provide(session)),
            }
        }
      })

      const startedRun = yield* ScheduleRuns.startRun(db, {
        scheduleID: row.id,
        scheduleName: row.name,
        ownerSessionID: session.id,
        sessionID: prepared.targetSessionID,
        run,
        now,
      })

      const jobID = `job_${row.id}_${run}`
      yield* db
        .update(ScheduleTable)
        .set({
          ...advanceFields,
          active_job_id: jobID,
          ...(prepared.dedicatedID === undefined ? {} : { dedicated_session_id: prepared.dedicatedID }),
        })
        .where(eq(ScheduleTable.id, row.id))
        .run()
        .pipe(Effect.orDie)

      yield* jobs.start({
        id: jobID,
        type: "schedule",
        title: wakeDescription(row, run),
        metadata: {
          sessionID: session.id,
          scheduleID: row.id,
          run,
          ...(prepared.targetSessionID === undefined ? {} : { targetSessionID: prepared.targetSessionID }),
        },
        run: prepared.runEffect,
      })

      yield* observeBackgroundRun({
        row: {
          ...row,
          ...(prepared.dedicatedID === undefined ? {} : { dedicated_session_id: prepared.dedicatedID }),
        },
        ownerSessionID: session.id,
        runID: startedRun.id,
        jobID,
        run,
        due,
        late,
        checkMessage,
        targetSessionID: prepared.targetSessionID,
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning("schedule background observer failed", { scheduleID: row.id, jobID, cause }),
        ),
        Effect.forkIn(layerScope, { startImmediately: true }),
      )
    })

    const fire = Effect.fnUntraced(function* (row: Row, session: SessionSchema.Info, due: number, now: number) {
      const late = now - due >= LATE_AFTER
      const next = following(row, now)

      if (row.check !== null) {
        const check = row.check
        const checkMessageID = SessionMessage.ID.make(`msg_${row.id}_check_${row.checks + 1}`)
        const outcome = yield* ScheduleCheck.evaluate(session, check, row.state ?? null, {
          messageID: checkMessageID,
          now,
          checks: row.checks,
        }).pipe(instances.provide(session))

        if (!outcome.ok) {
          const strikes = row.failures + 1
          if (!outcome.invalid && strikes < MAX_FAILURES) {
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
            ? `[Schedule paused after invalid check: ${outcome.error}]`
            : `[Schedule paused after ${strikes} failed checks: ${outcome.error}]`
          const id = yield* admitWake(
            row,
            session.id,
            run,
            due,
            late,
            `${ScheduleAction.summaryText(row.action)}\n\n${note}`,
            { error: outcome.error, failures: strikes },
          )
          yield* db
            .update(ScheduleTable)
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
            .where(eq(ScheduleTable.id, row.id))
            .run()
            .pipe(Effect.orDie)
          yield* ScheduleRuns.recordCompleted(db, {
            scheduleID: row.id,
            scheduleName: row.name,
            ownerSessionID: session.id,
            sessionID: session.id,
            run,
            status: "failed",
            attention: "needs_you",
            summary: note,
            error: outcome.error,
            now,
          })
          return
        }

        if (!outcome.wake) {
          const checks = row.checks + 1
          const ended = next === undefined || (row.ends_at !== null && next > row.ends_at)
          if (check.mode === "until" && ended) {
            const run = row.run_count + 1
            const timeoutNote = `[Schedule timed out without matching: ${ScheduleCheck.describe(check.condition)}]`
            const id = yield* admitWake(
              row,
              session.id,
              run,
              due,
              late,
              `${ScheduleAction.summaryText(row.action)}\n\n${timeoutNote}`,
              { expired: true },
            )
            yield* db
              .update(ScheduleTable)
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
              .where(eq(ScheduleTable.id, row.id))
              .run()
              .pipe(Effect.orDie)
            yield* ScheduleRuns.recordCompleted(db, {
              scheduleID: row.id,
              scheduleName: row.name,
              ownerSessionID: session.id,
              sessionID: session.id,
              run,
              status: "completed",
              attention: "needs_you",
              summary: timeoutNote,
              now,
            })
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

        yield* dispatchAction(row, session, row.run_count + 1, due, now, late, outcome.message, {
          checks: row.checks + 1,
          state: outcome.state,
        })
        return
      }

      yield* dispatchAction(row, session, row.run_count + 1, due, now, late, undefined, {})
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
      const skip = () => {
        const next = following(row, now)
        const done = finished(row, next, row.remaining_runs)
        return update(row, {
          last_outcome: "skipped",
          retry_at: null,
          status: done ? "done" : "active",
          next_due_at: done ? null : next,
          time_updated: now,
        })
      }
      if (row.active_job_id !== null) {
        const activeJob = yield* jobs.get(row.active_job_id)
        if (activeJob?.status === "running") {
          yield* skip()
          return
        }
      }
      if (row.dedicated_session_id !== null && (yield* execution.isActive(row.dedicated_session_id))) {
        yield* skip()
        return
      }
      if (!ScheduleAction.isBackground(row.action) && row.last_message_id !== null && (yield* pending(row.last_message_id))) {
        // The wake that followed admission may have been lost; waking again is harmless.
        yield* execution.wake(session.id)
        yield* skip()
        return
      }
      yield* fire(row, session, due, now)
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
              return Effect.logWarning("schedule failed to fire", { scheduleID: row.id, cause }).pipe(
                Effect.andThen(
                  update(row, { last_outcome: "failed", retry_at: now + FAILED_RETRY, time_updated: now }),
                ),
              )
            }),
          ),
        { discard: true, concurrency: due.length > 1 ? TICK_CONCURRENCY : 1 },
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
    // Session asleep, so wake every Session whose last scheduled prompt is still pending and clear stale job IDs.
    const rewake = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const tracked = yield* db
        .select({ id: ScheduleTable.id, activeJobID: ScheduleTable.active_job_id })
        .from(ScheduleTable)
        .where(isNotNull(ScheduleTable.active_job_id))
        .all()
        .pipe(Effect.orDie)
      const liveIDs: ID[] = []
      const staleIDs: ID[] = []
      for (const item of tracked) {
        if (item.activeJobID === null) continue
        const live = yield* jobs.get(item.activeJobID)
        if (live?.status === "running") liveIDs.push(item.id)
        else staleIDs.push(item.id)
      }
      yield* ScheduleRuns.clearOrphanedRunning(db, now, liveIDs)
      if (staleIDs.length > 0) {
        yield* db
          .update(ScheduleTable)
          .set({ active_job_id: null })
          .where(inArray(ScheduleTable.id, staleIDs))
          .run()
          .pipe(Effect.orDie)
      }
      const rows = yield* db
        .selectDistinct({ sessionID: SessionInboxTable.session_id })
        .from(ScheduleTable)
        .innerJoin(SessionInboxTable, eq(SessionInboxTable.id, ScheduleTable.last_message_id))
        .all()
        .pipe(Effect.orDie)
      yield* Effect.forEach(rows, (row) => execution.wake(row.sessionID), { discard: true })
    })

    const hasActiveRows = db
      .select({ id: ScheduleTable.id })
      .from(ScheduleTable)
      .where(or(eq(ScheduleTable.status, "active"), isNotNull(ScheduleTable.active_job_id)))
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
        yield* rewake.pipe(Effect.catchCause((cause) => Effect.logError("schedule rewake failed", { cause })))
      }
      if (!active) {
        yield* releaseLeader
        yield* doorbell.await.pipe(Effect.timeoutOption(MAX_SLEEP))
        return
      }
      yield* Effect.scoped(
        Effect.forkScoped(heartbeat).pipe(
          Effect.andThen(
            tickAt(now).pipe(Effect.catchCause((cause) => Effect.logError("schedule tick failed", { cause }))),
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
      create: Effect.fn("Schedule.create")(function* (input) {
        const session = yield* sessions.get(input.sessionID)
        const config = yield* settings(session).pipe(
          Effect.catchTag("FileSystem.DirectoryNotFoundError", () =>
            Effect.fail(new InvalidError({ reason: `Session directory does not exist: ${session.location.directory}` })),
          ),
        )
        if (!config.enabled) return yield* new DisabledError()
        yield* validateAction(input.action)
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
          return yield* new InvalidError({ reason: "The schedule ends before it first fires" })

        yield* ScheduleAction.authorize(session, input.name, when, input.action).pipe(
          instances.provide(session),
          Effect.mapError((error) => (typeof error === "string" ? new InvalidError({ reason: error }) : error)),
          Effect.catchTag("FileSystem.DirectoryNotFoundError", () =>
            Effect.fail(new InvalidError({ reason: `Session directory does not exist: ${session.location.directory}` })),
          ),
        )

        const scheduleID = ID.create()
        const seeded =
          check === undefined
            ? { matched: false as const, state: null as Schema.Json, checks: 0 }
            : yield* Effect.gen(function* () {
                yield* ScheduleCheck.authorize(session, input.name, when, check).pipe(
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
                const init = yield* ScheduleCheck.evaluate(session, check, null, {
                  messageID: SessionMessage.ID.make(`msg_${scheduleID}_check_0`),
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
          const inlinePrompt = !ScheduleAction.isBackground(input.action) && input.action.type === "prompt"
          const row = yield* db
            .insert(ScheduleTable)
            .values({
              id: scheduleID,
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
              run_count: inlinePrompt ? 1 : 0,
              ...(inlinePrompt ? { last_fired_at: now, last_outcome: "fired" as const } : {}),
              time_created: now,
              time_updated: now,
            })
            .returning()
            .get()
            .pipe(Effect.orDie)
          if (inlinePrompt) {
            yield* ScheduleRuns.recordCompleted(db, {
              scheduleID: row.id,
              scheduleName: row.name,
              ownerSessionID: session.id,
              sessionID: session.id,
              run: 1,
              status: "completed",
              attention: "quiet",
              summary: seeded.message ?? ScheduleAction.summaryText(input.action),
              read: true,
              now,
            })
            return toInfo(row, seeded.message)
          }
          yield* dispatchAction(row, session, 1, now, now, false, seeded.message, {
            checks: 1,
            state: seeded.state,
            forceDone: true,
          }).pipe(
            Effect.tapError(() =>
              db.delete(ScheduleTable).where(eq(ScheduleTable.id, scheduleID)).run().pipe(Effect.ignore),
            ),
            Effect.mapError((error) => new InvalidError({ reason: error.message })),
          )
          return toInfo(yield* find(scheduleID).pipe(Effect.orDie), seeded.message)
        }

        const remaining = check?.mode === "until" ? 1 : (input.ends?.times ?? null)
        const row = yield* db
          .insert(ScheduleTable)
          .values({
            id: scheduleID,
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
      list: Effect.fn("Schedule.list")(function* (input) {
        const rows = yield* db
          .select()
          .from(ScheduleTable)
          .where(input?.sessionID === undefined ? undefined : eq(ScheduleTable.session_id, input.sessionID))
          .orderBy(asc(ScheduleTable.time_created), asc(ScheduleTable.id))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => toInfo(row))
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
          .set({
            status: done ? "done" : "active",
            next_due_at: done ? null : next,
            failures: 0,
            retry_at: null,
            time_updated: now,
          })
          .where(and(eq(ScheduleTable.id, id), eq(ScheduleTable.status, "paused")))
          .run()
          .pipe(Effect.orDie)
        yield* doorbell.open
        return toInfo(yield* find(id))
      }),
      remove: Effect.fn("Schedule.remove")(function* (id) {
        const row = yield* find(id)
        if (row.active_job_id !== null) yield* jobs.cancel(row.active_job_id)
        yield* db.delete(ScheduleTable).where(eq(ScheduleTable.id, id)).run().pipe(Effect.orDie)
      }),
      runs: Effect.fn("Schedule.runs")(function* (input) {
        return yield* ScheduleRuns.listRuns(db, input)
      }),
      inbox: Effect.fn("Schedule.inbox")(function* (input) {
        return yield* ScheduleRuns.listInbox(db, input)
      }),
      getRun: Effect.fn("Schedule.getRun")(function* (runID) {
        const found = yield* ScheduleRuns.getRun(db, runID)
        if (found === undefined) return yield* new RunNotFoundError({ runID })
        return found
      }),
      markRead: Effect.fn("Schedule.markRead")(function* (runID) {
        const now = yield* Clock.currentTimeMillis
        const updated = yield* ScheduleRuns.markRead(db, runID, now)
        if (updated === undefined) return yield* new RunNotFoundError({ runID })
        return updated
      }),
      reportResult: Effect.fn("Schedule.reportResult")(function* (sessionID, input) {
        const nextInMs = input.nextIn === undefined ? undefined : yield* duration(input.nextIn)
        if (nextInMs !== undefined && nextInMs < MIN_CHECK_INTERVAL) {
          return yield* new InvalidError({ reason: "nextIn must be at least 15 seconds" })
        }
        const now = yield* Clock.currentTimeMillis
        const reported = yield* ScheduleRuns.reportResult(db, {
          sessionID,
          attention: input.attention,
          summary: input.summary,
          nextInMs,
          now,
        })
        if (reported === undefined) {
          return yield* new InvalidError({
            reason: "schedule_result can only be called during an active scheduled run",
          })
        }
        return reported
      }),
      enabled: Effect.fn("Schedule.enabled")(function* (sessionID) {
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
  deps: [Database.node, Session.node, SessionExecution.node, Instance.node, Job.node],
})
