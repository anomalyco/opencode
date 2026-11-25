export * as Automation from "./automation.js"

import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { and, asc, eq, gt, isNotNull, isNull, lte, min, ne, or, sql } from "drizzle-orm"
import {
  Cause,
  Clock,
  Context,
  Cron,
  DateTime,
  Deferred,
  Effect,
  FiberMap,
  Latch,
  Layer,
  Option,
  Result,
  Schedule,
  Schema,
  Semaphore,
  Stream,
} from "effect"
import { Node, makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import {
  Action,
  ActionInput,
  CreateInput,
  durationMillis,
  ID,
  Info,
  Outcome,
  Request,
  runSessionID,
  Status,
  Target,
  Trigger,
} from "@opencode/schema/automation"
import type { ProjectID } from "@opencode/schema/project-id"
import { AbsolutePath } from "@opencode/schema/schema"
import { Agent } from "./agent.js"
import { type Invocation, matchesAuthor } from "./automation/author.js"
import { AutomationCode } from "./automation/code.js"
import { AutomationEvent } from "./automation/event.js"
import { AutomationShell } from "./automation/shell.js"
import { AutomationTable } from "./automation/sql.js"
import { Config } from "./config.js"
import { Database } from "./database/database.js"
import { FileSystem } from "./filesystem.js"
import { Instance } from "./instance/service.js"
import { KVTable } from "./kv/sql.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { Permission } from "./permission.js"
import { Plugin } from "./plugin/service.js"
import { Project } from "./project.js"
import { Session } from "./session.js"
import { SessionExecution } from "./session/execution.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { SessionInboxTable } from "./session/sql.js"
import { SubagentDepth } from "./session/subagent-depth.js"
import { ShellResult } from "./shell/result.js"

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
    return "Automations are disabled. Set automations to true in config to enable them."
  }
}

export interface ListInput {
  readonly sessionID?: SessionSchema.ID
  readonly projectID?: ProjectID
  /** Only automations in the project that owns this absolute directory, or that ran in it. */
  readonly directory?: string
}

export interface Interface {
  readonly create: (
    input: CreateInput,
    invocation?: Invocation,
  ) => Effect.Effect<Info, InvalidError | DisabledError | Session.NotFoundError | Permission.Error>
  /** Oldest first, leaving out automations whose directory has automations off. */
  readonly list: (input?: ListInput) => Effect.Effect<Info[], InvalidError | DisabledError | Session.NotFoundError>
  /**
   * These fail with DisabledError when the automation's directory has automations off. `get` with a `projectID`
   * treats an automation in another project as missing, whatever its directory's config.
   */
  readonly get: (
    id: ID,
    options?: { readonly projectID?: ProjectID },
  ) => Effect.Effect<Info, NotFoundError | DisabledError>
  readonly pause: (id: ID) => Effect.Effect<Info, NotFoundError | DisabledError>
  readonly resume: (id: ID) => Effect.Effect<Info, NotFoundError | DisabledError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError | DisabledError>
  /** Whether automations are enabled in the config of `directory`. */
  readonly enabled: (directory: string) => Effect.Effect<boolean, FileSystem.DirectoryNotFoundError>
  /** Runs every automation that is due now, at most once each. */
  readonly tick: Effect.Effect<void>
  /**
   * Owns timer ticks and MCP subscriptions until interrupted. A SQLite lease elects one scheduler per database.
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
/** How long a due automation waits before reading config again while automations are disabled there. */
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

const deliverySummary = (sessionID: SessionSchema.ID, subagent?: Agent.ID) =>
  `${subagent === undefined ? "Prompted" : "Started subagent"} ${sessionID}`

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
    const fs = yield* FSUtil.Service
    const sessions = yield* Session.Service
    const projects = yield* Project.Service
    const locations = yield* LocationServiceMap.Service
    const instances = yield* Instance.Service
    const execution = yield* SessionExecution.Service
    const scope = yield* Effect.scope
    const doorbell = yield* Latch.make()
    const watches = yield* FiberMap.make<ID>()

