export * as Automation from "./automation.js"

import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { and, asc, eq, gt, isNull, lte, min, ne, or, sql } from "drizzle-orm"
import { Cause, Clock, Context, Cron, DateTime, Effect, Latch, Layer, Option, Result, Schedule, Schema } from "effect"
import { Node, makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import {
  Action,
  ActionInput,
  type CodeAction,
  CreateInput,
  durationMillis,
  ID,
  Info,
  Outcome,
  type PromptAction,
  Request,
  runSessionID,
  Status,
  Target,
  Trigger,
} from "@opencode/schema/automation"
import type { ProjectID } from "@opencode/schema/project-id"
import { AbsolutePath } from "@opencode/schema/schema"
import { Agent } from "./agent.js"
import { AutomationCode } from "./automation/code.js"
import { AutomationTable } from "./automation/sql.js"
import { Config } from "./config.js"
import { Database } from "./database/database.js"
import { FileSystem } from "./filesystem.js"
import { Flag } from "./flag.js"
import { KVTable } from "./kv/sql.js"
import { LocationServiceMap } from "./location-service-map.js"
import { Permission } from "./permission.js"
import { Plugin } from "./plugin.js"
import { Project } from "./project.js"
import { Session } from "./session.js"
import { SessionExecution } from "./session/execution.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { SessionInboxTable } from "./session/sql.js"

export { Action, ActionInput, CreateInput, ID, Info, Outcome, Request, Status, Target, Trigger }

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

export interface ListInput {
  readonly sessionID?: SessionSchema.ID
  readonly projectID?: ProjectID
}

export interface Interface {
  readonly create: (
    input: CreateInput,
  ) => Effect.Effect<Info, InvalidError | DisabledError | Session.NotFoundError | Permission.Error>
  readonly list: (input?: ListInput) => Effect.Effect<Info[]>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly pause: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly resume: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError>
  /** Whether experimental.automations is on in the config of `directory`. */
  readonly enabled: (directory: string) => Effect.Effect<boolean, FileSystem.DirectoryNotFoundError>
  /** Runs every automation that is due now, at most once each. */
  readonly tick: Effect.Effect<void>
  /**
   * Runs `tick` whenever an automation falls due, until interrupted. Elects at most one active leader per SQLite
   * database via a lease row, so auxiliary processes (`opencode acp`, `--standalone`) sharing a data directory
   * never double-run alongside a managed service.
   */
  readonly run: Effect.Effect<never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Automation") {}

type Row = typeof AutomationTable.$inferSelect

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const MIN_PROMPT_INTERVAL = MINUTE
const MIN_CODE_INTERVAL = 15_000
/** A run this far past its due time is marked late. */
const LATE_AFTER = MINUTE
/** The loop re-reads the table at least this often, so clock jumps and missed doorbells are caught. */
const MAX_SLEEP = 30_000
const LEADER_KEY = "automation:leader"
const LEADER_TTL = 2 * MAX_SLEEP
/** How long a due automation waits before its location's flag is read again, while automations are off there. */
const DISABLED_RETRY = HOUR
/** How long an automation whose prompt failed waits before trying again. */
const FAILED_RETRY = 5 * MINUTE
/** How long an automation whose code failed waits before trying again, up to MAX_CODE_FAILURES. */
const CODE_FAILED_RETRY = MINUTE
const MAX_CODE_FAILURES = 3
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

const RELATIVE = /^in\s+(.+)$/i
const OFFSET = /\d(?:z|[+-]\d{2}:?\d{2})$/i

/** Parses "in 10 minutes", an instant with an offset, or a wall-clock time in `zone`. */
const parseTime = (raw: string, zone: DateTime.TimeZone, now: number) => {
  const input = raw.trim()
  const relative = RELATIVE.exec(input)
  if (relative) {
    return Option.flatMap(durationMillis(relative[1]), (delay) =>
      delay > 0 ? Option.some(now + delay) : Option.none(),
    )
  }
  return Option.map(
    OFFSET.test(input) ? DateTime.make(input) : DateTime.makeZoned(input, { timeZone: zone, adjustForTimeZone: true }),
    DateTime.toEpochMillis,
  )
}

const cronNext = Option.liftThrowable(Cron.next)

/**
 * The first slot strictly after `now`, or undefined if the expression never matches a date. When clocks fall back,
 * Cron.next maps a repeated wall-clock time to its first occurrence, which is already past during the repeated hour,
 * so no slot runs twice: step past each such slot until one lands after `now`.
 */
const nextCron = (cron: Cron.Cron, now: number, from = now): number | undefined => {
  const next = cronNext(cron, new Date(from))
  if (Option.isNone(next)) return undefined
  const at = next.value.getTime()
  return at > now ? at : nextCron(cron, now, at + HOUR)
}

/** The first slot strictly after `now`, or undefined for `at`. Missed slots are skipped, so downtime runs once. */
const following = (row: Pick<Row, "trigger" | "tz" | "next_due_at">, now: number) => {
  switch (row.trigger.type) {
    case "at":
      return undefined
    case "every": {
      // Keep the phase: skip every missed slot rather than running them in a burst.
      const every = millis(row.trigger.every)
      const due = row.next_due_at ?? now
      return due + (Math.floor((now - due) / every) + 1) * every
    }
    case "cron":
      return nextCron(Cron.parseUnsafe(row.trigger.cron, row.tz), now)
  }
}

const finished = (row: Pick<Row, "expires_at">, next: number | undefined) =>
  next === undefined || (row.expires_at !== null && next > row.expires_at)

const expired = (row: Pick<Row, "expires_at">, now: number) => row.expires_at !== null && now > row.expires_at

const optionalTime = (value: number | null) => (value === null ? undefined : DateTime.makeUnsafe(value))

const toInfo = (row: Row): Info => ({
  id: row.id,
  name: row.name,
  projectID: row.project_id,
  sessionID: row.session_id ?? undefined,
  directory: row.directory,
  trigger: row.trigger,
  tz: row.tz,
  action: row.action,
  expires: optionalTime(row.expires_at),
  status: row.status,
  nextDueAt: optionalTime(row.next_due_at),
  runCount: row.run_count,
  lastRunAt: optionalTime(row.last_run_at),
  lastOutcome: row.last_outcome ?? undefined,
  lastOutput: row.last_output ?? undefined,
  state: row.state ?? undefined,
  time: { created: DateTime.makeUnsafe(row.time_created), updated: DateTime.makeUnsafe(row.time_updated) },
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const sessions = yield* Session.Service
    const projects = yield* Project.Service
    const locations = yield* LocationServiceMap.Service
    const execution = yield* SessionExecution.Service
    const doorbell = yield* Latch.make()

    /**
     * The agent a run's child Session starts with, if `owner` could start it with the subagent tool: not hidden, not
     * primary-only, and not denied by the `subagent` permission. Waits for plugins, which add agents, so a cold
     * location doesn't read as a missing agent.
     */
    const subagent = (owner: SessionSchema.Info, id: Agent.ID) =>
      Effect.gen(function* () {
        yield* Plugin.awaitActivation
        const agents = yield* Agent.Service
        const agent = yield* agents.resolve(id)
        if (agent === undefined || agent.mode === "primary" || agent.hidden) return undefined
        const permission = yield* Permission.Service
        const denied = yield* permission
          .assertNotDenied({
            action: "subagent",
            resources: [agent.id],
            sessionID: owner.id,
            agent: (yield* agents.select(owner.agent)).id,
          })
          .pipe(
            Effect.as(false),
            Effect.catchTag("Permission.BlockedError", () => Effect.succeed(true)),
          )
        return denied ? undefined : agent
      })

    /** Runs `effect` in the Location of `directory`; fails with DirectoryNotFoundError when the folder is gone. */
    const inDirectory =
      (directory: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.provide(effect, locations.get(LocationServiceMap.canonical({ directory: AbsolutePath.make(directory) })))

    // Config is per location, so an automation follows the config of the directory it runs in.
    const settings = (directory: string) =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        const flags = yield* Flag.Service
        const entries = yield* config.entries()
        return {
          enabled: flags.resolve(entries).automations.enabled,
          timezone: Config.latest(entries, "timezone"),
        }
      }).pipe(inDirectory(directory))

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

    /**
     * Writes what came of running `row`, but only while its run_count is the one that was read: if another process
     * has recorded a run since, as after a leader handoff mid-run, this write would clobber its state or count the
     * run twice. A pause that landed meanwhile wins too, except with `evenIfPaused`, for a run that already happened:
     * that is still counted, and the automation stays paused unless the run was its last.
     */
    const settle = (row: Row, values: Partial<Row>, options?: { readonly evenIfPaused: boolean }) =>
      db
        .update(AutomationTable)
        .set(values)
        .where(
          and(
            eq(AutomationTable.id, row.id),
            eq(AutomationTable.run_count, row.run_count),
            options?.evenIfPaused ? ne(AutomationTable.status, "done") : eq(AutomationTable.status, "active"),
          ),
        )
        .run()
        .pipe(Effect.orDie)

    const pauseWith = (row: Row, now: number, reason: string) =>
      settle(
        row,
        { status: "paused", last_outcome: "failed", last_output: reason, retry_at: null, time_updated: now },
        { evenIfPaused: true },
      )

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

    const existing = (sessionID: SessionSchema.ID) =>
      sessions.get(sessionID).pipe(Effect.catchTag("Session.NotFoundError", () => Effect.undefined))

    /** A finished run's next slot, after the time it finished so a slow run doesn't trigger a burst, or done. */
    const advance = Effect.fnUntraced(function* (row: Row, done = false) {
      const next = following(row, yield* Clock.currentTimeMillis)
      const ended = done || finished(row, next)
      return { ...(ended ? { status: "done" as const } : {}), next_due_at: ended ? null : next }
    })

    const runPrompt = Effect.fnUntraced(function* (row: Row, action: PromptAction, due: number, now: number) {
      const run = row.run_count + 1
      const fire = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
        // The id is derived from the run, so retrying it after a crash reconciles with the earlier admission.
        const id = SessionMessage.ID.make(`msg_${row.id}_${run}`)
        const late = now - due >= LATE_AFTER
        yield* sessions.prompt({
          sessionID,
          id,
          text: action.prompt,
          delivery: "steer",
          metadata: { automation: { id: row.id, name: row.name, run, dueAt: due, late } },
        })
        // Record the run even if a pause landed during the prompt, or the next run would reuse this message id.
        yield* settle(
          row,
          {
            run_count: run,
            last_message_id: id,
            last_run_at: now,
            last_outcome: late ? "late" : "fired",
            last_output: `${action.to.session === undefined ? "Started subagent" : "Prompted"} ${sessionID}`,
            retry_at: null,
            ...(yield* advance(row)),
            time_updated: now,
          },
          { evenIfPaused: true },
        )
      })

      if (action.to.session !== undefined) {
        const target = yield* existing(action.to.session)
        if (!target) return yield* pauseWith(row, now, `Target session ${action.to.session} no longer exists`)
        if (target.projectID !== row.project_id)
          return yield* pauseWith(row, now, `Target session ${action.to.session} moved to another project`)
        if (row.last_message_id !== null && (yield* pending(row.last_message_id))) {
          // The wake that followed admission may have been lost; waking again is harmless.
          yield* execution.wake(target.id)
          return yield* settle(row, {
            last_outcome: "skipped",
            retry_at: null,
            ...(yield* advance(row)),
            time_updated: now,
          })
        }
        return yield* fire(target.id)
      }

      // The child hangs off the creating Session, so a run needs that Session.
      const owner = row.session_id === null ? undefined : yield* existing(row.session_id)
      if (!owner) return yield* pauseWith(row, now, "The session that created this automation no longer exists")
      if (owner.projectID !== row.project_id)
        return yield* pauseWith(row, now, "The session that created this automation moved to another project")
      const agent = yield* subagent(owner, action.to.subagent).pipe(inDirectory(row.directory))
      if (agent === undefined)
        return yield* pauseWith(row, now, `Agent ${action.to.subagent} is no longer available as a subagent`)
      // The id is derived from the run too, so a retry adopts the child it already started instead of leaking one.
      // Like the subagent tool's children it inherits the parent's location and permissions, but it reports to no one.
      const child = yield* sessions.create({
        id: runSessionID(row.id, run),
        parentID: owner.id,
        agent: agent.id,
        model: agent.model ?? owner.model,
        title: row.name,
      })
      yield* fire(child.id)
    })

    const runCode = Effect.fnUntraced(function* (row: Row, action: CodeAction, due: number, now: number) {
      // The tools were authorized for the creating Session's agent and permissions, so a run needs that Session.
      const owner = row.session_id === null ? undefined : yield* existing(row.session_id)
      if (!owner)
        return yield* pauseWith(row, now, `The session that authorized this automation's tools no longer exists`)
      const run = row.run_count + 1
      const outcome = yield* AutomationCode.run(owner, action, {
        messageID: SessionMessage.ID.make(`msg_${row.id}_${run}`),
        state: row.state,
        now,
        runs: row.run_count,
      }).pipe(inDirectory(row.directory))
      const ended = yield* Clock.currentTimeMillis

      if (!outcome.ok) {
        // State is kept: only a successful run replaces it.
        const strikes = row.failures + 1
        const output = outcome.output === undefined ? outcome.error : `${outcome.output}\n${outcome.error}`
        if (!outcome.invalid && strikes < MAX_CODE_FAILURES) {
          return yield* settle(row, {
            failures: strikes,
            last_outcome: "failed",
            last_output: output,
            retry_at: ended + CODE_FAILED_RETRY,
            time_updated: ended,
          })
        }
        return yield* settle(
          row,
          {
            status: "paused",
            failures: strikes,
            last_run_at: now,
            last_outcome: "failed",
            last_output: outcome.invalid ? `Paused: ${output}` : `Paused after ${strikes} failed runs: ${output}`,
            retry_at: null,
            time_updated: ended,
          },
          { evenIfPaused: true },
        )
      }

      yield* settle(
        row,
        {
          run_count: run,
          failures: 0,
          ...(outcome.state === undefined ? {} : { state: outcome.state }),
          last_run_at: now,
          last_outcome: now - due >= LATE_AFTER ? "late" : "fired",
          last_output: outcome.output ?? null,
          retry_at: null,
          ...(yield* advance(row, outcome.done)),
          time_updated: ended,
        },
        { evenIfPaused: true },
      )
    })

    /** Runs one due automation, after the checks both kinds of action share: leadership, expiry and the flag. */
    const runDue = Effect.fnUntraced(function* (row: Row, now: number) {
      const due = row.next_due_at
      if (due === null) return
      // Claimed for each run, not once per tick: the lease may have passed to another process since the tick began.
      if (!(yield* claimLeader(yield* Clock.currentTimeMillis))) return
      // A slot that only comes up late, after the automation expired (downtime, a retry), never runs.
      if (expired(row, now) && now - due >= LATE_AFTER) {
        return yield* settle(row, {
          status: "done",
          next_due_at: null,
          last_outcome: "expired",
          retry_at: null,
          time_updated: now,
        })
      }
      if (!(yield* settings(row.directory)).enabled) {
        // Reading the flag boots the location, so check again in an hour rather than every tick. The row keeps its
        // due time, so once the flag is back on it catches up like any missed slot.
        yield* settle(row, { last_outcome: "disabled", retry_at: now + DISABLED_RETRY, time_updated: now })
        return
      }
      switch (row.action.type) {
        case "prompt":
          return yield* runPrompt(row, row.action, due, now)
        case "code":
          return yield* runCode(row, row.action, due, now)
      }
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
          runDue(row, now).pipe(
            Effect.catchCause((cause) => {
              if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
              const error = Cause.squash(cause)
              // The folder (e.g. a removed worktree) is gone; pause rather than retrying every 5 minutes.
              if (error instanceof FileSystem.DirectoryNotFoundError)
                return pauseWith(row, now, `Directory no longer exists: ${row.directory}`)
              // Back off rather than retrying a failing run on every tick.
              return Effect.logWarning("automation failed to run", { automationID: row.id, cause }).pipe(
                Effect.andThen(
                  settle(row, {
                    last_outcome: "failed",
                    last_output: error instanceof Error ? error.message : String(error),
                    retry_at: now + FAILED_RETRY,
                    time_updated: now,
                  }),
                ),
              )
            }),
          ),
        { discard: true, concurrency: due.length > 1 ? TICK_CONCURRENCY : 1 },
      )
    }, Effect.withSpan("Automation.tick"))

    const tick = Effect.flatMap(Clock.currentTimeMillis, tickAt)

    // Rows due by `from` that could not run (a failed prompt, a retry_at not yet reached) are rechecked after at most
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
    // Session asleep, so wake every Session whose last automation prompt is still pending.
    const rewake = db
      .selectDistinct({ sessionID: SessionInboxTable.session_id })
      .from(AutomationTable)
      .innerJoin(SessionInboxTable, eq(SessionInboxTable.id, AutomationTable.last_message_id))
      .all()
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) => Effect.forEach(rows, (row) => execution.wake(row.sessionID), { discard: true })),
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
    // Whether this process held the lease on its last pass. Taking the lease is when `rewake` runs.
    let leading = false
    // The first pass claims the lease even with nothing active: an automation that has since finished may have left a
    // prompt pending.
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
      Effect.schedule(Schedule.spaced(LEADER_TTL / 3)),
    )

    /** Sleeps until the doorbell rings (an automation was created or resumed) or MAX_SLEEP passes. */
    const idle = doorbell.await.pipe(Effect.timeoutOption(MAX_SLEEP))

    const loop = Effect.gen(function* () {
      yield* doorbell.close
      const active = yield* hasActiveRows
      if (!active && bootChecked) {
        if (leading) yield* releaseLeader
        yield* idle
        return
      }
      const now = yield* Clock.currentTimeMillis
      const isLeader = yield* claimLeader(now)
      if (!isLeader) {
        leading = false
        bootChecked = true
        yield* idle
        return
      }
      if (!leading) {
        leading = true
        bootChecked = true
        yield* rewake.pipe(Effect.catchCause((cause) => Effect.logError("automation rewake failed", { cause })))
      }
      if (!active) {
        yield* releaseLeader
        yield* idle
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
        yield* idle
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

    /** The trigger as stored, with a relative `at` fixed to an instant, and its first due time. */
    const firstDue = Effect.fnUntraced(function* (
      trigger: Trigger,
      action: ActionInput,
      zone: DateTime.TimeZone,
      now: number,
    ) {
      switch (trigger.type) {
        case "at": {
          const at = parseTime(trigger.at, zone, now)
          if (Option.isNone(at)) return yield* new InvalidError({ reason: `Invalid time: ${trigger.at}` })
          if (at.value <= now) return yield* new InvalidError({ reason: `Time is in the past: ${trigger.at}` })
          const stored: Trigger = RELATIVE.test(trigger.at.trim())
            ? { type: "at", at: new Date(at.value).toISOString(), tz: trigger.tz }
            : trigger
          return { trigger: stored, due: at.value }
        }
        case "every": {
          const every = yield* duration(trigger.every)
          const code = action.type === "code"
          if (every < (code ? MIN_CODE_INTERVAL : MIN_PROMPT_INTERVAL)) {
            return yield* new InvalidError({
              reason: code ? "every must be at least 15 seconds" : "every must be at least 1 minute",
            })
          }
          return { trigger, due: now + every }
        }
        case "cron": {
          const cron = Cron.parse(trigger.cron, zone)
          if (Result.isFailure(cron)) return yield* new InvalidError({ reason: cron.failure.message })
          if (cron.success.seconds.size !== 1)
            return yield* new InvalidError({ reason: "cron must run at most once a minute" })
          const next = nextCron(cron.success, now)
          if (next === undefined) return yield* new InvalidError({ reason: `cron never runs: ${trigger.cron}` })
          return { trigger, due: next }
        }
      }
    })

    /** Resolves a prompt's target and checks a code action, both in the automation's directory. */
    const resolveAction = Effect.fnUntraced(function* (
      input: CreateInput,
      owner: SessionSchema.Info | undefined,
      trigger: Trigger,
      directory: string,
      projectID: ProjectID,
    ) {
      const action = input.action
      if (action.type === "prompt") {
        const to = action.to ?? (owner === undefined ? undefined : { session: owner.id })
        if (to === undefined)
          return yield* new InvalidError({ reason: "A prompt action needs `to` when there is no session" })
        // Another project's Session is out of reach, as it is for the automation tools.
        if (to.session !== undefined && (yield* sessions.get(to.session)).projectID !== projectID)
          return yield* new InvalidError({ reason: `Session ${to.session} is in another project` })
        if (to.subagent !== undefined) {
          // The child of each run hangs off the creating Session.
          if (owner === undefined)
            return yield* new InvalidError({ reason: "A prompt to a subagent needs a session to be its parent" })
          const agent = yield* subagent(owner, to.subagent).pipe(inDirectory(directory))
          if (agent === undefined)
            return yield* new InvalidError({
              reason: `Unknown agent, or one that can't run as a subagent: ${to.subagent}`,
            })
        }
        return { type: "prompt" as const, prompt: action.prompt, to }
      }
      // Tool permissions are asked in, and checked against, the creating Session.
      if (owner === undefined) return yield* new InvalidError({ reason: "A code action needs a session" })
      const code = { type: "code" as const, code: action.code, args: action.args }
      yield* AutomationCode.authorize(owner, input.name, trigger, code).pipe(
        inDirectory(directory),
        Effect.mapError((error) => (typeof error === "string" ? new InvalidError({ reason: error }) : error)),
      )
      return code
    })

    return Service.of({
      create: Effect.fn("Automation.create")(function* (input) {
        const owner = input.sessionID === undefined ? undefined : yield* sessions.get(input.sessionID)
        const directory = owner?.location.directory ?? input.directory ?? os.homedir()
        if (!path.isAbsolute(directory))
          return yield* new InvalidError({ reason: `Directory must be an absolute path: ${directory}` })
        const missingDirectory = () =>
          Effect.fail(new InvalidError({ reason: `Directory does not exist: ${directory}` }))
        const config = yield* settings(directory).pipe(
          Effect.catchTag("FileSystem.DirectoryNotFoundError", missingDirectory),
        )
        if (!config.enabled) return yield* new DisabledError()
        const zone = yield* resolveZone(input.trigger.tz ?? config.timezone)
        const now = yield* Clock.currentTimeMillis
        const first = yield* firstDue(input.trigger, input.action, zone, now)
        const expiresAt =
          input.expires === undefined
            ? null
            : yield* Option.match(parseTime(input.expires, zone, now), {
                onNone: () => Effect.fail(new InvalidError({ reason: `Invalid time: ${input.expires}` })),
                onSome: Effect.succeed,
              })
        if (expiresAt !== null && first.due > expiresAt)
          return yield* new InvalidError({ reason: "The automation expires before it first runs" })
        const projectID = owner?.projectID ?? (yield* projects.resolve(AbsolutePath.make(directory))).id
        const action = yield* resolveAction(input, owner, first.trigger, directory, projectID).pipe(
          Effect.catchTag("FileSystem.DirectoryNotFoundError", missingDirectory),
        )

        const row = yield* db
          .insert(AutomationTable)
          .values({
            id: ID.create(),
            project_id: projectID,
            session_id: owner?.id ?? null,
            directory,
            name: input.name,
            trigger: first.trigger,
            tz: DateTime.zoneToString(zone),
            action,
            next_due_at: first.due,
            expires_at: expiresAt,
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
          .where(
            and(
              input?.sessionID === undefined ? undefined : eq(AutomationTable.session_id, input.sessionID),
              input?.projectID === undefined ? undefined : eq(AutomationTable.project_id, input.projectID),
            ),
          )
          .orderBy(asc(AutomationTable.time_created), asc(AutomationTable.id))
          .all()
          .pipe(Effect.orDie)
        return rows.map(toInfo)
      }),
      get: Effect.fn("Automation.get")(function* (id) {
        return toInfo(yield* find(id))
      }),
      pause: Effect.fn("Automation.pause")(function* (id) {
        const row = yield* find(id)
        if (row.status !== "active") return toInfo(row)
        yield* db
          .update(AutomationTable)
          .set({ status: "paused", time_updated: yield* Clock.currentTimeMillis })
          .where(and(eq(AutomationTable.id, id), eq(AutomationTable.status, "active")))
          .run()
          .pipe(Effect.orDie)
        return toInfo(yield* find(id))
      }),
      resume: Effect.fn("Automation.resume")(function* (id) {
        const row = yield* find(id)
        if (row.status !== "paused") return toInfo(row)
        const now = yield* Clock.currentTimeMillis
        // An `at` that fell due while paused runs once, late, unless it has expired; a repeating automation resumes at
        // its next slot.
        const next =
          row.next_due_at === null || row.next_due_at > now ? row.next_due_at : (following(row, now) ?? row.next_due_at)
        const done = next === null || finished(row, next) || expired(row, now)
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
      enabled: (directory) => settings(directory).pipe(Effect.map((value) => value.enabled)),
      tick,
      run,
    })
  }),
)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Session.node, SessionExecution.node, Project.node, LocationServiceMap.node],
})