    /**
     * The agent a run's child Session starts with, if `owner` could start it with the subagent tool: not hidden, not
     * primary-only, within the depth limit and already allowed in the owner's current Location. The code/tools
     * authorized when the automation was created do not grant permission to start a child.
     */
    const subagent = (owner: SessionSchema.Info, id: Agent.ID, invocation?: Invocation) =>
      Effect.gen(function* () {
        yield* Plugin.awaitActivation
        const location = yield* Location.Service
        if (location.project.id !== owner.projectID)
          return yield* new InvalidError({ reason: "The creating session's location is no longer in its project" })
        const config = yield* Config.Service
        const limit = yield* SubagentDepth.reached(owner, sessions, config)
        if (limit !== undefined) return yield* new InvalidError({ reason: `Subagent depth limit reached (${limit})` })
        const agents = yield* Agent.Service
        const agent = yield* agents.resolve(id)
        if (!agent) return yield* new InvalidError({ reason: `Unknown subagent: ${id}` })
        if (agent.hidden) return yield* new InvalidError({ reason: `Subagent ${id} is hidden` })
        if (agent.mode === "primary") return yield* new InvalidError({ reason: `Agent ${id} is primary-only` })
        const creator = yield* agents.resolve(owner.agent)
        if (!creator)
          return yield* new InvalidError({
            reason: `Creating session's agent not found: ${owner.agent ?? "(default)"}`,
          })
        if (invocation && !matchesAuthor(owner, creator, invocation))
          return yield* new InvalidError({ reason: "Create the automation with the session's current agent" })
        const permission = yield* Permission.Service
        yield* permission
          .assert({
            action: "subagent",
            resources: [agent.id],
            ...(invocation ?? { sessionID: owner.id, agent: creator.id }),
          })
          .pipe(
            // Only consulted for an ask. Never borrow an ambient grant, even if a hook turned a config allow into an ask.
            Effect.provideService(Permission.Unattended, [{ action: "subagent", resource: "*", effect: "deny" }]),
            Effect.catchTag(
              "Permission.BlockedError",
              (error) => new InvalidError({ reason: `Cannot start subagent ${id}: ${error.message}` }),
            ),
          )
        return agent
      }).pipe(instances.provide(owner))

    /** Runs `effect` in the Location of `directory`; fails with DirectoryNotFoundError when the folder is gone. */
    const inDirectory =
      (directory: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.provide(effect, locations.get(LocationServiceMap.canonical({ directory: AbsolutePath.make(directory) })))

    // Config is per location, so an automation follows the config of the directory it runs in.
    const settings = (directory: string) =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        const entries = yield* config.entries()
        return {
          enabled: Config.latest(entries, "automations") ?? true,
          timezone: Config.latest(entries, "timezone"),
        }
      }).pipe(inDirectory(directory))

    // An automation whose folder is gone stays manageable, so it can be inspected and deleted.
    const visible = (directory: string) =>
      settings(directory).pipe(
        Effect.map((value) => value.enabled),
        Effect.catchTag("FileSystem.DirectoryNotFoundError", () => Effect.succeed(true)),
      )

    /**
     * The row of an automation callers may manage: it exists, is in `projectID` when given, and its directory has
     * automations on. Ownership is checked first so another project's config is never read.
     */
    const findVisible = (id: ID, projectID?: ProjectID) =>
      Effect.gen(function* () {
        const row = yield* find(id)
        if (projectID !== undefined && row.project_id !== projectID)
          return yield* new NotFoundError({ automationID: id })
        if (!(yield* visible(row.directory))) return yield* new DisabledError()
        return row
      })

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

    /** Advance a successful run's cursor or timer. A slow timer skips slots it missed while running. */
    const advance = (row: Row, ended: number, done = false, event?: AutomationEvent.Message) => {
      if (event && row.event_position)
        return {
          ...(done ? { status: "done" as const } : {}),
          event_position: { ...row.event_position, cursor: event.position.cursor },
        }
      const next = following(row, ended)
      return done || finished(row, next) ? { status: "done" as const, next_due_at: null } : { next_due_at: next }
    }

    const promptTarget = Effect.fnUntraced(function* (row: Row, to: Target) {
      if (to.session !== undefined) {
        const target = yield* existing(to.session)
        if (!target) return yield* new InvalidError({ reason: `Target session ${to.session} no longer exists` })
        if (target.projectID !== row.project_id)
          return yield* new InvalidError({ reason: `Target session ${to.session} moved to another project` })
        return target.id
      }

      // The child hangs off the creating Session, so a run needs that Session.
      const owner = row.session_id === null ? undefined : yield* existing(row.session_id)
      if (!owner)
        return yield* new InvalidError({ reason: "The session that created this automation no longer exists" })
      if (owner.projectID !== row.project_id)
        return yield* new InvalidError({ reason: "The session that created this automation moved to another project" })
      const agent = yield* subagent(owner, to.subagent)
      // The id is derived from the run too, so a retry adopts the child it already started instead of leaking one.
      // Like the subagent tool's children it inherits the parent's location and permissions, but it reports to no one.
      const child = yield* sessions.create({
        id: runSessionID(row.id, row.run_count + 1),
        parentID: owner.id,
        agent: agent.id,
        model: agent.model ?? owner.model,
        title: row.name,
      })
      // Session.create adopts an existing ID, even if its caller requested a different parent or agent.
      if (child.parentID !== owner.id || child.agent !== agent.id || child.projectID !== row.project_id)
        return yield* new InvalidError({ reason: `Run child ${child.id} has a different parent, agent or project` })
      if (!isDeepStrictEqual(child.location, owner.location))
        return yield* new InvalidError({ reason: `Run child ${child.id} is no longer in the creator's location` })
      if (!isDeepStrictEqual(child.permissions, owner.permissions))
        return yield* new InvalidError({ reason: `Run child ${child.id} no longer matches the creator's permissions` })
      return child.id
    })

    const codeFailed = Effect.fnUntraced(function* (
      row: Row,
      now: number,
      outcome: Extract<AutomationCode.Outcome, { ok: false }>,
    ) {
      const ended = yield* Clock.currentTimeMillis
      const strikes = row.failures + 1
      // Preserve the diagnostic even when logs alone would fill the budget.
      const reason = outcome.output === undefined ? outcome.error : `${outcome.error}\n${outcome.output}`
      const output = (prefix = "") => AutomationCode.boundedOutput(prefix + reason)
      if (row.trigger.type === "event") return yield* pauseWith(row, now, output())
      if (!outcome.invalid && strikes < MAX_CODE_FAILURES) {
        return yield* settle(row, {
          failures: strikes,
          last_outcome: "failed",
          last_output: output(),
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
          last_output: output(outcome.invalid ? "Paused: " : `Paused after ${strikes} failed runs: `),
          retry_at: null,
          time_updated: ended,
        },
        { evenIfPaused: true },
      )
    })

    const runShell = Effect.fnUntraced(function* (
      row: Row,
      action: Extract<Action, { type: "shell" }>,
      now: number,
      event?: AutomationEvent.Message,
    ) {
      const run = row.run_count + 1
      const owner = row.session_id === null ? undefined : yield* existing(row.session_id)
      if (!owner) return yield* pauseWith(row, now, "The session that authorized this command no longer exists")
      const missingDirectory = () => pauseWith(row, now, `Directory no longer exists: ${row.directory}`)
      // The saved Location may still be cached after its directory is removed.
      if (!(yield* fs.isDir(row.directory))) return yield* missingDirectory()

      const admitted = yield* Deferred.make<void, FileSystem.DirectoryNotFoundError>()
      yield* Effect.gen(function* () {
        const started = yield* AutomationShell.start(owner, action, row.directory).pipe(Effect.result)

        // Advance on launch, so the next timer slot or event can start before this command exits.
        yield* settle(
          row,
          {
            run_count: run,
            last_run_at: now,
            retry_at: null,
            ...advance(row, now, false, event),
            time_updated: now,
          },
          { evenIfPaused: true },
        )
        yield* Deferred.succeed(admitted, undefined)

        const captured = Result.isSuccess(started) ? ShellResult.output(yield* started.success) : undefined
        const output = captured
          ? `Exit code: ${captured.exit ?? "unknown"}\n${captured.output}`
          : Result.isFailure(started)
            ? started.failure.message
            : ""
        // A late completion must not replace a newer run's result or the reason the automation paused.
        yield* db
          .update(AutomationTable)
          .set({
            last_outcome: captured?.exit === 0 ? "fired" : "failed",
            last_output: AutomationCode.boundedOutput(output),
            time_updated: yield* Clock.currentTimeMillis,
          })
          .where(
            and(
              eq(AutomationTable.id, row.id),
              eq(AutomationTable.run_count, run),
              ne(AutomationTable.status, "paused"),
            ),
          )
          .run()
          .pipe(Effect.orDie)
      }).pipe(
        Effect.asVoid,
        inDirectory(row.directory),
        Effect.onExit((exit) => Deferred.done(admitted, exit)),
        Effect.forkIn(scope),
      )
      return yield* Deferred.await(admitted).pipe(
        Effect.catchTag("FileSystem.DirectoryNotFoundError", missingDirectory),
      )
    })

    const runAction = Effect.fnUntraced(
      function* (row: Row, now: number, event?: AutomationEvent.Message) {
        const action = row.action
        if (action.type === "shell") return yield* runShell(row, action, now, event)
        const run = row.run_count + 1
        const dueAt = row.next_due_at ?? now
        const late = now - dueAt >= LATE_AFTER
        const id = `msg_${row.id}_${run}`
        // Commit the action result and advance the cursor or timer together, only after any handoff is durable.
        const complete = Effect.fnUntraced(function* (
          values: Pick<Row, "last_output"> & Partial<Pick<Row, "state" | "failures" | "last_message_id">>,
          done = false,
        ) {
          const ended = yield* Clock.currentTimeMillis
          yield* settle(
            row,
            {
              ...values,
              run_count: run,
              last_run_at: now,
              last_outcome: late ? "late" : "fired",
              retry_at: null,
              ...advance(row, ended, done, event),
              time_updated: action.type === "code" ? ended : now,
            },
            { evenIfPaused: true },
          )
        })

        const admit = (
          sessionID: SessionSchema.ID,
          text: string,
          values: Parameters<typeof complete>[0],
          done = false,
        ) => {
          // A code action's unsuffixed ID identifies its tool calls, not its returned prompt.
          const messageID = SessionMessage.ID.make(action.type === "code" ? `${id}_send` : id)
          return sessions.prompt(
            {
              sessionID,
              id: messageID,
              text,
              delivery: "steer",
              metadata: { automation: { id: row.id, name: row.name, run, dueAt, late } },
            },
            complete({ ...values, last_message_id: messageID }, done),
          )
        }

        if (action.type === "prompt") {
          const text = event ? AutomationEvent.prompt(action.prompt, event) : action.prompt
          // One oversized event is skipped, so the watch moves past it instead of stopping on it.
          if (event && Buffer.byteLength(text) > 32_768)
            return yield* settle(row, {
              last_outcome: "skipped",
              last_output: "Event prompt exceeds 32 KiB",
              retry_at: null,
              ...advance(row, now, false, event),
              time_updated: now,
            })
          const target = yield* promptTarget(row, action.to)
          // Only an unchanging timer prompt can be coalesced. Re-wake it in case the first wake was lost.
          if (!event && action.to.session && row.last_message_id && (yield* pending(row.last_message_id))) {
            yield* execution.wake(target)
            return yield* settle(row, {
              last_outcome: "skipped",
              retry_at: null,
              ...advance(row, yield* Clock.currentTimeMillis),
              time_updated: now,
            })
          }
          return yield* admit(target, text, { last_output: deliverySummary(target, action.to.subagent) })
        }

        // The tools were authorized for the creating Session's agent and permissions, so a run needs that Session.
        const owner = row.session_id === null ? undefined : yield* existing(row.session_id)
        if (!owner)
          return yield* pauseWith(row, now, `The session that authorized this automation's tools no longer exists`)
        if (owner.projectID !== row.project_id)
          return yield* pauseWith(
            row,
            now,
            "The session that authorized this automation's tools moved to another project",
          )
        const outcome = yield* AutomationCode.run(owner, action, {
          automationID: row.id,
          messageID: SessionMessage.ID.make(id),
          state: row.state,
          now,
          runs: row.run_count,
          ...(event && { event: AutomationEvent.input(event) }),
        }).pipe(inDirectory(row.directory))
        if (!outcome.ok) return yield* codeFailed(row, now, outcome)

        const values = {
          ...(outcome.state !== undefined && { state: outcome.state }),
          failures: 0,
          last_output: outcome.output ?? null,
        }
        const send = outcome.send
        if (!send) return yield* complete(values, outcome.done)
        const sent = yield* promptTarget(row, send.to ?? { session: owner.id }).pipe(
          Effect.flatMap((target) =>
            admit(
              target,
              send.prompt,
              {
                ...values,
                last_output: AutomationCode.handoffOutput(deliverySummary(target, send.to?.subagent), outcome.output),
              },
              outcome.done,
            ),
          ),
          Effect.result,
        )
        if (Result.isFailure(sent))
          return yield* codeFailed(row, now, {
            ok: false,
            output: outcome.output,
            error: sent.failure.message,
            invalid: sent.failure instanceof InvalidError || sent.failure instanceof FileSystem.DirectoryNotFoundError,
          })
      },
      (effect, row, now, _event?: AutomationEvent.Message) =>
        effect.pipe(Effect.catchTag("Automation.InvalidError", (error) => pauseWith(row, now, error.reason))),
    )

    /** Runs one due automation after checking leadership, expiry and whether automations are enabled. */
    const runDue = Effect.fnUntraced(function* (row: Row, now: number) {
      const due = row.next_due_at
      if (due === null) return
      // Claimed for each run, not once per tick: the lease may have passed to another process since the tick began.
      if (!(yield* claimLeader(now))) return
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
        // Reading config boots the location, so check again in an hour rather than every tick. The row keeps its
        // due time, so once automations are enabled it catches up like any missed slot.
        yield* settle(row, { last_outcome: "disabled", retry_at: now + DISABLED_RETRY, time_updated: now })
        return
      }
      return yield* runAction(row, now)
    })

    const tickAt = Effect.fnUntraced(function* (from: number) {
      const eligible = and(
        eq(AutomationTable.status, "active"),
        lte(AutomationTable.next_due_at, from),
        or(isNull(AutomationTable.retry_at), lte(AutomationTable.retry_at, from)),
      )
      const due = yield* db
        .select({ id: AutomationTable.id })
        .from(AutomationTable)
        .where(eligible)
        .orderBy(asc(AutomationTable.next_due_at))
        .all()
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        due,
        Effect.fnUntraced(function* ({ id }) {
          // Selection isn't admission: a timer queued behind slow actions can be paused, removed or rescheduled.
          const row = yield* db
            .select()
            .from(AutomationTable)
            .where(and(eq(AutomationTable.id, id), eligible))
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const now = yield* Clock.currentTimeMillis
          yield* runDue(row, now).pipe(
            Effect.catchCause((cause) => {
              if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
              const error = Cause.squash(cause)
              // The folder (e.g. a removed worktree) is gone; pause rather than retrying every 5 minutes.
              if (error instanceof FileSystem.DirectoryNotFoundError)
                return pauseWith(row, now, `Directory no longer exists: ${error.directory}`)
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
          )
        }),
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

    // A crash between admission and a Session claiming the work can lose the wake. Each automation records only its
    // last admission, not earlier pending children. Inbox IDs and metadata supplied by callers are not run receipts.
    const rewake = db
      .selectDistinct({ sessionID: SessionInboxTable.session_id })
      .from(AutomationTable)
      .innerJoin(SessionInboxTable, eq(SessionInboxTable.id, AutomationTable.last_message_id))
      .all()
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) => Effect.forEach(rows, (row) => execution.wake(row.sessionID), { discard: true })),
      )

    const hasActiveRows = (timersOnly = false) =>
      db
        .select({ id: AutomationTable.id })
        .from(AutomationTable)
        .where(
          and(eq(AutomationTable.status, "active"), timersOnly ? isNotNull(AutomationTable.next_due_at) : undefined),
        )
        .limit(1)
        .get()
        .pipe(
          Effect.orDie,
          Effect.map((row) => row !== undefined),
        )

    const ownerID = randomUUID()
    // Claim once on startup even with nothing active: a finished automation may have left a prompt pending.
    let leadership: "unchecked" | "leader" | "follower" = "unchecked"

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

    const releaseLeader = Effect.gen(function* () {
      yield* FiberMap.clear(watches)
      leadership = "follower"
      yield* db
        .delete(KVTable)
        .where(and(eq(KVTable.key, LEADER_KEY), sql`json_extract(${KVTable.value}, '$.owner') = ${ownerID}`))
        .run()
        .pipe(Effect.ignore)
    })

    const heartbeat = Clock.currentTimeMillis.pipe(
      Effect.flatMap(claimLeader),
      Effect.ignore,
      Effect.schedule(Schedule.spaced(LEADER_TTL / 3)),
    )

    // Re-check the original placement and the resource-specific grant before opening a stream or running an action.
    const checkWatch = Effect.fnUntraced(function* (row: Row, server: string) {
      const owner = row.session_id === null ? undefined : yield* existing(row.session_id)
      if (
        !owner ||
        owner.projectID !== row.project_id ||
        owner.location.directory !== row.directory ||
        owner.location.workspaceID !== undefined
      )
        return yield* new InvalidError({
          reason: "The session that authorized this watch moved or was deleted",
        })
      const action = "opencode_watch_mcp_event"
      yield* Effect.gen(function* () {
        yield* Plugin.awaitActivation
        const agents = yield* Agent.Service
        const agent = yield* agents.select(owner.agent)
        if (!agent.info || agent.id !== row.event_position?.agent)
          return yield* new InvalidError({
            reason: "The session agent that authorized this watch changed",
          })
        const permission = yield* Permission.Service
        yield* permission
          .assert({
            action,
            resources: [server],
            sessionID: owner.id,
            agent: agent.id,
          })
          .pipe(Effect.provideService(Permission.Unattended, [{ action, resource: server, effect: "allow" }]))
      }).pipe(inDirectory(row.directory))
    })

    // Like a timer, a watch where automations are off stays active and is checked again later. It starts from now
    // when it reopens, so nothing that happened while it was off runs.
    const disableWatch = (row: Row, now: number) =>
      settle(row, {
        last_outcome: "disabled",
        retry_at: now + DISABLED_RETRY,
        event_position: row.event_position && { ...row.event_position, cursor: null },
        time_updated: now,
      })

    const expireWatch = (row: Row, now: number) =>
      settle(row, {
        status: "done",
        last_outcome: "expired",
        time_updated: now,
      })

    const watch = Effect.fnUntraced(function* (id: ID, expires: number | null) {
      // Expiry stops admission, but cannot cut a delivery between its inbox write and cursor commit.
      const delivery = yield* Semaphore.make(1)
      const expire = Effect.gen(function* () {
        yield* expireWatch(yield* find(id), yield* Clock.currentTimeMillis)
      })
      const open = Effect.gen(function* () {
        const row = yield* find(id)
        const trigger = row.trigger
        if (row.status !== "active" || trigger.type !== "event") return Stream.empty
        const now = yield* Clock.currentTimeMillis
        if (row.expires_at !== null && now >= row.expires_at) return Stream.fromEffectDrain(expireWatch(row, now))
        if (!(yield* settings(row.directory)).enabled) return Stream.fromEffectDrain(disableWatch(row, now))
        yield* checkWatch(row, trigger.server)
        const position = row.event_position
        if (!position)
          return yield* new InvalidError({
            reason: "No authorized event watch",
          })
        const stream = yield* AutomationEvent.follow(trigger, { cursor: position.cursor ?? null, seen: [] }).pipe(
          inDirectory(row.directory),
        )
        return stream.pipe(
          Stream.takeWhileEffect(
            Effect.fnUntraced(function* (update) {
              if (update.type === "pending") return true
              const current = yield* find(id)
              const at = yield* Clock.currentTimeMillis
              if (current.status !== "active" || !(yield* claimLeader(at))) return false
              if (current.expires_at !== null && at >= current.expires_at) {
                yield* expireWatch(current, at)
                return false
              }
              if (!(yield* settings(current.directory)).enabled) {
                yield* disableWatch(current, at)
                return false
              }
              yield* checkWatch(current, trigger.server)
              if (update.type === "position") {
                yield* settle(current, {
                  event_position: { ...position, ...current.event_position, cursor: update.position.cursor },
                })
                return true
              }
              yield* runAction(current, at, update)
              return (yield* find(id)).status === "active"
            }, delivery.withPermit),
          ),
        )
      }).pipe(Stream.unwrap, Stream.runDrain)
      const run =
        expires === null
          ? open
          : Effect.raceFirst(
              open,
              Effect.gen(function* () {
                yield* Effect.sleep(Math.max(0, expires - (yield* Clock.currentTimeMillis)))
                yield* delivery.withPermit(expire)
              }),
            )
      yield* run.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.gen(function* () {
                const reason = Cause.squash(cause)
                const row = yield* find(id)
                if (row.status === "active")
                  yield* pauseWith(
                    row,
                    yield* Clock.currentTimeMillis,
                    (reason instanceof Error ? reason.message : String(reason)).slice(0, 1024),
                  )
              }),
        ),
        Effect.catchTag("Automation.NotFoundError", () => Effect.void),
      )
    })

    // The lease/doorbell loop also sees changes from other processes. It never polls a producer for events.
    const reconcileWatches = Effect.fnUntraced(function* (now: number) {
      const active = yield* db
        .select()
        .from(AutomationTable)
        .where(
          and(
            eq(AutomationTable.status, "active"),
            isNull(AutomationTable.next_due_at),
            or(isNull(AutomationTable.retry_at), lte(AutomationTable.retry_at, now)),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      const ids = new Set(active.map((row) => row.id))
      for (const [id] of Array.from(watches)) if (!ids.has(id)) yield* FiberMap.remove(watches, id)
      for (const row of active) {
        // An open watch whose directory turned automations off closes now, not on its next event. Its directory is
        // already loaded, so reading its config is cheap.
        if (yield* FiberMap.has(watches, row.id)) {
          // A missing directory is left to the watch, which pauses on it.
          const enabled = yield* settings(row.directory).pipe(
            Effect.map((config) => config.enabled),
            Effect.catchTag("FileSystem.DirectoryNotFoundError", () => Effect.succeed(true)),
          )
          if (enabled) continue
          yield* FiberMap.remove(watches, row.id)
          yield* disableWatch(row, now)
          continue
        }
        yield* FiberMap.run(watches, row.id, watch(row.id, row.expires_at), { onlyIfMissing: true })
      }
      return active.length
    })

    /** Sleeps until the doorbell rings (an automation was created or resumed) or MAX_SLEEP passes. */
    const idle = doorbell.await.pipe(Effect.timeoutOption(MAX_SLEEP))

    const loop = Effect.gen(function* () {
      yield* doorbell.close
      const active = yield* hasActiveRows()
      if (!active && leadership !== "unchecked") {
        if (leadership === "leader") yield* releaseLeader
        return yield* idle
      }
      const now = yield* Clock.currentTimeMillis
      if (!(yield* claimLeader(now))) {
        yield* FiberMap.clear(watches)
        leadership = "follower"
        return yield* idle
      }
      if (leadership !== "leader") {
        leadership = "leader"
        yield* rewake.pipe(Effect.catchCause((cause) => Effect.logError("automation rewake failed", { cause })))
      }
      if (!active) {
        yield* releaseLeader
        return yield* idle
      }
      // No timer tick or next-slot query for event-only databases; timer-only databases need no extra probe.
      if ((yield* reconcileWatches(now)) > 0 && !(yield* hasActiveRows(true))) return yield* idle
      yield* Effect.scoped(
        Effect.forkScoped(heartbeat).pipe(
          Effect.andThen(
            tickAt(now).pipe(Effect.catchCause((cause) => Effect.logError("automation tick failed", { cause }))),
          ),
        ),
      )
      if (!(yield* hasActiveRows())) {
        yield* releaseLeader
        return yield* idle
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
        case "event":
          return { trigger, due: null }
        case "at": {
          const at = parseTime(trigger.at, zone, now)
          if (Option.isNone(at)) return yield* new InvalidError({ reason: `Invalid time: ${trigger.at}` })
          if (at.value <= now) return yield* new InvalidError({ reason: `Time is in the past: ${trigger.at}` })
          const stored: Trigger = RELATIVE.test(trigger.at.trim())
            ? { ...trigger, at: new Date(at.value).toISOString() }
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

    /** Resolves a prompt target or authorizes an unattended action. */
    const resolveAction = Effect.fnUntraced(function* (
      input: CreateInput,
      owner: SessionSchema.Info | undefined,
      trigger: Trigger,
      directory: string,
      projectID: ProjectID,
      invocation?: Invocation,
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
          yield* subagent(owner, to.subagent, invocation)
        }
        return { type: "prompt" as const, prompt: action.prompt, to }
      }
      if (action.type === "shell") {
        if (!owner) return yield* new InvalidError({ reason: "A shell action needs a session" })
        yield* AutomationShell.authorize(owner, input.name, trigger, action, invocation).pipe(
          instances.provide(owner),
          Effect.mapError((error) => (typeof error === "string" ? new InvalidError({ reason: error }) : error)),
        )
        return action
      }
      // Tool permissions are asked in, and checked against, the creating Session.
      if (owner === undefined) return yield* new InvalidError({ reason: "A code action needs a session" })
      const code = { type: "code" as const, code: action.code, args: action.args }
      yield* AutomationCode.authorize(owner, input.name, trigger, code, invocation).pipe(
        inDirectory(directory),
        Effect.mapError((error) => (typeof error === "string" ? new InvalidError({ reason: error }) : error)),
      )
      return code
    })

    return Service.of({
      create: Effect.fn("Automation.create")(function* (input, invocation) {
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
        if (input.trigger.type === "event") {
          const trigger = input.trigger
          if (!owner || !invocation || owner.location.workspaceID !== undefined)
            return yield* new InvalidError({
              reason: "Create an event automation from a tool call in a local session",
            })
          yield* Effect.gen(function* () {
            const agents = yield* Agent.Service
            const agent = yield* agents.select(owner.agent)
            if (!matchesAuthor(owner, agent.info, invocation))
              return yield* new InvalidError({
                reason: "Create the watch with the session's current agent",
              })
            const permission = yield* Permission.Service
            yield* permission.assert({
              ...invocation,
              action: "opencode_watch_mcp_event",
              resources: [trigger.server],
              metadata: { automation: input.name, trigger },
            })
            yield* AutomationEvent.check(trigger).pipe(
              Effect.mapError((error) => new InvalidError({ reason: error.message })),
            )
          }).pipe(inDirectory(directory), Effect.catchTag("FileSystem.DirectoryNotFoundError", missingDirectory))
        }
        const zone = yield* resolveZone(
          (input.trigger.type === "event" ? undefined : input.trigger.tz) ?? config.timezone,
        )
        const now = yield* Clock.currentTimeMillis
        const first = yield* firstDue(input.trigger, input.action, zone, now)
        const expiresAt =
          input.expires === undefined
            ? null
            : yield* Option.match(parseTime(input.expires, zone, now), {
                onNone: () => Effect.fail(new InvalidError({ reason: `Invalid time: ${input.expires}` })),
                onSome: Effect.succeed,
              })
        if (expiresAt !== null && (first.due ?? now) > expiresAt)
          return yield* new InvalidError({
            reason: "The automation expires before it first runs",
          })
        const projectID = owner?.projectID ?? (yield* projects.resolve(AbsolutePath.make(directory))).id
        const action = yield* resolveAction(input, owner, first.trigger, directory, projectID, invocation).pipe(
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
            event_position: first.trigger.type === "event" && invocation ? { agent: invocation.agent } : null,
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
        if (input?.sessionID !== undefined) {
          const session = yield* sessions.get(input.sessionID)
          if (!(yield* visible(session.location.directory))) return yield* new DisabledError()
        }
        const directory = input?.directory
        if (directory !== undefined && !path.isAbsolute(directory))
          return yield* new InvalidError({ reason: `Directory must be an absolute path: ${directory}` })
        if (directory !== undefined && !(yield* visible(directory))) return yield* new DisabledError()
        // Reading ownership must not record a Project for a folder that was only asked about.
        const owner =
          directory === undefined
            ? undefined
            : (yield* projects.resolve(AbsolutePath.make(directory), { persist: false })).id
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
        // A deleted folder may no longer resolve to its Project, so also match automations that ran there.
        const matching = rows.filter(
          (row) => directory === undefined || row.project_id === owner || row.directory === directory,
        )
        const shown = new Set(
          yield* Effect.filter(new Set(matching.map((row) => row.directory)), (item) => visible(item)),
        )
        return matching.filter((row) => shown.has(row.directory)).map(toInfo)
      }),
      get: Effect.fn("Automation.get")(function* (id, options) {
        return toInfo(yield* findVisible(id, options?.projectID))
      }),
      pause: Effect.fn("Automation.pause")(function* (id) {
        const row = yield* findVisible(id)
        if (row.status !== "active") return toInfo(row)
        yield* db
          .update(AutomationTable)
          .set({ status: "paused", time_updated: yield* Clock.currentTimeMillis })
          .where(and(eq(AutomationTable.id, id), eq(AutomationTable.status, "active")))
          .run()
          .pipe(Effect.orDie)
        if (row.trigger.type === "event") yield* FiberMap.remove(watches, id)
        return toInfo(yield* find(id))
      }),
      resume: Effect.fn("Automation.resume")(function* (id) {
        const row = yield* findVisible(id)
        if (row.status !== "paused") return toInfo(row)
        const now = yield* Clock.currentTimeMillis
        // An `at` that fell due while paused runs once, late, unless it has expired; a repeating automation resumes at
        // its next slot.
        const next =
          row.next_due_at === null || row.next_due_at > now ? row.next_due_at : (following(row, now) ?? row.next_due_at)
        const done = (row.trigger.type !== "event" && (next === null || finished(row, next))) || expired(row, now)
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
        yield* findVisible(id)
        yield* db.delete(AutomationTable).where(eq(AutomationTable.id, id)).run().pipe(Effect.orDie)
        yield* FiberMap.remove(watches, id)
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
  deps: [
    Database.node,
    FSUtil.node,
    Session.node,
    SessionExecution.node,
    Project.node,
    LocationServiceMap.node,
    Instance.node,
  ],
})
